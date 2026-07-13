"use client";

import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useMemo,
  useState,
} from "react";
import type { TracePayload } from "@/lib/voice-trace";
import type {
  SandboxMode,
  SandboxPhase,
  SandboxTraceRecord,
} from "../character-sandbox";
import { SandboxReadinessPanel } from "./sandbox-readiness-drawer";

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";
const DANGER = "var(--status-error)";
const PANEL_BG = "var(--surface-active)";
const PANEL_SECTION_BG = "var(--material-card)";
const PANEL_CELL_BG = "var(--surface-1)";

type Props = {
  open: boolean;
  phase: SandboxPhase;
  mode: SandboxMode;
  records: SandboxTraceRecord[];
  characterId: string;
  characterTitle: string;
  sessionId: string | null;
  sessionError: string | null;
  chatModel: string;
  voiceModel: string;
  onClose: () => void;
};

type TraceRow = {
  name: string;
  elapsedMs: number;
  meta?: Record<string, unknown>;
};

export function SandboxTraceDrawer({
  open,
  phase,
  mode,
  records,
  characterId,
  characterTitle,
  sessionId,
  sessionError,
  chatModel,
  voiceModel,
  onClose,
}: Props) {
  const [tab, setTab] = useState<"trace" | "readiness">("trace");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [height, setHeight] = useState(360);
  const selected =
    records.find((record) => record.id === selectedId) ??
    records[records.length - 1] ??
    null;
  const preSessionRows = useMemo(
    () =>
      buildPreSessionRows({
        mode,
        chatModel,
        voiceModel,
        sessionId,
        sessionError,
      }),
    [chatModel, mode, sessionError, sessionId, voiceModel],
  );
  const rows = selected ? normalizeTraceRows(selected.trace) : preSessionRows;
  const elapsed = selected
    ? traceElapsedMs(selected.trace)
    : (rows.at(-1)?.elapsedMs ?? 0);

  if (!open) return null;

  function resizeFromPointer(clientY: number) {
    const viewportHeight =
      typeof window === "undefined" ? 900 : window.innerHeight;
    const maxHeight = Math.max(320, Math.round(viewportHeight * 0.72));
    const nextHeight = clamp(viewportHeight - clientY, 240, maxHeight);
    setHeight(nextHeight);
  }

  function onResizePointerDown(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeFromPointer(e.clientY);
  }

  function onResizePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    resizeFromPointer(e.clientY);
  }

  return (
    <section
      role="region"
      aria-label="Sandbox trace bottom panel"
      style={{
        position: "relative",
        width: "100%",
        height,
        minHeight: 240,
        flexShrink: 0,
        background: PANEL_BG,
        borderTop: "1px solid var(--border-medium)",
        display: "flex",
        flexDirection: "row",
        overflow: "hidden",
        boxShadow: "var(--elevation-panel)",
      }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize trace panel"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        style={{
          position: "absolute",
          top: -5,
          left: 0,
          right: 0,
          height: 10,
          cursor: "ns-resize",
          touchAction: "none",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            width: 72,
            height: 3,
            borderRadius: "var(--radius-pill)",
            background: "var(--ink-edge)",
            boxShadow: "0 0 0 1px var(--border-subtle)",
          }}
        />
      </div>
      <header
        style={{
          width: 300,
          flexShrink: 0,
          padding: "22px 24px",
          borderRight: "1px solid var(--border-medium)",
          background: PANEL_SECTION_BG,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: "var(--space-18)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-12)",
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "var(--space-16)",
            }}
          >
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: ACCENT,
                lineHeight: "14px",
              }}
            >
              diagnostics
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={iconButtonStyle}
            >
              x
            </button>
          </div>
          <div
            style={{
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-4xl)",
              fontWeight: 600,
              letterSpacing: 0,
              lineHeight: "30px",
              color: "var(--text-primary)",
            }}
          >
            {tab === "trace"
              ? phase === "pre-session" || phase === "intro"
                ? "Pre-session plan"
                : "Runtime trace"
              : "Readiness checks"}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-12)",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              border: "1px solid var(--border-medium)",
              background: PANEL_CELL_BG,
            }}
          >
            <DiagnosticsTab
              active={tab === "trace"}
              onClick={() => setTab("trace")}
            >
              trace
            </DiagnosticsTab>
            <DiagnosticsTab
              active={tab === "readiness"}
              onClick={() => setTab("readiness")}
              leftBorder
            >
              readiness
            </DiagnosticsTab>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-8)",
              flexWrap: "wrap",
            }}
          >
            <TracePill tone={sessionError ? "danger" : "accent"}>
              {sessionError ? "degraded" : phase}
            </TracePill>
            <TracePill>{records.length} captured</TracePill>
            <TracePill>{Math.round(elapsed)}ms</TracePill>
          </div>
        </div>
      </header>

      {tab === "readiness" ? (
        <div
          style={{
            minWidth: 0,
            flex: 1,
            display: "flex",
            overflow: "hidden",
            background: PANEL_SECTION_BG,
          }}
        >
          <SandboxReadinessPanel
            active={open && tab === "readiness"}
            characterId={characterId}
            characterTitle={characterTitle}
            mode={mode}
            chatModel={chatModel}
            voiceModel={voiceModel}
          />
        </div>
      ) : (
        <>
          <div
            style={{
              width: 330,
              flexShrink: 0,
              padding: "18px 18px",
              borderRight: "1px solid var(--border-subtle)",
              background: PANEL_SECTION_BG,
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-10)",
              overflow: "auto",
            }}
          >
            <TraceCell label="mode" value={mode} hint={phase} />
            <TraceCell
              label="session"
              value={sessionId ? sessionId.slice(0, 8) : "not started"}
              hint={sessionError ?? "world session"}
            />
            <TraceCell
              label="chat model"
              value={chatModel || "unset"}
              hint="provider routed by registry"
            />
            <TraceCell
              label="voice model"
              value={voiceModel || "unset"}
              hint="tts prompt path"
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: records.length > 0 ? "160px 1fr" : "1fr",
              minHeight: 0,
              flex: 1,
              background: PANEL_SECTION_BG,
            }}
          >
            {records.length > 0 && (
              <TraceRecordRail
                records={records}
                selectedId={selected?.id ?? null}
                onSelect={setSelectedId}
              />
            )}
            <TraceTimeline
              rows={rows}
              emptyLabel={
                records.length === 0
                  ? "No turn traces yet. Start the session to capture orchestrator, model, TTS, and playback timings."
                  : "No events recorded for this trace."
              }
            />
          </div>
        </>
      )}
    </section>
  );
}

