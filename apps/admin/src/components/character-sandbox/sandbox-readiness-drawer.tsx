"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { SandboxMode } from "../character-sandbox";

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";
const DANGER = "var(--danger)";
const AMBER = "#FACC15";

type ReadinessStatus =
  | "not_checked"
  | "checking"
  | "ready"
  | "warning"
  | "blocked"
  | "degraded"
  | "unavailable";

type ReadinessGroup = "routing" | "voice" | "context" | "persistence" | "browser";
type ReadinessAction =
  | "check_model"
  | "check_tts"
  | "check_stt"
  | "check_persistence"
  | "run_all";

type ReadinessCheck = {
  id: string;
  label: string;
  group: ReadinessGroup;
  status: ReadinessStatus;
  summary: string;
  detail?: string;
  checkedAt?: string;
  metadata?: Record<string, unknown>;
  action?: ReadinessAction;
};

type ReadinessReport = {
  timestamp: string;
  mode: SandboxMode;
  overallStatus: ReadinessStatus;
  character: {
    id: string;
    slug: string;
    title: string;
  };
  selected: {
    chatModel: ModelSelection;
    voiceModel?: ModelSelection;
    voice?: {
      provider: string;
      slug: string;
      name?: string | null;
      status: string;
      fallback: boolean;
    };
    stt: {
      provider: string;
      label: string;
      configured: boolean;
    };
  };
  checks: ReadinessCheck[];
  groups: Array<{
    id: ReadinessGroup;
    status: ReadinessStatus;
    ready: number;
    warnings: number;
    blocked: number;
    total: number;
  }>;
};

type ModelSelection = {
  id: string;
  label: string;
  provider: string | null;
  mode: "chat" | "voice";
  known: boolean;
  configured: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  streaming?: boolean;
  latencyTier?: string;
  qualityTier?: string;
  missingEnv?: string | null;
};

type Props = {
  open: boolean;
  characterId: string;
  characterTitle: string;
  mode: SandboxMode;
  chatModel: string;
  voiceModel: string;
  onClose: () => void;
};

type PanelProps = {
  active: boolean;
  characterId: string;
  characterTitle: string;
  mode: SandboxMode;
  chatModel: string;
  voiceModel: string;
  onClose?: () => void;
};

const GROUPS: Array<{ id: ReadinessGroup; label: string; action?: ReadinessAction }> = [
  { id: "routing", label: "model routing", action: "check_model" },
  { id: "voice", label: "voice stack", action: "check_tts" },
  { id: "context", label: "context inputs" },
  { id: "persistence", label: "persistence", action: "check_persistence" },
  { id: "browser", label: "browser" },
];

export function SandboxReadinessDrawer({
  open,
  characterId,
  characterTitle,
  mode,
  chatModel,
  voiceModel,
  onClose,
}: Props) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Sandbox readiness"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        pointerEvents: "none",
      }}
    >
      <button
        type="button"
        aria-label="Close readiness drawer"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          background: "rgba(0,0,0,0.32)",
          cursor: "default",
          pointerEvents: "auto",
        }}
      />
      <aside
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 520,
          maxWidth: "calc(100vw - 24px)",
          background: "#0B0C0D",
          borderLeft: "1px solid rgba(255,255,255,0.10)",
          display: "flex",
          flexDirection: "column",
          pointerEvents: "auto",
          boxShadow: "-28px 0 80px rgba(0,0,0,0.48)",
        }}
      >
        <SandboxReadinessPanel
          active={open}
          characterId={characterId}
          characterTitle={characterTitle}
          mode={mode}
          chatModel={chatModel}
          voiceModel={voiceModel}
          onClose={onClose}
        />
      </aside>
    </div>
  );
}

