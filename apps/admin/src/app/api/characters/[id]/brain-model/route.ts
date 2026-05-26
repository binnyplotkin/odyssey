import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCharacterStore, type CharacterBrainModel } from "@odyssey/db";
import { MODEL_REGISTRY } from "@/lib/model-registry";
import { invalidateCharactersList } from "@/lib/characters-cache";
import { invalidateCharacterDetail } from "@/lib/character-detail-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/brain-model
 *
 * Saves the L04 Brain / Model on a character. Validates that the model
 * id is one of the registry entries marked as chat-compatible. Empty
 * fields are stripped so the persisted shape stays tight; the chat
 * route only overrides defaults for keys that are explicitly set.
 *
 * Returns the updated CharacterRecord on success.
 *
 * Pass `{ brainModel: null }` to clear (chat route reverts to defaults).
 */

// Accept any chat-capable model from the registry, regardless of provider —
// Anthropic, OpenAI, Cerebras, and Groq today; Gemini etc. when they're
// added. The chat route routes by provider automatically via
// `getChatProviderForModel`.
const ALLOWED_CHAT_MODELS = new Set(
  MODEL_REGISTRY.filter((m) => m.modes.includes("chat")).map((m) => m.id),
);

// Voice-capable subset. The voice surface wires Anthropic + Cerebras + Groq
// today (OpenAI's realtime API is a different shape we haven't integrated),
// so we filter to those providers AND require the model declare
// `modes: ["voice"]` in the registry. Validation here keeps the L04 editor
// honest — picking an invalid voice model rejects at save time rather than
// silently 400-ing the voice-stream route on first speak.
const ALLOWED_VOICE_MODELS = new Set(
  MODEL_REGISTRY
    .filter(
      (m) =>
        m.modes.includes("voice") &&
        (m.provider === "anthropic" || m.provider === "cerebras" || m.provider === "groq"),
    )
    .map((m) => m.id),
);

// `provider` lookup map — used by FallbackSchema to coerce the right provider
// onto each fallback entry so the saved record stays consistent with the
// model id even if the client sends a mismatched value.
const PROVIDER_BY_MODEL = new Map(MODEL_REGISTRY.map((m) => [m.id, m.provider]));

const FallbackSchema = z.object({
  // Accepts any provider that has a chat provider wired in the engine.
  // Widen this enum + the chat-providers factory + CharacterBrainModel
  // in lockstep when a new provider lands.
  provider: z.enum(["anthropic", "openai", "cerebras", "groq"]),
  model: z.string().trim().refine((m) => ALLOWED_CHAT_MODELS.has(m), {
    message: "fallback model must be a chat-compatible registry entry",
  }),
  trigger: z.enum(["5xx", "rate_limit"]).optional(),
});

// The voice override block. Same shape as the top-level chat config but
// without cacheControl/fallbacks (see CharacterBrainModel docs for why),
// and constrained to voice-capable models.
const VoiceOverrideSchema = z.object({
  provider: z.enum(["anthropic", "cerebras", "groq"]).optional(),
  model: z
    .string()
    .trim()
    .refine((m) => ALLOWED_VOICE_MODELS.has(m), {
      message: "voice.model must be a voice-capable registry entry (Anthropic, Cerebras, or Groq)",
    })
    .optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().min(64).max(4096).optional(),
});

const BrainModelSchema = z.object({
  // Accepts any chat-capable provider. The chat route resolves which
  // SDK to use from the model id via the registry; storing provider
  // explicitly is for human readability + future fallback chains, not
  // runtime dispatch.
  provider: z.enum(["anthropic", "openai", "cerebras", "groq"]).optional(),
  model: z
    .string()
    .trim()
    .refine((m) => ALLOWED_CHAT_MODELS.has(m), {
      message: "model must be a chat-compatible registry entry",
    })
    .optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().min(64).max(4096).optional(),
  cacheControl: z.boolean().optional(),
  fallbacks: z.array(FallbackSchema).max(4).optional(),
  voice: VoiceOverrideSchema.optional(),
});

type Body = {
  brainModel: CharacterBrainModel | null;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }

  // Explicit null = clear (chat route reverts to defaults).
  if (body.brainModel === null) {
    const updated = await getCharacterStore().update(id, { brainModel: null });
    if (!updated) return jsonError(404, "character not found");
    invalidateCharactersList();
    invalidateCharacterDetail(id);
    return NextResponse.json({ character: updated });
  }

  const parsed = BrainModelSchema.safeParse(body.brainModel ?? {});
  if (!parsed.success) {
    return jsonError(400, `invalid mind model: ${parsed.error.message}`);
  }

  // Strip empty sub-fields so the persisted shape stays tight. Anything
  // the author hasn't explicitly touched simply isn't stored; the chat
  // route's defaults kick in for those keys.
  //
  // When a model is set but `provider` wasn't, coerce the provider from
  // the registry so the saved record always carries both fields in sync.
  // Prevents `{ model: "gpt-5", provider: "anthropic" }` from being stored
  // accidentally if the client forgets to update both.
  const cleaned: CharacterBrainModel = {};
  if (parsed.data.model) {
    cleaned.model = parsed.data.model;
    const coerced = PROVIDER_BY_MODEL.get(parsed.data.model);
    if (
      coerced === "anthropic" ||
      coerced === "openai" ||
      coerced === "cerebras" ||
      coerced === "groq"
    ) {
      cleaned.provider = coerced;
    } else if (parsed.data.provider) {
      cleaned.provider = parsed.data.provider;
    }
  } else if (parsed.data.provider) {
    cleaned.provider = parsed.data.provider;
  }
  if (typeof parsed.data.temperature === "number") cleaned.temperature = parsed.data.temperature;
  if (typeof parsed.data.topP === "number") cleaned.topP = parsed.data.topP;
  if (typeof parsed.data.maxTokens === "number") cleaned.maxTokens = parsed.data.maxTokens;
  if (typeof parsed.data.cacheControl === "boolean") cleaned.cacheControl = parsed.data.cacheControl;
  if (parsed.data.fallbacks?.length) cleaned.fallbacks = parsed.data.fallbacks;

  // Voice override block — only persist if it has any fields. Same
  // model→provider coercion as the top-level block so a saved record
  // can never carry a mismatched (model, provider) pair.
  if (parsed.data.voice) {
    const v = parsed.data.voice;
    const voice: NonNullable<CharacterBrainModel["voice"]> = {};
    if (v.model) {
      voice.model = v.model;
      const coerced = PROVIDER_BY_MODEL.get(v.model);
      if (coerced === "anthropic" || coerced === "cerebras" || coerced === "groq") {
        voice.provider = coerced;
      } else if (v.provider) {
        voice.provider = v.provider;
      }
    } else if (v.provider) {
      voice.provider = v.provider;
    }
    if (typeof v.temperature === "number") voice.temperature = v.temperature;
    if (typeof v.topP === "number") voice.topP = v.topP;
    if (typeof v.maxTokens === "number") voice.maxTokens = v.maxTokens;
    if (Object.keys(voice).length > 0) cleaned.voice = voice;
  }

  const updated = await getCharacterStore().update(id, { brainModel: cleaned });
  if (!updated) return jsonError(404, "character not found");

  invalidateCharactersList();
  invalidateCharacterDetail(id);
  return NextResponse.json({ character: updated });
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
