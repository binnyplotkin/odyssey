import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import {
  getWikiStore,
  getWikisStore,
  type WikiIngestionLogRecord,
  type WikiSourceKind,
  type WikiSourceRecord,
} from "@odyssey/db";
import { isKnownModel, type IngestionEvent, type PlanOp } from "@odyssey/wiki-ingest";
import { parseSourceFrontmatter } from "@/lib/source-frontmatter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SourceType = "primary" | "secondary" | "tertiary";

type IngestBody = {
  title: string;
  /** @deprecated collapsing into `sourceType`; still accepted for back-compat. */
  kind?: WikiSourceKind;
  sourceType?: SourceType;
  /** Structured citation from the Classify tab; merged into frontmatter → classify.citation. */
  citation?: {
    author?: string;
    year?: number | string;
    publisher?: string;
    isbn?: string;
  };
  /** Structured About facets from the Classify tab; merged into frontmatter → classify.facets. */
  facets?: {
    themes?: string[];
    location?: string[];
    timePeriod?: string;
    participants?: string[];
  };
  tags?: string[];
  content: string;
  frontmatter?: string;
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

const VALID_SOURCE_TYPES = new Set<SourceType>([
  "primary",
  "secondary",
  "tertiary",
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
  if (body.frontmatter != null && typeof body.frontmatter !== "string") {
    return jsonError(400, "frontmatter must be a YAML string");
  }
  if (body.sourceType != null && !VALID_SOURCE_TYPES.has(body.sourceType)) {
    return jsonError(400, `invalid sourceType "${body.sourceType}"`);
  }
  if (body.kind != null && !ACCEPTED_KINDS.has(body.kind)) {
    return jsonError(400, `invalid kind "${body.kind}"`);
  }
  if (body.sourceType == null && body.kind == null) {
    return jsonError(400, "sourceType (or legacy kind) is required");
  }
  if (body.model && !isKnownModel(body.model)) {
    return jsonError(400, `unknown model "${body.model}"`);
  }

  const wikiRecord = await getWikisStore().getWikiById(id);
  if (!wikiRecord) return jsonError(404, "wiki not found");

  const frontmatter = parseSourceFrontmatter(body.frontmatter);
  if (!frontmatter.ok) {
    return jsonError(400, frontmatter.error);
  }

  const wiki = getWikiStore();
  const sourceContent = body.content;
  const contentHash = sha256Hex(sourceContent);
  const existingSources = await wiki.listSourcesForWiki(wikiRecord.id);
  const duplicateSource = existingSources.find(
    (source) => source.contentHash === contentHash,
  );
  if (duplicateSource) {
    return resumeDuplicateSource({
      wiki,
      wikiId: wikiRecord.id,
      source: duplicateSource,
      model: body.model ?? null,
    });
  }

  const source = await wiki.createSource({
    wikiId: wikiRecord.id,
    title: body.title.trim(),
    kind: body.kind,
    sourceType: body.sourceType,
    content: sourceContent,
    metadata: {
      tags: (body.tags ?? [])
        .filter((t) => typeof t === "string" && t.trim())
        .map((t) => t.trim()),
      frontmatterRaw: frontmatter.raw,
      frontmatter: mergeFacets(
        mergeCitation(frontmatter.metadata, body.citation),
        body.facets,
      ),
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

async function resumeDuplicateSource(args: {
  wiki: ReturnType<typeof getWikiStore>;
  wikiId: string;
  source: WikiSourceRecord;
  model: string | null;
}) {
  const runs = (await args.wiki.listIngestionRunsForWiki(args.wikiId, 500))
    .filter((run) => run.sourceId === args.source.id)
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  const activeRun = runs.find(
    (run) => run.status === "queued" || run.status === "running",
  );
  if (activeRun) {
    return ingestRunResponse({
      run: activeRun,
      sourceId: args.source.id,
      duplicateSourceId: args.source.id,
      reused: true,
    });
  }

  const runEvents = new Map<string, IngestionEvent[]>();
  const eventsForRun = async (runId: string) => {
    const cached = runEvents.get(runId);
    if (cached) return cached;
    const events = (
      await args.wiki.listIngestionEvents(runId, { afterSeq: 0, limit: 2000 })
    )
      .map((event) => event.payload)
      .filter(isIngestionEvent);
    runEvents.set(runId, events);
    return events;
  };

  for (const failedRun of runs.filter((run) => run.status === "failed")) {
    const events = await eventsForRun(failedRun.id);
    const initiallyFailedOps = failedOpsStillUnresolved(events);
    if (initiallyFailedOps.length === 0) continue;
    const retryScopeKey = scopeKeyForOps(initiallyFailedOps);
    const relatedRetries = [];
    for (const run of runs) {
      if (run.id === failedRun.id) continue;
      const events = await eventsForRun(run.id);
      const queuedRetry = events.find(
        (event) =>
          event.type === "queued" &&
          event.retryOfRunId === failedRun.id &&
          retryScopeKeyFromEvents(events) === retryScopeKey,
      );
      if (queuedRetry) relatedRetries.push({ run, events });
    }

    const activeRetry = relatedRetries.find(
      ({ run }) => run.status === "queued" || run.status === "running",
    );
    if (activeRetry) {
      return ingestRunResponse({
        run: activeRetry.run,
        sourceId: args.source.id,
        duplicateSourceId: args.source.id,
        retryOfRunId: failedRun.id,
        retryOps: retryOpsFromQueuedEvents(activeRetry.events).length,
        reused: true,
      });
    }

    const resolvedSlugs = completedSlugsFromRetries(relatedRetries);
    const retryOps = failedOpsStillUnresolved(events, resolvedSlugs);
    if (retryOps.length === 0) continue;

    const retryRun = await args.wiki.startIngestion({
      wikiId: args.wikiId,
      sourceId: args.source.id,
      model: failedRun.model ?? args.model,
      status: "queued",
      notes: `resume duplicate source; retry failed ops from ${failedRun.id}`,
    });
    await args.wiki.appendIngestionEvent(retryRun.id, {
      type: "queued",
      runId: retryRun.id,
      model: retryRun.model,
      retryOfRunId: failedRun.id,
      retryScopeKey: scopeKeyForOps(retryOps),
      retryOps,
    } satisfies IngestionEvent);

    return ingestRunResponse({
      run: retryRun,
      sourceId: args.source.id,
      duplicateSourceId: args.source.id,
      retryOfRunId: failedRun.id,
      retryOps: retryOps.length,
      reused: false,
    });
  }

  const latestRun = runs[0];
  if (latestRun?.status === "succeeded") {
    return ingestRunResponse({
      run: latestRun,
      sourceId: args.source.id,
      duplicateSourceId: args.source.id,
      reused: true,
      alreadyIngested: true,
    });
  }

  // The source exists but its most recent run ended without success and left no
  // retryable ops behind — it died at a pre-op step (load / survey / plan), so
  // the op-retry loop above found nothing to resume. Echoing that dead run
  // would strand the source forever (every re-Run just replays the old error),
  // so enqueue a FRESH full run instead. Active queued/running runs and
  // op-level failures were already handled above, so this is only reached for
  // terminal non-success states (failed / cancelled).
  if (latestRun) {
    const freshRun = await args.wiki.startIngestion({
      wikiId: args.wikiId,
      sourceId: args.source.id,
      model: latestRun.model ?? args.model,
      status: "queued",
      notes: `resume duplicate source; fresh run after pre-op ${latestRun.status} of ${latestRun.id}`,
    });
    await args.wiki.appendIngestionEvent(freshRun.id, {
      type: "queued",
      runId: freshRun.id,
      model: freshRun.model,
    });
    return ingestRunResponse({
      run: freshRun,
      sourceId: args.source.id,
      duplicateSourceId: args.source.id,
      reused: false,
    });
  }

  return jsonError(409, "This source already exists but has no ingestion runs.");
}

function ingestRunResponse(args: {
  run: WikiIngestionLogRecord;
  sourceId: string;
  duplicateSourceId?: string;
  retryOfRunId?: string;
  retryOps?: number;
  reused: boolean;
  alreadyIngested?: boolean;
}) {
  return Response.json(
    {
      runId: args.run.id,
      sourceId: args.sourceId,
      duplicateSourceId: args.duplicateSourceId,
      retryOfRunId: args.retryOfRunId,
      retryOps: args.retryOps ?? 0,
      status: args.run.status,
      reused: args.reused,
      alreadyIngested: args.alreadyIngested ?? false,
    },
    {
      status: args.run.status === "succeeded" ? 200 : 202,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}

function failedOpsStillUnresolved(
  events: IngestionEvent[],
  resolvedSlugs = new Set<string>(),
): PlanOp[] {
  const completedSlugs = new Set<string>();
  for (const event of events) {
    if (event.type === "op-complete" && isPlanOp(event.op)) {
      completedSlugs.add(event.op.slug);
    }
  }

  const retryBySlug = new Map<string, PlanOp>();
  for (const event of events) {
    if (event.type !== "op-failed") continue;
    if (!isPlanOp(event.op)) continue;
    if (completedSlugs.has(event.op.slug)) continue;
    if (resolvedSlugs.has(event.op.slug)) continue;
    retryBySlug.set(event.op.slug, event.op);
  }
  return Array.from(retryBySlug.values());
}

function completedSlugsFromRetries(
  retries: Array<{ run: WikiIngestionLogRecord; events: IngestionEvent[] }>,
): Set<string> {
  const slugs = new Set<string>();
  for (const { run, events } of retries) {
    if (run.status !== "succeeded") continue;
    for (const event of events) {
      if (event.type === "op-complete" && isPlanOp(event.op)) {
        slugs.add(event.op.slug);
      }
    }
  }
  return slugs;
}

function retryOpsFromQueuedEvents(events: IngestionEvent[]): PlanOp[] {
  const queued = events.find(
    (event): event is Extract<IngestionEvent, { type: "queued" }> =>
      event.type === "queued",
  );
  return queued?.retryOps?.filter(isPlanOp) ?? [];
}

function retryScopeKeyFromEvents(events: IngestionEvent[]): string | null {
  const queued = events.find(
    (event): event is Extract<IngestionEvent, { type: "queued" }> =>
      event.type === "queued",
  );
  if (!queued) return null;
  if (typeof queued.retryScopeKey === "string" && queued.retryScopeKey) {
    return queued.retryScopeKey;
  }
  const ops = queued.retryOps?.filter(isPlanOp) ?? [];
  return ops.length > 0 ? scopeKeyForOps(ops) : null;
}

function scopeKeyForOps(ops: PlanOp[]): string {
  const slugs = ops.map((op) => op.slug).sort();
  return sha256Hex(JSON.stringify(slugs));
}

function isIngestionEvent(payload: unknown): payload is IngestionEvent {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { type?: unknown }).type === "string"
  );
}

function isPlanOp(value: unknown): value is PlanOp {
  if (typeof value !== "object" || value === null) return false;
  const op = value as Partial<PlanOp>;
  return (
    (op.action === "create" || op.action === "update" || op.action === "skip") &&
    typeof op.slug === "string" &&
    typeof op.type === "string" &&
    typeof op.title === "string" &&
    typeof op.rationale === "string"
  );
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Fold structured Classify citation fields into the parsed frontmatter (structured wins). */
function mergeCitation(
  frontmatter: Record<string, unknown>,
  citation: IngestBody["citation"],
): Record<string, unknown> {
  if (!citation) return frontmatter;
  const merged = { ...frontmatter };
  if (citation.author?.trim()) merged.author = citation.author.trim();
  const year =
    typeof citation.year === "string" ? Number(citation.year) : citation.year;
  if (typeof year === "number" && Number.isFinite(year)) merged.year = year;
  if (citation.publisher?.trim()) merged.publisher = citation.publisher.trim();
  if (citation.isbn?.trim()) merged.isbn = citation.isbn.trim();
  return merged;
}

/** Fold structured About facets into frontmatter (→ classify.facets on ingest). */
function mergeFacets(
  frontmatter: Record<string, unknown>,
  facets: IngestBody["facets"],
): Record<string, unknown> {
  if (!facets) return frontmatter;
  const merged = { ...frontmatter };
  if (facets.themes?.length) merged.themes = facets.themes;
  if (facets.location?.length) merged.location = facets.location;
  if (facets.timePeriod?.trim()) merged.time_period = facets.timePeriod.trim();
  if (facets.participants?.length) merged.participants = facets.participants;
  return merged;
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
