"use client";

import { type CSSProperties, type ReactNode } from "react";
import { type ModelId } from "@odyssey/wiki-ingest";

/**
 * Sticky footer — anchors the ingestion page, carries ingestion pipeline,
 * compact run telemetry, and adaptive primary action on the right.
 *
 * Same anatomy in every state: [prompt] · [model] · [embedding] ·
 * [stat group] · [actions]. State governs colour, chrome accents, and what
 * the stat group + actions contain. See Paper artboard
 * "Ingestion · Sticky Footer — Five States" for the visual contract.
 *
 * Self-contained: depends on the admin theme CSS variables so the footer
 * stays legible in both dark and light mode.
 */

const FONT_MONO = "var(--font-mono, 'JetBrains Mono'), ui-monospace, monospace";
const FONT_HEAD = "var(--font-body, Inter), system-ui, sans-serif";

const ACCENT = "var(--accent-strong)";
const ACCENT_SOFT = "var(--accent-soft)";
const ACCENT_LINE = "var(--accent-border)";
const ACCENT_BORDER_TOP_READY =
  "color-mix(in srgb, var(--accent-strong) 35%, transparent)";
const ACCENT_BORDER_TOP_RUN =
  "color-mix(in srgb, var(--accent-strong) 55%, transparent)";
const DANGER = "var(--status-error)";
const DANGER_FILL = "color-mix(in srgb, var(--status-error) 12%, transparent)";
const ON_ACCENT = "var(--background)";

const PROMPT_DOT = "var(--accent-strong)";
const MODEL_DOT = "var(--signal-blue)";
const EMBED_DOT = "var(--warning-amber)";
const PROMPT_DOT_FADED =
  "color-mix(in srgb, var(--accent-strong) 50%, transparent)";
const MODEL_DOT_FADED =
  "color-mix(in srgb, var(--signal-blue) 50%, transparent)";
const EMBED_DOT_FADED =
  "color-mix(in srgb, var(--warning-amber) 50%, transparent)";

const ROW_HEIGHT = 50;
const TOP_ACCENT_BASE: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 1,
  pointerEvents: "none",
};

const PIPELINE_SEGMENT_CSS = `
  .ingestion-pipeline-segment[data-interactive="true"] {
    background: transparent;
    cursor: pointer;
  }

  .ingestion-pipeline-segment[data-interactive="true"]:hover {
    background: var(--sidebar-hover, color-mix(in srgb, var(--text-primary) 4%, transparent));
  }

  .ingestion-pipeline-segment[data-interactive="true"]:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px var(--accent-border);
  }

  .ingestion-pipeline-segment[data-interactive="true"]:hover .ingestion-pipeline-edit {
    background: var(--accent-soft);
    border-color: var(--accent-border);
    color: var(--accent-strong);
  }
`;

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
  /* Steer metadata mirrored from Classify (read-only). */
  sourceType: string;
  tags: string[];

  /* Projected (idle / ready). */
  projectedCost?: number;
  projectedTokens?: number;
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
  retryFailedOnlyCount?: number;

  /* Callbacks — each state uses the ones it needs. */
  onRun?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  onRetryFailedOnly?: () => void;
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
        height: ROW_HEIGHT,
        background: "var(--header-bg, var(--sidebar))",
        backdropFilter: "blur(var(--header-blur, 18px))",
        boxShadow:
          "0 -18px 46px color-mix(in srgb, var(--shadow) 48%, transparent)",
        // Footer is a sibling of the grid inside <main>; it spans the full
        // content-area width naturally (left of sidebar, right to edge).
      }}
    >
      <style>{PIPELINE_SEGMENT_CSS}</style>
      <TopAccent state={state} progressFraction={props.progressFraction} />

      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          height: ROW_HEIGHT,
        }}
      >
        <PipelineChips {...props} />
        <StatGroup {...props} />
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
    return (
      <div
        style={{ ...TOP_ACCENT_BASE, height: 1, background: "var(--border-subtle)" }}
      />
    );
  }
  if (state === "ready") {
    return (
      <div
        style={{
          ...TOP_ACCENT_BASE,
          height: 1,
          background: ACCENT_BORDER_TOP_READY,
        }}
      />
    );
  }
  if (state === "running") {
    const fraction = Math.max(0, Math.min(1, progressFraction ?? 0));
    return (
      <div
        style={{
          ...TOP_ACCENT_BASE,
          height: 3,
          background: "var(--accent-soft)",
          borderTop: `1px solid ${ACCENT_BORDER_TOP_RUN}`,
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
            boxShadow:
              "0 0 12px color-mix(in srgb, var(--accent-strong) 70%, transparent)",
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
          ...TOP_ACCENT_BASE,
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
        ...TOP_ACCENT_BASE,
        height: 3,
        background: "color-mix(in srgb, var(--status-error) 10%, transparent)",
        borderTop: "1px solid var(--critical-border)",
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
          boxShadow:
            "0 0 10px color-mix(in srgb, var(--status-error) 50%, transparent)",
        }}
      />
    </div>
  );
}

