"use client";

import { type CSSProperties, type ReactNode } from "react";
import { type ModelId } from "@odyssey/wiki-ingest";

/**
 * Sticky footer — anchors the ingestion page, carries an abbreviated pipeline
 * summary + adaptive primary action on the right.
 *
 * Same anatomy in every state: [status] · [stat group] · [pipeline chips
 * with inline edit-prompt icon] · [actions]. State governs colour, chrome
 * accents, and what the stat group + actions contain. See Paper artboard
 * "Ingestion · Sticky Footer — Five States" for the visual contract.
 *
 * Self-contained: depends on the admin theme CSS variables so the footer
 * stays legible in both dark and light mode.
 */

const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const FONT_HEAD = "'Inter', system-ui, sans-serif";

const ACCENT = "var(--accent-strong)";
const ACCENT_SOFT = "var(--accent-soft)";
const ACCENT_LINE = "color-mix(in srgb, var(--accent-strong) 30%, transparent)";
const ACCENT_BORDER_TOP_READY =
  "color-mix(in srgb, var(--accent-strong) 35%, transparent)";
const ACCENT_BORDER_TOP_RUN =
  "color-mix(in srgb, var(--accent-strong) 55%, transparent)";
const DANGER = "var(--danger)";
const DANGER_FILL = "color-mix(in srgb, var(--danger) 12%, transparent)";
const ON_ACCENT = "var(--background)";

const PROMPT_DOT = "#8CE7D2";
const MODEL_DOT = "#A48CE7";
const EMBED_DOT = "#E7CB8C";
const PROMPT_DOT_FADED = "color-mix(in srgb, #8CE7D2 50%, transparent)";
const MODEL_DOT_FADED = "color-mix(in srgb, #A48CE7 50%, transparent)";
const EMBED_DOT_FADED = "color-mix(in srgb, #E7CB8C 50%, transparent)";

const FOOTER_BG = "var(--background)";
const ROW_HEIGHT = 64;

export type StickyFooterState =
  | "idle"
  | "ready"
  | "running"
  | "complete"
  | "failed";

export type StickyFooterProps = {
  state: StickyFooterState;

  /* Pipeline (always present). */
  promptLabel: string;
  promptVersion: string;
  promptTokens: number;
  model: ModelId;
  embeddings?: string;

  /* Destination wiki, surfaced in the ready/idle status pill. */
  wikiTitle: string;

  /* Projected (idle / ready). */
  projectedCost?: number;
  projectedDurationSec?: number;
  projectedPages?: number;

  /* Live (running). */
  runningOpNum?: number;
  runningOpTotal?: number;
  runningOpLabel?: string;
  elapsedSec?: number;
  spentCost?: number;
  progressFraction?: number;

  /* Final (complete). */
  finalDurationSec?: number;
  finalCost?: number;
  finalPages?: number;
  finalEdges?: number;
  finalChunks?: number;

  /* Failure (failed). */
  failedAtOpNum?: number;
  failedAtOpTotal?: number;
  errorReason?: string;

  /* Callbacks — each state uses the ones it needs. */
  onRun?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  onRunAnother?: () => void;
  onOpenWiki?: () => void;
  onReviewError?: () => void;
  onEditPrompt?: () => void;
};

export function StickyFooter(props: StickyFooterProps) {
  const { state } = props;
  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 30,
        background: FOOTER_BG,
        // Footer is a sibling of the grid inside <main>; it spans the full
        // content-area width naturally (left of sidebar, right to edge).
      }}
    >
      <TopAccent state={state} progressFraction={props.progressFraction} />

      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          height: ROW_HEIGHT,
          borderBottom: "1px solid var(--divider)",
        }}
      >
        <StatusCell {...props} />
        <StatGroup {...props} />
        <PipelineChips {...props} />
        <ActionsCell {...props} />
      </div>
    </div>
  );
}

/* ── Top accent / progress bar ─────────────────────────────────── */

