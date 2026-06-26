"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  WikiIngestionEventRecord,
  WikiIngestionLogRecord,
  WikiPageRecord,
  WikiPageType,
  WikiSourceKind,
  WikiSourceRecord,
  WikiSourceRefRecord,
} from "@odyssey/db";
import { RunEffectDiffDrawer } from "@/components/run-effect-diff-drawer";
import {
  PurgeConfirmModal,
  type PurgePreview,
} from "@/components/purge-confirm-modal";
import {
  previewPurgeWikiSource,
  purgeWikiSource,
} from "@/app/(authenticated)/wikis/actions";
import { getSourceParsedMetadata } from "@/lib/source-metadata-filters";

/* ── Tokens ────────────────────────────────────────────────────── */

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const DISPLAY = '"Space Grotesk", system-ui, sans-serif';
const BODY = '"Geist", "Inter", system-ui, sans-serif';

const FG = "var(--foreground)";
const TEXT_PRIMARY = "var(--text-primary)";
const TEXT_SECONDARY = "var(--text-secondary)";
const TEXT_MUTED = "var(--text-tertiary)";
const TEXT_FADED = "var(--text-placeholder)";
const TEXT_GHOST = "var(--text-quaternary)";
const TEXT_QUIET = "color-mix(in srgb, var(--text-primary) 14%, transparent)";

const PANEL_BG = "var(--material-card)";
const BORDER = "var(--border-medium)";
const BORDER_STRONG = "var(--ink-edge)";
const DIVIDER = "var(--border-subtle)";
const INPUT_BG = "var(--control-bg)";

const ACCENT = "var(--accent-strong)";
const ACCENT_SOFT = "var(--accent-wash)";
const ACCENT_RING = "var(--accent-border)";

const WARN = "var(--warning-amber)";
const WARN_SOFT = "color-mix(in srgb, var(--warning-amber) 6%, transparent)";
const WARN_RING = "color-mix(in srgb, var(--warning-amber) 30%, transparent)";

const DANGER = "var(--status-error)";
const DANGER_SOFT = "var(--critical-wash)";
const DANGER_RING = "var(--critical-border)";

const TYPE_COLOR: Record<WikiPageType, string> = {
  entity: "#8FD1CB",
  event: "#60A5FA",
  concept: "#A78BFA",
  relationship: "#FACC15",
  timeline: "#2DD4BF",
  voice_identity: "#F472B6",
};

const KIND_LABEL: Record<WikiSourceKind, string> = {
  bible: "PRIMARY · BIBLE",
  primary: "PRIMARY",
  commentary: "ANNOTATION · COMMENTARY",
  midrash: "ANNOTATION · MIDRASH",
  annotation: "ANNOTATION",
  note: "REFERENCE · NOTE",
  reference: "REFERENCE",
  transcript: "TRANSCRIPT",
};

/* ── Props ─────────────────────────────────────────────────────── */

type Props = {
  wikiId: string;
  wikiTitle: string;
  characterId: string;
  source: WikiSourceRecord;
  pages: WikiPageRecord[];
  runs: WikiIngestionLogRecord[];
  runEvents: Array<{ runId: string; events: WikiIngestionEventRecord[] }>;
  refs: WikiSourceRefRecord[];
  activeRunId: string | null;
  routeBase: string;
};

type PlanOpLike = {
  action?: unknown;
  slug?: unknown;
  type?: unknown;
  title?: unknown;
  rationale?: unknown;
  existingPageId?: unknown;
};

type AttemptedOpRow = {
  op: PlanOpLike;
  index: number;
  state: "saved" | "failed" | "writing" | "queued";
  page: WikiPageRecord | null;
  edgesAdded: number;
  tokens: number;
  error: string | null;
};

type RunAttemptSummary = {
  run: WikiIngestionLogRecord;
  rows: AttemptedOpRow[];
  savedCount: number;
  failedCount: number;
  plannedCount: number;
  retryableCount: number;
};

