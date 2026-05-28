import Link from "next/link";
import { notFound } from "next/navigation";
import type {
  WikiIngestionLogRecord,
  WikiPageRecord,
  WikiSourceRecord,
} from "@odyssey/db";
import { getWikiStore, getWikisStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string; runId: string }>;

type WikiIngestionEventRecord = Awaited<
  ReturnType<ReturnType<typeof getWikiStore>["listIngestionEvents"]>
>[number];

type PlanOpLike = {
  action?: unknown;
  slug?: unknown;
  type?: unknown;
  title?: unknown;
  rationale?: unknown;
  existingPageId?: unknown;
  sourcePassages?: unknown;
};

type CompletedEdit = {
  seq: number;
  createdAt: string;
  op: PlanOpLike;
  page: WikiPageRecord | null;
  edgesAdded: number;
  edgesRemoved: number;
  tokens: number;
};

type FailedEdit = {
  seq: number;
  createdAt: string;
  op: PlanOpLike;
  error: string;
};

export default async function WikiRunDetailPage({
  params,
}: {
  params: Params;
}) {
  const { id, runId } = await params;
  const wiki = await getWikisStore().getWikiById(id);
  if (!wiki) notFound();

  const store = getWikiStore();
  const [run, events] = await Promise.all([
    store.getIngestionRun(runId),
    store.listIngestionEvents(runId, { limit: 5000 }),
  ]);
  if (!run || run.wikiId !== wiki.id) notFound();

  const source = run.sourceId ? await store.getSource(run.sourceId) : null;
  const summary = deriveRunSummary(run, events);

  return (
    <main style={styles.page}>
      <section style={styles.header}>
        <div style={{ minWidth: 0 }}>
          <div style={styles.breadcrumb}>
            <Link href={`/wikis/${wiki.id}/runs`} style={styles.breadcrumbLink}>
              runs
            </Link>
            <span>/</span>
            <span>{run.id.slice(0, 8)}</span>
          </div>
          <h1 style={styles.title}>Ingestion run</h1>
          <div style={styles.subtitle}>
            {run.model ?? "model unknown"} · started {formatDate(run.startedAt)}
          </div>
        </div>
        <StatusPill status={run.status} />
      </section>

      <section style={styles.metrics}>
        <Metric label="created" value={run.pagesCreated} tone="success" />
        <Metric label="updated" value={run.pagesUpdated} />
        <Metric label="edges" value={run.edgesAdded} />
        <Metric
          label="contradictions"
          value={run.contradictionsFound}
          tone="warning"
        />
        <Metric label="tokens" value={run.tokensUsed.toLocaleString()} />
        <Metric label="events" value={events.length} />
      </section>

      <section style={styles.layout}>
        <div style={styles.mainStack}>
          <RunOverview run={run} source={source} />
          <PlanSection ops={summary.planOps} />
          <EditsSection
            edits={summary.completedEdits}
            failed={summary.failedEdits}
          />
          <EventTimeline events={events} />
        </div>
        <aside style={styles.rail}>
          <SummaryPanel run={run} summary={summary} source={source} />
          <RawPanel title="Run record" value={run} />
        </aside>
      </section>
    </main>
  );
}

function RunOverview({
  run,
  source,
}: {
  run: WikiIngestionLogRecord;
  source: WikiSourceRecord | null;
}) {
  return (
    <section style={styles.panel}>
      <SectionHeader title="Run details" eyebrow="summary" />
      <div style={styles.detailGrid}>
        <Detail label="run id" value={run.id} />
        <Detail label="status" value={run.status} />
        <Detail label="model" value={run.model ?? "unknown"} />
        <Detail label="prompt hash" value={run.promptHash ?? "none"} />
        <Detail
          label="source"
          value={source?.title ?? run.sourceId ?? "none"}
        />
        <Detail label="worker" value={run.workerId ?? "none"} />
        <Detail label="started" value={formatDate(run.startedAt)} />
        <Detail
          label="finished"
          value={run.finishedAt ? formatDate(run.finishedAt) : "not finished"}
        />
      </div>
      {run.errorMessage && (
        <div style={styles.errorBox}>
          <strong>Error</strong>
          <span>{run.errorMessage}</span>
        </div>
      )}
      {source && (
        <div style={styles.sourceBox}>
          <div style={styles.kicker}>Source snapshot</div>
          <div style={styles.sourceTitle}>{source.title}</div>
          <div style={styles.muted}>
            {source.kind} · {source.content.length.toLocaleString()} chars ·
            created {formatDate(source.createdAt)}
          </div>
          <pre style={styles.sourcePreview}>
            {source.content.slice(0, 1400)}
          </pre>
        </div>
      )}
    </section>
  );
}