function TopAccent({
  state,
  progressFraction,
}: {
  state: StickyFooterState;
  progressFraction?: number;
}) {
  if (state === "idle") {
    return <div style={{ height: 1, background: "var(--divider)" }} />;
  }
  if (state === "ready") {
    return <div style={{ height: 1, background: ACCENT_BORDER_TOP_READY }} />;
  }
  if (state === "running") {
    const fraction = Math.max(0, Math.min(1, progressFraction ?? 0));
    return (
      <div
        style={{
          height: 3,
          background: "var(--accent-soft)",
          borderTop: `1px solid ${ACCENT_BORDER_TOP_RUN}`,
          position: "relative",
        }}
      >
        <span
          style={{
            display: "block",
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: `${fraction * 100}%`,
            background: ACCENT,
            boxShadow: "0 0 12px rgba(140, 231, 210, 0.7)",
            transition: "width 240ms linear",
          }}
        />
      </div>
    );
  }
  if (state === "complete") {
    return (
      <div
        style={{
          height: 3,
          background: ACCENT,
          borderTop: `1px solid ${ACCENT_BORDER_TOP_READY}`,
        }}
      />
    );
  }
  // failed
  return (
    <div
      style={{
        height: 3,
        background: "color-mix(in srgb, var(--danger) 10%, transparent)",
        borderTop: `1px solid rgba(248, 113, 113, 0.55)`,
        position: "relative",
      }}
    >
      <span
        style={{
          display: "block",
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: "38%",
          background: DANGER,
          boxShadow: "0 0 10px rgba(248, 113, 113, 0.5)",
        }}
      />
    </div>
  );
}

/* ── Status cell ──────────────────────────────────────────────── */

function StatusCell(props: StickyFooterProps) {
  const {
    state,
    wikiTitle,
    runningOpNum,
    runningOpTotal,
    finalDurationSec,
    finalCost,
    failedAtOpNum,
    failedAtOpTotal,
  } = props;

  if (state === "idle") {
    return (
      <CellShell color="var(--text-tertiary)">
        <Dot color="var(--text-placeholder)" />
        Waiting for source + title
      </CellShell>
    );
  }
  if (state === "ready") {
    return (
      <CellShell color={ACCENT}>
        <Dot color={ACCENT} glow />
        Ready · writes to {wikiTitle}
      </CellShell>
    );
  }
  if (state === "running") {
    const isPlanning = !runningOpTotal;
    return (
      <CellShell color={ACCENT}>
        <Dot color={ACCENT} glow />
        {isPlanning
          ? "Running · planning…"
          : `Running · op ${runningOpNum ?? 1} of ${runningOpTotal ?? 1}`}
      </CellShell>
    );
  }
  if (state === "complete") {
    return (
      <CellShell color={ACCENT}>
        <CheckIcon color={ACCENT} />
        Complete · {fmtSec(finalDurationSec)} · {fmtCost(finalCost)}
      </CellShell>
    );
  }
  // failed
  return (
    <CellShell color={DANGER}>
      <ErrorIcon color={DANGER} />
      Failed · op {failedAtOpNum ?? 1} of {failedAtOpTotal ?? 1}
    </CellShell>
  );
}

/* ── Stat group (middle, varies by state) ─────────────────────── */

function StatGroup(props: StickyFooterProps) {
  const { state } = props;

  if (state === "idle") return null;

  if (state === "ready") {
    return (
      <CellGroup>
        <StatCell label="Cost" value={fmtCost(props.projectedCost)} />
        <StatCell label="Time" value={`~${props.projectedDurationSec ?? 0}s`} />
        <StatCell
          label="+Pages"
          value={`+${props.projectedPages ?? 0}`}
          accent
        />
      </CellGroup>
    );
  }

  if (state === "running") {
    return (
      <CellGroup>
        <StatCell label="Now" value={props.runningOpLabel ?? "—"} mono />
        <StatCell label="Elapsed" value={fmtSec(props.elapsedSec)} />
        <StatCell label="Spent" value={fmtCost(props.spentCost)} />
      </CellGroup>
    );
  }

  if (state === "complete") {
    return (
      <CellGroup>
        <StatCell label="+Pages" value={`+${props.finalPages ?? 0}`} accent />
        <StatCell label="+Edges" value={`+${props.finalEdges ?? 0}`} />
        <StatCell label="Chunks" value={`${props.finalChunks ?? 0}`} />
      </CellGroup>
    );
  }

  // failed — single wider reason cell
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0 22px",
        borderRight: "1px solid var(--divider)",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: DANGER,
          }}
        >
          Reason
        </span>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 12,
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 360,
          }}
        >
          {props.errorReason ?? "Unknown error"}
        </span>
      </div>
    </div>
  );
}