/* ── Helpers ───────────────────────────────────────────────────── */

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function byteSize(s: string): string {
  const n = new Blob([s]).size;
  if (n < 1024) return `${n} b`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kb`;
  return `${(n / (1024 * 1024)).toFixed(1)} mb`;
}

function shortRunId(id: string): string {
  // Friendly short ID — first 5 chars of the slug after any prefix, uppercased
  const tail = id.replace(/^run[_-]?/i, "");
  return `R-${tail.slice(0, 5).toUpperCase()}`;
}

function runStatus(
  run: WikiIngestionLogRecord,
): { label: string; color: string; tone: "active" | "warn" | "fail" | "neutral" } {
  if (run.status === "failed") {
    return { label: "FAILED", color: DANGER, tone: "fail" };
  }
  if (run.status === "running") {
    return { label: "RUNNING", color: ACCENT, tone: "active" };
  }
  if (run.contradictionsFound > 0) {
    return { label: "PARTIAL", color: WARN, tone: "warn" };
  }
  return { label: "COMPLETE", color: ACCENT, tone: "active" };
}

function pagesTouchedByRun(
  run: WikiIngestionLogRecord | null,
  refs: WikiSourceRefRecord[],
  pageById: Map<string, WikiPageRecord>,
): WikiPageRecord[] {
  if (!run) return [];
  // Refs don't currently carry a runId, so we approximate using time window
  // between this run and the previous one. A single page may be backed by
  // multiple refs (different passages from the same source), so dedupe by
  // page id.
  const at = new Date(run.startedAt).getTime();
  const seen = new Set<string>();
  const out: WikiPageRecord[] = [];
  for (const r of refs) {
    const t = new Date(r.createdAt).getTime();
    if (t < at - 6 * 3600_000 || t > at + 6 * 3600_000) continue;
    if (seen.has(r.pageId)) continue;
    const page = pageById.get(r.pageId);
    if (!page) continue;
    seen.add(r.pageId);
    out.push(page);
  }
  return out;
}

function deriveAttemptedOps(events: WikiIngestionEventRecord[]): AttemptedOpRow[] {
  const planEvent = events.find((event) => event.type === "plan-complete");
  const planPayload = asRecord(planEvent?.payload);
  const planned = Array.isArray(planPayload?.ops)
    ? planPayload.ops.map(asRecord).filter(isRecord)
    : [];

  const completedBySlug = new Map<string, WikiIngestionEventRecord>();
  const failedBySlug = new Map<string, WikiIngestionEventRecord>();
  const startedSlugs = new Set<string>();
  for (const event of events) {
    const payload = asRecord(event.payload);
    const op = asRecord(payload?.op);
    const slug = stringVal(op?.slug);
    if (!slug) continue;
    if (event.type === "op-start") startedSlugs.add(slug);
    if (event.type === "op-complete") completedBySlug.set(slug, event);
    if (event.type === "op-failed") failedBySlug.set(slug, event);
  }

  const ops =
    planned.length > 0
      ? planned
      : events
          .filter((event) => event.type === "op-start")
          .map((event) => asRecord(asRecord(event.payload)?.op))
          .filter(isRecord);

  return ops.map((op, index) => {
    const slug = stringVal(op.slug) ?? "";
    const completed = completedBySlug.get(slug);
    if (completed) {
      const payload = asRecord(completed.payload);
      return {
        op,
        index,
        state: "saved",
        page: asRecord(payload?.page) as WikiPageRecord | null,
        edgesAdded: numberVal(payload?.edgesAdded),
        tokens: numberVal(payload?.tokens),
        error: null,
      };
    }
    const failed = failedBySlug.get(slug);
    if (failed) {
      const payload = asRecord(failed.payload);
      return {
        op,
        index,
        state: "failed",
        page: null,
        edgesAdded: 0,
        tokens: 0,
        error: stringVal(payload?.error) ?? "Unknown operation failure.",
      };
    }
    return {
      op,
      index,
      state: startedSlugs.has(slug) ? "writing" : "queued",
      page: null,
      edgesAdded: 0,
      tokens: 0,
      error: null,
    };
  });
}

function unresolvedFailedOps(rows: AttemptedOpRow[]): AttemptedOpRow[] {
  return rows.filter((row) => row.state === "failed");
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

function stringVal(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberVal(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/* ── Root ──────────────────────────────────────────────────────── */

export function WikiSourceDetailView({
  wikiId,
  wikiTitle,
  source,
  pages,
  runs,
  runEvents,
  refs,
  activeRunId,
  routeBase,
}: Props) {
  const router = useRouter();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    activeRunId,
  );
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgePreview, setPurgePreview] = useState<PurgePreview | null>(null);
  const [purgePreviewLoading, setPurgePreviewLoading] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [purgePending, startPurge] = useTransition();

  const pageById = useMemo(
    () => new Map(pages.map((p) => [p.id, p])),
    [pages],
  );

  const activeRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  );
  const activeRunEvents = useMemo(
    () => runEvents.find((row) => row.runId === activeRun?.id)?.events ?? [],
    [runEvents, activeRun?.id],
  );
  const attemptedOps = useMemo(
    () => deriveAttemptedOps(activeRunEvents),
    [activeRunEvents],
  );
  const failedOps = useMemo(
    () => unresolvedFailedOps(attemptedOps),
    [attemptedOps],
  );
  const eventsByRun = useMemo(
    () => new Map(runEvents.map((row) => [row.runId, row.events])),
    [runEvents],
  );
  const runAttempts = useMemo<RunAttemptSummary[]>(
    () =>
      runs.map((run) => {
        const rows = deriveAttemptedOps(eventsByRun.get(run.id) ?? []);
        const failed = unresolvedFailedOps(rows);
        return {
          run,
          rows,
          savedCount: rows.filter((row) => row.state === "saved").length,
          failedCount: failed.length,
          plannedCount: rows.length,
          retryableCount: failed.length,
        };
      }),
    [eventsByRun, runs],
  );

  const effects = useMemo(
    () => pagesTouchedByRun(activeRun, refs, pageById),
    [activeRun, refs, pageById],
  );

  const lastRun = runs[0] ?? null;

  function handleSelectRun(runId: string) {
    setSelectedRunId(runId);
    router.replace(`${routeBase}/sources/${source.id}?run=${runId}`, {
      scroll: false,
    });
  }

  async function retryFailedOnlyForRun(runId: string) {
    const res = await fetch(
      `/api/wiki/${wikiId}/ingest/runs/${runId}/retry-failed`,
      { method: "POST" },
    );
    if (!res.ok) {
      const body = await res.text();
      window.alert(`Retry failed: ${body.slice(0, 300)}`);
      return;
    }
    const body = (await res.json()) as { runId?: string };
    if (body.runId) {
      router.push(`${routeBase}/ingestion?run=${body.runId}`);
      return;
    }
    router.refresh();
  }

  async function retryFailedOnly() {
    if (!activeRun || failedOps.length === 0) return;
    await retryFailedOnlyForRun(activeRun.id);
  }

  const kindLabel = KIND_LABEL[source.kind];

  const searchParams = useSearchParams();
  const effectPageIds = useMemo(() => effects.map((p) => p.id), [effects]);
  const handleOpenDiff = useCallback(
    (pageId: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("diff", pageId);
      router.replace(`${routeBase}/sources/${source.id}?${next.toString()}`, {
        scroll: false,
      });
    },
    [router, routeBase, source.id, searchParams],
  );

  function openPurge() {
    setPurgeError(null);
    setPurgePreview(null);
    setPurgeOpen(true);
    setPurgePreviewLoading(true);
    void previewPurgeWikiSource(wikiId, source.id).then((res) => {
      setPurgePreviewLoading(false);
      if (res.ok && res.data) {
        setPurgePreview(res.data);
        return;
      }
      if (!res.ok) setPurgeError(res.error);
    });
  }

  function confirmPurge() {
    setPurgeError(null);
    startPurge(async () => {
      const res = await purgeWikiSource(wikiId, source.id);
      if (!res.ok) {
        setPurgeError(res.error);
        return;
      }
      setPurgeOpen(false);
      router.replace(`${routeBase}/sources`);
      router.refresh();
    });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        padding: "0 0 80px",
        background: PANEL_BG,
        minHeight: "calc(100vh - 67px)",
      }}
    >
      <TopEyebrow
        wikiId={wikiId}
        wikiTitle={wikiTitle}
        sourceTitle={source.title}
      />

      <HeaderBar
        kindLabel={kindLabel}
        sourceId={source.id}
        purgePending={purgePending}
        onPurge={openPurge}
      />

      <HeroBlock source={source} />

      <MetaStrip
        source={source}
        runCount={runs.length}
        lastRun={lastRun}
        refs={refs}
      />

      <main
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-20)",
          padding: "32px 32px 0",
          minWidth: 0,
        }}
      >
        {activeRun ? (
          <>
            <RunHistoryStrip
              runs={runs}
              activeRunId={activeRun.id}
              onSelect={handleSelectRun}
            />
            <RunAttemptsOverview
              attempts={runAttempts}
              activeRunId={activeRun.id}
              onSelect={handleSelectRun}
              onRetryFailedOnly={(runId) => void retryFailedOnlyForRun(runId)}
            />
            <PipelineHeader run={activeRun} />
            <AttemptedPagesPane
              run={activeRun}
              rows={attemptedOps}
              failedCount={failedOps.length}
              onRetryFailedOnly={() => void retryFailedOnly()}
            />
            <InputPane source={source} run={activeRun} number={2} />
            <PromptPane run={activeRun} wikiTitle={wikiTitle} number={3} />
            <OutputPane run={activeRun} effects={effects} number={4} />
            <EffectsPane
              run={activeRun}
              effects={effects}
              refs={refs.filter(
                (r) =>
                  effects.some((p) => p.id === r.pageId) &&
                  r.sourceId === source.id,
              )}
              routeBase={routeBase}
              onOpenDiff={handleOpenDiff}
              number={5}
            />
          </>
        ) : (
          <EmptyState />
        )}
      </main>
      {activeRun && (
        <RunEffectDiffDrawer
          wikiId={wikiId}
          runId={activeRun.id}
          effectPageIds={effectPageIds}
        />
      )}
      <PurgeConfirmModal
        open={purgeOpen}
        kind="source"
        preview={purgePreview}
        loading={purgePreviewLoading}
        pending={purgePending}
        error={purgeError}
        onCancel={() => {
          if (!purgePending) setPurgeOpen(false);
        }}
        onConfirm={confirmPurge}
      />
    </div>
  );
}

/* ── TopEyebrow ────────────────────────────────────────────────── */

function TopEyebrow({
  wikiId,
  wikiTitle,
  sourceTitle,
}: {
  wikiId: string;
  wikiTitle: string;
  sourceTitle: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "18px 32px",
        borderTop: "0",
        borderRight: "0",
        borderBottom: `1px solid ${DIVIDER}`,
        borderLeft: "0",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "var(--space-14)",
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          fontWeight: 500,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        <Link
          href="/wikis"
          style={{ color: TEXT_GHOST, textDecoration: "none" }}
        >
          wikis
        </Link>
        <span style={{ color: TEXT_QUIET }}>/</span>
        <Link
          href={`/wikis/${wikiId}`}
          style={{ color: TEXT_MUTED, textDecoration: "none" }}
        >
          {wikiTitle}
        </Link>
        <span style={{ color: TEXT_QUIET }}>/</span>
        <Link
          href={`/wikis/${wikiId}/sources`}
          style={{ color: TEXT_MUTED, textDecoration: "none" }}
        >
          sources
        </Link>
        <span style={{ color: TEXT_QUIET }}>/</span>
        <span style={{ color: ACCENT }}>{sourceTitle}</span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "var(--space-14)",
          fontFamily: MONO,
          fontSize: 10.5,
          fontWeight: 500,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: TEXT_FADED,
        }}
      >
        <span>⌘← back</span>
      </div>
    </div>
  );
}

/* ── HeaderBar ─────────────────────────────────────────────────── */

function HeaderBar({
  kindLabel,
  sourceId,
  purgePending,
  onPurge,
}: {
  kindLabel: string;
  sourceId: string;
  purgePending: boolean;
  onPurge: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "22px 32px 0",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "var(--space-14)",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            flexDirection: "row",
            alignItems: "center",
            gap: "var(--space-8)",
            padding: "7px 12px",
            background: ACCENT_SOFT,
            borderTop: `1px solid ${ACCENT_RING}`,
            borderRight: `1px solid ${ACCENT_RING}`,
            borderBottom: `1px solid ${ACCENT_RING}`,
            borderLeft: `1px solid ${ACCENT_RING}`,
          }}
        >
          <div style={{ width: 6, height: 6, background: ACCENT }} />
          <span
            style={{
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: ACCENT,
            }}
          >
            {kindLabel}
          </span>
        </div>
        <span
          style={{
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            fontWeight: 400,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: TEXT_FADED,
          }}
        >
          {sourceId.slice(0, 12)}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "var(--space-8)",
        }}
      >
        <GhostBtn label="OPEN RAW" trailing="↗" />
        <PrimaryBtn label="RE-INGEST" trailing="↻" />
        <DangerBtn
          label={purgePending ? "PURGING" : "PURGE SOURCE"}
          onClick={onPurge}
          disabled={purgePending}
        />
        <IconBtn label="⋯" />
      </div>
    </div>
  );
}

function GhostBtn({
  label,
  trailing,
}: {
  label: string;
  trailing?: string;
}) {
  return (
    <button
      type="button"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-8)",
        padding: "9px 14px",
        background: "transparent",
        borderTop: `1px solid ${BORDER_STRONG}`,
        borderRight: `1px solid ${BORDER_STRONG}`,
        borderBottom: `1px solid ${BORDER_STRONG}`,
        borderLeft: `1px solid ${BORDER_STRONG}`,
        fontFamily: MONO,
        fontSize: "var(--font-size-sm)",
        fontWeight: 600,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: TEXT_PRIMARY,
        cursor: "pointer",
      }}
    >
      {label}
      {trailing && <span style={{ color: TEXT_FADED }}>{trailing}</span>}
    </button>
  );
}

function PrimaryBtn({
  label,
  trailing,
}: {
  label: string;
  trailing?: string;
}) {
  return (
    <button
      type="button"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-8)",
        padding: "9px 14px",
        background: ACCENT,
        borderTop: `1px solid ${ACCENT}`,
        borderRight: `1px solid ${ACCENT}`,
        borderBottom: `1px solid ${ACCENT}`,
        borderLeft: `1px solid ${ACCENT}`,
        fontFamily: MONO,
        fontSize: "var(--font-size-sm)",
        fontWeight: 700,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "var(--accent-on)",
        cursor: "pointer",
      }}
    >
      {label}
      {trailing && <span>{trailing}</span>}
    </button>
  );
}

function DangerBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-8)",
        padding: "9px 14px",
        background: DANGER_SOFT,
        borderTop: `1px solid ${DANGER_RING}`,
        borderRight: `1px solid ${DANGER_RING}`,
        borderBottom: `1px solid ${DANGER_RING}`,
        borderLeft: `1px solid ${DANGER_RING}`,
        fontFamily: MONO,
        fontSize: "var(--font-size-sm)",
        fontWeight: 700,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: DANGER,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

function IconBtn({ label }: { label: string }) {
  return (
    <button
      type="button"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        background: "transparent",
        borderTop: `1px solid ${BORDER_STRONG}`,
        borderRight: `1px solid ${BORDER_STRONG}`,
        borderBottom: `1px solid ${BORDER_STRONG}`,
        borderLeft: `1px solid ${BORDER_STRONG}`,
        fontFamily: MONO,
        fontSize: "var(--font-size-md)",
        fontWeight: 600,
        color: TEXT_MUTED,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

/* ── HeroBlock ─────────────────────────────────────────────────── */

function HeroBlock({ source }: { source: WikiSourceRecord }) {
  const note =
    typeof source.metadata?.note === "string"
      ? (source.metadata.note as string)
      : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-14)",
        padding: "36px 40px 12px",
      }}
    >
      <h1
        style={{
          margin: 0,
          fontFamily: DISPLAY,
          fontSize: 52,
          fontWeight: 500,
          lineHeight: "60px",
          letterSpacing: "-0.014em",
          color: FG,
        }}
      >
        {source.title}
      </h1>
      {note && (
        <p
          style={{
            margin: 0,
            maxWidth: 760,
            fontFamily: BODY,
            fontSize: "var(--font-size-xl)",
            fontWeight: 400,
            lineHeight: "26px",
            color: TEXT_SECONDARY,
          }}
        >
          {note}
        </p>
      )}
    </div>
  );
}

/* ── MetaStrip ─────────────────────────────────────────────────── */

function MetaStrip({
  source,
  runCount,
  lastRun,
  refs,
}: {
  source: WikiSourceRecord;
  runCount: number;
  lastRun: WikiIngestionLogRecord | null;
  refs: WikiSourceRefRecord[];
}) {
  const words = wordCount(source.content);
  const size = byteSize(source.content);

  const lastIngested = lastRun
    ? `${relative(lastRun.startedAt)} · ${shortRunId(lastRun.id)}`
    : "never";

  const pagesWritten = lastRun
    ? `${lastRun.pagesCreated + lastRun.pagesUpdated} · ${lastRun.edgesAdded} edges`
    : `${refs.length} refs`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "var(--space-32)",
        padding: "8px 40px 0",
        flexWrap: "wrap",
      }}
    >
      <MetaCell label="KIND" value={source.kind.toUpperCase()} accent />
      <MetaDivider />
      <MetaCell label="WORDS" value={words.toLocaleString()} />
      <MetaDivider />
      <MetaCell label="SIZE" value={size} />
      <MetaDivider />
      <MetaCell label="RUNS" value={String(runCount)} />
      <MetaDivider />
      <MetaCell label="LAST INGESTED" value={lastIngested} />
      <MetaDivider />
      <MetaCell label="PAGES WRITTEN" value={pagesWritten} />
    </div>
  );
}

function MetaCell({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <span
        style={{
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
          fontWeight: 500,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: TEXT_FADED,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 12.5,
          fontWeight: accent ? 600 : 500,
          letterSpacing: accent ? "0.08em" : "normal",
          color: accent ? ACCENT : TEXT_PRIMARY,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function MetaDivider() {
  return <div style={{ width: 1, height: 32, background: DIVIDER }} />;
}

/* ── RunHistoryStrip ───────────────────────────────────────────── */

function RunHistoryStrip({
  runs,
  activeRunId,
  onSelect,
}: {
  runs: WikiIngestionLogRecord[];
  activeRunId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeRun = runs.find((r) => r.id === activeRunId);
  const olderRuns = runs.filter((r) => r.id !== activeRunId);
  const isLatest = runs[0]?.id === activeRunId;

  if (!activeRun) return null;

  const status = runStatus(activeRun);
  const statusColor =
    status.tone === "fail" ? DANGER : status.tone === "warn" ? WARN : ACCENT;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={olderRuns.length === 0}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-14)",
          padding: "10px 14px",
          background: "transparent",
          borderTop: `1px solid ${BORDER}`,
          borderRight: `1px solid ${BORDER}`,
          borderBottom: open
            ? `1px solid ${DIVIDER}`
            : `1px solid ${BORDER}`,
          borderLeft: `1px solid ${BORDER}`,
          cursor: olderRuns.length === 0 ? "default" : "pointer",
          textAlign: "left",
          width: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: "var(--space-14)",
          }}
        >
          <span
            style={{
              fontFamily: MONO,
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: TEXT_FADED,
            }}
          >
            {isLatest ? "LATEST RUN" : "VIEWING"}
          </span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 12.5,
              fontWeight: 600,
              color: ACCENT,
            }}
          >
            {shortRunId(activeRun.id)}
          </span>
          <span
            style={{ fontFamily: MONO, fontSize: "var(--font-size-sm)", color: TEXT_MUTED }}
          >
            {relative(activeRun.startedAt)}
          </span>
          <span style={{ color: TEXT_QUIET }}>·</span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              fontWeight: 500,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: statusColor,
            }}
          >
            {status.label}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: "var(--space-10)",
          }}
        >
          {!isLatest && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                if (runs[0]) onSelect(runs[0].id);
              }}
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                fontWeight: 500,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: TEXT_SECONDARY,
                cursor: "pointer",
              }}
            >
              JUMP TO LATEST ↑
            </span>
          )}
          {olderRuns.length > 0 && (
            <span
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                fontWeight: 500,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: TEXT_MUTED,
              }}
            >
              HISTORY · {olderRuns.length} {open ? "↑" : "↓"}
            </span>
          )}
        </div>
      </button>
      {open && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 0,
            borderTop: 0,
            borderRight: `1px solid ${BORDER}`,
            borderBottom: `1px solid ${BORDER}`,
            borderLeft: `1px solid ${BORDER}`,
            background: INPUT_BG,
          }}
        >
          {olderRuns.map((run) => (
            <CompactRunRow
              key={run.id}
              run={run}
              onClick={() => {
                onSelect(run.id);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CompactRunRow({
  run,
  onClick,
}: {
  run: WikiIngestionLogRecord;
  onClick: () => void;
}) {
  const status = runStatus(run);
  const statusColor =
    status.tone === "fail" ? DANGER : status.tone === "warn" ? WARN : TEXT_MUTED;

  const leftBorder =
    status.tone === "fail"
      ? DANGER_RING
      : status.tone === "warn"
        ? WARN_RING
        : BORDER;

  const summary =
    run.status === "failed"
      ? run.errorMessage ?? "failed"
      : `${run.pagesCreated + run.pagesUpdated} pages · ${run.edgesAdded} edges`;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 0,
        padding: "10px 14px",
        background: "transparent",
        borderTop: 0,
        borderRight: 0,
        borderBottom: `1px solid ${DIVIDER}`,
        borderLeft: `2px solid ${leftBorder}`,
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
    >
      <span
        style={{
          width: 80,
          flexShrink: 0,
          fontFamily: MONO,
          fontSize: "var(--font-size-base)",
          fontWeight: 500,
          color: TEXT_PRIMARY,
        }}
      >
        {shortRunId(run.id)}
      </span>
      <span
        style={{
          width: 110,
          flexShrink: 0,
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          color: TEXT_MUTED,
        }}
      >
        {relative(run.startedAt)}
      </span>
      <span
        style={{
          width: 100,
          flexShrink: 0,
          fontFamily: MONO,
          fontSize: 10.5,
          fontWeight: 500,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: statusColor,
        }}
      >
        {status.label}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          color: TEXT_SECONDARY,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {summary}
      </span>
      <span
        style={{
          width: 140,
          flexShrink: 0,
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          color: TEXT_FADED,
          textAlign: "right",
        }}
      >
        {run.model ?? "—"}
      </span>
    </button>
  );
}

/* ── RunAttemptsOverview ───────────────────────────────────────── */

function RunAttemptsOverview({
  attempts,
  activeRunId,
  onSelect,
  onRetryFailedOnly,
}: {
  attempts: RunAttemptSummary[];
  activeRunId: string;
  onSelect: (id: string) => void;
  onRetryFailedOnly: (id: string) => void;
}) {
  if (attempts.length === 0) return null;

  const totalPlanned = attempts.reduce((sum, item) => sum + item.plannedCount, 0);
  const totalFailed = attempts.reduce((sum, item) => sum + item.failedCount, 0);

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        borderTop: `1px solid ${BORDER}`,
        borderRight: `1px solid ${BORDER}`,
        borderBottom: `1px solid ${BORDER}`,
        borderLeft: `1px solid ${BORDER}`,
        background: INPUT_BG,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-16)",
          padding: "14px 18px",
          borderBottom: `1px solid ${DIVIDER}`,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <span
            style={{
              fontFamily: DISPLAY,
              fontSize: 18,
              fontWeight: 650,
              color: FG,
            }}
          >
            Run attempts
          </span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: TEXT_FADED,
            }}
          >
            {attempts.length} runs · {totalPlanned} planned pages · {totalFailed} failed
          </span>
        </div>
        <span
          style={{
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            color: TEXT_MUTED,
            textAlign: "right",
          }}
        >
          Click a run to view its full attempted page list.
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {attempts.map((attempt) => (
          <RunAttemptRow
            key={attempt.run.id}
            attempt={attempt}
            active={attempt.run.id === activeRunId}
            onSelect={() => onSelect(attempt.run.id)}
            onRetryFailedOnly={() => onRetryFailedOnly(attempt.run.id)}
          />
        ))}
      </div>
    </section>
  );
}

function RunAttemptRow({
  attempt,
  active,
  onSelect,
  onRetryFailedOnly,
}: {
  attempt: RunAttemptSummary;
  active: boolean;
  onSelect: () => void;
  onRetryFailedOnly: () => void;
}) {
  const status = runStatus(attempt.run);
  const statusColor =
    status.tone === "fail" ? DANGER : status.tone === "warn" ? WARN : ACCENT;
  const hasPlannedOps = attempt.plannedCount > 0;
  const summary = hasPlannedOps
    ? `${attempt.savedCount}/${attempt.plannedCount} saved · ${attempt.failedCount} failed`
    : attempt.run.status === "failed"
      ? "failed before page planning"
      : "no page operations recorded";

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "grid",
        gridTemplateColumns: "100px 120px minmax(0, 1fr) 190px",
        alignItems: "center",
        gap: "var(--space-12)",
        width: "100%",
        padding: "12px 18px",
        background: active ? ACCENT_SOFT : "transparent",
        borderTop: 0,
        borderRight: 0,
        borderBottom: `1px solid ${DIVIDER}`,
        borderLeft: active ? `2px solid ${ACCENT}` : "2px solid transparent",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: "var(--font-size-base)",
          fontWeight: 700,
          color: active ? ACCENT : TEXT_PRIMARY,
        }}
      >
        {shortRunId(attempt.run.id)}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          color: TEXT_MUTED,
        }}
      >
        {relative(attempt.run.startedAt)}
      </span>
      <span
        style={{
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            color: hasPlannedOps ? TEXT_SECONDARY : TEXT_MUTED,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={attempt.run.errorMessage ?? summary}
        >
          {summary}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: statusColor,
          }}
        >
          {status.label}
        </span>
      </span>
      <span
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: "var(--space-10)",
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            color: TEXT_FADED,
          }}
        >
          {active ? "viewing" : "view"}
        </span>
        {attempt.retryableCount > 0 && (
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onRetryFailedOnly();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onRetryFailedOnly();
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 104,
              padding: "7px 10px",
              background: DANGER_SOFT,
              borderTop: `1px solid ${DANGER_RING}`,
              borderRight: `1px solid ${DANGER_RING}`,
              borderBottom: `1px solid ${DANGER_RING}`,
              borderLeft: `1px solid ${DANGER_RING}`,
              fontFamily: MONO,
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: DANGER,
              cursor: "pointer",
            }}
          >
            Retry {attempt.retryableCount}
          </span>
        )}
      </span>
    </button>
  );
}

/* ── PipelineHeader ────────────────────────────────────────────── */

function PipelineHeader({ run }: { run: WikiIngestionLogRecord }) {
  const status = runStatus(run);
  const duration =
    run.finishedAt && run.startedAt
      ? `${((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s`
      : "—";

  const statusColor =
    status.tone === "fail" ? DANGER : status.tone === "warn" ? WARN : ACCENT;
  const statusBg =
    status.tone === "fail"
      ? DANGER_SOFT
      : status.tone === "warn"
        ? WARN_SOFT
        : ACCENT_SOFT;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "18px 22px",
        background: ACCENT_SOFT,
        borderTop: `1px solid ${ACCENT_RING}`,
        borderRight: `1px solid ${ACCENT_RING}`,
        borderBottom: `1px solid ${ACCENT_RING}`,
        borderLeft: `2px solid ${ACCENT}`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "baseline",
          gap: "var(--space-18)",
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            fontWeight: 600,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: ACCENT,
          }}
        >
          PIPELINE
        </span>
        <span
          style={{
            fontFamily: DISPLAY,
            fontSize: "var(--font-size-4xl)",
            fontWeight: 500,
            letterSpacing: "-0.01em",
            color: FG,
          }}
        >
          Run {shortRunId(run.id)}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            fontWeight: 400,
            color: TEXT_FADED,
          }}
        >
          {new Date(run.startedAt).toISOString().replace("T", " ").slice(0, 16)}{" "}
          UTC
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "var(--space-18)",
        }}
      >
        <HeaderStat label="DURATION" value={duration} />
        <HeaderDivider />
        <HeaderStat
          label="PAGES"
          value={`${run.pagesCreated + run.pagesUpdated}`}
        />
        <HeaderDivider />
        <HeaderStat
          label="TOKENS"
          value={`${(run.tokensUsed / 1000).toFixed(1)}k`}
        />
        <HeaderDivider />
        <div
          style={{
            display: "inline-flex",
            flexDirection: "row",
            alignItems: "center",
            gap: "var(--space-8)",
            padding: "7px 12px",
            background: statusBg,
            borderTop: `1px solid ${statusColor}`,
            borderRight: `1px solid ${statusColor}`,
            borderBottom: `1px solid ${statusColor}`,
            borderLeft: `1px solid ${statusColor}`,
          }}
        >
          <div style={{ width: 6, height: 6, background: statusColor }} />
          <span
            style={{
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: statusColor,
            }}
          >
            {status.label}
          </span>
        </div>
      </div>
    </div>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        alignItems: "flex-end",
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 9.5,
          fontWeight: 500,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: TEXT_FADED,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 12.5,
          fontWeight: 500,
          color: TEXT_PRIMARY,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function HeaderDivider() {
  return <div style={{ width: 1, height: 30, background: BORDER }} />;
}

/* ── AttemptedPagesPane ────────────────────────────────────────── */

function AttemptedPagesPane({
  run,
  rows,
  failedCount,
  onRetryFailedOnly,
}: {
  run: WikiIngestionLogRecord;
  rows: AttemptedOpRow[];
  failedCount: number;
  onRetryFailedOnly: () => void;
}) {
  const savedCount = rows.filter((row) => row.state === "saved").length;
  return (
    <PaneShell
      number={1}
      title="Attempted pages"
      subtitle={`${savedCount} saved · ${failedCount} failed · ${rows.length} planned`}
      trailing={
        failedCount > 0 ? (
          <button
            type="button"
            onClick={onRetryFailedOnly}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-8)",
              padding: "7px 12px",
              background: DANGER_SOFT,
              borderTop: `1px solid ${DANGER_RING}`,
              borderRight: `1px solid ${DANGER_RING}`,
              borderBottom: `1px solid ${DANGER_RING}`,
              borderLeft: `1px solid ${DANGER_RING}`,
              fontFamily: MONO,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: DANGER,
              cursor: "pointer",
            }}
          >
            Retry {failedCount} failed only ↻
          </button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <div
          style={{
            padding: "28px 18px",
            borderTop: `1px dashed ${BORDER_STRONG}`,
            borderRight: `1px dashed ${BORDER_STRONG}`,
            borderBottom: `1px dashed ${BORDER_STRONG}`,
            borderLeft: `1px dashed ${BORDER_STRONG}`,
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
          color: TEXT_MUTED,
          textAlign: "center",
        }}
      >
          No planned page operations were recorded for this run. It failed before
          ingestion produced page ops, so there are no individual failed pages to
          retry from this run.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 0,
            borderTop: `1px solid ${BORDER}`,
            borderRight: `1px solid ${BORDER}`,
            borderBottom: `1px solid ${BORDER}`,
            borderLeft: `1px solid ${BORDER}`,
          }}
        >
          <AttemptedHeaderRow />
          {rows.map((row) => (
            <AttemptedOpRowView
              key={`${String(row.op.slug ?? row.index)}-${row.index}`}
              row={row}
              run={run}
            />
          ))}
        </div>
      )}
    </PaneShell>
  );
}

function AttemptedHeaderRow() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 0,
        padding: "10px 18px",
        background: INPUT_BG,
        borderBottom: `1px solid ${DIVIDER}`,
      }}
    >
      <ColHead width={56}>#</ColHead>
      <ColHead width={110}>Status</ColHead>
      <ColHead width={110}>Action</ColHead>
      <ColHead flex>Page</ColHead>
      <ColHead width={90} alignRight>Edges</ColHead>
      <ColHead width={90} alignRight>Tokens</ColHead>
    </div>
  );
}

function AttemptedOpRowView({
  row,
}: {
  row: AttemptedOpRow;
  run: WikiIngestionLogRecord;
}) {
  const stateColor =
    row.state === "saved"
      ? ACCENT
      : row.state === "failed"
        ? DANGER
        : row.state === "writing"
          ? WARN
          : TEXT_MUTED;
  const title =
    stringVal(row.op.title) ??
    row.page?.title ??
    stringVal(row.op.slug) ??
    "untitled";
  const slug = stringVal(row.op.slug) ?? row.page?.slug ?? "no slug";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 0,
        padding: "13px 18px",
        borderBottom: `1px solid ${DIVIDER}`,
        borderLeft: `2px solid ${stateColor}`,
      }}
    >
      <div style={{ width: 56, flexShrink: 0, fontFamily: MONO, color: TEXT_MUTED }}>
        {String(row.index + 1).padStart(2, "0")}
      </div>
      <div
        style={{
          width: 110,
          flexShrink: 0,
          fontFamily: MONO,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: stateColor,
        }}
      >
        {row.state}
      </div>
      <div
        style={{
          width: 110,
          flexShrink: 0,
          fontFamily: MONO,
          fontSize: 10.5,
          color: TEXT_SECONDARY,
          textTransform: "uppercase",
        }}
      >
        {stringVal(row.op.action) ?? "op"}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        <span
          style={{
            fontFamily: DISPLAY,
            fontSize: 15,
            color: FG,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            color: row.state === "failed" ? DANGER : TEXT_MUTED,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={row.error ?? slug}
        >
          {row.error ?? slug}
        </span>
      </div>
      <div style={{ width: 90, flexShrink: 0, textAlign: "right", fontFamily: MONO, color: TEXT_SECONDARY }}>
        {row.state === "saved" ? `+${row.edgesAdded}` : "—"}
      </div>
      <div style={{ width: 90, flexShrink: 0, textAlign: "right", fontFamily: MONO, color: TEXT_SECONDARY }}>
        {row.tokens ? row.tokens.toLocaleString() : "—"}
      </div>
    </div>
  );
}

/* ── Pane shell + gutter ───────────────────────────────────────── */

function PaneShell({
  number,
  title,
  subtitle,
  trailing,
  showConnector = true,
  children,
}: {
  number: number;
  title: string;
  subtitle: string;
  trailing?: React.ReactNode;
  showConnector?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        gap: 0,
        borderTop: `1px solid ${BORDER}`,
        borderRight: `1px solid ${BORDER}`,
        borderBottom: `1px solid ${BORDER}`,
        borderLeft: `1px solid ${BORDER}`,
        background: PANEL_BG,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          padding: "24px 0",
          width: 64,
          flexShrink: 0,
          borderTop: 0,
          borderRight: `1px solid ${DIVIDER}`,
          borderBottom: 0,
          borderLeft: 0,
          gap: "var(--space-14)",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            background: ACCENT_SOFT,
            borderTop: `1px solid ${ACCENT}`,
            borderRight: `1px solid ${ACCENT}`,
            borderBottom: `1px solid ${ACCENT}`,
            borderLeft: `1px solid ${ACCENT}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontFamily: MONO,
              fontSize: "var(--font-size-base)",
              fontWeight: 700,
              color: ACCENT,
            }}
          >
            {number}
          </span>
        </div>
        {showConnector && (
          <div
            style={{
              width: 1,
              flex: 1,
              minHeight: 120,
              background: BORDER,
            }}
          />
        )}
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "24px 28px 28px",
          gap: "var(--space-18)",
          minWidth: 0,
        }}
      >
        <header
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "baseline",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "baseline",
              gap: "var(--space-14)",
            }}
          >
            <span
              style={{
                fontFamily: DISPLAY,
                fontSize: "var(--font-size-3xl)",
                fontWeight: 500,
                letterSpacing: "-0.01em",
                color: FG,
              }}
            >
              {title}
            </span>
            <span
              style={{
                fontFamily: MONO,
                fontSize: "var(--font-size-sm)",
                fontWeight: 500,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: TEXT_FADED,
              }}
            >
              {subtitle}
            </span>
          </div>
          {trailing}
        </header>
        {children}
      </div>
    </section>
  );
}

