"use client";

import type { SandboxTurn } from "../character-sandbox";

/**
 * SandboxMissionControl — the bottom dock that surfaces session telemetry
 * + a terminal-style log of every turn. Stats grid header has six cells
 * (TTFT, tokens used, spent, model, scope, last-turn recall) with the
 * TTFT value cast in mint Inter — the one hero number per dock.
 * Log rows differentiate user-vs-character via mint-tinted left border +
 * background tint on character rows; the active capture row gets amber
 * treatment matching the ingestion ops-log convention.
 */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";
const AMBER = "var(--warning-amber)";

export function SandboxMissionControl({
  turns,
  sessionId,
  traceCount = 0,
  sessionError,
  ttftMs,
  tokensUsed,
  spent,
  model,
  scopeTags,
  lastRecall,
  onCollapse,
  savedTurnIds,
  onSaveExample,
}: {
  turns: SandboxTurn[];
  sessionId?: string | null;
  traceCount?: number;
  sessionError?: string | null;
  ttftMs: number | null;
  tokensUsed: number;
  spent: number;
  model: string;
  scopeTags: string[];
  lastRecall: number;
  onCollapse: () => void;
  savedTurnIds: Set<string>;
  onSaveExample: (characterTurnId: string) => void;
}) {
  const characterTurns = turns.filter((t) => t.speaker === "character").length;

  return (
    <section
      style={{
        height: 340,
        flexShrink: 0,
        borderTop: "1px solid var(--border)",
        background: "var(--material-card)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 24px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)" }}>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: ACCENT,
            }}
          >
            mission control
          </span>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
            }}
          >
            turn {String(characterTurns).padStart(2, "0")} ·{" "}
            {turns.length} events · {traceCount} traces ·{" "}
            {sessionError
              ? "session degraded"
              : sessionId
                ? `session ${sessionId.slice(0, 8)}`
                : "session local"}
          </span>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          style={{
            padding: "5px 10px",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-tertiary)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-2xs)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          ▾ collapse
        </button>
      </header>

      <StatsGrid
        ttftMs={ttftMs}
        tokensUsed={tokensUsed}
        spent={spent}
        model={model}
        scopeTags={scopeTags}
        lastRecall={lastRecall}
      />

      <LogTable
        turns={turns}
        savedTurnIds={savedTurnIds}
        onSaveExample={onSaveExample}
      />
    </section>
  );
}

/* ── Stats grid ───────────────────────────────────────────────── */

function StatsGrid({
  ttftMs,
  tokensUsed,
  spent,
  model,
  scopeTags,
  lastRecall,
}: {
  ttftMs: number | null;
  tokensUsed: number;
  spent: number;
  model: string;
  scopeTags: string[];
  lastRecall: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface-hover)",
        flexShrink: 0,
      }}
    >
      <StatCell label="ttft">
        <span
          style={{
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-3xl)",
            fontWeight: 600,
            color: ACCENT,
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          {ttftMs != null ? ttftMs : "—"}
          {ttftMs != null && (
            <span
              style={{
                fontSize: "var(--font-size-base)",
                color: "var(--text-tertiary)",
                marginLeft: "var(--space-4)",
              }}
            >
              ms
            </span>
          )}
        </span>
      </StatCell>
      <StatCell label="tokens used">
        <span
          style={{
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-3xl)",
            fontWeight: 600,
            color: "var(--text-primary)",
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          {tokensUsed.toLocaleString()}
          <span
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--text-tertiary)",
              marginLeft: "var(--space-6)",
            }}
          >
            / 2,000
          </span>
        </span>
      </StatCell>
      <StatCell label="spent">
        <span
          style={{
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-3xl)",
            fontWeight: 600,
            color: "var(--text-primary)",
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          ${spent < 0.01 ? spent.toFixed(4) : spent.toFixed(3)}
        </span>
      </StatCell>
      <StatCell label="model">
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-md)",
            color: "var(--text-primary)",
            lineHeight: 1,
            paddingTop: "var(--space-4)",
          }}
        >
          {model}
        </span>
      </StatCell>
      <StatCell label="scope">
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            color: "var(--text-secondary)",
            lineHeight: 1.3,
          }}
        >
          {scopeTags.length > 0 ? scopeTags.join(" · ") : "—"}
        </span>
      </StatCell>
      <StatCell label="recall · last turn" last>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            color: lastRecall > 0 ? ACCENT : "var(--text-tertiary)",
            lineHeight: 1.3,
          }}
        >
          {lastRecall > 0 ? `${lastRecall} facts` : "no recall"}
        </span>
      </StatCell>
    </div>
  );
}

