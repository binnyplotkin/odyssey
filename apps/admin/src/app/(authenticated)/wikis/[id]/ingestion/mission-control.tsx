"use client";

/**
 * MissionControl — calm running-state summary. The footer owns commands and
 * final telemetry; this panel shows only the current operation and traceable
 * progress inside the body.
 */

const FONT_MONO = "var(--font-mono, 'JetBrains Mono'), ui-monospace, monospace";
const FONT_HEAD = "var(--font-body, Inter), system-ui, sans-serif";
const ACCENT = "var(--accent-strong)";
const AMBER = "var(--status-processing)";

const SPARK_W = 320;
const SPARK_H = 48;

export type MissionControlProps = {
  /** Total ops in the plan. */
  opsTotal: number;
  /** Ops completed so far. */
  opsDone: number;
  /** Ops with action="create". */
  opsCreate: number;
  /** Ops with action="update". */
  opsUpdate: number;
  /** Pages created so far (running tally). */
  pagesAdded: number;
  /** Edges added so far (running tally). */
  edgesAdded: number;
  /** Total tokens consumed so far. */
  tokensUsed: number;
  /** Current tokens/sec rate; null while we don't yet have a sample. */
  tokensPerSec: number | null;
  /** Recent tokens/sec samples for the sparkline. Most recent at the end. */
  sparklineSamples: number[];
  /** Contradictions flagged during planning. */
  contradictions: number;
  /** "now" status line — e.g. `embed · §22:1–22:5`. */
  currentOpLabel: string | null;
  /** Model id, shown in the status line. */
  model: string | null;
  /** "writing → pages" or "fetching" etc. — a short verb-phrase for the status line. */
  currentOpStage: string | null;
  /** Elapsed ms since run start. */
  elapsedMs: number;
  /** Heuristic ETA in seconds (existing derivation). Pass null while no data yet. */
  etaSec: number | null;
};