/* ── InputPane ─────────────────────────────────────────────────── */

function InputPane({
  source,
  run,
  number,
}: {
  source: WikiSourceRecord;
  run: WikiIngestionLogRecord;
  number: number;
}) {
  const totalWords = wordCount(source.content);
  const tokensApprox = Math.round(totalWords * 1.3);
  const excerpt = source.content.slice(0, 1600);
  const parsedMetadata = getSourceParsedMetadata(source);
  const hasParsedMetadata = Object.keys(parsedMetadata).length > 0;

  return (
    <PaneShell
      number={number}
      title="Input"
      subtitle="SOURCE CONTENT"
      trailing={
        <span style={{ fontFamily: MONO, fontSize: "var(--font-size-sm)", color: TEXT_MUTED }}>
          ~{tokensApprox.toLocaleString()} tokens
        </span>
      }
    >
      {hasParsedMetadata && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-8)",
          }}
        >
          <span
            style={{
              fontFamily: MONO,
              fontSize: "var(--font-size-xs)",
              fontWeight: 600,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: ACCENT,
            }}
          >
            Parsed source metadata
          </span>
          <pre
            style={{
              margin: 0,
              padding: "16px 18px",
              background: INPUT_BG,
              borderTop: `1px solid ${BORDER}`,
              borderRight: `1px solid ${BORDER}`,
              borderBottom: `1px solid ${BORDER}`,
              borderLeft: `1px solid ${BORDER}`,
              fontFamily: MONO,
              fontSize: 12,
              fontWeight: 400,
              lineHeight: "20px",
              color: TEXT_SECONDARY,
              whiteSpace: "pre-wrap",
              maxHeight: 260,
              overflow: "auto",
            }}
          >
            {JSON.stringify(parsedMetadata, null, 2)}
          </pre>
        </div>
      )}
      <pre
        style={{
          margin: 0,
          padding: "22px 24px",
          background: INPUT_BG,
          borderTop: `1px solid ${BORDER}`,
          borderRight: `1px solid ${BORDER}`,
          borderBottom: `1px solid ${BORDER}`,
          borderLeft: `1px solid ${BORDER}`,
          fontFamily: MONO,
          fontSize: 12.5,
          fontWeight: 400,
          lineHeight: "22px",
          color: TEXT_SECONDARY,
          whiteSpace: "pre-wrap",
          maxHeight: 460,
          overflow: "auto",
        }}
      >
        {excerpt}
        {source.content.length > excerpt.length && "\n…"}
      </pre>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "var(--space-18)",
          padding: "0 4px",
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            fontWeight: 500,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: TEXT_MUTED,
          }}
        >
          SOURCE {source.kind.toUpperCase()} · {byteSize(source.content)}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: MONO,
            fontSize: 10.5,
            fontWeight: 400,
            color: TEXT_FADED,
          }}
        >
          This is the content the ingestion run consumed
        </span>
      </div>
    </PaneShell>
  );
}

