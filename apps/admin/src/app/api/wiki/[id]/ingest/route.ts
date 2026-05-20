import { NextRequest } from "next/server";
import { getWikiStore, getWikisStore, type WikiSourceKind } from "@odyssey/db";
import { isKnownModel } from "@odyssey/wiki-ingest";

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

const ACCEPTED_KINDS = new Set<WikiSourceKind>([
  "bible",
  "commentary",
  "midrash",
  "note",
  "transcript",
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

  const wikiRecord = await getWikisStore().getWikiById(id);
  if (!wikiRecord) return jsonError(404, "wiki not found");

  const wiki = getWikiStore();
  const source = await wiki.createSource({
    wikiId: wikiRecord.id,
    title: body.title.trim(),
    kind: body.kind,
    content: body.content,
    metadata: {
      tags: (body.tags ?? [])
        .filter((t) => typeof t === "string" && t.trim())
        .map((t) => t.trim()),
      ...(body.notes?.trim() ? { notes: body.notes.trim() } : {}),
    },
  });

  const run = await wiki.startIngestion({
    wikiId: wikiRecord.id,
    sourceId: source.id,
    model: body.model ?? null,
    status: "queued",
    notes: body.notes?.trim() || null,
  });

  await wiki.appendIngestionEvent(run.id, {
    type: "queued",
    runId: run.id,
    model: body.model ?? null,
  });

  return new Response(JSON.stringify({
    runId: run.id,
    sourceId: source.id,
    status: run.status,
  }), {
    status: 202,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