function CellGroup({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        borderRight: "1px solid var(--divider)",
      }}
    >
      {children}
    </div>
  );
}

function StatCell({
  label,
  value,
  accent = false,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 1,
        padding: "0 18px",
        height: "100%",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: mono ? FONT_MONO : FONT_HEAD,
          fontSize: mono ? 12 : 14,
          fontWeight: mono ? 400 : 600,
          color: accent ? ACCENT : "var(--text-primary)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ── Pipeline chips + edit icon ──────────────────────────────── */

function PipelineChips(props: StickyFooterProps) {
  const {
    state,
    promptLabel,
    promptVersion,
    promptTokens,
    model,
    embeddings,
    onEditPrompt,
  } = props;
  const muted = state === "idle";
  const dimmed =
    state === "running" || state === "complete" || state === "failed";

  const chipColor = muted
    ? "var(--text-tertiary)"
    : dimmed
      ? "var(--text-secondary)"
      : "var(--text-primary)";

  const dividerColor = muted
    ? "var(--text-placeholder)"
    : "var(--text-tertiary)";
  const stackLabelColor = muted
    ? "var(--text-placeholder)"
    : "var(--text-tertiary)";

  const promptDotColor = muted ? PROMPT_DOT_FADED : PROMPT_DOT;
  const modelDotColor = muted ? MODEL_DOT_FADED : MODEL_DOT;
  const embedDotColor = muted ? EMBED_DOT_FADED : EMBED_DOT;

  const promptText =
    promptTokens > 0 && (state === "idle" || state === "ready")
      ? `${promptLabel} ${promptVersion} · ${promptTokens} tok`
      : `${promptLabel} ${promptVersion}`;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        gap: 0,
        padding: "0 22px",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: stackLabelColor,
          marginRight: 14,
        }}
      >
        Stack
      </span>
      <Chip color={chipColor} dotColor={promptDotColor} label={promptText} />
      {state !== "running" && onEditPrompt && (
        <EditPromptButton onClick={onEditPrompt} muted={muted} />
      )}
      <Divider color={dividerColor} />
      <Chip color={chipColor} dotColor={modelDotColor} label={model} />
      <Divider color={dividerColor} />
      <Chip
        color={chipColor}
        dotColor={embedDotColor}
        label={embeddings ?? "text-embedding-3-large"}
      />
    </div>
  );
}

function Chip({
  color,
  dotColor,
  label,
}: {
  color: string;
  dotColor: string;
  label: ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontFamily: FONT_MONO,
        fontSize: 12,
        color,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      <Dot color={dotColor} small />
      {label}
    </span>
  );
}

function Divider({ color }: { color: string }) {
  return <span style={{ color, margin: "0 12px", flexShrink: 0 }}>/</span>;
}

function EditPromptButton({
  onClick,
  muted,
}: {
  onClick: () => void;
  muted: boolean;
}) {
  const iconColor = muted ? "rgba(140, 231, 210, 0.55)" : ACCENT;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Edit prompt"
      title="Edit prompt"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        padding: 0,
        marginLeft: 8,
        background: muted ? "transparent" : ACCENT_SOFT,
        border: `1px solid ${muted ? "rgba(140, 231, 210, 0.18)" : ACCENT_LINE}`,
        color: iconColor,
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <PencilIcon color={iconColor} />
    </button>
  );
}

/* ── Actions cell ─────────────────────────────────────────────── */

function ActionsCell(props: StickyFooterProps) {
  const { state } = props;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "0 22px",
        borderLeft: "1px solid var(--divider)",
        flexShrink: 0,
      }}
    >
      {state === "idle" && (
        <PrimaryButton
          disabled
          label="Run"
          icon={<PlayIcon color="var(--text-placeholder)" />}
        />
      )}

      {state === "ready" && (
        <PrimaryButton
          onClick={props.onRun}
          label="Run"
          icon={<PlayIcon color={ON_ACCENT} />}
        />
      )}

      {state === "running" && (
        <DangerOutlineButton
          onClick={props.onCancel}
          label="Cancel"
          icon={
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <rect
                x="1"
                y="1"
                width="7"
                height="7"
                stroke={DANGER}
                strokeWidth="1"
              />
            </svg>
          }
        />
      )}

      {state === "complete" && (
        <>
          <GhostButton onClick={props.onOpenWiki} label="Open wiki ↗" />
          <PrimaryButton
            onClick={props.onRunAnother}
            label="Run another"
            icon={
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M5 1v8M1 5h8"
                  stroke={ON_ACCENT}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            }
          />
        </>
      )}

      {state === "failed" && (
        <>
          <GhostButton onClick={props.onReviewError} label="Review error" />
          <DangerSolidButton
            onClick={props.onRetry}
            label="Retry"
            icon={<RegenerateIcon color={DANGER} />}
          />
        </>
      )}
    </div>
  );
}