/* ── PromptPane ────────────────────────────────────────────────── */

function PromptPane({
  run,
  wikiTitle,
  number,
}: {
  run: WikiIngestionLogRecord;
  wikiTitle: string;
  number: number;
}) {
  return (
    <PaneShell
      number={number}
      title="Prompt"
      subtitle="INGESTION CONFIG · WHAT THE MODEL READ"
      trailing={
        <Link
          href="../ingestion"
          style={{ textDecoration: "none" }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-6)",
              padding: "5px 10px",
              background: "transparent",
              borderTop: `1px solid ${BORDER_STRONG}`,
              borderRight: `1px solid ${BORDER_STRONG}`,
              borderBottom: `1px solid ${BORDER_STRONG}`,
              borderLeft: `1px solid ${BORDER_STRONG}`,
              fontFamily: MONO,
              fontSize: 10.5,
              fontWeight: 500,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: TEXT_SECONDARY,
              cursor: "pointer",
            }}
          >
            VIEW PROMPT EDITOR ↗
          </span>
        </Link>
      }
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "stretch",
          gap: 0,
          borderTop: `1px solid ${BORDER}`,
          borderRight: `1px solid ${BORDER}`,
          borderBottom: `1px solid ${BORDER}`,
          borderLeft: `1px solid ${BORDER}`,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-8)",
            padding: "18px 22px",
            flex: 1,
            borderTop: 0,
            borderRight: `1px solid ${DIVIDER}`,
            borderBottom: 0,
            borderLeft: 0,
          }}
        >
          <span
            style={{
              fontFamily: MONO,
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: TEXT_FADED,
            }}
          >
            PROMPT
          </span>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "baseline",
              gap: "var(--space-10)",
            }}
          >
            <span
              style={{
                fontFamily: DISPLAY,
                fontSize: "var(--font-size-4xl)",
                fontWeight: 500,
                letterSpacing: "-0.01em",
                color: FG,
              }}
            >
              {wikiTitle} lens
            </span>
            {run.promptHash && (
              <span
                style={{
                  display: "inline-flex",
                  padding: "3px 7px",
                  background: ACCENT_SOFT,
                  borderTop: `1px solid ${ACCENT_RING}`,
                  borderRight: `1px solid ${ACCENT_RING}`,
                  borderBottom: `1px solid ${ACCENT_RING}`,
                  borderLeft: `1px solid ${ACCENT_RING}`,
                  fontFamily: MONO,
                  fontSize: "var(--font-size-xs)",
                  fontWeight: 600,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: ACCENT,
                }}
              >
                {run.promptHash.slice(0, 7)}
              </span>
            )}
          </div>
          <span
            style={{
              fontFamily: BODY,
              fontSize: "var(--font-size-md)",
              lineHeight: "20px",
              color: TEXT_MUTED,
            }}
          >
            The ingestion lens that mapped this source into the {wikiTitle}{" "}
            graph.
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-8)",
            padding: "18px 22px",
            width: 220,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: MONO,
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: TEXT_FADED,
            }}
          >
            MODEL
          </span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: "var(--font-size-md)",
              fontWeight: 500,
              color: TEXT_PRIMARY,
            }}
          >
            {run.model ?? "—"}
          </span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              fontWeight: 400,
              color: TEXT_MUTED,
            }}
          >
            tokens · {run.tokensUsed.toLocaleString()}
          </span>
        </div>
      </div>
    </PaneShell>
  );
}