function StatCell({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: "14px 22px",
        borderRight: last ? "none" : "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-2xs)",
          letterSpacing: "0.20em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

/* ── Log table ────────────────────────────────────────────────── */

function LogTable({
  turns,
  savedTurnIds,
  onSaveExample,
}: {
  turns: SandboxTurn[];
  savedTurnIds: Set<string>;
  onSaveExample: (characterTurnId: string) => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-base)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 22px",
          borderBottom: "1px solid var(--border-subtle)",
          fontSize: "var(--font-size-2xs)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
          flexShrink: 0,
        }}
      >
        <span style={{ width: 22, flexShrink: 0 }} />
        <span style={{ width: 88, flexShrink: 0 }}>timestamp</span>
        <span style={{ width: 72, flexShrink: 0 }}>turn</span>
        <span style={{ flex: 1, minWidth: 0, paddingLeft: "var(--space-8)" }}>utterance</span>
        <span style={{ width: 100, flexShrink: 0, textAlign: "right" }}>
          recall
        </span>
        <span style={{ width: 80, flexShrink: 0, textAlign: "right" }}>
          tokens
        </span>
        <span style={{ width: 70, flexShrink: 0, textAlign: "right" }}>
          save
        </span>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
        }}
      >
        {turns.length === 0 ? (
          <div
            style={{
              padding: "14px 22px",
              color: "var(--text-tertiary)",
              fontSize: "var(--font-size-base)",
            }}
          >
            no turns yet
          </div>
        ) : (
          turns.map((turn, i) => (
            <LogRow
              key={turn.id}
              turn={turn}
              index={i + 1}
              saved={savedTurnIds.has(turn.id)}
              onSave={() => onSaveExample(turn.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function LogRow({
  turn,
  index,
  saved,
  onSave,
}: {
  turn: SandboxTurn;
  index: number;
  saved: boolean;
  onSave: () => void;
}) {
  const isCharacter = turn.speaker === "character";
  const isCapturing = turn.inFlight;

  const rowStyle: React.CSSProperties = isCapturing
    ? {
        background: `color-mix(in srgb, ${AMBER} 6%, transparent)`,
        borderLeft: `2px solid color-mix(in srgb, ${AMBER} 50%, transparent)`,
        paddingLeft: "var(--space-20)",
      }
    : isCharacter
      ? {
          background: "color-mix(in srgb, var(--accent-strong) 3%, transparent)",
          borderLeft:
            "2px solid var(--accent-glow)",
          paddingLeft: "var(--space-20)",
        }
      : { paddingLeft: 22 };

  const glyph = isCapturing ? "●" : isCharacter ? "◆" : "▸";
  const glyphColor = isCapturing
    ? AMBER
    : isCharacter
      ? ACCENT
      : "var(--text-tertiary)";

  const turnLabel = isCharacter
    ? `${String(index).padStart(2, "0")} chr`
    : `${String(index).padStart(2, "0")} you`;
  const turnColor = isCapturing
    ? AMBER
    : isCharacter
      ? ACCENT
      : "var(--text-tertiary)";

  const utteranceColor = isCapturing ? AMBER : "var(--text-primary)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "9px 22px",
        paddingLeft: rowStyle.paddingLeft,
        background: rowStyle.background,
        borderLeft: rowStyle.borderLeft,
        borderBottom: "1px solid var(--ink-soft)",
      }}
    >
      <span style={{ width: 22, flexShrink: 0, color: glyphColor }}>
        {glyph}
      </span>
      <span
        style={{
          width: 88,
          flexShrink: 0,
          color: isCapturing ? AMBER : "var(--text-quaternary)",
        }}
      >
        {fmtMs(turn.timestampMs)}
      </span>
      <span style={{ width: 72, flexShrink: 0, color: turnColor }}>
        {turnLabel}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          paddingLeft: "var(--space-8)",
          color: utteranceColor,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontStyle: isCapturing ? "italic" : "normal",
        }}
      >
        {isCapturing ? "capturing audio…" : turn.text}
      </span>
      <span
        style={{
          width: 100,
          flexShrink: 0,
          textAlign: "right",
          color: isCapturing
            ? AMBER
            : (turn.factsRecalled ?? 0) > 0
              ? ACCENT
              : "var(--text-tertiary)",
          fontSize: "var(--font-size-sm)",
        }}
      >
        {isCapturing
          ? "listening"
          : isCharacter
            ? (turn.factsRecalled ?? 0) > 0
              ? `${turn.factsRecalled} facts ↩`
              : "no recall"
            : "—"}
      </span>
      <span
        style={{
          width: 80,
          flexShrink: 0,
          textAlign: "right",
          color: isCapturing ? AMBER : "var(--text-secondary)",
        }}
      >
        {turn.tokens != null ? turn.tokens : "—"}
      </span>
      <span
        style={{
          width: 70,
          flexShrink: 0,
          textAlign: "right",
        }}
      >
        {isCharacter && !isCapturing ? (
          <button
            type="button"
            onClick={onSave}
            disabled={saved}
            style={{
              padding: "3px 8px",
              border: saved
                ? "1px solid color-mix(in srgb, var(--accent-strong) 60%, transparent)"
                : "1px solid color-mix(in srgb, var(--accent-strong) 35%, transparent)",
              background: saved
                ? "color-mix(in srgb, var(--accent-strong) 18%, transparent)"
                : "transparent",
              color: ACCENT,
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-2xs)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              cursor: saved ? "default" : "pointer",
            }}
          >
            {saved ? "✓ saved" : "+ save"}
          </button>
        ) : (
          <span style={{ color: "var(--text-quaternary)" }}>—</span>
        )}
      </span>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────── */

function fmtMs(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const s = (ms % 60_000) / 1000;
  return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}