function PrimaryButton({
  onClick,
  label,
  icon,
  disabled = false,
}: {
  onClick?: () => void;
  label: string;
  icon: ReactNode;
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
        gap: 8,
        padding: "0 18px",
        height: 36,
        background: disabled ? "rgba(140, 231, 210, 0.10)" : ACCENT,
        border: `1px solid ${disabled ? "rgba(140, 231, 210, 0.20)" : ACCENT}`,
        color: disabled ? "var(--text-placeholder)" : ON_ACCENT,
        fontFamily: FONT_HEAD,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? undefined : "0 0 14px rgba(140, 231, 210, 0.20)",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function GhostButton({
  onClick,
  label,
}: {
  onClick?: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0 14px",
        height: 36,
        background: "transparent",
        border: "1px solid var(--border)",
        color: "var(--text-secondary)",
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function DangerOutlineButton({
  onClick,
  label,
  icon,
}: {
  onClick?: () => void;
  label: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "0 14px",
        height: 36,
        background: "transparent",
        border: `1px solid rgba(248, 113, 113, 0.40)`,
        color: DANGER,
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function DangerSolidButton({
  onClick,
  label,
  icon,
}: {
  onClick?: () => void;
  label: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "0 18px",
        height: 36,
        background: DANGER_FILL,
        border: `1px solid ${DANGER}`,
        color: DANGER,
        fontFamily: FONT_HEAD,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/* ── Atoms ────────────────────────────────────────────────────── */

function CellShell({
  color,
  children,
}: {
  color: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "0 22px",
        borderRight: "1px solid var(--divider)",
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color,
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

function Dot({
  color,
  glow = false,
  small = false,
}: {
  color: string;
  glow?: boolean;
  small?: boolean;
}) {
  const size = small ? 5 : 6;
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 999,
        background: color,
        boxShadow: glow ? `0 0 8px ${color}` : undefined,
        flexShrink: 0,
      }}
    />
  );
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path
        d="M2 5l2 2 4-5"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ErrorIcon({ color }: { color: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
      <circle cx="5.5" cy="5.5" r="4.5" stroke={color} strokeWidth="1" />
      <path d="M5.5 3v3" stroke={color} strokeWidth="1" strokeLinecap="round" />
      <circle cx="5.5" cy="7.8" r="0.4" fill={color} />
    </svg>
  );
}

function PencilIcon({ color }: { color: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
      <path
        d="M7.5 1.5l2 2L3 10H1V8L7.5 1.5z"
        stroke={color}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M6.5 2.5l2 2" stroke={color} strokeWidth="1" />
    </svg>
  );
}

function PlayIcon({ color }: { color: string }) {
  return (
    <svg width="9" height="10" viewBox="0 0 9 10" fill="none" aria-hidden>
      <path d="M1 1l7 4-7 4V1z" fill={color} />
    </svg>
  );
}

function RegenerateIcon({ color }: { color: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
      <path
        d="M1.5 5.5a4 4 0 016.8-2.8L10 4.2M9.5 5.5a4 4 0 01-6.8 2.8L1 6.8"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M10 1.5v2.7H7.3M1 9.5V6.8h2.7"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Formatters ───────────────────────────────────────────────── */

function fmtCost(value: number | undefined): string {
  if (value === undefined || value <= 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

function fmtSec(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value < 60) return `${value.toFixed(1)}s`;
  const m = Math.floor(value / 60);
  const s = Math.round(value % 60);
  return `${m}m ${s}s`;
}

// Silence unused-import warning if module shrinks later.
void (null as CSSProperties | null);