/* ── Stat group (middle, varies by state) ─────────────────────── */

function StatGroup(props: StickyFooterProps) {
  const { state } = props;

  if (state === "idle") return null;

  if (state === "ready") {
    return (
      <CellGroup>
        <StatCell label="Tokens" value={fmtTokens(props.projectedTokens)} />
        <StatCell label="Cost" value={fmtCost(props.projectedCost)} />
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
        borderLeft: "1px solid var(--border-subtle)",
        borderRight: "1px solid var(--border-subtle)",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-2xs)",
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
            fontSize: "var(--font-size-base)",
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
        borderLeft: "1px solid var(--border-subtle)",
        borderRight: "1px solid var(--border-subtle)",
        flexShrink: 0,
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
        gap: "var(--space-1)",
        padding: "0 18px",
        height: "100%",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-2xs)",
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

/* ── Pipeline segments ─────────────────────────────────────────── */

function PipelineChips(props: StickyFooterProps) {
  const {
    state,
    promptLabel,
    promptVersion,
    promptTokens,
    sourceType,
    tags,
    onEditPrompt,
  } = props;
  const muted = state === "idle";
  const dimmed =
    state === "running" || state === "complete" || state === "failed";
  const promptLocked = dimmed;
  const promptEditable = !promptLocked && Boolean(onEditPrompt);

  const valueColor = muted
    ? "var(--text-tertiary)"
    : dimmed
      ? "var(--text-secondary)"
      : "var(--text-primary)";
  const labelColor = muted ? "var(--text-placeholder)" : "var(--text-tertiary)";

  const promptDotColor = muted ? PROMPT_DOT_FADED : PROMPT_DOT;
  const typeDotColor = muted ? MODEL_DOT_FADED : MODEL_DOT;
  const tagsDotColor = muted ? EMBED_DOT_FADED : EMBED_DOT;

  const promptText =
    promptTokens > 0 && (state === "idle" || state === "ready")
      ? `${promptLabel} ${promptVersion} · ${promptTokens} tok`
      : `${promptLabel} ${promptVersion}`;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "stretch",
        gap: 0,
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <PipelineSegment
        label="Prompt"
        value={promptText}
        valueColor={valueColor}
        labelColor={labelColor}
        dotColor={promptDotColor}
        flex="1.35 1 320px"
        onClick={promptEditable ? onEditPrompt : undefined}
        action={promptEditable ? <EditPromptIcon muted={muted} /> : undefined}
        locked={promptLocked}
      />
      <PipelineSegment
        label="Source type ↺"
        value={sourceType}
        valueColor={valueColor}
        labelColor={labelColor}
        dotColor={typeDotColor}
        flex="0.9 1 250px"
        locked
      />
      <PipelineSegment
        label="Tags ↺"
        value={tags.length > 0 ? tags.join(" · ") : "—"}
        valueColor={valueColor}
        labelColor={labelColor}
        dotColor={tagsDotColor}
        flex="1 1 280px"
        locked
        isLast
      />
    </div>
  );
}