/* ── OutputPane ────────────────────────────────────────────────── */

function OutputPane({
  run,
  effects,
  number,
}: {
  run: WikiIngestionLogRecord;
  effects: WikiPageRecord[];
  number: number;
}) {
  const success = run.status === "succeeded";

  return (
    <PaneShell
      number={number}
      title="Output"
      subtitle="MODEL RESPONSE · RUN STATS"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "stretch",
          gap: 0,
          borderTop: `1px solid ${BORDER}`,
          borderRight: `1px solid ${BORDER}`,
          borderBottom: `1px solid ${BORDER}`,
          borderLeft: `1px solid ${BORDER}`,
        }}
      >
        <StatCell label="PAGES CREATED" value={String(run.pagesCreated)} />
        <StatDivider />
        <StatCell label="PAGES UPDATED" value={String(run.pagesUpdated)} />
        <StatDivider />
        <StatCell label="EDGES ADDED" value={String(run.edgesAdded)} />
        <StatDivider />
        <StatCell
          label="CONTRADICTIONS"
          value={String(run.contradictionsFound)}
          tone={run.contradictionsFound > 0 ? "warn" : "neutral"}
        />
        <StatDivider />
        <StatCell
          label="STATUS"
          value={success ? "passed" : run.status}
          tone={success ? "good" : "bad"}
        />
      </div>
      {run.errorMessage && (
        <pre
          style={{
            margin: 0,
            padding: "16px 20px",
            background: DANGER_SOFT,
            borderTop: `1px solid ${DANGER_RING}`,
            borderRight: `1px solid ${DANGER_RING}`,
            borderBottom: `1px solid ${DANGER_RING}`,
            borderLeft: `2px solid ${DANGER}`,
            fontFamily: MONO,
            fontSize: "var(--font-size-base)",
            lineHeight: "20px",
            color: DANGER,
            whiteSpace: "pre-wrap",
          }}
        >
          {run.errorMessage}
        </pre>
      )}
      {run.notes && (
        <pre
          style={{
            margin: 0,
            padding: "22px 24px",
            background: INPUT_BG,
            borderTop: `1px solid ${BORDER}`,
            borderRight: `1px solid ${BORDER}`,
            borderBottom: `1px solid ${BORDER}`,
            borderLeft: `1px solid ${BORDER}`,
            fontFamily: MONO,
            fontSize: 12.5,
            lineHeight: "22px",
            color: TEXT_SECONDARY,
            whiteSpace: "pre-wrap",
            maxHeight: 280,
            overflow: "auto",
          }}
        >
          {run.notes}
        </pre>
      )}
      <span
        style={{
          fontFamily: MONO,
          fontSize: 10.5,
          color: TEXT_FADED,
          padding: "0 4px",
        }}
      >
        Schema-validated output produced {effects.length}{" "}
        {effects.length === 1 ? "page" : "pages"} this run
      </span>
    </PaneShell>
  );
}