function DiagnosticsTab({
  active,
  onClick,
  leftBorder,
  children,
}: {
  active: boolean;
  onClick: () => void;
  leftBorder?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        borderLeft: leftBorder ? "1px solid var(--border-medium)" : "none",
        background: active ? "var(--accent-wash)" : PANEL_CELL_BG,
        color: active ? ACCENT : "var(--text-tertiary)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        padding: "8px 11px",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function TraceRecordRail({
  records,
  selectedId,
  onSelect,
}: {
  records: SandboxTraceRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav
      style={{
        borderRight: "1px solid var(--border-subtle)",
        background: PANEL_SECTION_BG,
        overflow: "auto",
        padding: "12px 10px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
      }}
    >
      {records
        .slice()
        .reverse()
        .map((record, index) => {
          const active = record.id === selectedId;
          return (
            <button
              key={record.id}
              type="button"
              onClick={() => onSelect(record.id)}
              style={{
                border: active
                  ? "1px solid color-mix(in srgb, var(--accent-strong) 45%, transparent)"
                  : "1px solid var(--border-subtle)",
                background: active
                  ? "color-mix(in srgb, var(--accent-strong) 10%, transparent)"
                  : PANEL_CELL_BG,
                color: active ? ACCENT : "var(--text-secondary)",
                padding: "10px 12px",
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-5)",
              }}
            >
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-xs)",
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                }}
              >
                trace {String(records.length - index).padStart(2, "0")}
              </span>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-2xs)",
                  color: "var(--text-tertiary)",
                }}
              >
                {record.kind} · {record.meta.model ?? "model unset"}
              </span>
            </button>
          );
        })}
    </nav>
  );
}

