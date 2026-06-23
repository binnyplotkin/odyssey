import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { getWikiStore } from "@odyssey/db";
import type { WikiIngestionLogRecord } from "@odyssey/db";
import type { IngestionEvent, PlanOp } from "@odyssey/wiki-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await ctx.params;
  const wiki = getWikiStore();
  const originalRun = await wiki.getIngestionRun(runId);
  if (!originalRun || originalRun.wikiId !== id) {
    return jsonError(404, "run not found");
  }
  if (!originalRun.sourceId) {
    return jsonError(400, "run has no source to retry");
  }

  const eventRows = await wiki.listIngestionEvents(runId, {
    afterSeq: 0,
    limit: 2000,
  });
  const events = eventRows
    .map((event) => event.payload)
    .filter(isIngestionEvent);
  const retryOps = failedOpsStillUnresolved(events);
  if (retryOps.length === 0) {
    return jsonError(400, "no failed operations found to retry");
  }
  const retryScopeKey = scopeKeyForOps(retryOps);
  const existingRetries = await listRetryRunsForOriginal({
    wiki,
    wikiId: id,
    sourceId: originalRun.sourceId,
    originalRunId: originalRun.id,
  });
  const activeRetry = existingRetries.find(
    ({ run, events }) =>
      (run.status === "queued" || run.status === "running") &&
      retryScopeKeyFromEvents(events) === retryScopeKey,
  );
  if (activeRetry) {
    return retryRunResponse({
      run: activeRetry.run,
      sourceId: originalRun.sourceId,
      originalRunId: originalRun.id,
      retryOps: retryOpsFromQueuedEvents(activeRetry.events).length,
      reused: true,
    });
  }

  const resolvedByRetrySlugs = completedSlugsFromRetries(existingRetries);
  const unresolvedRetryOps = failedOpsStillUnresolved(events, resolvedByRetrySlugs);
  if (unresolvedRetryOps.length === 0) {
    const successfulRetry = existingRetries.find(({ run, events }) => {
      return (
        run.status === "succeeded" &&
        retryScopeKeyFromEvents(events) === retryScopeKey
      );
    });
    return retryRunResponse({
      run: successfulRetry?.run ?? originalRun,
      sourceId: originalRun.sourceId,
      originalRunId: originalRun.id,
      retryOps: 0,
      reused: Boolean(successfulRetry),
      alreadyResolved: true,
    });
  }

  const retryRun = await wiki.startIngestion({
    wikiId: id,
    sourceId: originalRun.sourceId,
    model: originalRun.model,
    status: "queued",
    notes: `retry failed ops from ${originalRun.id}`,
  });

  await wiki.appendIngestionEvent(retryRun.id, {
    type: "queued",
    runId: retryRun.id,
    model: retryRun.model,
    retryOfRunId: originalRun.id,
    retryScopeKey: scopeKeyForOps(unresolvedRetryOps),
    retryOps: unresolvedRetryOps,
  } satisfies IngestionEvent);

  return retryRunResponse({
    run: retryRun,
    sourceId: originalRun.sourceId,
    originalRunId: originalRun.id,
    retryOps: unresolvedRetryOps.length,
    reused: false,
  });
}

async function listRetryRunsForOriginal(args: {
  wiki: ReturnType<typeof getWikiStore>;
  wikiId: string;
  sourceId: string;
  originalRunId: string;
}): Promise<Array<{ run: WikiIngestionLogRecord; events: IngestionEvent[] }>> {
  const runs = await args.wiki.listIngestionRunsForWiki(args.wikiId, 500);
  const candidates = runs.filter(
    (run) =>
      run.id !== args.originalRunId &&
      run.sourceId === args.sourceId &&
      (run.status === "queued" ||
        run.status === "running" ||
        run.status === "succeeded"),
  );
  const out: Array<{ run: WikiIngestionLogRecord; events: IngestionEvent[] }> =
    [];
  for (const run of candidates) {
    const events = (
      await args.wiki.listIngestionEvents(run.id, { afterSeq: 0, limit: 2000 })
    )
      .map((event) => event.payload)
      .filter(isIngestionEvent);
    const queuedRetry = events.find(
      (event) =>
        event.type === "queued" && event.retryOfRunId === args.originalRunId,
    );
    if (queuedRetry) out.push({ run, events });
  }
  return out;
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
  const stored = (queued as { retryScopeKey?: unknown } | undefined)
    ?.retryScopeKey;
  if (typeof stored === "string" && stored) return stored;
  const ops = queued?.retryOps?.filter(isPlanOp) ?? [];
  return ops.length > 0 ? scopeKeyForOps(ops) : null;
}

function scopeKeyForOps(ops: PlanOp[]): string {
  const slugs = ops.map((op) => op.slug).sort();
  return createHash("sha256").update(JSON.stringify(slugs)).digest("hex");
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

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function retryRunResponse(args: {
  run: WikiIngestionLogRecord;
  sourceId: string;
  originalRunId: string;
  retryOps: number;
  reused: boolean;
  alreadyResolved?: boolean;
}) {
  return Response.json(
    {
      runId: args.run.id,
      sourceId: args.sourceId,
      retryOfRunId: args.originalRunId,
      retryOps: args.retryOps,
      status: args.run.status,
      reused: args.reused,
      alreadyResolved: args.alreadyResolved ?? false,
    },
    {
      status: args.run.status === "succeeded" ? 200 : 202,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