function StatCell({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad" | "warn";
}) {
  const color =
    tone === "good"
      ? ACCENT
      : tone === "bad"
        ? DANGER
        : tone === "warn"
          ? WARN
          : TEXT_PRIMARY;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        padding: "14px 18px",
        flex: 1,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 9.5,
          fontWeight: 500,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: TEXT_FADED,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: "var(--font-size-lg)",
          fontWeight: 500,
          color,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function StatDivider() {
  return <div style={{ width: 1, alignSelf: "stretch", background: DIVIDER }} />;
}

/* ── EffectsPane ───────────────────────────────────────────────── */

function EffectsPane({
  run,
  effects,
  onOpenDiff,
  number,
}: {
  run: WikiIngestionLogRecord;
  effects: WikiPageRecord[];
  refs: WikiSourceRefRecord[];
  routeBase: string;
  onOpenDiff: (pageId: string) => void;
  number: number;
}) {
  return (
    <PaneShell
      number={number}
      title="Effects"
      subtitle="WHAT WAS WRITTEN TO THE GRAPH"
      showConnector={false}
      trailing={
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: "var(--space-14)",
          }}
        >
          <EffectChip label={`+${run.pagesCreated} PAGES`} tone="good" />
          {run.pagesUpdated > 0 && (
            <EffectChip
              label={`${run.pagesUpdated} UPDATED`}
              tone="warn"
            />
          )}
          <EffectChip
            label={`+${run.edgesAdded} EDGES`}
            tone="neutral"
          />
        </div>
      }
    >
      {effects.length === 0 ? (
        <div
          style={{
            padding: "32px 18px",
            borderTop: `1px dashed ${BORDER_STRONG}`,
            borderRight: `1px dashed ${BORDER_STRONG}`,
            borderBottom: `1px dashed ${BORDER_STRONG}`,
            borderLeft: `1px dashed ${BORDER_STRONG}`,
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            color: TEXT_MUTED,
            textAlign: "center",
          }}
        >
          No page links attributed to this run window
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 0,
            borderTop: `1px solid ${BORDER}`,
            borderRight: `1px solid ${BORDER}`,
            borderBottom: `1px solid ${BORDER}`,
            borderLeft: `1px solid ${BORDER}`,
          }}
        >
          <EffectsHeaderRow />
          {effects.map((page) => (
            <EffectRow
              key={page.id}
              page={page}
              onOpenDiff={onOpenDiff}
            />
          ))}
        </div>
      )}
    </PaneShell>
  );
}

