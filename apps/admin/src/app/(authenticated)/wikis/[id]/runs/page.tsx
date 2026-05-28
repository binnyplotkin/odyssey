import Link from "next/link";
import { notFound } from "next/navigation";
import { getWikiStore, getWikisStore } from "@odyssey/db";
import type { WikiIngestionLogRecord } from "@odyssey/db";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function WikiRunsPage({ params }: { params: Params }) {
  const { id } = await params;
  const wiki = await getWikisStore().getWikiById(id);
  if (!wiki) notFound();

  const runs = await getWikiStore().listIngestionRunsForWiki(wiki.id, 200);
  const succeeded = runs.filter((run) => run.status === "succeeded").length;
  const failed = runs.filter((run) => run.status === "failed").length;
  const running = runs.filter(
    (run) => run.status === "running" || run.status === "queued",
  ).length;
  const tokens = runs.reduce((sum, run) => sum + (run.tokensUsed ?? 0), 0);

  return (
    <main style={styles.page}>
      <section style={styles.header}>
        <div>
          <div style={styles.kicker}>Ingestion history</div>
          <h1 style={styles.title}>Runs</h1>
        </div>
        <Link href={`/wikis/${wiki.id}/ingestion`} style={styles.primaryLink}>
          New ingestion
        </Link>
      </section>

      <section style={styles.metrics}>
        <Metric label="total" value={runs.length} />
        <Metric label="succeeded" value={succeeded} tone="success" />
        <Metric label="failed" value={failed} tone="danger" />
        <Metric label="active" value={running} tone="processing" />
        <Metric label="tokens" value={tokens.toLocaleString()} />
      </section>

      <section style={styles.panel}>
        <div style={styles.panelHeader}>
          <div style={styles.kicker}>Recent runs</div>
          <div style={styles.muted}>{runs.length} shown</div>
        </div>
        {runs.length === 0 ? (
          <div style={styles.empty}>
            No ingestion runs yet. Start an ingestion to create pages and event
            history for this wiki.
          </div>
        ) : (
          <div style={styles.table}>
            {runs.map((run) => (
              <RunRow key={run.id} wikiId={wiki.id} run={run} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function RunRow({
  wikiId,
  run,
}: {
  wikiId: string;
  run: WikiIngestionLogRecord;
}) {
  return (
    <Link href={`/wikis/${wikiId}/runs/${run.id}`} style={styles.row}>
      <div style={{ minWidth: 0 }}>
        <div style={styles.rowTitle}>
          <StatusDot status={run.status} />
          <span style={styles.monoStrong}>{run.id.slice(0, 8)}</span>
          <span style={styles.muted}>{run.model ?? "model unknown"}</span>
        </div>
        <div style={styles.rowSub}>
          started {formatDate(run.startedAt)}
          {run.finishedAt ? ` · finished ${formatDate(run.finishedAt)}` : ""}
          {run.sourceId ? ` · source ${run.sourceId.slice(0, 8)}` : ""}
        </div>
      </div>
      <div style={styles.rowStats}>
        <SmallStat label="created" value={run.pagesCreated} />
        <SmallStat label="updated" value={run.pagesUpdated} />
        <SmallStat label="edges" value={run.edgesAdded} />
        <SmallStat label="tokens" value={run.tokensUsed} />
      </div>
    </Link>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "danger" | "processing";
}) {
  const color =
    tone === "success"
      ? "var(--status-live)"
      : tone === "danger"
        ? "var(--status-error)"
        : tone === "processing"
          ? "var(--status-processing)"
          : "var(--text-primary)";
  return (
    <div style={styles.metric}>
      <div style={{ ...styles.metricValue, color }}>{value}</div>
      <div style={styles.metricLabel}>{label}</div>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={styles.smallStat}>
      <span>{value.toLocaleString()}</span>
      <span>{label}</span>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
  kicker: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--font-size-xs)",
    letterSpacing: "0.16em",
    textTransform: "uppercase" as const,
    color: "var(--accent-strong)",
  },
  title: {
    margin: "6px 0 0",
    fontSize: 28,
    lineHeight: 1.1,
    letterSpacing: 0,
  },
  primaryLink: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 34,
    padding: "0 13px",
    border: "1px solid var(--accent-strong)",
    borderRadius: "var(--radius-md)",
    background: "var(--accent-strong)",
    color: "var(--accent-on)",
    textDecoration: "none",
    fontSize: "var(--font-size-md)",
    fontWeight: 650,
  },
  metrics: {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gap: 12,
    marginBottom: 18,
  },
  metric: {
    padding: "14px 16px",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    background: "var(--material-card)",
  },
  metricValue: {
    fontSize: 24,
    fontWeight: 700,
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums" as const,
  },
  metricLabel: {
    marginTop: 8,
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--font-size-xs)",
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: "var(--text-tertiary)",
  },
  panel: {
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    background: "var(--material-card)",
    overflow: "hidden",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 16px",
    borderBottom: "1px solid var(--border)",
  },
  table: {
    display: "flex",
    flexDirection: "column" as const,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 18,
    padding: "14px 16px",
    borderBottom: "1px solid var(--border-subtle)",
    color: "inherit",
    textDecoration: "none",
  },
  rowTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  rowSub: {
    marginTop: 6,
    color: "var(--text-tertiary)",
    fontSize: "var(--font-size-base)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  rowStats: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 72px)",
    gap: 8,
  },
  smallStat: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
    alignItems: "flex-end",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--font-size-xs)",
    color: "var(--text-tertiary)",
  },
  monoStrong: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--font-size-md)",
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  muted: {
    color: "var(--text-tertiary)",
    fontSize: "var(--font-size-base)",
  },
  empty: {
    padding: 18,
    color: "var(--text-secondary)",
    fontSize: "var(--font-size-md)",
  },
  statusPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "2px 8px",
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
};
