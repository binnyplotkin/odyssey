import { NextRequest } from "next/server";
import { getCharacterStore, getWikiStore, type WikiSourceKind } from "@odyssey/db";
import { runIngestion, isKnownModel } from "@odyssey/wiki-ingest";

/**
 * POST /api/characters/:id/ingest
 *
 * Body: { title, kind, tags[], content, model? }
 * Creates a wiki_source row, then streams IngestionEvents back as SSE.
 *
 * Keep-alive is ensured by the event frequency — the pipeline emits at
 * least a "planning" / "op-start" event within seconds. Vercel's streaming
 * response passes through as long as data keeps flowing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IngestBody = {
  title: string;
  kind: WikiSourceKind;
  tags?: string[];
  content: string;
  model?: string;
  notes?: string;
};

const VALID_KINDS: WikiSourceKind[] = [
  "bible", // legacy — treated as "primary" by convention; we'll accept it
  "commentary",
  "midrash",
  "note",
  "transcript",
] as WikiSourceKind[];

// Also accept the new generic taxonomy (primary/annotation/reference).
const ACCEPTED_KINDS = new Set([
  ...VALID_KINDS,
  "primary",
  "annotation",
  "reference",
]);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }

  if (!body.title?.trim()) return jsonError(400, "title is required");
  if (!body.content?.trim()) return jsonError(400, "content is required");
  if (!body.kind || !ACCEPTED_KINDS.has(body.kind)) {
    return jsonError(400, `invalid kind "${body.kind}"`);
  }
  if (body.model && !isKnownModel(body.model)) {
    return jsonError(400, `unknown model "${body.model}"`);
  }

  const character = await getCharacterStore().getById(id);
  if (!character) return jsonError(404, "character not found");

  // Create the source row up-front. If the user's connection drops mid-run,
  // the source is at least persisted and the ingestion log will reflect a
  // running-then-orphaned state (surfaced as "failed" on retry).
  const wiki = getWikiStore();
  const source = await wiki.createSource({
    characterId: character.id,
    title: body.title.trim(),
    kind: body.kind,
    content: body.content,
    metadata: {
      tags: (body.tags ?? []).filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim()),
    },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Send an initial heartbeat so the client knows the stream is alive.
      controller.enqueue(encoder.encode(`:connected\n\n`));

      try {
        for await (const ev of runIngestion({
          characterId: character.id,
          sourceId: source.id,
          model: body.model,
        })) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(ev)}\n\n`),
          );
          if (ev.type === "succeeded" || ev.type === "failed") break;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "failed",
              error: msg,
              tokensUsed: 0,
            })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable Vercel buffering for genuine streaming behaviour.
      "X-Accel-Buffering": "no",
    },
  });
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