function EffectChip({
  label,
  tone,
}: {
  label: string;
  tone: "good" | "warn" | "neutral";
}) {
  const color = tone === "good" ? ACCENT : tone === "warn" ? WARN : TEXT_SECONDARY;
  const bg = tone === "good" ? ACCENT_SOFT : tone === "warn" ? WARN_SOFT : "transparent";
  const ring =
    tone === "good"
      ? ACCENT_RING
      : tone === "warn"
        ? WARN_RING
        : BORDER_STRONG;

  return (
    <span
      style={{
        display: "inline-flex",
        padding: "5px 10px",
        background: bg,
        borderTop: `1px solid ${ring}`,
        borderRight: `1px solid ${ring}`,
        borderBottom: `1px solid ${ring}`,
        borderLeft: `1px solid ${ring}`,
        fontFamily: MONO,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color,
      }}
    >
      {label}
    </span>
  );
}

function EffectsHeaderRow() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 0,
        padding: "10px 18px",
        background: INPUT_BG,
        borderTop: 0,
        borderRight: 0,
        borderBottom: `1px solid ${DIVIDER}`,
        borderLeft: 0,
      }}
    >
      <ColHead width={60}>DIFF</ColHead>
      <ColHead width={100}>TYPE</ColHead>
      <ColHead flex>PAGE</ColHead>
      <ColHead width={90} alignRight>
        CONFIDENCE
      </ColHead>
      <ColHead width={32} />
    </div>
  );
}