function TraceTimeline({
  rows,
  emptyLabel,
}: {
  rows: TraceRow[];
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: 28,
          background: PANEL_SECTION_BG,
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-md)",
          lineHeight: "20px",
          color: "var(--text-tertiary)",
        }}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: 0,
        overflow: "auto",
        padding: "18px 28px 28px",
        background: PANEL_SECTION_BG,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-10)",
      }}
    >
      {rows.map((row, index) => {
        const prev = rows[index - 1];
        const delta = prev
          ? Math.max(0, row.elapsedMs - prev.elapsedMs)
          : row.elapsedMs;
        return (
          <div
            key={`${row.name}-${index}`}
            style={{
              display: "grid",
              gridTemplateColumns: "86px 1fr",
              gap: "var(--space-12)",
              padding: "10px 0",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: "var(--space-3)",
              }}
            >
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-sm)",
                  lineHeight: "14px",
                  color: "var(--text-primary)",
                }}
              >
                {Math.round(row.elapsedMs)}ms
              </span>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-2xs)",
                  lineHeight: "12px",
                  color: "var(--text-quaternary)",
                }}
              >
                +{Math.round(delta)}ms
              </span>
            </div>
            <div
              style={{
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-5)",
              }}
            >
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-sm)",
                  lineHeight: "14px",
                  color: "var(--text-secondary)",
                }}
              >
                {row.name}
              </span>
              {row.meta ? (
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: FONT_MONO,
                    fontSize: "var(--font-size-2xs)",
                    lineHeight: "14px",
                    color: "var(--text-tertiary)",
                  }}
                >
                  {JSON.stringify(row.meta, null, 2)}
                </pre>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TraceCell({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border-subtle)",
        background: PANEL_CELL_BG,
        padding: "10px 12px",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-2xs)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 7,
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-sm)",
          lineHeight: "14px",
          color: "var(--text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
      {hint ? (
        <div
          style={{
            marginTop: "var(--space-4)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-2xs)",
            lineHeight: "12px",
            color: "var(--text-quaternary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function TracePill({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "accent" | "danger" | "muted";
}) {
  const color =
    tone === "accent"
      ? ACCENT
      : tone === "danger"
        ? DANGER
        : "var(--text-tertiary)";
  return (
    <span
      style={{
        border: `1px solid ${tone === "muted" ? "var(--border-medium)" : color}`,
        background:
          tone === "muted"
            ? "var(--ink-soft)"
            : `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-2xs)",
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        padding: "5px 8px",
      }}
    >
      {children}
    </span>
  );
}

function buildPreSessionRows({
  mode,
  chatModel,
  voiceModel,
  sessionId,
  sessionError,
}: {
  mode: SandboxMode;
  chatModel: string;
  voiceModel: string;
  sessionId: string | null;
  sessionError: string | null;
}): TraceRow[] {
  return [
    {
      name: "sandbox.pre_session.loaded",
      elapsedMs: 0,
      meta: { phase: "pre-session" },
    },
    {
      name: "routing.chat_model.selected",
      elapsedMs: 1,
      meta: { model: chatModel || "unset" },
    },
    {
      name: "routing.voice_model.selected",
      elapsedMs: 2,
      meta: { model: voiceModel || "unset", mode },
    },
    {
      name: sessionId ? "world_session.ready" : "world_session.pending_start",
      elapsedMs: 3,
      meta: sessionId ? { sessionId } : { persistence: "created on start" },
    },
    {
      name: sessionError
        ? "sandbox.session.degraded"
        : "sandbox.ready_for_launch",
      elapsedMs: 4,
      meta: sessionError
        ? { error: sessionError }
        : { shortcut: "Cmd/Ctrl+Enter" },
    },
  ];
}

function normalizeTraceRows(trace: TracePayload): TraceRow[] {
  return trace.events
    .map((event) => ({
      name: event.name,
      elapsedMs: "elapsedMs" in event ? event.elapsedMs : event.t,
      ...(event.meta ? { meta: event.meta } : {}),
    }))
    .sort((a, b) => a.elapsedMs - b.elapsedMs);
}

function traceElapsedMs(trace: TracePayload): number {
  if ("elapsedMs" in trace) return trace.elapsedMs;
  const rows = normalizeTraceRows(trace);
  return rows.at(-1)?.elapsedMs ?? 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

const iconButtonStyle = {
  width: 30,
  height: 30,
  border: "1px solid var(--border-medium)",
  background: PANEL_CELL_BG,
  color: "var(--text-tertiary)",
  fontFamily: FONT_MONO,
  fontSize: "var(--font-size-lg)",
  cursor: "pointer",
} satisfies CSSProperties;