export function MissionControl({
  opsTotal,
  opsDone,
  opsCreate,
  opsUpdate,
  pagesAdded,
  edgesAdded,
  tokensUsed,
  tokensPerSec,
  sparklineSamples,
  contradictions,
  currentOpLabel,
  model,
  currentOpStage,
  elapsedMs,
  etaSec,
}: MissionControlProps) {
  const progressFraction = opsTotal > 0 ? opsDone / opsTotal : 0;
  const sparklinePath = buildSparklinePath(sparklineSamples);
  const lastSample = sparklineSamples[sparklineSamples.length - 1] ?? 0;
  const sparkLastX =
    sparklineSamples.length > 0
      ? ((sparklineSamples.length - 1) /
          Math.max(1, sparklineSamples.length - 1)) *
        SPARK_W
      : SPARK_W;
  const sparkMax = Math.max(...sparklineSamples, 1);
  const sparkLastY = SPARK_H - (lastSample / sparkMax) * (SPARK_H - 4) - 2;

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
      }}
    >
      <style>{ANIM_CSS}</style>

      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-18)",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: ACCENT,
          }}
        >
          run console
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-10)",
            padding: "3px 12px",
            border: "1px solid var(--accent-border)",
            borderRadius: "var(--radius-pill)",
            background: "var(--accent-soft)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: ACCENT,
          }}
        >
          <PulseDot color={ACCENT} />
          live · {formatElapsed(elapsedMs)}
        </span>
      </header>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--control-border)",
          borderRadius: "var(--radius-lg)",
          background: "var(--control-bg)",
          overflow: "hidden",
        }}
      >
        {/* Top row — Op queue counter (left) + Tokens/sec sparkline (right) */}
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              flex: "1.6 1 0",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-10)",
              padding: "18px 22px",
              borderRight: "1px solid var(--border-subtle)",
            }}
          >
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.20em",
                textTransform: "uppercase",
                color: "var(--text-tertiary)",
              }}
            >
              Op queue
            </span>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "var(--space-14)",
              }}
            >
              <span
                style={{
                  fontFamily: FONT_HEAD,
                  fontSize: 38,
                  fontWeight: 600,
                  letterSpacing: 0,
                  color: "var(--text-primary)",
                  lineHeight: 1,
                }}
              >
                {opsDone}
              </span>
              <span
                style={{
                  fontFamily: FONT_HEAD,
                  fontSize: "var(--font-size-2xl)",
                  color: "var(--text-tertiary)",
                  letterSpacing: 0,
                }}
              >
                / {opsTotal || "—"}
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-sm)",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--text-tertiary)",
                }}
              >
                {etaSec !== null ? `~${etaSec}s remaining` : "estimating…"}
              </span>
            </div>
            <div
              style={{
                position: "relative",
                height: 3,
                background: "var(--ink-fill)",
                borderRadius: "var(--radius-pill)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: `${(progressFraction * 100).toFixed(1)}%`,
                  height: 3,
                  background: ACCENT,
                  boxShadow:
                    "0 0 10px color-mix(in srgb, var(--accent) 55%, transparent)",
                  transition: "width 240ms ease",
                }}
              />
            </div>
          </div>

          <div
            style={{
              flex: "1.4 1 0",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-8)",
              padding: "18px 22px",
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-xs)",
                  letterSpacing: "0.20em",
                  textTransform: "uppercase",
                  color: "var(--text-tertiary)",
                }}
              >
                Tokens / sec
              </span>
              <span
                style={{
                  fontFamily: FONT_HEAD,
                  fontSize: "var(--font-size-2xl)",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  letterSpacing: 0,
                }}
              >
                {tokensPerSec === null
                  ? "—"
                  : Math.round(tokensPerSec).toLocaleString()}
              </span>
            </div>
            <svg
              width="100%"
              height={SPARK_H}
              viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
              preserveAspectRatio="none"
              style={{ display: "block", opacity: 0.78 }}
              aria-hidden
            >
              <defs>
                <linearGradient id="mc-spark-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--accent-strong)"
                    stopOpacity="0.30"
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--accent-strong)"
                    stopOpacity="0"
                  />
                </linearGradient>
              </defs>
              {sparklinePath && (
                <>
                  <path
                    d={`${sparklinePath} L${SPARK_W},${SPARK_H} L0,${SPARK_H} Z`}
                    fill="url(#mc-spark-fill)"
                  />
                  <path
                    d={sparklinePath}
                    stroke={ACCENT}
                    strokeWidth="1.2"
                    fill="none"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <circle cx={sparkLastX} cy={sparkLastY} r="3" fill={ACCENT} />
                </>
              )}
            </svg>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.10em",
                color: "var(--text-tertiary)",
              }}
            >
              <span>last 20s</span>
              <span style={{ color: ACCENT }}>
                ↗ {tokensUsed.toLocaleString()} tok used
              </span>
            </div>
          </div>
        </div>

        {/* Counter strip */}
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <Counter label="Create" value={`${opsCreate}`} />
          <Counter label="Update" value={`${opsUpdate}`} />
          <Counter label="Pages" value={`+${pagesAdded}`} accent />
          <Counter label="Edges" value={`+${edgesAdded}`} accent />
          <Counter
            label="Flagged"
            value={`${contradictions}`}
            tone={contradictions > 0 ? "amber" : undefined}
            last
          />
        </div>

        {/* Status line */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "11px 18px",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            color: "var(--text-secondary)",
            background:
              "color-mix(in srgb, var(--background) 42%, transparent)",
            gap: 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              color: "var(--text-tertiary)",
              marginRight: "var(--space-14)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            Now
          </span>
          <span style={{ color: ACCENT }}>▸</span>
          <span
            style={{
              marginLeft: "var(--space-8)",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {currentOpLabel ?? "queued"}
          </span>
          {model && (
            <>
              <Sep />
              <span style={{ color: "var(--text-secondary)" }}>{model}</span>
            </>
          )}
          {currentOpStage && (
            <>
              <Sep />
              <span style={{ color: "var(--text-secondary)" }}>
                {currentOpStage}
              </span>
            </>
          )}
          <span
            style={{
              marginLeft: "auto",
              color: "var(--text-tertiary)",
              flexShrink: 0,
              paddingLeft: "var(--space-12)",
            }}
          >
            {formatShortElapsed(elapsedMs)}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ── Atoms ────────────────────────────────────────────────────── */

function Counter({
  label,
  value,
  accent = false,
  tone,
  last = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  tone?: "amber";
  last?: boolean;
}) {
  const valueColor =
    tone === "amber" ? AMBER : accent ? ACCENT : "var(--text-primary)";
  const labelColor = tone === "amber" ? AMBER : "var(--text-tertiary)";
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        padding: "11px 18px",
        borderRight: last ? "none" : "1px solid var(--border-subtle)",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-2xs)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: labelColor,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-lg)",
          fontWeight: 600,
          color: valueColor,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Sep() {
  return (
    <span style={{ color: "var(--text-quaternary)", margin: "0 10px" }}>·</span>
  );
}

function PulseDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "var(--radius-pill)",
        background: color,
        boxShadow: `0 0 8px ${color}`,
        animation: "mc-pulse 1.1s ease-in-out infinite",
        flexShrink: 0,
      }}
    />
  );
}

const ANIM_CSS = `@keyframes mc-pulse{0%,100%{opacity:1}50%{opacity:.4}}`;

/* ── Helpers ──────────────────────────────────────────────────── */

function buildSparklinePath(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const denom = Math.max(1, values.length - 1);
  return values
    .map((v, i) => {
      const x = (i / denom) * SPARK_W;
      const y = SPARK_H - (v / max) * (SPARK_H - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatShortElapsed(ms: number): string {
  const sec = Math.max(0, ms / 1000);
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}