function ColHead({
  width,
  flex,
  alignRight,
  children,
}: {
  width?: number;
  flex?: boolean;
  alignRight?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        ...(flex
          ? { flex: 1, minWidth: 0 }
          : { width, flexShrink: 0 }),
        fontFamily: MONO,
        fontSize: "var(--font-size-xs)",
        fontWeight: 500,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: TEXT_FADED,
        textAlign: alignRight ? "right" : "left",
      }}
    >
      {children}
    </div>
  );
}

function EffectRow({
  page,
  onOpenDiff,
}: {
  page: WikiPageRecord;
  onOpenDiff: (pageId: string) => void;
}) {
  const typeColor = TYPE_COLOR[page.type];
  const confidencePct = Math.round((page.confidence ?? 0) * 100);

  return (
    <button
      type="button"
      onClick={() => onOpenDiff(page.id)}
      style={{
        background: "transparent",
        borderTop: 0,
        borderRight: 0,
        borderBottom: 0,
        borderLeft: 0,
        padding: 0,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 0,
          padding: "14px 18px",
          background: "transparent",
          borderTop: 0,
          borderRight: 0,
          borderBottom: `1px solid ${DIVIDER}`,
          borderLeft: `2px solid ${ACCENT}`,
          cursor: "pointer",
        }}
      >
        <div style={{ width: 60, flexShrink: 0 }}>
          <span
            style={{
              display: "inline-flex",
              padding: "3px 7px",
              background: ACCENT_SOFT,
              borderTop: `1px solid ${ACCENT_RING}`,
              borderRight: `1px solid ${ACCENT_RING}`,
              borderBottom: `1px solid ${ACCENT_RING}`,
              borderLeft: `1px solid ${ACCENT_RING}`,
              fontFamily: MONO,
              fontSize: "var(--font-size-xs)",
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: ACCENT,
            }}
          >
            + NEW
          </span>
        </div>
        <div
          style={{
            width: 100,
            flexShrink: 0,
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: "var(--space-8)",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              background: typeColor,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              fontWeight: 500,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: TEXT_SECONDARY,
            }}
          >
            {page.type}
          </span>
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          <span
            style={{
              fontFamily: DISPLAY,
              fontSize: 15,
              fontWeight: 500,
              color: FG,
            }}
          >
            {page.title}
          </span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              fontWeight: 400,
              color: TEXT_MUTED,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {page.slug} · {page.summary ?? ""}
          </span>
        </div>
        <div
          style={{
            width: 90,
            flexShrink: 0,
            textAlign: "right",
            fontFamily: MONO,
            fontSize: "var(--font-size-md)",
            fontWeight: 500,
            color: TEXT_PRIMARY,
          }}
        >
          {confidencePct}%
        </div>
        <div
          style={{
            width: 32,
            flexShrink: 0,
            textAlign: "right",
            fontFamily: MONO,
            fontSize: "var(--font-size-md)",
            color: TEXT_FADED,
          }}
        >
          ↗
        </div>
      </div>
    </button>
  );
}

/* ── EmptyState ────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div
      style={{
        padding: "60px 24px",
        borderTop: `1px dashed ${BORDER_STRONG}`,
        borderRight: `1px dashed ${BORDER_STRONG}`,
        borderBottom: `1px dashed ${BORDER_STRONG}`,
        borderLeft: `1px dashed ${BORDER_STRONG}`,
        fontFamily: MONO,
        fontSize: "var(--font-size-base)",
        color: TEXT_MUTED,
        textAlign: "center",
      }}
    >
      No ingestion runs yet for this source. Hit RE-INGEST to start one.
    </div>
  );
}