export function SandboxReadinessPanel({
  active,
  characterId,
  characterTitle,
  mode,
  chatModel,
  voiceModel,
  onClose,
}: PanelProps) {
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<ReadinessAction | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<ReadinessGroup>("routing");

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        mode,
        chatModel,
        voiceModel,
      });
      const res = await fetch(
        `/api/characters/${encodeURIComponent(characterId)}/sandbox/readiness?${params}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(await readError(res));
      const payload = (await res.json()) as { report: ReadinessReport };
      setReport(mergeBrowserChecks(payload.report));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [characterId, chatModel, mode, voiceModel]);

  useEffect(() => {
    if (active) void loadReport();
  }, [active, loadReport]);

  useEffect(() => {
    if (!active || !onClose) return;
    const close = onClose;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, onClose]);

  const checks = report?.checks ?? [];
  const visibleChecks = checks.filter((check) => check.group === selectedGroup);
  const overall = report?.overallStatus ?? "not_checked";

  async function runAction(action: ReadinessAction) {
    setRunningAction(action);
    setError(null);
    try {
      const res = await fetch(
        `/api/characters/${encodeURIComponent(characterId)}/sandbox/readiness`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, mode, chatModel, voiceModel }),
        },
      );
      if (!res.ok) throw new Error(await readError(res));
      const payload = (await res.json()) as {
        result: { checks: ReadinessCheck[] };
      };
      setReport((prev) =>
        prev
          ? mergeBrowserChecks({
              ...prev,
              checks: mergeChecks(prev.checks, payload.result.checks),
            })
          : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningAction(null);
    }
  }

  return (
    <div
      style={{
        minHeight: 0,
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#0B0C0D",
        overflow: "hidden",
      }}
    >
      <DrawerHeader
        title={characterTitle}
        status={loading ? "checking" : overall}
        onClose={onClose}
        onRefresh={() => void loadReport()}
        refreshing={loading}
      />

      {error && <ErrorBanner message={error} />}

      <SelectedRuntime report={report} mode={mode} loading={loading} />

      <ActionBar
        runningAction={runningAction}
        onRun={(action) => void runAction(action)}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "164px 1fr",
          minHeight: 0,
          flex: 1,
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <GroupRail
          selected={selectedGroup}
          checks={checks}
          onSelect={setSelectedGroup}
        />
        <CheckPane
          group={selectedGroup}
          checks={visibleChecks}
          loading={loading && checks.length === 0}
          onRun={(action) => void runAction(action)}
          runningAction={runningAction}
        />
      </div>
    </div>
  );
}

function DrawerHeader({
  title,
  status,
  onClose,
  onRefresh,
  refreshing,
}: {
  title: string;
  status: ReadinessStatus;
  onClose?: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const tone = statusTone(status);
  return (
    <header
      style={{
        padding: "24px 28px 18px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-16)" }}>
        <div style={{ minWidth: 0 }}>
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
            pre-session readiness
          </div>
          <div
            style={{
              marginTop: "var(--space-8)",
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-4xl)",
              fontWeight: 600,
              letterSpacing: 0,
              lineHeight: "30px",
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={iconButtonStyle}
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-12)" }}>
        <StatusPill status={status} />
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          style={{
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.03)",
            color: refreshing ? "var(--text-quaternary)" : tone.color,
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            padding: "7px 10px",
            cursor: refreshing ? "default" : "pointer",
          }}
        >
          {refreshing ? "checking" : "refresh"}
        </button>
      </div>
    </header>
  );
}

function SelectedRuntime({
  report,
  mode,
  loading,
}: {
  report: ReadinessReport | null;
  mode: SandboxMode;
  loading: boolean;
}) {
  const chat = report?.selected.chatModel;
  const voice = report?.selected.voiceModel;
  const tts = report?.selected.voice;
  return (
    <section
      style={{
        padding: "16px 28px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "var(--space-10)",
      }}
    >
      <RuntimeCell label="chat model" value={chat?.id ?? (loading ? "loading" : "unknown")} hint={chat?.provider ?? null} />
      <RuntimeCell label="mode" value={mode} hint={report?.selected.stt.provider ?? null} />
      {mode === "voice" && (
        <>
          <RuntimeCell label="voice model" value={voice?.id ?? "unknown"} hint={voice?.provider ?? null} />
          <RuntimeCell label="tts voice" value={tts?.slug ?? "fallback"} hint={tts?.provider ?? null} />
        </>
      )}
    </section>
  );
}

function RuntimeCell({
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
        border: "1px solid rgba(255,255,255,0.06)",
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
          lineHeight: "12px",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: "var(--space-5)",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-sm)",
          color: "var(--text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
      {hint && (
        <div
          style={{
            marginTop: "var(--space-3)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-2xs)",
            color: "var(--text-tertiary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function ActionBar({
  runningAction,
  onRun,
}: {
  runningAction: ReadinessAction | null;
  onRun: (action: ReadinessAction) => void;
}) {
  return (
    <div
      style={{
        padding: "14px 28px",
        display: "flex",
        gap: "var(--space-8)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {[
        ["run_all", "run all"],
        ["check_model", "model"],
        ["check_tts", "tts"],
        ["check_stt", "stt"],
        ["check_persistence", "db"],
      ].map(([action, label]) => (
        <button
          key={action}
          type="button"
          onClick={() => onRun(action as ReadinessAction)}
          disabled={Boolean(runningAction)}
          style={{
            flex: action === "run_all" ? "1 1 92px" : "0 0 auto",
            padding: "8px 10px",
            border: "1px solid rgba(143,209,203,0.32)",
            background:
              runningAction === action
                ? "rgba(143,209,203,0.16)"
                : "rgba(143,209,203,0.06)",
            color: runningAction ? "var(--text-tertiary)" : ACCENT,
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            cursor: runningAction ? "default" : "pointer",
          }}
        >
          {runningAction === action ? "checking" : label}
        </button>
      ))}
    </div>
  );
}

function GroupRail({
  selected,
  checks,
  onSelect,
}: {
  selected: ReadinessGroup;
  checks: ReadinessCheck[];
  onSelect: (group: ReadinessGroup) => void;
}) {
  return (
    <nav
      style={{
        borderRight: "1px solid rgba(255,255,255,0.06)",
        padding: "14px 0",
        overflow: "auto",
      }}
    >
      {GROUPS.map((group) => {
        const scoped = checks.filter((check) => check.group === group.id);
        const status = scoped.length ? aggregateStatus(scoped) : "unavailable";
        const active = selected === group.id;
        return (
          <button
            key={group.id}
            type="button"
            onClick={() => onSelect(group.id)}
            style={{
              width: "100%",
              display: "grid",
              gridTemplateColumns: "16px 1fr 18px",
              alignItems: "center",
              gap: "var(--space-8)",
              padding: "11px 14px",
              border: "none",
              borderLeft: active ? `2px solid ${statusTone(status).color}` : "2px solid transparent",
              background: active ? "rgba(255,255,255,0.045)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-tertiary)",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <StatusDot status={status} />
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {group.label}
            </span>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                color: "var(--text-quaternary)",
                textAlign: "right",
              }}
            >
              {scoped.length}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function CheckPane({
  group,
  checks,
  loading,
  onRun,
  runningAction,
}: {
  group: ReadinessGroup;
  checks: ReadinessCheck[];
  loading: boolean;
  onRun: (action: ReadinessAction) => void;
  runningAction: ReadinessAction | null;
}) {
  const groupMeta = GROUPS.find((g) => g.id === group);
  return (
    <section
      style={{
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "16px 20px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          justifyContent: "space-between",
          gap: "var(--space-12)",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-xl)",
            color: "var(--text-primary)",
            lineHeight: "20px",
          }}
        >
          {groupMeta?.label ?? group}
        </div>
        {groupMeta?.action && (
          <button
            type="button"
            onClick={() => onRun(groupMeta.action!)}
            disabled={Boolean(runningAction)}
            style={{
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.03)",
              color: runningAction ? "var(--text-tertiary)" : ACCENT,
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-2xs)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              padding: "6px 8px",
              cursor: runningAction ? "default" : "pointer",
            }}
          >
            {runningAction === groupMeta.action ? "checking" : "check"}
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {loading ? (
          <EmptyState label="loading readiness" />
        ) : checks.length === 0 ? (
          <EmptyState label="no checks in this group" />
        ) : (
          checks.map((check) => <CheckRow key={check.id} check={check} />)
        )}
      </div>
    </section>
  );
}

function CheckRow({ check }: { check: ReadinessCheck }) {
  const [expanded, setExpanded] = useState(false);
  const tone = statusTone(check.status);
  const metadata = useMemo(() => safeJson(check.metadata), [check.metadata]);
  return (
    <div
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.045)",
        padding: "14px 20px",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "18px 1fr 82px",
          gap: "var(--space-10)",
          alignItems: "start",
          border: "none",
          background: "transparent",
          color: "inherit",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <StatusDot status={check.status} />
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-md)",
              color: "var(--text-primary)",
              lineHeight: "17px",
            }}
          >
            {check.label}
          </span>
          <span
            style={{
              display: "block",
              marginTop: "var(--space-4)",
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              color: "var(--text-tertiary)",
              lineHeight: "15px",
            }}
          >
            {check.summary}
          </span>
        </span>
        <span
          style={{
            color: tone.color,
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-2xs)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            textAlign: "right",
            lineHeight: "14px",
          }}
        >
          {statusLabel(check.status)}
        </span>
      </button>
      {expanded && (
        <div
          style={{
            marginTop: "var(--space-12)",
            marginLeft: 28,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.025)",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-8)",
          }}
        >
          {check.detail && <DetailText>{check.detail}</DetailText>}
          {check.checkedAt && <DetailText>checked {formatTime(check.checkedAt)}</DetailText>}
          {metadata && (
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                lineHeight: "16px",
                color: "var(--text-tertiary)",
              }}
            >
              {metadata}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function DetailText({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        color: "var(--text-tertiary)",
        lineHeight: "15px",
      }}
    >
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: ReadinessStatus }) {
  const tone = statusTone(status);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 10px",
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        color: tone.color,
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
      }}
    >
      <StatusDot status={status} />
      {statusLabel(status)}
    </span>
  );
}

function StatusDot({ status }: { status: ReadinessStatus }) {
  const tone = statusTone(status);
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "var(--radius-pill)",
        background: tone.color,
        boxShadow: status === "ready" ? `0 0 8px ${tone.color}` : undefined,
        marginTop: "var(--space-3)",
        flexShrink: 0,
      }}
    />
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        margin: "12px 28px 0",
        border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)",
        background: "color-mix(in srgb, var(--danger) 10%, transparent)",
        color: "var(--text-primary)",
        padding: "10px 12px",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        lineHeight: "15px",
      }}
    >
      {message}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: "var(--space-20)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-sm)",
        color: "var(--text-tertiary)",
      }}
    >
      {label}
    </div>
  );
}

function mergeBrowserChecks(report: ReadinessReport): ReadinessReport {
  const browserChecks = resolveBrowserChecks(report.mode);
  const checks = mergeChecks(report.checks, browserChecks);
  return {
    ...report,
    checks,
    groups: report.groups.map((group) => {
      const scoped = checks.filter((check) => check.group === group.id);
      return {
        ...group,
        status: scoped.length ? aggregateStatus(scoped) : "unavailable",
        ready: scoped.filter((c) => c.status === "ready").length,
        warnings: scoped.filter((c) => c.status === "warning").length,
        blocked: scoped.filter((c) => c.status === "blocked").length,
        total: scoped.length,
      };
    }),
    overallStatus: aggregateStatus(checks),
  };
}

function resolveBrowserChecks(mode: SandboxMode): ReadinessCheck[] {
  if (typeof window === "undefined") return [];
  const audioContext =
    "AudioContext" in window || "webkitAudioContext" in (window as unknown as Record<string, unknown>);
  const checks: ReadinessCheck[] = [
    {
      id: "browser-audio-output",
      label: "Browser audio output",
      group: "browser",
      status: audioContext ? "ready" : "blocked",
      summary: audioContext ? "AudioContext is available." : "AudioContext is unavailable.",
      metadata: { api: "AudioContext" },
    },
  ];
  if (mode === "voice") {
    const mediaDevices = Boolean(navigator.mediaDevices?.getUserMedia);
    checks.push({
      id: "browser-mic",
      label: "Browser mic permission",
      group: "browser",
      status: mediaDevices ? "warning" : "blocked",
      summary: mediaDevices
        ? "Mic API is available; permission is requested when recording starts."
        : "getUserMedia is unavailable.",
      metadata: { api: "navigator.mediaDevices.getUserMedia" },
    });
    checks.push({
      id: "browser-recorder",
      label: "Browser recorder",
      group: "browser",
      status: "MediaRecorder" in window ? "ready" : "blocked",
      summary:
        "MediaRecorder" in window
          ? "MediaRecorder is available."
          : "MediaRecorder is unavailable.",
      metadata: { api: "MediaRecorder" },
    });
  }
  return checks;
}

function mergeChecks(
  existing: ReadinessCheck[],
  updates: ReadinessCheck[],
): ReadinessCheck[] {
  const byId = new Map(existing.map((check) => [check.id, check]));
  for (const update of updates) byId.set(update.id, update);
  return Array.from(byId.values());
}

function aggregateStatus(checks: ReadinessCheck[]): ReadinessStatus {
  if (checks.some((c) => c.status === "blocked")) return "blocked";
  if (checks.some((c) => c.status === "degraded")) return "degraded";
  if (checks.some((c) => c.status === "warning")) return "warning";
  if (checks.some((c) => c.status === "checking")) return "checking";
  if (checks.some((c) => c.status === "not_checked")) return "not_checked";
  if (checks.some((c) => c.status === "unavailable")) return "unavailable";
  return "ready";
}

function statusTone(status: ReadinessStatus): {
  color: string;
  border: string;
  bg: string;
} {
  switch (status) {
    case "ready":
      return { color: ACCENT, border: "rgba(143,209,203,0.44)", bg: "rgba(143,209,203,0.10)" };
    case "warning":
    case "degraded":
      return { color: AMBER, border: "rgba(250,204,21,0.38)", bg: "rgba(250,204,21,0.08)" };
    case "blocked":
      return { color: DANGER, border: "color-mix(in srgb, var(--danger) 42%, transparent)", bg: "color-mix(in srgb, var(--danger) 10%, transparent)" };
    case "checking":
      return { color: "#93C5FD", border: "rgba(147,197,253,0.38)", bg: "rgba(147,197,253,0.08)" };
    default:
      return { color: "var(--text-tertiary)", border: "rgba(255,255,255,0.12)", bg: "rgba(255,255,255,0.03)" };
  }
}

function statusLabel(status: ReadinessStatus): string {
  return status.replace("_", " ");
}

function safeJson(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const payload = JSON.parse(text) as { error?: string };
    return payload.error ?? `${res.status}`;
  } catch {
    return text.slice(0, 200) || `${res.status}`;
  }
}

const iconButtonStyle: CSSProperties = {
  width: 28,
  height: 28,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
  color: "var(--text-secondary)",
  fontFamily: FONT_MONO,
  fontSize: 17,
  lineHeight: "24px",
  cursor: "pointer",
};