function PipelineSegment({
  label,
  value,
  valueColor,
  labelColor,
  dotColor,
  flex,
  action,
  onClick,
  locked = false,
  isLast = false,
}: {
  label: string;
  value: ReactNode;
  valueColor: string;
  labelColor: string;
  dotColor: string;
  flex: string;
  action?: ReactNode;
  onClick?: () => void;
  locked?: boolean;
  isLast?: boolean;
}) {
  const content = (
    <>
      <div
        style={{
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-2xs)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: labelColor,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-8)",
            minWidth: 0,
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-base)",
            color: valueColor,
            whiteSpace: "nowrap",
          }}
        >
          <Dot color={dotColor} small />
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            {value}
          </span>
        </span>
      </div>
      {action}
      {locked && <LockedIndicator />}
    </>
  );

  const segmentStyle: CSSProperties = {
    flex,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--space-12)",
    padding: "0 18px",
    borderRight: isLast
      ? "none"
      : "1px solid var(--header-border, var(--border-subtle))",
    transition: "background 140ms ease, box-shadow 140ms ease",
  };

  if (onClick) {
    return (
      <button
        type="button"
        className="ingestion-pipeline-segment"
        data-interactive="true"
        onClick={onClick}
        aria-label={`Edit ${label.toLowerCase()}`}
        title={`Edit ${label.toLowerCase()}`}
        style={{
          ...segmentStyle,
          appearance: "none",
          borderTop: 0,
          borderBottom: 0,
          borderLeft: 0,
          color: "inherit",
          font: "inherit",
          textAlign: "left",
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className="ingestion-pipeline-segment"
      data-interactive="false"
      style={{
        ...segmentStyle,
      }}
    >
      {content}
    </div>
  );
}

function LockedIndicator() {
  return (
    <span
      title="Locked"
      aria-label="Locked"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        color: "var(--text-placeholder)",
        flexShrink: 0,
        opacity: 0.82,
      }}
    >
      <LockIcon />
    </span>
  );
}

function EditPromptIcon({ muted }: { muted: boolean }) {
  const iconColor = muted
    ? "color-mix(in srgb, var(--accent-strong) 55%, transparent)"
    : ACCENT;
  return (
    <span
      className="ingestion-pipeline-edit"
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        padding: 0,
        background: muted ? "transparent" : ACCENT_SOFT,
        border: `1px solid ${
          muted
            ? "color-mix(in srgb, var(--accent-strong) 18%, transparent)"
            : ACCENT_LINE
        }`,
        color: iconColor,
        flexShrink: 0,
        transition:
          "background 140ms ease, border-color 140ms ease, color 140ms ease",
      }}
    >
      <PencilIcon color={iconColor} />
    </span>
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
        gap: "var(--space-10)",
        padding: "0 22px",
        borderLeft: "1px solid var(--border-subtle)",
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
          {props.onRetryFailedOnly && (
            <GhostButton
              onClick={props.onRetryFailedOnly}
              label={
                props.retryFailedOnlyCount && props.retryFailedOnlyCount > 0
                  ? `Retry ${props.retryFailedOnlyCount} failed only`
                  : "Retry failed only"
              }
            />
          )}
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
        gap: "var(--space-8)",
        padding: "0 18px",
        height: 36,
        background: disabled
          ? "color-mix(in srgb, var(--accent-strong) 10%, transparent)"
          : ACCENT,
        border: `1px solid ${
          disabled
            ? "color-mix(in srgb, var(--accent-strong) 20%, transparent)"
            : ACCENT
        }`,
        borderRadius: "var(--radius-md)",
        color: disabled ? "var(--text-placeholder)" : ON_ACCENT,
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-md)",
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled
          ? undefined
          : "0 0 14px color-mix(in srgb, var(--accent-strong) 20%, transparent)",
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
        borderRadius: "var(--radius-md)",
        color: "var(--text-secondary)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-sm)",
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
        border: "1px solid var(--critical-border)",
        borderRadius: "var(--radius-md)",
        color: DANGER,
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-sm)",
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
        gap: "var(--space-8)",
        padding: "0 18px",
        height: 36,
        background: DANGER_FILL,
        border: `1px solid ${DANGER}`,
        borderRadius: "var(--radius-md)",
        color: DANGER,
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-md)",
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
        borderRadius: "var(--radius-pill)",
        background: color,
        boxShadow: glow ? `0 0 8px ${color}` : undefined,
        flexShrink: 0,
      }}
    />
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

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
      <rect
        x="2"
        y="5"
        width="7"
        height="4.5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        d="M3.5 5V3.8a2 2 0 014 0V5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
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

function fmtTokens(value: number | undefined): string {
  const n = Math.max(0, value ?? 0);
  if (n < 1000) return `${n}`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
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
