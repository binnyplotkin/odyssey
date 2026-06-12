import { NextRequest } from "next/server";
import { getCharacterStore, getVoiceStore, getSceneSessionStore } from "@odyssey/db";
import {
  createStreamingTtsAdapterForVoice,
  type StreamingTtsProvider,
  type VoiceForRouting,
} from "@odyssey/engine";
import {
  sandboxVoiceContextCacheKeyForDebug,
  startSandboxVoiceContextCacheWarm,
} from "@/lib/sandbox-voice-context-cache";
import {
  startVoiceAckAudioWarm,
  voiceAckAudioCacheKey,
  type CachedVoiceAckAudioFrame,
} from "@/lib/voice-ack-audio-cache";
import { isAckLaneEnabled, selectVoiceAck } from "@/lib/voice-ack-lane";
import { createEmbeddingSignedUrl } from "@/lib/voices-storage";
import type { Scene } from "@odyssey/wiki-curator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PrepareBody = {
  sessionId?: string | null;
  turnId?: string | null;
  partialTranscript?: string;
  scene?: Scene;
  tokenBudget?: number;
  startedAtMs?: number;
};

const DEFAULT_TOKEN_BUDGET = 2500;
const MIN_PARTIAL_CHARS = 8;
const TTS_DEFAULT_VOICE_SLUG = "abraham";
const TTS_DEFAULT_PROVIDER: StreamingTtsProvider = "pocket_tts";
type StreamingTtsRouting = ReturnType<typeof createStreamingTtsAdapterForVoice>;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: PrepareBody;
  try {
    body = (await req.json()) as PrepareBody;
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }

  const partial = body.partialTranscript?.trim() ?? "";
  if (partial.length < MIN_PARTIAL_CHARS) {
    return Response.json({ accepted: false, reason: "partial-too-short" });
  }

  const character =
    (await getCharacterStore().getById(id)) ??
    (await getCharacterStore().getBySlug(id));
  if (!character) return jsonError(404, "character not found");

  const tokenBudget = body.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const cacheKey = sandboxVoiceContextCacheKeyForDebug({
    characterId: character.id,
    sessionId: body.sessionId,
    scene: body.scene,
    tokenBudget,
  });
  const startedAt = performance.now();
  const warmPromise = startSandboxVoiceContextCacheWarm({
    characterId: character.id,
    sessionId: body.sessionId,
    query: partial,
    scene: body.scene,
    tokenBudget,
  });

  if (body.sessionId) {
    void warmPromise
      .then(async (entry) => {
        await getSceneSessionStore().appendEvent({
          sessionId: body.sessionId!,
          turnId: body.turnId ?? null,
          type: "context.prepare.ready",
          source: "system",
          payload: {
            cacheKey,
            queryChars: partial.length,
            selectedPages: entry.pages.map((selected) => selected.page.slug),
            tokensUsed: entry.tokensUsed,
            tokensBudget: entry.tokensBudget,
            elapsedMs: Math.round(performance.now() - startedAt),
            clientStartedAtMs: body.startedAtMs ?? null,
          },
        });

        const ackText = selectVoiceAck({
          enabled: isAckLaneEnabled(),
          characterTitle: character.title,
          message: partial,
          selectedPages: entry.pages,
        });
        if (!ackText) return;

        try {
          const routing = await resolvePrepareAckTtsRouting(character);
          const ackAudioKey = voiceAckAudioCacheKey({
            contextCacheKey: entry.key,
            ttsProvider: routing.provider,
            ttsVoice: routing.voiceContext.slug,
            ackText,
          });
          const ackStartedAt = performance.now();
          await startVoiceAckAudioWarm({
            key: ackAudioKey,
            ackText,
            synthesize: () => synthesizeAckAudio(routing, ackText),
          });
          await getSceneSessionStore().appendEvent({
            sessionId: body.sessionId!,
            turnId: body.turnId ?? null,
            type: "context.prepare.ack_audio.ready",
            source: "system",
            payload: {
              cacheKey,
              ackAudioKey,
              ackText,
              provider: routing.provider,
              voice: routing.voiceContext.slug,
              elapsedMs: Math.round(performance.now() - ackStartedAt),
            },
          });
        } catch (ackErr) {
          console.error("[voice-live.prepare] ack audio warm failed", ackErr);
          await getSceneSessionStore().appendEvent({
            sessionId: body.sessionId!,
            turnId: body.turnId ?? null,
            type: "context.prepare.ack_audio.failed",
            source: "system",
            payload: {
              cacheKey,
              ackText,
              message: ackErr instanceof Error ? ackErr.message : String(ackErr),
            },
          }).catch((eventErr) => {
            console.error("[voice-live.prepare] ack audio failure event failed", eventErr);
          });
        }
      })
      .catch((err) => {
        console.error("[voice-live.prepare] context warm failed", err);
      });
  }

  return Response.json({
    accepted: true,
    cacheKey,
    queryChars: partial.length,
  });
}

async function resolvePrepareAckTtsRouting(character: {
  slug?: string | null;
  voiceId?: string | null;
  voiceSettings?: unknown;
}): Promise<StreamingTtsRouting> {
  let voiceForRouting: VoiceForRouting;
  if (typeof character.voiceId === "string" && character.voiceId) {
    const bound = await getVoiceStore().getById(character.voiceId);
    if (bound?.status === "ready") {
      const embeddingUrl =
        bound.provider === "pocket_tts" && bound.embeddingPath
          ? await createEmbeddingSignedUrl(bound.embeddingPath).catch(() => null)
          : null;
      voiceForRouting = {
        provider: bound.provider as StreamingTtsProvider,
        slug: bound.slug,
        embeddingUrl,
        providerConfig: bound.providerConfig,
        voiceSettings:
          (character.voiceSettings as Record<string, unknown> | null) ?? null,
      };
    } else {
      voiceForRouting = {
        provider: TTS_DEFAULT_PROVIDER,
        slug: character.slug ?? TTS_DEFAULT_VOICE_SLUG,
        embeddingUrl: null,
      };
    }
  } else {
    voiceForRouting = {
      provider: TTS_DEFAULT_PROVIDER,
      slug: TTS_DEFAULT_VOICE_SLUG,
      embeddingUrl: null,
    };
  }

  return createStreamingTtsAdapterForVoice(voiceForRouting);
}

async function synthesizeAckAudio(
  routing: StreamingTtsRouting,
  ackText: string,
): Promise<CachedVoiceAckAudioFrame[]> {
  const frames: CachedVoiceAckAudioFrame[] = [];
  for await (const frame of routing.adapter.stream({
    text: ackText,
    voice: routing.voiceContext,
  })) {
    if (frame.type === "error") {
      throw new Error(frame.message);
    }
    frames.push({
      pcmFloat32Base64: frame.pcmFloat32Base64,
      samples: frame.samples,
      sampleRate: frame.sampleRate,
    });
  }
  return frames;
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