function PlanSection({ ops }: { ops: PlanOpLike[] }) {
  return (
    <section style={styles.panel}>
      <SectionHeader title="Plan" eyebrow={`${ops.length} ops`} />
      {ops.length === 0 ? (
        <div style={styles.empty}>
          No plan-complete event was recorded for this run.
        </div>
      ) : (
        <div style={styles.opList}>
          {ops.map((op, index) => (
            <div
              key={`${stringVal(op.slug) || index}-${index}`}
              style={styles.opCard}
            >
              <div style={styles.opIndex}>{index + 1}</div>
              <div style={{ minWidth: 0 }}>
                <div style={styles.opTitle}>
                  {stringVal(op.action) || "op"} ·{" "}
                  {stringVal(op.title) || stringVal(op.slug) || "untitled"}
                </div>
                <div style={styles.opMeta}>
                  {stringVal(op.slug) || "no slug"} ·{" "}
                  {stringVal(op.type) || "type unknown"}
                  {stringVal(op.existingPageId)
                    ? ` · existing ${stringVal(op.existingPageId)?.slice(0, 8)}`
                    : ""}
                </div>
                {stringVal(op.rationale) && (
                  <p style={styles.opRationale}>{stringVal(op.rationale)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EditsSection({
  edits,
  failed,
}: {
  edits: CompletedEdit[];
  failed: FailedEdit[];
}) {
  return (
    <section style={styles.panel}>
      <SectionHeader
        title="Edits"
        eyebrow={`${edits.length} completed · ${failed.length} failed`}
      />
      {edits.length === 0 && failed.length === 0 ? (
        <div style={styles.empty}>No page edits were recorded.</div>
      ) : (
        <div style={styles.editList}>
          {edits.map((edit) => (
            <div key={`edit-${edit.seq}`} style={styles.editCard}>
              <div style={styles.editHeader}>
                <div>
                  <div style={styles.editTitle}>
                    {stringVal(edit.op.action) || "write"} ·{" "}
                    {edit.page?.title ??
                      stringVal(edit.op.title) ??
                      "Untitled page"}
                  </div>
                  <div style={styles.opMeta}>
                    seq {edit.seq} · {formatDate(edit.createdAt)} ·{" "}
                    {edit.page?.slug ?? stringVal(edit.op.slug) ?? "no slug"}
                  </div>
                </div>
                <div style={styles.editStats}>
                  <SmallStat label="edges +" value={edit.edgesAdded} />
                  <SmallStat label="edges -" value={edit.edgesRemoved} />
                  <SmallStat label="tokens" value={edit.tokens} />
                </div>
              </div>
              {edit.page && (
                <details style={styles.details}>
                  <summary style={styles.summary}>Page payload</summary>
                  <div style={styles.pagePayload}>
                    <Detail
                      label="summary"
                      value={edit.page.summary ?? "none"}
                    />
                    <Detail
                      label="confidence"
                      value={String(edit.page.confidence)}
                    />
                    <Detail
                      label="perspective"
                      value={JSON.stringify(edit.page.perspective)}
                    />
                    <Detail
                      label="frontmatter"
                      value={JSON.stringify(edit.page.frontmatter, null, 2)}
                    />
                    <pre style={styles.bodyPreview}>{edit.page.body}</pre>
                  </div>
                </details>
              )}
            </div>
          ))}
          {failed.map((edit) => (
            <div
              key={`failed-${edit.seq}`}
              style={{
                ...styles.editCard,
                borderColor: "var(--critical-border)",
              }}
            >
              <div style={styles.editTitle}>
                failed ·{" "}
                {stringVal(edit.op.title) ??
                  stringVal(edit.op.slug) ??
                  "operation"}
              </div>
              <div style={styles.opMeta}>
                seq {edit.seq} · {formatDate(edit.createdAt)}
              </div>
              <div style={styles.errorBox}>{edit.error}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EventTimeline({ events }: { events: WikiIngestionEventRecord[] }) {
  return (
    <section style={styles.panel}>
      <SectionHeader
        title="Event timeline"
        eyebrow={`${events.length} events`}
      />
      <div style={styles.timeline}>
        {events.map((event) => (
          <details key={event.id} style={styles.eventRow}>
            <summary style={styles.eventSummary}>
              <span style={styles.seq}>#{event.seq}</span>
              <span style={styles.eventType}>{event.type}</span>
              <span style={styles.muted}>{formatDate(event.createdAt)}</span>
            </summary>
            <pre style={styles.raw}>
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </details>
        ))}
      </div>
    </section>
  );
}

function SummaryPanel({
  run,
  summary,
  source,
}: {
  run: WikiIngestionLogRecord;
  summary: ReturnType<typeof deriveRunSummary>;
  source: WikiSourceRecord | null;
}) {
  return (
    <section style={styles.panel}>
      <SectionHeader title="Debug index" eyebrow="run" />
      <div style={styles.railList}>
        <Detail
          label="duration"
          value={formatDuration(run.startedAt, run.finishedAt)}
        />
        <Detail label="planned ops" value={String(summary.planOps.length)} />
        <Detail
          label="completed edits"
          value={String(summary.completedEdits.length)}
        />
        <Detail
          label="failed edits"
          value={String(summary.failedEdits.length)}
        />
        <Detail
          label="source id"
          value={source?.id ?? run.sourceId ?? "none"}
        />
        <Detail
          label="claimed"
          value={run.claimedAt ? formatDate(run.claimedAt) : "not claimed"}
        />
        <Detail
          label="heartbeat"
          value={run.heartbeatAt ? formatDate(run.heartbeatAt) : "none"}
        />
      </div>
    </section>
  );
}

function RawPanel({ title, value }: { title: string; value: unknown }) {
  return (
    <section style={styles.panel}>
      <SectionHeader title={title} eyebrow="raw" />
      <pre style={styles.raw}>{JSON.stringify(value, null, 2)}</pre>
    </section>
  );
}

function SectionHeader({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <header style={styles.sectionHeader}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      <span style={styles.kicker}>{eyebrow}</span>
    </header>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "warning";
}) {
  const color =
    tone === "success"
      ? "var(--status-live)"
      : tone === "warning"
        ? "var(--warning-amber)"
        : "var(--text-primary)";
  return (
    <div style={styles.metric}>
      <div style={{ ...styles.metricValue, color }}>{value}</div>
      <div style={styles.metricLabel}>{label}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.detail}>
      <div style={styles.detailLabel}>{label}</div>
      <div style={styles.detailValue}>{value}</div>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={styles.smallStat}>
      <strong>{value.toLocaleString()}</strong>
      <span>{label}</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === "succeeded"
      ? "var(--status-live)"
      : status === "failed"
        ? "var(--status-error)"
        : status === "running" || status === "queued"
          ? "var(--status-processing)"
          : "var(--text-tertiary)";
  return (
    <span style={styles.statusPill}>
      <span style={{ ...styles.dot, background: color }} />
      {status}
    </span>
  );
}

function deriveRunSummary(
  run: WikiIngestionLogRecord,
  events: WikiIngestionEventRecord[],
) {
  const planEvent = events.find((event) => event.type === "plan-complete");
  const planPayload = asRecord(planEvent?.payload);
  const planOps = Array.isArray(planPayload?.ops)
    ? planPayload.ops.map(asRecord).filter(isRecord)
    : [];

  const completedEdits = events
    .filter((event) => event.type === "op-complete")
    .map((event): CompletedEdit => {
      const payload = asRecord(event.payload);
      return {
        seq: event.seq,
        createdAt: event.createdAt,
        op: asRecord(payload?.op) ?? {},
        page: asRecord(payload?.page) as WikiPageRecord | null,
        edgesAdded: numberVal(payload?.edgesAdded),
        edgesRemoved: numberVal(payload?.edgesRemoved),
        tokens: numberVal(payload?.tokens),
      };
    });

  const failedEdits = events
    .filter((event) => event.type === "op-failed")
    .map((event): FailedEdit => {
      const payload = asRecord(event.payload);
      return {
        seq: event.seq,
        createdAt: event.createdAt,
        op: asRecord(payload?.op) ?? {},
        error: stringVal(payload?.error) ?? "Unknown operation failure.",
      };
    });

  return { run, planOps, completedEdits, failedEdits };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRecord(
  value: Record<string, unknown> | null,
): value is Record<string, unknown> {
  return value !== null;
}

function stringVal(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberVal(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(start: string, end: string | null) {
  const endTime = end ? new Date(end).getTime() : Date.now();
  const seconds = Math.max(
    0,
    Math.round((endTime - new Date(start).getTime()) / 1000),
  );
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${mins}m ${rest}s`;
}

const styles = {
  page: {
    minHeight: "calc(100vh - 48px)",
    padding: "32px 40px 96px",
    background: "var(--background)",
    color: "var(--text-primary)",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 24,
    marginBottom: 24,
  },
  breadcrumb: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "var(--text-tertiary)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--font-size-sm)",
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  breadcrumbLink: {
    color: "var(--accent-strong)",
    textDecoration: "none",
  },
  title: {
    margin: "8px 0 0",
    fontSize: 30,
    lineHeight: 1.1,
    letterSpacing: 0,
  },
  subtitle: {
    marginTop: 8,
    color: "var(--text-tertiary)",
    fontSize: "var(--font-size-md)",
  },
  metrics: {
    display: "grid",
    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
    gap: 12,
    marginBottom: 18,
  },
  layout: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 340px",
    gap: 18,
    alignItems: "start",
  },
  mainStack: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 18,
    minWidth: 0,
  },
  rail: {
    position: "sticky" as const,
    top: 20,
    display: "flex",
    flexDirection: "column" as const,
    gap: 18,
    minWidth: 0,
  },
  panel: {
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    background: "var(--material-card)",
    overflow: "hidden",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 16px",
    borderBottom: "1px solid var(--border)",
  },
  sectionTitle: {
    margin: 0,
    fontSize: "var(--font-size-xl)",
    lineHeight: 1.2,
  },
  kicker: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--font-size-xs)",
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "var(--accent-strong)",
  },
  metric: {
    padding: "13px 14px",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    background: "var(--material-card)",
  },
  metricValue: {
    fontSize: 22,
    fontWeight: 700,
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums" as const,
  },
  metricLabel: {
    marginTop: 7,
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--font-size-xs)",
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: "var(--text-tertiary)",
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 10,
    padding: 16,
  },
  detail: {
    minWidth: 0,
    padding: "9px 10px",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    background: "var(--control-bg)",
  },
  detailLabel: {
    marginBottom: 5,
    color: "var(--text-tertiary)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--font-size-xs)",
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
  },
  detailValue: {
    color: "var(--text-primary)",
    fontSize: "var(--font-size-base)",
    lineHeight: 1.45,
    whiteSpace: "pre-wrap" as const,
    overflowWrap: "anywhere" as const,
  },
  sourceBox: {
    margin: "0 16px 16px",
    padding: 12,
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    background: "var(--control-bg)",
  },
  sourceTitle: {
    marginTop: 6,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  sourcePreview: {
    margin: "10px 0 0",
    maxHeight: 260,
    overflow: "auto",
    padding: 10,
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    background: "var(--background)",
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap" as const,
    fontSize: "var(--font-size-sm)",
    lineHeight: 1.5,
  },
  opList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
    padding: 16,
  },
  opCard: {
    display: "grid",
    gridTemplateColumns: "28px minmax(0, 1fr)",
    gap: 10,
    padding: 12,
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    background: "var(--control-bg)",
  },
  opIndex: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-pill)",
    color: "var(--text-tertiary)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--font-size-xs)",
  },
  opTitle: {
    color: "var(--text-primary)",
    fontWeight: 700,
    overflowWrap: "anywhere" as const,
  },
  opMeta: {
    marginTop: 4,
    color: "var(--text-tertiary)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--font-size-xs)",
    overflowWrap: "anywhere" as const,
  },
  opRationale: {
    margin: "8px 0 0",
    color: "var(--text-secondary)",
    fontSize: "var(--font-size-base)",
    lineHeight: 1.5,
  },
  editList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
    padding: 16,
  },
  editCard: {
    padding: 12,
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    background: "var(--control-bg)",
  },
  editHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 18,
  },
  editTitle: {
    color: "var(--text-primary)",
    fontWeight: 700,
  },
  editStats: {
    display: "flex",
    gap: 8,
    flexShrink: 0,
  },
  smallStat: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-end",
    gap: 2,
    color: "var(--text-tertiary)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--font-size-xs)",
  },
  details: {
    marginTop: 10,
  },
  summary: {
    cursor: "pointer",
    color: "var(--accent-strong)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--font-size-xs)",
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
  },
  pagePayload: {
    marginTop: 10,
    display: "grid",
    gap: 10,
  },
  bodyPreview: {
    margin: 0,
    maxHeight: 420,
    overflow: "auto",
    padding: 12,
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    background: "var(--background)",
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap" as const,
    lineHeight: 1.55,
  },
  timeline: {
    display: "flex",
    flexDirection: "column" as const,
  },
  eventRow: {
    borderBottom: "1px solid var(--border-subtle)",
  },
  eventSummary: {
    display: "grid",
    gridTemplateColumns: "64px minmax(0, 1fr) auto",
    gap: 12,
    padding: "11px 16px",
    cursor: "pointer",
    alignItems: "center",
  },
  seq: {
    color: "var(--text-tertiary)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--font-size-xs)",
  },
  eventType: {
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--font-size-sm)",
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
  },
  raw: {
    maxHeight: 420,
    overflow: "auto",
    margin: "0 16px 16px",
    padding: 12,
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    background: "var(--background)",
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    fontSize: "var(--font-size-sm)",
    lineHeight: 1.5,
  },
  railList: {
    display: "grid",
    gap: 10,
    padding: 16,
  },
  statusPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-pill)",
    background: "var(--ink-wash)",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--font-size-xs)",
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "var(--radius-pill)",
  },
  muted: {
    color: "var(--text-tertiary)",
    fontSize: "var(--font-size-base)",
  },
  empty: {
    padding: 16,
    color: "var(--text-secondary)",
  },
  errorBox: {
    margin: "0 16px 16px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    padding: 12,
    border: "1px solid var(--critical-border)",
    borderRadius: "var(--radius-md)",
    background: "var(--critical-fill)",
    color: "var(--status-error)",
  },
};
