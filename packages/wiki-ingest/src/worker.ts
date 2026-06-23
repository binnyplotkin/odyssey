import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { getWikiStore } from "@odyssey/db";
import { embedText, embedTexts, EMBEDDING_MODEL } from "@odyssey/engine";
import { runIngestion } from "./pipeline";
import type { PlanOp } from "./types";

const workerId = process.env.WIKI_INGEST_WORKER_ID ?? `wiki-ingest-${process.pid}`;
const pollMs = Number(process.env.WIKI_INGEST_POLL_MS ?? 2000);
let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function workOne(): Promise<boolean> {
  const wiki = getWikiStore();
  const run = await wiki.claimNextQueuedIngestion(workerId);
  if (!run) return false;

  if (!run.wikiId || !run.sourceId) {
    const failed = {
      type: "failed" as const,
      error: "queued ingestion run is missing wiki_id or source_id",
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    await wiki.appendIngestionEvent(run.id, failed);
    await wiki.finishIngestion(run.id, {
      status: "failed",
      errorMessage: failed.error,
    });
    return true;
  }

  console.log(`[wiki-ingest-worker] claimed ${run.id}`);
  const heartbeat = setInterval(() => {
    void wiki.touchIngestionRun(run.id, workerId).catch((err) => {
      console.error("[wiki-ingest-worker] heartbeat failed", err);
    });
  }, 30_000);

  try {
    const retryOps = await loadRetryOps(wiki, run.id);
    for await (const ev of runIngestion({
      wikiId: run.wikiId,
      sourceId: run.sourceId,
      runId: run.id,
      model: run.model ?? undefined,
      retryOps,
      embed: embedText,
      embedMany: embedTexts,
      embeddingModel: EMBEDDING_MODEL,
    })) {
      await wiki.appendIngestionEvent(run.id, ev);
      await wiki.touchIngestionRun(run.id, workerId);
      if (ev.type === "succeeded") {
        await wiki.finishIngestion(run.id, {
          status: "succeeded",
          pagesCreated: ev.result.pagesCreated,
          pagesUpdated: ev.result.pagesUpdated,
          edgesAdded: ev.result.edgesAdded,
          contradictionsFound: ev.result.contradictionsFound,
          tokensUsed: ev.result.tokensUsed,
        });
        break;
      }
      if (ev.type === "failed") {
        await wiki.finishIngestion(run.id, {
          status: "failed",
          tokensUsed: ev.tokensUsed,
          errorMessage: ev.error,
        });
        break;
      }
    }
    console.log(`[wiki-ingest-worker] completed ${run.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = {
      type: "failed" as const,
      error: message,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    await wiki.appendIngestionEvent(run.id, failed);
    await wiki.finishIngestion(run.id, {
      status: "failed",
      errorMessage: message,
    });
    console.error(`[wiki-ingest-worker] failed ${run.id}`, err);
  } finally {
    clearInterval(heartbeat);
  }

  return true;
}

async function loadRetryOps(
  wiki: ReturnType<typeof getWikiStore>,
  runId: string,
): Promise<PlanOp[] | undefined> {
  const events = await wiki.listIngestionEvents(runId, { afterSeq: 0, limit: 20 });
  const queued = events
    .map((event) => event.payload)
    .find(isQueuedRetryPayload);
  return queued?.retryOps?.filter(isPlanOp);
}

function isQueuedRetryPayload(
  payload: unknown,
): payload is { type: "queued"; retryOps: unknown[] } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { type?: unknown }).type === "queued" &&
    Array.isArray((payload as { retryOps?: unknown }).retryOps)
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

async function main() {
  console.log(`[wiki-ingest-worker] started workerId=${workerId}`);
  while (!stopping) {
    const didWork = await workOne();
    if (!didWork) await sleep(pollMs);
  }
  console.log("[wiki-ingest-worker] stopped");
}

main().catch((err) => {
  console.error("[wiki-ingest-worker] crashed", err);
  process.exit(1);
});
