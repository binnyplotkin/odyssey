"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type React from "react";
import type {
  SceneSessionAudioArtifactRecord,
  SceneSessionContextBuildRecord,
  SceneSessionDetailRecord,
  SceneSessionEventRecord,
  SceneSessionTurnRecord,
} from "@odyssey/db";
import { useHeaderContent } from "@/components/header-context";

type Props = {
  detail: SceneSessionDetailRecord;
};

const FONT_DISPLAY = '"Space Grotesk", system-ui, sans-serif';
const FONT_MONO = '"JetBrains Mono", ui-monospace, monospace';
const FONT_BODY = '"Inter", system-ui, sans-serif';

const C = {
  bg: "#0C0E14",
  bgRail: "#0A0C12",
  border: "rgba(255,255,255,0.08)",
  borderSoft: "rgba(255,255,255,0.05)",
  borderStrong: "rgba(255,255,255,0.12)",
  panel: "rgba(255,255,255,0.025)",
  panelStrong: "rgba(255,255,255,0.04)",
  text: "rgba(255,255,255,0.94)",
  textHigh: "rgba(255,255,255,0.65)",
  textMid: "rgba(255,255,255,0.45)",
  textLow: "rgba(255,255,255,0.35)",
  mint: "#8FD1CB",
  mintSoft: "rgba(140,231,210,0.12)",
  mintMid: "rgba(140,231,210,0.20)",
  mintBg: "rgba(140,231,210,0.06)",
  greenDot: "#4ADE80",
  amber: "#E5B85A",
  amberSoft: "rgba(229,184,90,0.16)",
  amberDeep: "#C9A04A",
  red: "#F4A8A8",
} as const;

type TabKey = "pipeline" | "graph" | "prompt" | "voice" | "eval" | "raw";

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "pipeline", label: "Pipeline", icon: "1" },
  { key: "graph", label: "Graph", icon: "2" },
  { key: "prompt", label: "Prompt", icon: "3" },
  { key: "voice", label: "Voice", icon: "4" },
  { key: "eval", label: "Eval", icon: "5" },
  { key: "raw", label: "Raw", icon: "6" },
];

type ConvFilter = "all" | "issues" | "slow";

export function SessionDetailWorkbench({ detail }: Props) {
  const { session, user, contextBuilds, turns, events, audioArtifacts } = detail;
  const { setFlush } = useHeaderContent();

  useEffect(() => {
    setFlush(true);
    return () => setFlush(false);
  }, [setFlush]);

  const [activeTab, setActiveTab] = useState<TabKey>("pipeline");
  const [convFilter, setConvFilter] = useState<ConvFilter>("all");
  const [activeTurnId, setActiveTurnId] = useState<string | null>(() => {
    const interrupted = turns.find((t) => t.status === "interrupted" || t.status === "error");
    if (interrupted) return interrupted.id;
    let slowest: SceneSessionTurnRecord | null = null;
    let slowestMs = -1;
    for (const t of turns) {
      const ms = firstAudioMs(t);
      if (ms != null && ms > slowestMs) {
        slowest = t;
        slowestMs = ms;
      }
    }
    return slowest?.id ?? turns.at(0)?.id ?? null;
  });

  const activeTurn =
    turns.find((t) => t.id === activeTurnId) ?? turns.at(0) ?? null;
  const activeContext = useMemo(
    () => pickActiveContext(contextBuilds, activeTurn),
    [contextBuilds, activeTurn],
  );

  const stats = useMemo(() => computeStats(detail), [detail]);
  const filteredTurns = useMemo(() => filterTurns(turns, convFilter, events), [turns, convFilter, events]);

  const sessionDate = formatDate(session.startedAt);
  const sessionTime = formatTime(session.startedAt);
  const userLabel =
    user?.name?.trim() ||
    user?.email ||
    (session.userId ? shortId(session.userId) : "Unknown");
  const characterDisplay =
    stringField(session.metadata, "characterName") ||
    stripCharacterPrefix(stringField(session.metadata, "characterTitle")) ||
    (session.characterId ? prettyCharacterId(session.characterId) : "—");
  const characterCrumb =
    stringField(session.metadata, "characterTitle") ||
    characterDisplay;
  const characterSlug =
    stringField(session.metadata, "characterSlug") ||
    (session.characterId ? session.characterId.replace(/^char_/, "") : "—");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: C.bg,
        color: C.text,
        fontFamily: FONT_BODY,
        minHeight: "100vh",
      }}
    >
      <HeaderRail
        session={session}
        userLabel={userLabel}
        characterDisplay={characterDisplay}
        characterCrumb={characterCrumb}
        characterSlug={characterSlug}
        sessionDate={sessionDate}
        sessionTime={sessionTime}
        contextBuilds={contextBuilds}
        stats={stats}
      />

      <div
        className="session-detail-body"
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "stretch",
          minHeight: 0,
        }}
      >
        <ConversationColumn
          session={session}
          userName={userLabel}
          characterName={characterDisplay}
          turns={filteredTurns}
          activeTurnId={activeTurn?.id ?? null}
          onSelectTurn={setActiveTurnId}
          filter={convFilter}
          onFilterChange={setConvFilter}
          events={events}
          contextBuilds={contextBuilds}
          audioArtifacts={audioArtifacts}
        />

        <InspectorRail
          session={session}
          activeTurn={activeTurn}
          activeContext={activeContext}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          turns={turns}
          events={events}
          audioArtifacts={audioArtifacts}
          contextBuilds={contextBuilds}
        />
      </div>
    </div>
  );
}

// ───────────── Header rail ─────────────

function HeaderRail({
  session,
  userLabel,
  characterDisplay,
  characterCrumb,
  characterSlug,
  sessionDate,
  sessionTime,
  contextBuilds,
  stats,
}: {
  session: SceneSessionDetailRecord["session"];
  userLabel: string;
  characterDisplay: string;
  characterCrumb: string;
  characterSlug: string;
  sessionDate: string;
  sessionTime: string;
  contextBuilds: SceneSessionContextBuildRecord[];
  stats: ReturnType<typeof computeStats>;
}) {
  const statusColor =
    session.status === "ended" || session.status === "completed"
      ? C.greenDot
      : session.status === "active"
        ? C.mint
        : session.status === "error"
          ? C.red
          : C.amber;
  const statusLabel = session.status === "ended" ? "complete" : session.status;
  const sessionMode = `${session.mode} session`;
  const sessionShort = shortId(session.id);
  const titleA = userLabel;
  const titleB = characterDisplay;
  const subTags = [
    session.mode,
    session.metadata && stringField(session.metadata, "client") ? `${stringField(session.metadata, "client")}` : "web client",
    session.metadata && stringField(session.metadata, "scene") ? stringField(session.metadata, "scene") : null,
    contextBuilds[0]?.promptKind ? `moment: ${contextBuilds[0]?.promptKind}` : null,
    `idx ${contextBuilds.length}`,
  ].filter(Boolean) as string[];

  return (
    <header
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "24px 32px 20px",
        gap: "var(--space-18)",
        borderBottom: `1px solid ${C.borderSoft}`,
        background: C.bg,
      }}
    >
      <TopRow characterCrumb={characterCrumb} characterSlug={characterSlug} sessionShort={sessionShort} />
      <IdentityStrip
        statusColor={statusColor}
        statusLabel={statusLabel}
        sessionMode={sessionMode}
        sessionShort={sessionShort}
        titleA={titleA}
        titleB={titleB}
        sessionDate={sessionDate}
        sessionTime={sessionTime}
        subTags={subTags}
      />
      <KpiStrip stats={stats} />
    </header>
  );
}

function TopRow({
  characterCrumb,
  characterSlug,
  sessionShort,
}: {
  characterCrumb: string;
  characterSlug: string;
  sessionShort: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-20)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)", minWidth: 0 }}>
        <Link
          href="/sessions"
          aria-label="Back to sessions"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: "var(--radius-md)",
            border: `1px solid ${C.border}`,
            color: C.textMid,
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>

        <Avatar label={characterCrumb} size={28} />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-10)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-base)",
            color: C.textMid,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: C.text, fontWeight: 600 }}>{characterCrumb}</span>
          <Sep />
          <span style={{ color: C.textMid }}>{characterSlug}</span>
          <Sep />
          <span style={{ color: C.textMid }}>sessions</span>
          <Sep />
          <span style={{ color: C.text, fontWeight: 600 }}>{sessionShort}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flexShrink: 0 }}>
        <NavButton label="Prev" />
        <NavButton label="Next" />
        <ReplayButton />
      </div>
    </div>
  );
}

function Sep() {
  return <span style={{ color: C.textLow }}>/</span>;
}

function NavButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      style={{
        background: "transparent",
        border: `1px solid ${C.border}`,
        borderRadius: "var(--radius-md)",
        padding: "8px 14px",
        color: C.textHigh,
        fontFamily: FONT_BODY,
        fontSize: "var(--font-size-base)",
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function ReplayButton() {
  return (
    <button
      type="button"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        background: C.mint,
        border: "none",
        borderRadius: "var(--radius-md)",
        padding: "8px 14px",
        color: "#06110f",
        fontFamily: FONT_BODY,
        fontSize: "var(--font-size-base)",
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      <svg width="9" height="11" viewBox="0 0 12 14" fill="currentColor">
        <path d="M1 1.4v11.2c0 .9.9 1.4 1.6.9l8.6-5.6c.7-.4.7-1.4 0-1.8L2.6.5C1.9.1 1 .6 1 1.4Z" />
      </svg>
      Replay session
    </button>
  );
}

function Avatar({
  label,
  size = 28,
  variant = "neutral",
}: {
  label: string;
  size?: number;
  variant?: "neutral" | "user" | "assistant";
}) {
  const initial = (label?.charAt(0) ?? "·").toUpperCase();
  const bg =
    variant === "user"
      ? "linear-gradient(135deg, #E5C49A 0%, #B07F4F 100%)"
      : variant === "assistant"
        ? "linear-gradient(135deg, #8FD1CB 0%, #105A59 100%)"
        : "linear-gradient(135deg, #8FD1CB 0%, #3A8B7A 100%)";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "#06110f",
        fontFamily: FONT_DISPLAY,
        fontWeight: 700,
        fontSize: Math.round(size * 0.42),
        lineHeight: 1,
      }}
    >
      {initial}
    </div>
  );
}

function IdentityStrip({
  statusColor,
  statusLabel,
  sessionMode,
  sessionShort,
  titleA,
  titleB,
  sessionDate,
  sessionTime,
  subTags,
}: {
  statusColor: string;
  statusLabel: string;
  sessionMode: string;
  sessionShort: string;
  titleA: string;
  titleB: string;
  sessionDate: string;
  sessionTime: string;
  subTags: string[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)", flexWrap: "wrap" }}>
        <Eyebrow color={statusColor} bold>
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: statusColor,
              marginRight: "var(--space-8)",
              verticalAlign: "middle",
            }}
          />
          {statusLabel.toUpperCase()}
        </Eyebrow>
        <Eyebrow>·</Eyebrow>
        <Eyebrow>{sessionMode.toUpperCase()}</Eyebrow>
        <Eyebrow>·</Eyebrow>
        <Eyebrow strong>{sessionShort.toUpperCase()}</Eyebrow>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "var(--space-24)",
          flexWrap: "wrap",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            fontSize: 34,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            color: C.text,
          }}
        >
          {titleA} <span style={{ color: C.textLow }}>·</span> {titleB}
        </h1>
        <div
          style={{
            color: C.textMid,
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-base)",
            letterSpacing: "0.02em",
          }}
        >
          {sessionDate} · {sessionTime}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-16)",
          flexWrap: "wrap",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-sm)",
          color: C.textMid,
          letterSpacing: "0.04em",
        }}
      >
        {subTags.map((tag, i) => (
          <span key={`${tag}-${i}`}>{tag}</span>
        ))}
      </div>
    </div>
  );
}

function Eyebrow({
  children,
  color,
  bold,
  strong,
}: {
  children: React.ReactNode;
  color?: string;
  bold?: boolean;
  strong?: boolean;
}) {
  return (
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: color ?? (strong ? C.textHigh : C.textLow),
        fontWeight: bold || strong ? 700 : 500,
      }}
    >
      {children}
    </span>
  );
}

// ───────────── KPI strip ─────────────

function KpiStrip({ stats }: { stats: ReturnType<typeof computeStats> }) {
  const items: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "default" | "mint" | "amber" }[] = [
    { label: "Duration", value: stats.duration },
    { label: "Turns", value: stats.turnCount },
    {
      label: "P50 first-audio",
      value: stats.p50FirstAudio.value,
      sub: stats.p50FirstAudio.sub,
      tone: "mint",
    },
    {
      label: "Tokens",
      value: stats.tokens.value,
      sub: stats.tokens.sub,
    },
    { label: "Cost", value: stats.cost.value, sub: stats.cost.sub },
    { label: "Audio", value: stats.audio.value, sub: stats.audio.sub },
    {
      label: "STT rejected",
      value: stats.sttRejected.value,
      sub: stats.sttRejected.sub,
      tone: "amber",
    },
    { label: "Errors", value: stats.errors.value, sub: stats.errors.sub },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        border: `1px solid ${C.border}`,
        borderRadius: "var(--radius-xl)",
        background: C.panel,
        overflow: "hidden",
      }}
    >
      {items.map((item, i) => (
        <KpiCell key={item.label} {...item} divider={i < items.length - 1} />
      ))}
    </div>
  );
}

function KpiCell({
  label,
  value,
  sub,
  tone,
  divider,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "mint" | "amber";
  divider?: boolean;
}) {
  const valueColor = tone === "mint" ? C.mint : tone === "amber" ? C.amber : C.text;
  return (
    <div
      style={{
        padding: "14px 18px",
        borderRight: divider ? `1px solid ${C.borderSoft}` : "none",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: C.textLow,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "var(--space-10)",
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            fontSize: 26,
            lineHeight: 1.05,
            letterSpacing: "-0.01em",
            color: valueColor,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {value}
        </span>
        {sub ? (
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              color: C.textLow,
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
            }}
          >
            {sub}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ───────────── Conversation column ─────────────

function ConversationColumn({
  session,
  userName,
  characterName,
  turns,
  activeTurnId,
  onSelectTurn,
  filter,
  onFilterChange,
  events,
  contextBuilds,
  audioArtifacts,
}: {
  session: SceneSessionDetailRecord["session"];
  userName: string;
  characterName: string;
  turns: SceneSessionTurnRecord[];
  activeTurnId: string | null;
  onSelectTurn: (id: string) => void;
  filter: ConvFilter;
  onFilterChange: (filter: ConvFilter) => void;
  events: SceneSessionEventRecord[];
  contextBuilds: SceneSessionContextBuildRecord[];
  audioArtifacts: SceneSessionAudioArtifactRecord[];
}) {
  const totalDuration = computeDuration(session);
  return (
    <section
      className="session-detail-conversation"
      style={{
        display: "flex",
        flexDirection: "column",
        flex: "0 0 680px",
        maxWidth: 680,
        padding: "20px 24px 28px",
        gap: "var(--space-14)",
        borderRight: `1px solid ${C.borderSoft}`,
        background: C.bg,
        minWidth: 0,
      }}
    >
      <ConvHeader
        turnCount={turns.length}
        duration={totalDuration}
        filter={filter}
        onFilterChange={onFilterChange}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-14)" }}>
        {turns.length === 0 ? (
          <EmptyHint>No turns recorded for this session.</EmptyHint>
        ) : (
          turns.map((turn, index) => (
            <TurnEntry
              key={turn.id}
              turn={turn}
              index={index}
              focused={turn.id === activeTurnId}
              onSelect={() => onSelectTurn(turn.id)}
              events={events}
              contextBuilds={contextBuilds}
              audioArtifacts={audioArtifacts}
              sessionId={session.id}
              userName={userName}
              characterName={characterName}
            />
          ))
        )}
      </div>
    </section>
  );
}

function ConvHeader({
  turnCount,
  duration,
  filter,
  onFilterChange,
}: {
  turnCount: number;
  duration: string;
  filter: ConvFilter;
  onFilterChange: (filter: ConvFilter) => void;
}) {
  const filters: { key: ConvFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "issues", label: "Issues" },
    { key: "slow", label: "Slow" },
  ];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-16)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <Eyebrow>Conversation</Eyebrow>
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            fontSize: "var(--font-size-2xl)",
            lineHeight: "22px",
            letterSpacing: "-0.01em",
            color: C.text,
          }}
        >
          {turnCount} turns · {duration}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onFilterChange(f.key)}
            style={{
              padding: "5px 12px",
              borderRadius: "var(--radius-pill)",
              border: "none",
              background: filter === f.key ? C.mintSoft : "transparent",
              color: filter === f.key ? C.mint : C.textMid,
              fontFamily: FONT_BODY,
              fontSize: "var(--font-size-base)",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TurnEntry({
  turn,
  index,
  focused,
  onSelect,
  events,
  contextBuilds,
  audioArtifacts,
  sessionId,
  userName,
  characterName,
}: {
  turn: SceneSessionTurnRecord;
  index: number;
  focused: boolean;
  onSelect: () => void;
  events: SceneSessionEventRecord[];
  contextBuilds: SceneSessionContextBuildRecord[];
  audioArtifacts: SceneSessionAudioArtifactRecord[];
  sessionId: string;
  userName: string;
  characterName: string;
}) {
  const turnNum = String((turn.turnIndex ?? index) + 1).padStart(2, "0");
  const headlineMs = firstAudioMs(turn) ?? null;
  const startedAt = formatTimecode(turn.startedAt, turn.startedAt);
  const completedAt = turn.completedAt ? formatTimecode(turn.startedAt, turn.completedAt) : null;
  const turnContext = contextBuilds.find((c) => c.turnId === turn.id) ?? null;

  if (!focused) {
    return (
      <button
        type="button"
        onClick={onSelect}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-6)",
          padding: "14px 18px",
          borderTop: `1px solid ${C.borderSoft}`,
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-12)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)", fontFamily: FONT_MONO, fontSize: "var(--font-size-sm)", color: C.textLow, letterSpacing: "0.04em" }}>
            <span style={{ color: C.text, fontWeight: 700 }}>TURN {turnNum}</span>
            <span>{startedAt}</span>
            {turn.status && turn.status !== "succeeded" && turn.status !== "completed" ? (
              <span style={{ color: C.amber, textTransform: "uppercase" }}>{turn.status}</span>
            ) : null}
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-sm)", color: C.textLow }}>
            {headlineMs != null ? `first-audio ${headlineMs}ms` : "—"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-8)", minWidth: 0 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-xs)", color: C.textLow, letterSpacing: "0.16em", textTransform: "uppercase", flexShrink: 0 }}>
            {(turn.userText ? "USER" : "ASSIST")}
          </span>
          <span
            style={{
              fontSize: "var(--font-size-lg)",
              color: C.textHigh,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {truncate(turn.userText ?? turn.assistantText ?? "", 120) || "—"}
          </span>
        </div>
      </button>
    );
  }

  const bargeIn = bargeInEvents(events, turn);
  const userAudio = audioArtifacts.find((a) => a.turnId === turn.id && a.direction === "input") ?? null;
  const assistantAudio = audioArtifacts.find((a) => a.turnId === turn.id && a.direction === "output") ?? null;
  const userWords = wordCount(turn.userText);
  const interrupted = turn.status === "interrupted" || bargeIn.length > 0;
  const interruptionMs = bargeIn[0] ? msFromTurnStart(turn, bargeIn[0].createdAt) : null;
  const tokens = numberField(asRecord(turn.tokenUsage), "input") ?? numberField(asRecord(turn.tokenUsage), "promptTokens");
  const outTokens = numberField(asRecord(turn.tokenUsage), "output") ?? numberField(asRecord(turn.tokenUsage), "completionTokens");
  const ctxPages = pageCount(turnContext?.selectedPages);
  const ctxTokens = turnContext?.tokensUsed ?? null;

  return (
    <article
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-14)",
        padding: "16px 18px 18px",
        borderRadius: "var(--radius-2xl)",
        border: `1px solid ${C.mintMid}`,
        background: C.mintBg,
        boxShadow: `0 0 0 4px rgba(140,231,210,0.04)`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)", flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "3px 9px",
            borderRadius: "var(--radius-pill)",
            background: C.mintSoft,
            color: C.mint,
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-2xs)",
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          Focused
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)", fontFamily: FONT_MONO, fontSize: "var(--font-size-sm)", color: C.textLow, letterSpacing: "0.04em" }}>
          <span style={{ color: C.text, fontWeight: 700 }}>TURN {turnNum}</span>
          <span style={{ color: C.textMid }}>{startedAt}</span>
          {completedAt ? <span style={{ color: C.textMid }}>→ {completedAt}</span> : null}
        </div>
        {interrupted ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "3px 9px",
              borderRadius: "var(--radius-pill)",
              background: C.amberSoft,
              color: C.amber,
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-2xs)",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Interrupted{interruptionMs != null ? ` · ${(interruptionMs / 1000).toFixed(1)}s` : ""}
          </span>
        ) : null}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-14)", fontFamily: FONT_MONO, fontSize: "var(--font-size-sm)", color: C.textLow }}>
          {headlineMs != null ? <Stat label="first-audio" value={`${headlineMs}ms`} mint /> : null}
          {tokens != null && outTokens != null ? <Stat label="tok" value={`${tokens}/${outTokens}`} /> : null}
        </div>
      </div>

      <Speaker
        side="user"
        avatarLabel={userInitials(userName)}
        line={`${(userName ?? "USER").toUpperCase()} · USER · ${(userAudio?.durationMs ?? 0) / 1000 ? `${((userAudio?.durationMs ?? 0) / 1000).toFixed(1)}s · ` : ""}${userWords} wd`}
        text={turn.userText ?? ""}
        audioSrc={userAudio ? `/api/scene-sessions/${sessionId}/audio/${userAudio.id}` : null}
      />

      <Speaker
        side="assistant"
        avatarLabel={(characterName ?? "A").charAt(0).toUpperCase()}
        line={`${(characterName ?? "ASSISTANT").toUpperCase()} · ASSISTANT · ${turn.provider ?? "provider?"} · ${turn.model ?? "model?"}`}
        text={turn.assistantText ?? ""}
        italic
        audioSrc={assistantAudio ? `/api/scene-sessions/${sessionId}/audio/${assistantAudio.id}` : null}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-8)" }}>
        {ctxPages > 0 ? <Pill>{ctxPages} pages · {ctxTokens ?? "?"} ctx tok</Pill> : null}
        {countTimeGated(turnContext) > 0 ? <Pill>{countTimeGated(turnContext)} time-gated</Pill> : null}
        {countDropped(turnContext) > 0 ? <Pill>{countDropped(turnContext)} budget-dropped</Pill> : null}
        {interrupted && interruptionMs != null ? (
          <Pill tone="amber">user barge-in @ {(interruptionMs / 1000).toFixed(1)}s</Pill>
        ) : null}
      </div>
    </article>
  );
}

function Speaker({
  side,
  avatarLabel,
  line,
  text,
  italic,
  audioSrc,
}: {
  side: "user" | "assistant";
  avatarLabel: string;
  line: string;
  text: string;
  italic?: boolean;
  audioSrc?: string | null;
}) {
  return (
    <div style={{ display: "flex", gap: "var(--space-14)" }}>
      <Avatar label={avatarLabel} size={32} variant={side} />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)", minWidth: 0, flex: 1 }}>
        <Eyebrow>{line}</Eyebrow>
        {audioSrc ? (
          <audio
            controls
            preload="metadata"
            src={audioSrc}
            style={{
              width: "100%",
              height: 32,
              filter: "invert(1) hue-rotate(180deg) saturate(0.6)",
            }}
          />
        ) : null}
        <p
          style={{
            margin: 0,
            color: text ? C.text : C.textMid,
            fontStyle: italic ? "italic" : "normal",
            fontSize: "var(--font-size-lg)",
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {text || (side === "user" ? "(no transcript captured)" : "(no response captured)")}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, mint }: { label: string; value: string; mint?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: "var(--space-4)" }}>
      <span style={{ color: C.textLow, fontSize: "var(--font-size-xs)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</span>
      <span style={{ color: mint ? C.mint : C.text, fontWeight: 700 }}>{value}</span>
    </span>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: "amber" | "mint" }) {
  const bg = tone === "amber" ? C.amberSoft : tone === "mint" ? C.mintSoft : "rgba(255,255,255,0.04)";
  const color = tone === "amber" ? C.amber : tone === "mint" ? C.mint : C.textHigh;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: "var(--radius-pill)",
        background: bg,
        color,
        border: `1px solid ${tone === "amber" ? "rgba(229,184,90,0.2)" : tone === "mint" ? C.mintMid : C.border}`,
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </span>
  );
}

// ───────────── Inspector rail ─────────────

function InspectorRail({
  session,
  activeTurn,
  activeContext,
  activeTab,
  onTabChange,
  turns,
  events,
  audioArtifacts,
  contextBuilds,
}: {
  session: SceneSessionDetailRecord["session"];
  activeTurn: SceneSessionTurnRecord | null;
  activeContext: SceneSessionContextBuildRecord | null;
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  turns: SceneSessionTurnRecord[];
  events: SceneSessionEventRecord[];
  audioArtifacts: SceneSessionAudioArtifactRecord[];
  contextBuilds: SceneSessionContextBuildRecord[];
}) {
  const turnIndex = activeTurn ? turns.findIndex((t) => t.id === activeTurn.id) : -1;
  const turnLabel = turnIndex >= 0 ? `Turn ${String(turnIndex + 1).padStart(2, "0")}` : "No turn";
  const inspectorHeadline = inspectorHeadlineFor(activeTab);
  const turnEvents = activeTurn ? events.filter((e) => e.turnId === activeTurn.id) : [];

  return (
    <section
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        padding: "20px 24px 28px",
        gap: "var(--space-14)",
        background: C.bgRail,
      }}
    >
      <InspectorHeader
        turnLabel={turnLabel}
        headline={inspectorHeadline}
        usedBaseline={!!activeContext && (activeContext.promptKind === "voice-baseline" || activeContext.metadata?.cacheHit === true)}
      />

      <TabBar tabs={TABS} active={activeTab} onChange={onTabChange} />

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-14)", minWidth: 0 }}>
        {activeTab === "pipeline" ? (
          <PipelinePanel turn={activeTurn} context={activeContext} events={turnEvents} />
        ) : null}
        {activeTab === "graph" ? <GraphPanel context={activeContext} /> : null}
        {activeTab === "prompt" ? <PromptInspectorPanel context={activeContext} /> : null}
        {activeTab === "voice" ? (
          <VoicePanel turn={activeTurn} events={turnEvents} audioArtifacts={audioArtifacts} sessionId={session.id} />
        ) : null}
        {activeTab === "eval" ? (
          <EvalPanel
            sessionId={session.id}
            characterId={session.characterId ?? null}
            turn={activeTurn}
            context={activeContext}
          />
        ) : null}
        {activeTab === "raw" ? (
          <RawPanel
            session={session}
            activeTurn={activeTurn}
            activeContext={activeContext}
            audioArtifacts={audioArtifacts}
            contextBuilds={contextBuilds}
            turns={turns}
            events={events}
          />
        ) : null}

        {activeTab === "pipeline" && activeTurn ? (
          <TraceMarksPanel turn={activeTurn} events={turnEvents} />
        ) : null}
      </div>
    </section>
  );
}

function inspectorHeadlineFor(tab: TabKey): string {
  if (tab === "pipeline") return "Why this turn was slow";
  if (tab === "graph") return "What knowledge fed this turn";
  if (tab === "prompt") return "How the prompt was constructed";
  if (tab === "voice") return "Did the engine hear what was said";
  if (tab === "eval") return "Is this turn faithful and in-character";
  return "All session data";
}

// ───────────── Eval panel (faithfulness + in-character quality) ─────────────

type EvalGrade = {
  grounding?: {
    faithfulnessScore: number;
    fabrications: string[];
    embellishments: string[];
    usedRetrievedKnowledge: boolean;
    verdict: string;
    notes: string;
  };
  quality?: {
    qualityScore: number;
    voice: { score: number; notes: string };
    persona: { score: number; notes: string };
    scope: { score: number; notes: string };
    issues: string[];
    verdict: string;
    notes: string;
  };
};

function scoreColor(s: number): string {
  if (s >= 0.9) return C.greenDot;
  if (s >= 0.7) return C.amber;
  return C.red;
}

function EvalPanel({
  sessionId,
  characterId,
  turn,
  context,
}: {
  sessionId: string;
  characterId: string | null;
  turn: SceneSessionTurnRecord | null;
  context: SceneSessionContextBuildRecord | null;
}) {
  const [status, setStatus] = useState<"idle" | "grading" | "done" | "error">("idle");
  const [grade, setGrade] = useState<EvalGrade | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promote, setPromote] = useState<"idle" | "saving" | "added" | "duplicate" | "full" | "error">("idle");
  const [promoteMsg, setPromoteMsg] = useState<string | null>(null);

  useEffect(() => {
    setStatus("idle");
    setGrade(null);
    setError(null);
    setPromote("idle");
    setPromoteMsg(null);
  }, [turn?.id]);

  if (!turn) {
    return <PanelNote>Select a turn to evaluate.</PanelNote>;
  }
  const gradeable = Boolean(turn.assistantText && context?.systemPrompt);

  async function run() {
    if (!turn) return;
    setStatus("grading");
    setError(null);
    try {
      const res = await fetch(`/api/scene-sessions/${encodeURIComponent(sessionId)}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId: turn.id }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? `grade failed (${res.status})`);
      }
      const payload = (await res.json()) as { grade: EvalGrade };
      setGrade(payload.grade);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  async function promoteExemplar() {
    if (!characterId || !turn?.userText || !turn?.assistantText) return;
    setPromote("saving");
    setPromoteMsg(null);
    try {
      const res = await fetch(`/api/characters/${encodeURIComponent(characterId)}/directive/exemplars`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: turn.userText, you: turn.assistantText }),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; exemplarCount?: number; error?: string };
      if (!res.ok && res.status !== 409) throw new Error(data.error ?? `promote failed (${res.status})`);
      if (data.status === "added") {
        setPromote("added");
        setPromoteMsg(`Added to exemplars (${data.exemplarCount}/8) — feeds this character's voice on the next turn.`);
      } else if (data.status === "duplicate") {
        setPromote("duplicate");
        setPromoteMsg("Already an exemplar.");
      } else {
        setPromote("full");
        setPromoteMsg(data.error ?? "Exemplar cap reached (8) — drop one in the L02 editor first.");
      }
    } catch (err) {
      setPromote("error");
      setPromoteMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const canPromote = Boolean(characterId && turn?.userText && turn?.assistantText);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-14)", minWidth: 0 }}>
      {!gradeable ? (
        <PanelNote>
          This turn wasn’t captured with its prompt, so it can’t be graded (older turn, or a turn
          recorded without a turnId).
        </PanelNote>
      ) : (
        <button
          type="button"
          onClick={() => void run()}
          disabled={status === "grading"}
          style={{
            alignSelf: "flex-start",
            padding: "8px 16px",
            borderRadius: 8,
            border: `1px solid ${C.mintMid}`,
            background: status === "grading" ? C.panel : C.mintSoft,
            color: C.mint,
            fontFamily: FONT_MONO,
            fontSize: 12,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            cursor: status === "grading" ? "default" : "pointer",
          }}
        >
          {status === "grading" ? "Evaluating…" : grade ? "Re-evaluate" : "Evaluate this turn"}
        </button>
      )}

      {error ? <PanelNote tone="bad">{error}</PanelNote> : null}

      {grade?.grounding ? (
        <ScoreCard
          title="Faithfulness"
          subtitle="Grounded in the knowledge it was given?"
          score={grade.grounding.faithfulnessScore}
          verdict={grade.grounding.verdict}
          rows={[
            { label: "used graph", value: grade.grounding.usedRetrievedKnowledge ? "yes" : "no" },
          ]}
          bad={grade.grounding.fabrications.map((f) => ({ label: "fabrication", text: f }))}
          muted={grade.grounding.embellishments.map((e) => ({ label: "embellishment", text: e }))}
          notes={grade.grounding.notes}
        />
      ) : null}

      {grade?.quality ? (
        <ScoreCard
          title="In-character quality"
          subtitle="True to its voice, persona, and scope?"
          score={grade.quality.qualityScore}
          verdict={grade.quality.verdict}
          rows={[
            { label: "voice", value: grade.quality.voice.score.toFixed(2) },
            { label: "persona", value: grade.quality.persona.score.toFixed(2) },
            { label: "scope", value: grade.quality.scope.score.toFixed(2) },
          ]}
          bad={grade.quality.issues.map((i) => ({ label: "issue", text: i }))}
          notes={grade.quality.notes}
        />
      ) : null}

      {grade && canPromote ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
          <button
            type="button"
            onClick={() => void promoteExemplar()}
            disabled={promote === "saving" || promote === "added"}
            title="Append this exchange to the character's L02 exemplars (few-shots its voice)"
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: `1px solid ${promote === "added" ? C.mintMid : C.border}`,
              background: promote === "added" ? C.mintSoft : C.panelStrong,
              color: promote === "added" ? C.mint : C.textHigh,
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              cursor: promote === "saving" || promote === "added" ? "default" : "pointer",
            }}
          >
            {promote === "saving" ? "Promoting…" : promote === "added" ? "✓ Promoted to exemplar" : "Promote to exemplar"}
          </button>
          {grade.quality && grade.quality.qualityScore < 0.85 && promote === "idle" ? (
            <span style={{ color: C.textLow, fontSize: 11, lineHeight: 1.5 }}>
              Exemplars few-shot the voice — promote only your strongest turns.
            </span>
          ) : null}
          {promoteMsg ? (
            <span
              style={{
                color: promote === "error" || promote === "full" ? C.amber : C.textMid,
                fontSize: 11,
                lineHeight: 1.5,
              }}
            >
              {promoteMsg}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ScoreCard({
  title,
  subtitle,
  score,
  verdict,
  rows,
  bad = [],
  muted = [],
  notes,
}: {
  title: string;
  subtitle: string;
  score: number;
  verdict: string;
  rows: { label: string; value: string }[];
  bad?: { label: string; text: string }[];
  muted?: { label: string; text: string }[];
  notes?: string;
}) {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ color: C.text, fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600 }}>{title}</span>
          <span style={{ color: C.textMid, fontSize: 12 }}>{subtitle}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ color: scoreColor(score), fontFamily: FONT_MONO, fontSize: 26, fontWeight: 700 }}>
            {score.toFixed(2)}
          </span>
          <span
            style={{
              color: C.textHigh,
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {verdict}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        {rows.map((r) => (
          <span key={r.label} style={{ color: C.textHigh, fontFamily: FONT_MONO, fontSize: 12 }}>
            {r.label} <span style={{ color: C.text }}>{r.value}</span>
          </span>
        ))}
      </div>

      {bad.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {bad.map((b, i) => (
            <span key={i} style={{ color: C.red, fontSize: 12, lineHeight: 1.5 }}>
              ✗ <span style={{ color: C.textMid, fontFamily: FONT_MONO, fontSize: 10 }}>{b.label}</span> {b.text}
            </span>
          ))}
        </div>
      ) : null}

      {muted.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {muted.map((m, i) => (
            <span key={i} style={{ color: C.textLow, fontSize: 11, lineHeight: 1.5 }}>
              ~ {m.text}
            </span>
          ))}
        </div>
      ) : null}

      {notes ? (
        <p style={{ color: C.textMid, fontSize: 12, lineHeight: 1.6, margin: 0 }}>{notes}</p>
      ) : null}
    </div>
  );
}

function PanelNote({ children, tone }: { children: ReactNode; tone?: "bad" }) {
  return (
    <p
      style={{
        margin: 0,
        padding: "12px 14px",
        background: C.panel,
        border: `1px solid ${tone === "bad" ? C.red : C.border}`,
        borderRadius: 8,
        color: tone === "bad" ? C.red : C.textMid,
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      {children}
    </p>
  );
}

function InspectorHeader({
  turnLabel,
  headline,
  usedBaseline,
}: {
  turnLabel: string;
  headline: string;
  usedBaseline: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "var(--space-16)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <Eyebrow>Inspector · {turnLabel}</Eyebrow>
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            fontSize: "var(--font-size-2xl)",
            lineHeight: "22px",
            letterSpacing: "-0.01em",
            color: C.text,
          }}
        >
          {headline}
        </span>
      </div>
      {usedBaseline ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-8)",
            padding: "5px 12px",
            borderRadius: "var(--radius-pill)",
            border: `1px solid ${C.mintMid}`,
            background: C.mintSoft,
            color: C.mint,
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.12em",
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.mint, display: "inline-block" }} />
          used baseline ctx
        </span>
      ) : null}
    </div>
  );
}

function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: TabKey; label: string; icon: string }[];
  active: TabKey;
  onChange: (key: TabKey) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${C.borderSoft}` }}>
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            style={{
              all: "unset",
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-8)",
              padding: "10px 14px",
              cursor: "pointer",
              borderBottom: isActive ? `2px solid ${C.mint}` : "2px solid transparent",
              marginBottom: -1,
              color: isActive ? C.text : C.textMid,
              fontFamily: FONT_BODY,
              fontWeight: isActive ? 600 : 500,
              fontSize: "var(--font-size-md)",
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: "var(--radius-xs)",
                border: `1px solid ${isActive ? C.mintMid : C.border}`,
                color: isActive ? C.mint : C.textLow,
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-2xs)",
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {t.icon}
            </span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Pipeline panel ──

function PipelinePanel({
  turn,
  context,
  events,
}: {
  turn: SceneSessionTurnRecord | null;
  context: SceneSessionContextBuildRecord | null;
  events: SceneSessionEventRecord[];
}) {
  if (!turn) return <Panel>No turn selected.</Panel>;

  const traceItems = pipelineTraceItems(turn, context, events);
  const totalMs = Math.max(traceItems.reduce((max, it) => Math.max(max, it.endMs), 0), 1);
  const ticks = makeTicks(totalMs);
  const markCount = traceEvents(turn.trace).length + traceEvents(context?.timingTrace).length;
  const headlineMetrics = pipelineHeadlineMetrics(traceItems, totalMs);

  return (
    <Panel>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--space-16)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <Eyebrow>STT → LLM → TTS data flow</Eyebrow>
          <span
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontSize: "var(--font-size-xl)",
              color: C.text,
              letterSpacing: "-0.01em",
            }}
          >
            Pipeline ribbon · turn {String((turn.turnIndex ?? 0) + 1).padStart(2, "0")}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          <Chip>{markCount} marks</Chip>
          <Chip>click marks to scrub</Chip>
        </div>
      </div>

      <TimeRuler ticks={ticks} totalMs={totalMs} />
      <PipelineLanes items={traceItems} totalMs={totalMs} />
      <HeadlineMetrics metrics={headlineMetrics} />
    </Panel>
  );
}

function Chip({ children, mint }: { children: React.ReactNode; mint?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-6)",
        padding: "4px 10px",
        borderRadius: "var(--radius-pill)",
        border: `1px solid ${mint ? C.mintMid : C.border}`,
        background: mint ? C.mintSoft : "transparent",
        color: mint ? C.mint : C.textMid,
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </span>
  );
}

function TimeRuler({ ticks, totalMs }: { ticks: number[]; totalMs: number }) {
  return (
    <div style={{ position: "relative", height: 18, marginTop: "var(--space-14)", marginLeft: 110 }}>
      {ticks.map((t, i) => (
        <div
          key={`${t}-${i}`}
          style={{
            position: "absolute",
            left: `${(t / totalMs) * 100}%`,
            transform: "translateX(-50%)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            color: C.textLow,
          }}
        >
          {i === 0 ? "0ms" : t}
        </div>
      ))}
    </div>
  );
}

type LaneItem = {
  laneTitle: string;
  laneSub: string;
  startMs: number;
  endMs: number;
  marks: number[];
  highlight?: boolean;
  amber?: boolean;
  label?: string;
};

function PipelineLanes({ items, totalMs }: { items: LaneItem[]; totalMs: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: "var(--space-6)" }}>
      {items.map((item, i) => (
        <div
          key={`${item.laneTitle}-${i}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-12)",
            height: 34,
            borderTop: i === 0 ? `1px solid ${C.borderSoft}` : "none",
            borderBottom: `1px solid ${C.borderSoft}`,
          }}
        >
          <div style={{ width: 100, flexShrink: 0, display: "flex", flexDirection: "column" }}>
            <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-2xs)", color: C.textLow, letterSpacing: "0.16em", textTransform: "uppercase" }}>
              {item.laneTitle}
            </span>
            <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-sm)", color: C.text, letterSpacing: "0.02em" }}>
              {item.laneSub}
            </span>
          </div>
          <div style={{ position: "relative", flex: 1, height: "100%" }}>
            <LaneBar item={item} totalMs={totalMs} />
          </div>
        </div>
      ))}
    </div>
  );
}

function LaneBar({ item, totalMs }: { item: LaneItem; totalMs: number }) {
  const left = (item.startMs / totalMs) * 100;
  const width = Math.max(((item.endMs - item.startMs) / totalMs) * 100, 0.3);
  const fill = item.amber ? C.amberDeep : item.highlight ? C.mint : "rgba(140,231,210,0.45)";
  return (
    <>
      <div
        style={{
          position: "absolute",
          top: "50%",
          transform: "translateY(-50%)",
          left: `${left}%`,
          width: `${width}%`,
          height: 14,
          borderRadius: "var(--radius-xs)",
          background: fill,
          boxShadow: item.highlight ? `0 0 0 1px ${C.mint}` : undefined,
        }}
      />
      {item.marks.map((m, i) => (
        <span
          key={`mark-${i}`}
          style={{
            position: "absolute",
            top: "50%",
            transform: "translate(-50%, -50%)",
            left: `${(m / totalMs) * 100}%`,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: item.amber ? C.amber : "rgba(140,231,210,0.85)",
          }}
        />
      ))}
      {item.label ? (
        <span
          style={{
            position: "absolute",
            top: "50%",
            transform: "translate(-50%, -150%)",
            left: `${((item.startMs + item.endMs) / 2 / totalMs) * 100}%`,
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            color: item.amber ? C.amber : C.text,
            whiteSpace: "nowrap",
          }}
        >
          {item.label}
        </span>
      ) : null}
    </>
  );
}

function HeadlineMetrics({ metrics }: { metrics: { label: string; value: string; sub?: string; tone?: "mint" | "amber" }[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))`,
        marginTop: "var(--space-14)",
        border: `1px solid ${C.border}`,
        borderRadius: "var(--radius-lg)",
        background: C.panel,
        overflow: "hidden",
      }}
    >
      {metrics.map((m, i) => (
        <div
          key={m.label}
          style={{
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
            borderRight: i < metrics.length - 1 ? `1px solid ${C.borderSoft}` : "none",
            background: m.tone === "amber" ? "rgba(229,184,90,0.06)" : "transparent",
          }}
        >
          <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-xs)", color: C.textLow, letterSpacing: "0.16em", textTransform: "uppercase" }}>
            {m.label}
          </span>
          <span
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontSize: "var(--font-size-3xl)",
              color: m.tone === "mint" ? C.mint : m.tone === "amber" ? C.amber : C.text,
              letterSpacing: "-0.01em",
            }}
          >
            {m.value}
          </span>
          {m.sub ? (
            <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-xs)", color: C.textLow }}>{m.sub}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ── Trace marks list ──

function TraceMarksPanel({ turn, events }: { turn: SceneSessionTurnRecord; events: SceneSessionEventRecord[] }) {
  const marks = mergeTraceMarks(turn, events);
  const total = marks.length;

  return (
    <Panel>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-12)",
        }}
      >
        <Eyebrow>trace marks · serverTrace.events</Eyebrow>
        <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-xs)", color: C.textLow }}>
          {Math.min(marks.length, 16)} of {total}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: "var(--space-10)" }}>
        {marks.length === 0 ? (
          <EmptyHint>No trace marks captured.</EmptyHint>
        ) : (
          marks.slice(0, 16).map((mark, i) => (
            <div
              key={`${mark.name}-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "80px minmax(0, 200px) minmax(0, 1fr) 64px",
                gap: "var(--space-12)",
                padding: "10px 0",
                borderTop: i === 0 ? `1px solid ${C.borderSoft}` : "none",
                borderBottom: `1px solid ${C.borderSoft}`,
              }}
            >
              <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-sm)", color: mark.amber ? C.amber : C.mint, fontWeight: 600 }}>
                +{Math.round(mark.ms)}ms
              </span>
              <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-sm)", color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {mark.name}
              </span>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-sm)",
                  color: C.textHigh,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {mark.detail}
              </span>
              <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-xs)", color: C.textLow, textAlign: "right" }}>
                {mark.source}
              </span>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

// ── Graph / Prompt / Voice / Raw panels ──

type GraphNode = {
  id: string;
  slug: string;
  type: string;
  score: number | null;
  tokens: number | null;
  isSeed: boolean;
  kind: "selected" | "time-gated" | "score-dropped" | "budget-dropped";
  x: number;
  y: number;
};

function KnowledgeGraphViz({
  context,
  pages,
  timeGated,
  dropped,
  seedSlugs,
}: {
  context: SceneSessionContextBuildRecord;
  pages: unknown[];
  timeGated: unknown[];
  dropped: unknown[];
  seedSlugs: Set<string>;
}) {
  const W = 760;
  const H = 380;
  const cx = W / 2;
  const cy = H / 2 + 6;

  const selectedNodes = useMemo(() => {
    const items = pages
      .map((p, i) => {
        const r = asRecord(p);
        const slug = stringField(r, "slug") ?? stringField(r, "id") ?? `page-${i}`;
        return {
          id: `sel-${i}-${slug}`,
          slug,
          type: stringField(r, "type") ?? stringField(r, "pageType") ?? "page",
          score: numberField(r, "score") ?? numberField(r, "weight") ?? 0,
          tokens: numberField(r, "tokens"),
          isSeed: seedSlugs.has(slug),
        };
      })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return items;
  }, [pages, seedSlugs]);

  const ringRadius = Math.min(W, H) * 0.32;
  const outerRadius = ringRadius * 1.55;

  const layout = useMemo(() => {
    if (selectedNodes.length === 0) return { center: null, ring: [], outer: [] };
    const center = { ...selectedNodes[0], x: cx, y: cy, kind: "selected" as const };
    const ring = selectedNodes.slice(1).map((n, i, arr) => {
      const angle = (i / Math.max(arr.length, 1)) * Math.PI * 2 - Math.PI / 2;
      return {
        ...n,
        kind: "selected" as const,
        x: cx + Math.cos(angle) * ringRadius,
        y: cy + Math.sin(angle) * ringRadius,
      };
    });
    const outerSpec: { raw: unknown; kind: GraphNode["kind"] }[] = [];
    for (let k = 0; k < timeGated.length && outerSpec.length < 4; k++) {
      outerSpec.push({ raw: timeGated[k], kind: "time-gated" });
    }
    const half = Math.ceil(dropped.length / 2);
    for (let k = 0; k < dropped.length && outerSpec.length < 9; k++) {
      const kind: GraphNode["kind"] = k < half ? "score-dropped" : "budget-dropped";
      outerSpec.push({ raw: dropped[k], kind });
    }

    const outerNodes: GraphNode[] = outerSpec.map((spec, i) => {
      const r = asRecord(spec.raw);
      const slug = stringField(r, "slug") ?? stringField(r, "id") ?? `${spec.kind}-${i}`;
      const angleSpread = outerSpec.length === 0 ? 0 : (i / outerSpec.length) * Math.PI * 2;
      const jitter = ((hashStr(slug) % 100) / 100 - 0.5) * 0.5;
      const angle = angleSpread + jitter - Math.PI / 4;
      return {
        id: `${spec.kind}-${i}-${slug}`,
        slug,
        type: stringField(r, "type") ?? stringField(r, "pageType") ?? spec.kind,
        score: numberField(r, "score"),
        tokens: numberField(r, "tokens"),
        isSeed: false,
        kind: spec.kind,
        x: cx + Math.cos(angle) * outerRadius,
        y: cy + Math.sin(angle) * outerRadius,
      };
    });
    return { center, ring, outer: outerNodes };
  }, [selectedNodes, timeGated, dropped, cx, cy, ringRadius, outerRadius]);

  const [selectedId, setSelectedId] = useState<string | null>(layout.center?.id ?? null);
  const allNodes: GraphNode[] = layout.center
    ? [layout.center, ...layout.ring, ...layout.outer]
    : [...layout.ring, ...layout.outer];
  const selectedNode = allNodes.find((n) => n.id === selectedId) ?? layout.center ?? null;

  if (!layout.center) {
    return (
      <Panel>
        <Eyebrow>Curator topology · radial</Eyebrow>
        <EmptyHint>No selected pages to graph.</EmptyHint>
      </Panel>
    );
  }

  return (
    <Panel>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-16)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <Eyebrow>Curator topology · radial</Eyebrow>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: "var(--font-size-xl)", color: C.text, letterSpacing: "-0.01em" }}>
            Wiki graph reach for this turn
          </span>
        </div>
        <div style={{ display: "flex", gap: "var(--space-6)" }}>
          <Chip mint>radial</Chip>
          <Chip>force</Chip>
          <Chip>list</Chip>
        </div>
      </div>

      <div style={{ position: "relative", marginTop: "var(--space-10)" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: "block", overflow: "visible" }}
        >
          {/* Background grid for atmosphere */}
          <defs>
            <radialGradient id="kg-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={C.mint} stopOpacity="0.18" />
              <stop offset="60%" stopColor={C.mint} stopOpacity="0.04" />
              <stop offset="100%" stopColor={C.mint} stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx={cx} cy={cy} r={ringRadius * 1.6} fill="url(#kg-glow)" />

          {/* Edges: center → ring (solid mint) */}
          {layout.ring.map((n) => {
            const score = n.score ?? 0;
            const opacity = Math.min(1, 0.25 + score / 12);
            const isSelEdge = selectedNode && (n.id === selectedNode.id || layout.center?.id === selectedNode.id);
            return (
              <line
                key={`edge-c-${n.id}`}
                x1={cx}
                y1={cy}
                x2={n.x}
                y2={n.y}
                stroke={C.mint}
                strokeOpacity={isSelEdge ? Math.min(1, opacity + 0.35) : opacity}
                strokeWidth={isSelEdge ? 1.8 : 1.2}
              />
            );
          })}

          {/* Edges between adjacent ring nodes (chord) */}
          {layout.ring.map((n, i, arr) => {
            const next = arr[(i + 1) % arr.length];
            if (!next || arr.length < 3) return null;
            return (
              <line
                key={`edge-r-${n.id}`}
                x1={n.x}
                y1={n.y}
                x2={next.x}
                y2={next.y}
                stroke={C.mint}
                strokeOpacity={0.18}
                strokeWidth={1}
              />
            );
          })}

          {/* Edges: outer nodes → nearest selected (dashed) */}
          {layout.outer.map((n) => {
            const nearest = nearestNode(n, [layout.center!, ...layout.ring]);
            return (
              <line
                key={`edge-o-${n.id}`}
                x1={nearest.x}
                y1={nearest.y}
                x2={n.x}
                y2={n.y}
                stroke={n.kind === "time-gated" ? C.amber : "rgba(255,255,255,0.35)"}
                strokeOpacity={0.45}
                strokeWidth={1}
                strokeDasharray="4 3"
              />
            );
          })}

          {/* Nodes */}
          {[layout.center, ...layout.ring, ...layout.outer].map((node) => (
            <GraphNodeShape
              key={node.id}
              node={node}
              isCenter={node.id === layout.center?.id}
              isSelected={selectedNode?.id === node.id}
              onSelect={() => setSelectedId(node.id)}
            />
          ))}
        </svg>

        {selectedNode ? <NodeInspector node={selectedNode} center={layout.center} /> : null}
      </div>

      <Legend />
    </Panel>
  );
}

function GraphNodeShape({
  node,
  isCenter,
  isSelected,
  onSelect,
}: {
  node: GraphNode;
  isCenter: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const radius = isCenter ? 26 : node.kind === "selected" ? 20 : 12;
  const isSelectedKind = node.kind === "selected";
  const fill = isSelectedKind
    ? node.isSeed
      ? "rgba(140,231,210,0.35)"
      : "rgba(140,231,210,0.18)"
    : node.kind === "time-gated"
      ? "rgba(229,184,90,0.18)"
      : "rgba(255,255,255,0.06)";
  const stroke = isSelectedKind
    ? C.mint
    : node.kind === "time-gated"
      ? C.amber
      : "rgba(255,255,255,0.32)";
  const strokeDash = node.kind === "score-dropped" || node.kind === "budget-dropped" ? "3 3" : undefined;
  const labelColor = isSelectedKind ? C.text : node.kind === "time-gated" ? C.amber : C.textMid;
  const showLabel = isSelectedKind || node.kind === "time-gated";

  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      onClick={onSelect}
      style={{ cursor: "pointer" }}
    >
      {isSelected ? (
        <circle r={radius + 6} fill="none" stroke={C.mint} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 3" />
      ) : null}
      <circle
        r={radius}
        fill={fill}
        stroke={stroke}
        strokeWidth={isSelected ? 2 : 1.4}
        strokeDasharray={strokeDash}
      />
      {showLabel ? (
        <text
          y={4}
          textAnchor="middle"
          fontSize={isCenter ? 11 : 10}
          fontFamily={FONT_MONO}
          fontWeight={600}
          fill={labelColor}
          pointerEvents="none"
        >
          {truncateLabel(node.slug, isCenter ? 14 : 11)}
        </text>
      ) : null}
    </g>
  );
}

function NodeInspector({ node, center }: { node: GraphNode; center: GraphNode | null }) {
  const kindLabel: Record<GraphNode["kind"], string> = {
    selected: "selected",
    "time-gated": "time-gated",
    "score-dropped": "score-dropped",
    "budget-dropped": "budget-dropped",
  };
  const trail = center && node.id !== center.id ? `${center.slug} → ${node.slug}` : node.slug;
  return (
    <div
      style={{
        position: "absolute",
        right: 10,
        top: 14,
        width: 220,
        background: "rgba(12,14,20,0.92)",
        border: `1px solid ${C.borderStrong}`,
        borderRadius: "var(--radius-lg)",
        padding: "12px 14px",
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-8)" }}>
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: "var(--font-size-lg)", color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.slug}
        </span>
        <Chip mint={node.kind === "selected"}>{kindLabel[node.kind].toUpperCase()}</Chip>
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-xs)", color: C.textMid, marginTop: "var(--space-6)", letterSpacing: "0.04em" }}>
        type {node.type}
        {node.score != null ? ` · score ${node.score.toFixed(1)}` : ""}
        {node.tokens != null ? ` · ${node.tokens} tok` : ""}
      </div>
      {node.isSeed ? (
        <div style={{ marginTop: "var(--space-8)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-xs)", color: C.mint, letterSpacing: "0.06em" }}>SEED · query-title</span>
        </div>
      ) : null}
      <div style={{ marginTop: "var(--space-8)", fontFamily: FONT_MONO, fontSize: "var(--font-size-xs)", color: C.textLow }}>
        trail: {truncateLabel(trail, 30)}
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    { dot: C.mint, label: "selected" },
    { dot: "rgba(140,231,210,0.55)", outline: true, label: "seed (entry point)" },
    { dot: C.amber, label: "time-gated" },
    { dot: "rgba(255,255,255,0.4)", dashed: true, label: "budget-dropped" },
    { dot: "rgba(255,255,255,0.4)", dashed: true, label: "score-dropped" },
    { line: true, dashed: false, label: "edge contribution" },
    { line: true, dashed: true, label: "weak edge" },
  ];
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "var(--space-14)",
        marginTop: "var(--space-10)",
        paddingTop: "var(--space-10)",
        borderTop: `1px solid ${C.borderSoft}`,
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        color: C.textMid,
        letterSpacing: "0.04em",
      }}
    >
      {items.map((it, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-6)" }}>
          {it.line ? (
            <span
              style={{
                display: "inline-block",
                width: 22,
                height: 0,
                borderTop: it.dashed
                  ? `1px dashed rgba(255,255,255,0.45)`
                  : `1px solid ${C.mint}`,
              }}
            />
          ) : (
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: it.outline ? "transparent" : (it.dot as string),
                border: it.outline ? `1.5px solid ${it.dot as string}` : "none",
              }}
            />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

function nearestNode(node: GraphNode, candidates: GraphNode[]): GraphNode {
  let best = candidates[0];
  let bestDist = Infinity;
  for (const c of candidates) {
    const dx = c.x - node.x;
    const dy = c.y - node.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function truncateLabel(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function GraphPanel({ context }: { context: SceneSessionContextBuildRecord | null }) {
  if (!context) return <Panel>No context build recorded.</Panel>;
  const trace = asRecord(context.curatorTrace);
  const seeds = asArray(trace?.seeds);
  const edges = asArray(trace?.edges);
  const timeGated = asArray(trace?.timelineFiltered);
  const dropped = [...asArray(trace?.scoreDropped), ...asArray(trace?.budgetDropped)];
  const pages = asArray(context.selectedPages);
  const seedSlugs = new Set(
    seeds
      .map((s) => stringField(asRecord(s), "slug") ?? stringField(asRecord(s), "id"))
      .filter(Boolean) as string[],
  );

  const summary: { label: string; value: string; tone?: "mint" | "amber" }[] = [
    { label: "Total pages", value: String(pages.length) },
    { label: "Seeds", value: String(seeds.length) },
    { label: "Edges traversed", value: String(edges.length) },
    { label: "Selected", value: `${pages.length} / ${seeds.length + edges.length}`, tone: "mint" },
    { label: "Time-gated", value: String(timeGated.length), tone: "amber" },
    { label: "Budget-dropped", value: String(dropped.length) },
    { label: "Tokens", value: `${context.tokensUsed ?? "?"} / ${context.tokensBudget ?? "?"}` },
  ];

  return (
    <>
      <Panel>
        <Eyebrow>Curator topology</Eyebrow>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${summary.length}, minmax(0, 1fr))`,
            marginTop: "var(--space-12)",
            border: `1px solid ${C.border}`,
            borderRadius: "var(--radius-lg)",
            background: C.panel,
            overflow: "hidden",
          }}
        >
          {summary.map((m, i) => (
            <div
              key={m.label}
              style={{
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3)",
                borderRight: i < summary.length - 1 ? `1px solid ${C.borderSoft}` : "none",
              }}
            >
              <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-xs)", color: C.textLow, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                {m.label}
              </span>
              <span
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 600,
                  fontSize: 20,
                  color: m.tone === "mint" ? C.mint : m.tone === "amber" ? C.amber : C.text,
                  letterSpacing: "-0.01em",
                }}
              >
                {m.value}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <KnowledgeGraphViz context={context} pages={pages} timeGated={timeGated} dropped={dropped} seedSlugs={seedSlugs} />

      <Panel>
        <Eyebrow>Selected pages · in priority order</Eyebrow>
        <div style={{ marginTop: "var(--space-10)", display: "flex", flexDirection: "column" }}>
          {pages.length === 0 ? (
            <EmptyHint>No pages selected.</EmptyHint>
          ) : (
            pages.slice(0, 16).map((p, i) => {
              const r = asRecord(p);
              const slug = stringField(r, "slug") ?? stringField(r, "id") ?? "untitled";
              const type = stringField(r, "type") ?? stringField(r, "pageType") ?? "page";
              const score = numberField(r, "score") ?? numberField(r, "weight");
              const tokens = numberField(r, "tokens");
              return (
                <div
                  key={`${slug}-${i}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "30px minmax(0, 1fr) 110px 70px 50px",
                    gap: "var(--space-12)",
                    padding: "10px 0",
                    borderTop: i === 0 ? `1px solid ${C.borderSoft}` : "none",
                    borderBottom: `1px solid ${C.borderSoft}`,
                    fontFamily: FONT_MONO,
                    fontSize: "var(--font-size-sm)",
                  }}
                >
                  <span style={{ color: C.textLow }}>{String(i + 1).padStart(2, "0")}</span>
                  <span style={{ color: C.mint, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slug}</span>
                  <span style={{ color: C.textMid }}>{type}</span>
                  <span style={{ color: C.text }}>{score != null ? score.toFixed(1) : "—"}</span>
                  <span style={{ color: C.textMid, textAlign: "right" }}>{tokens ?? "—"}</span>
                </div>
              );
            })
          )}
        </div>
      </Panel>
    </>
  );
}

function PromptInspectorPanel({ context }: { context: SceneSessionContextBuildRecord | null }) {
  if (!context) return <Panel>No context build recorded.</Panel>;
  const promptChunk = context.promptChunk ?? "";
  const systemPrompt = context.systemPrompt ?? "";
  return (
    <>
      <Panel>
        <Eyebrow>Build trace · traceEnvelope</Eyebrow>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            fontSize: "var(--font-size-xl)",
            color: C.text,
            marginTop: "var(--space-4)",
            letterSpacing: "-0.01em",
          }}
        >
          curator → prompt
        </div>
      </Panel>

      <div className="session-detail-prompt-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "var(--space-14)", minWidth: 0 }}>
        <Panel>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <Eyebrow>Prompt chunk · curator output</Eyebrow>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: "var(--font-size-lg)", color: C.text }}>
                {promptChunk.length.toLocaleString()} chars
              </span>
            </div>
            <CopyButton text={promptChunk} />
          </div>
          <CodeBlock>{promptChunk || "(empty)"}</CodeBlock>
        </Panel>
        <Panel>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <Eyebrow>System prompt · sent to LLM</Eyebrow>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: "var(--font-size-lg)", color: C.text }}>
                {systemPrompt.length.toLocaleString()} chars
              </span>
            </div>
            <CopyButton text={systemPrompt} />
          </div>
          <CodeBlock>{systemPrompt || "(empty)"}</CodeBlock>
        </Panel>
      </div>
    </>
  );
}

function VoicePanel({
  turn,
  events,
  audioArtifacts,
  sessionId,
}: {
  turn: SceneSessionTurnRecord | null;
  events: SceneSessionEventRecord[];
  audioArtifacts: SceneSessionAudioArtifactRecord[];
  sessionId: string;
}) {
  if (!turn) return <Panel>No turn selected.</Panel>;
  const wordEvents = events.filter((e) => e.type === "stt.word");
  const accepted = wordEvents.filter((e) => payloadField(e.payload, "accepted") !== false);
  const rejected = wordEvents.filter((e) => payloadField(e.payload, "accepted") === false);
  const stepEvents = events.filter((e) => e.type === "stt.step");
  const userClip = audioArtifacts.find((a) => a.turnId === turn.id && a.direction === "input") ?? null;

  const summary: { label: string; value: string; tone?: "mint" | "amber" }[] = [
    { label: "User clip", value: userClip?.durationMs ? `${(userClip.durationMs / 1000).toFixed(1)}s` : "—" },
    { label: "Words heard", value: String(wordEvents.length) },
    { label: "Accepted", value: String(accepted.length), tone: "mint" },
    { label: "Rejected", value: String(rejected.length), tone: "amber" },
    { label: "STT steps", value: String(stepEvents.length) },
  ];

  return (
    <>
      <Panel>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${summary.length}, minmax(0, 1fr))`,
            border: `1px solid ${C.border}`,
            borderRadius: "var(--radius-lg)",
            background: C.panel,
            overflow: "hidden",
          }}
        >
          {summary.map((m, i) => (
            <div
              key={m.label}
              style={{
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3)",
                borderRight: i < summary.length - 1 ? `1px solid ${C.borderSoft}` : "none",
              }}
            >
              <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-xs)", color: C.textLow, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                {m.label}
              </span>
              <span
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 600,
                  fontSize: "var(--font-size-3xl)",
                  color: m.tone === "mint" ? C.mint : m.tone === "amber" ? C.amber : C.text,
                  letterSpacing: "-0.01em",
                }}
              >
                {m.value}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <Eyebrow>Per-word audit · stt.word events</Eyebrow>
        <div style={{ marginTop: "var(--space-10)", display: "flex", flexDirection: "column", maxHeight: 360, overflow: "auto" }}>
          {wordEvents.length === 0 ? (
            <EmptyHint>No word events captured.</EmptyHint>
          ) : (
            wordEvents.slice(0, 80).map((evt, i) => {
              const heard = stringField(asRecord(evt.payload), "word") ?? stringField(asRecord(evt.payload), "text") ?? "—";
              const conf = numberField(asRecord(evt.payload), "confidence") ?? numberField(asRecord(evt.payload), "conf");
              const ok = payloadField(evt.payload, "accepted") !== false;
              return (
                <div
                  key={evt.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "32px 70px 60px minmax(0, 1fr) 50px",
                    gap: "var(--space-12)",
                    padding: "8px 0",
                    borderTop: i === 0 ? `1px solid ${C.borderSoft}` : "none",
                    borderBottom: `1px solid ${C.borderSoft}`,
                    fontFamily: FONT_MONO,
                    fontSize: "var(--font-size-sm)",
                  }}
                >
                  <span style={{ color: C.textLow }}>{String(i + 1).padStart(2, "0")}</span>
                  <span style={{ color: C.textMid }}>{formatTime(evt.createdAt)}</span>
                  <span style={{ color: !ok ? C.amber : C.textHigh }}>
                    {conf != null ? conf.toFixed(2) : "—"}
                  </span>
                  <span style={{ color: !ok ? C.amber : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {heard}
                  </span>
                  <span style={{ color: ok ? C.mint : C.amber, textAlign: "right" }}>{ok ? "✓" : "✗"}</span>
                </div>
              );
            })
          )}
        </div>
      </Panel>

      {userClip ? (
        <Panel>
          <Eyebrow>Input audio · stt alignment</Eyebrow>
          <audio
            controls
            preload="metadata"
            src={`/api/scene-sessions/${sessionId}/audio/${userClip.id}`}
            style={{ width: "100%", marginTop: "var(--space-10)", height: 36, filter: "invert(1) hue-rotate(180deg) saturate(0.6)" }}
          />
        </Panel>
      ) : null}
    </>
  );
}

function RawPanel({
  session,
  activeTurn,
  activeContext,
  audioArtifacts,
  contextBuilds,
  turns,
  events,
}: {
  session: SceneSessionDetailRecord["session"];
  activeTurn: SceneSessionTurnRecord | null;
  activeContext: SceneSessionContextBuildRecord | null;
  audioArtifacts: SceneSessionAudioArtifactRecord[];
  contextBuilds: SceneSessionContextBuildRecord[];
  turns: SceneSessionTurnRecord[];
  events: SceneSessionEventRecord[];
}) {
  return (
    <>
      <Panel>
        <Eyebrow>Session</Eyebrow>
        <CodeBlock>{JSON.stringify(session, null, 2)}</CodeBlock>
      </Panel>
      {activeTurn ? (
        <Panel>
          <Eyebrow>Active turn</Eyebrow>
          <CodeBlock>{JSON.stringify(activeTurn, null, 2)}</CodeBlock>
        </Panel>
      ) : null}
      {activeContext ? (
        <Panel>
          <Eyebrow>Active context build</Eyebrow>
          <CodeBlock>{JSON.stringify(activeContext, null, 2)}</CodeBlock>
        </Panel>
      ) : null}
      <Panel>
        <Eyebrow>Counts</Eyebrow>
        <CodeBlock>
{`turns: ${turns.length}
contextBuilds: ${contextBuilds.length}
events: ${events.length}
audioArtifacts: ${audioArtifacts.length}`}
        </CodeBlock>
      </Panel>
    </>
  );
}

// ───────────── Generic primitives ─────────────

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: C.panelStrong,
        border: `1px solid ${C.borderStrong}`,
        borderRadius: "var(--radius-xl)",
        padding: "var(--space-18)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-10)",
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre
      style={{
        margin: 0,
        marginTop: "var(--space-10)",
        padding: "var(--space-14)",
        background: "#06080C",
        border: `1px solid ${C.borderSoft}`,
        borderRadius: "var(--radius-md)",
        color: C.textHigh,
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-sm)",
        lineHeight: 1.55,
        whiteSpace: "pre-wrap",
        overflow: "auto",
        maxHeight: 360,
      }}
    >
      {children}
    </pre>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, color: C.textMid, fontFamily: FONT_BODY, fontSize: "var(--font-size-md)" }}>{children}</p>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      style={{
        background: "transparent",
        border: `1px solid ${C.border}`,
        borderRadius: "var(--radius-sm)",
        color: C.textMid,
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        padding: "4px 10px",
        cursor: "pointer",
      }}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

// ───────────── Computations ─────────────

function computeStats(detail: SceneSessionDetailRecord) {
  const { session, turns, events, audioArtifacts, contextBuilds } = detail;
  const duration = computeDuration(session);
  const turnCount = turns.length;

  const firstAudios = turns
    .map((t) => firstAudioMs(t))
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  const p50 = firstAudios.length === 0 ? null : firstAudios[Math.floor(firstAudios.length / 2)];
  const p95 = firstAudios.length === 0 ? null : firstAudios[Math.floor(firstAudios.length * 0.95)];

  let inTokens = 0;
  let outTokens = 0;
  let estimatedCostUsd = 0;
  for (const t of turns) {
    const usage = asRecord(t.tokenUsage);
    inTokens +=
      numberField(usage, "input") ??
      numberField(usage, "inputTokens") ??
      numberField(usage, "promptTokens") ??
      0;
    outTokens +=
      numberField(usage, "output") ??
      numberField(usage, "outputTokens") ??
      numberField(usage, "completionTokens") ??
      0;
    estimatedCostUsd +=
      numberField(usage, "estimatedCostUsd") ??
      numberField(asRecord(t.metadata?.cost), "estimatedCostUsd") ??
      0;
  }
  for (const c of contextBuilds) {
    inTokens += c.tokensUsed ?? 0;
  }

  const audioBytes = audioArtifacts.reduce((sum, a) => sum + a.byteSize, 0);

  const wordEvents = events.filter((e) => e.type === "stt.word");
  const rejected = wordEvents.filter((e) => payloadField(e.payload, "accepted") === false);

  const errorEvents = events.filter((e) => e.type.includes("error") || e.type.includes("interrupt"));

  return {
    duration,
    turnCount,
    p50FirstAudio: {
      value: p50 != null ? `${p50}ms` : "—",
      sub: p95 != null ? `p95 ${p95}ms` : undefined,
    },
    tokens: {
      value: inTokens + outTokens > 1000 ? `${((inTokens + outTokens) / 1000).toFixed(1)}K` : `${inTokens + outTokens}`,
      sub: inTokens || outTokens ? `in ${formatNumber(inTokens)} · out ${formatNumber(outTokens)}` : undefined,
    },
    cost: {
      value: formatCost(estimatedCostUsd),
      sub: estimatedCostUsd > 0 ? "est. model cost" : undefined,
    },
    audio: {
      value: formatBytes(audioBytes),
      sub: `${audioArtifacts.length} clips`,
    },
    sttRejected: {
      value: wordEvents.length === 0 ? "—" : `${((rejected.length / wordEvents.length) * 100).toFixed(1)}%`,
      sub: wordEvents.length === 0 ? undefined : `${rejected.length} of ${wordEvents.length} wd`,
    },
    errors: {
      value: String(errorEvents.length),
      sub: errorEvents.length > 0 ? `${errorEvents.filter((e) => e.type.includes("interrupt")).length} interrupted` : "clean",
    },
  };
}

function pickActiveContext(
  contextBuilds: SceneSessionContextBuildRecord[],
  activeTurn: SceneSessionTurnRecord | null,
): SceneSessionContextBuildRecord | null {
  if (!activeTurn) return contextBuilds.at(-1) ?? null;

  const matchingForTurn = contextBuilds.filter((c) => c.turnId === activeTurn.id);
  if (matchingForTurn.length > 0) {
    return matchingForTurn[matchingForTurn.length - 1];
  }

  const turnStartMs = new Date(activeTurn.startedAt).getTime();
  let best: SceneSessionContextBuildRecord | null = null;
  let bestMs = -Infinity;
  for (const c of contextBuilds) {
    const createdMs = new Date(c.createdAt).getTime();
    if (createdMs <= turnStartMs && createdMs > bestMs) {
      best = c;
      bestMs = createdMs;
    }
  }
  return best;
}

function computeDuration(session: SceneSessionDetailRecord["session"]) {
  const start = new Date(session.startedAt).getTime();
  const end = session.endedAt ? new Date(session.endedAt).getTime() : new Date(session.lastActiveAt).getTime();
  const diff = Math.max(0, end - start);
  const totalSeconds = Math.round(diff / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function filterTurns(
  turns: SceneSessionTurnRecord[],
  filter: ConvFilter,
  events: SceneSessionEventRecord[],
): SceneSessionTurnRecord[] {
  if (filter === "all") return turns;
  if (filter === "issues") {
    return turns.filter((t) => {
      if (t.status === "interrupted" || t.status === "error") return true;
      const turnEvents = events.filter((e) => e.turnId === t.id);
      return turnEvents.some((e) => e.type.includes("error") || e.type.includes("interrupt"));
    });
  }
  if (filter === "slow") {
    const sorted = [...turns]
      .map((t) => ({ t, ms: firstAudioMs(t) }))
      .filter((x) => x.ms != null)
      .sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0));
    return sorted.slice(0, Math.max(3, Math.ceil(sorted.length * 0.2))).map((x) => x.t);
  }
  return turns;
}

function firstAudioMs(turn: SceneSessionTurnRecord): number | null {
  const metrics = asRecord(turn.audioMetrics);
  const firstAudio =
    numberField(metrics, "firstAudioMs") ??
    numberField(metrics, "firstAudio") ??
    numberField(asRecord(turn.latencySummary), "firstAudioMs") ??
    numberField(asRecord(turn.latencySummary), "firstAudio");
  if (firstAudio != null) return Math.round(firstAudio);
  const traceEvts = traceEvents(turn.trace);
  const firstAudioEvt =
    traceEvts.find((e) => e.name?.includes("first-audio") || e.name?.includes("first_audio") || e.name?.includes("tts.first")) ?? null;
  if (firstAudioEvt?.ms != null) return Math.round(firstAudioEvt.ms);
  return null;
}

function pipelineHeadlineMetrics(items: LaneItem[], totalMs: number) {
  const stt = items.find((i) => i.laneTitle.startsWith("CLIENT") && i.laneSub.toLowerCase().includes("stt"));
  const llm = items.find((i) => i.laneSub.toLowerCase().includes("llm"));
  const tts = items.find((i) => i.laneSub.toLowerCase().includes("tts"));
  const ctx = items.find((i) => i.laneSub.toLowerCase().includes("context"));
  return [
    { label: "STT pause", value: stt ? `${Math.round(stt.endMs - stt.startMs)}ms` : "—", sub: "final after silence" },
    { label: "LLM TTFB", value: llm ? `${Math.round(llm.endMs - llm.startMs)}ms` : "—", sub: "attached → first-token" },
    { label: "First-audio", value: ctx ? `${Math.round(ctx.endMs - ctx.startMs)}ms` : "—", sub: "first-text → audio", tone: "mint" as const },
    { label: "TTS synth", value: tts ? `${Math.round(tts.endMs - tts.startMs)}ms` : "—", sub: "slowest segment", tone: "amber" as const },
    { label: "Total", value: `${Math.round(totalMs)}ms`, sub: "interrupted at 8.2s" },
  ];
}

function pipelineTraceItems(
  turn: SceneSessionTurnRecord,
  context: SceneSessionContextBuildRecord | null,
  events: SceneSessionEventRecord[],
): LaneItem[] {
  const turnTrace = traceEvents(turn.trace);
  const ctxTrace = traceEvents(context?.timingTrace);
  const turnStart = new Date(turn.startedAt).getTime();
  const completedAt = turn.completedAt ? new Date(turn.completedAt).getTime() : Date.now();
  const totalMs = Math.max(completedAt - turnStart, 100);

  const sttEnd = turnTrace.find((e) => e.name?.startsWith("stt.final"))?.ms ?? totalMs * 0.33;
  const ctxEnd = ctxTrace.find((e) => e.name?.includes("done") || e.name?.includes("end"))?.ms ?? totalMs * 0.4;
  const llmStart = turnTrace.find((e) => e.name?.includes("llm.first") || e.name?.includes("first-token"))?.ms ?? totalMs * 0.45;
  const llmEnd = turnTrace.find((e) => e.name?.includes("llm.done"))?.ms ?? totalMs * 0.75;
  const ttsStart = turnTrace.find((e) => e.name?.includes("tts.first") || e.name?.includes("tts.start"))?.ms ?? totalMs * 0.5;
  const ttsEnd = turnTrace.find((e) => e.name?.includes("tts.done"))?.ms ?? totalMs * 0.78;
  const speakerEnd = turnTrace.find((e) => e.name?.includes("speaker.done") || e.name?.includes("playback"))?.ms ?? totalMs;

  const sttMarks = events
    .filter((e) => e.type.startsWith("stt."))
    .map((e) => Math.max(0, new Date(e.createdAt).getTime() - turnStart))
    .filter((ms) => ms <= totalMs);

  return [
    {
      laneTitle: "CLIENT",
      laneSub: "STT",
      startMs: 0,
      endMs: sttEnd,
      marks: sttMarks.slice(0, 12),
      label: turnTrace.length ? "stt.final" : undefined,
    },
    {
      laneTitle: "SERVER",
      laneSub: "Context",
      startMs: sttEnd,
      endMs: ctxEnd,
      marks: [],
      label: ctxTrace.length ? "context.attached" : undefined,
    },
    {
      laneTitle: "SERVER",
      laneSub: "LLM",
      startMs: llmStart,
      endMs: llmEnd,
      marks: [],
      highlight: true,
      label: "first-token",
    },
    {
      laneTitle: "SERVER",
      laneSub: "TTS",
      startMs: ttsStart,
      endMs: ttsEnd,
      marks: [],
      amber: true,
      label: "tts.done",
    },
    {
      laneTitle: "CLIENT",
      laneSub: "Speaker",
      startMs: ttsEnd,
      endMs: speakerEnd,
      marks: [],
    },
  ];
}

function makeTicks(totalMs: number): number[] {
  const targetTicks = 6;
  const rawStep = totalMs / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = Math.max(magnitude, Math.round(rawStep / magnitude) * magnitude);
  const ticks: number[] = [];
  for (let v = 0; v <= totalMs; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] !== totalMs) ticks.push(Math.round(totalMs));
  return ticks;
}

function mergeTraceMarks(turn: SceneSessionTurnRecord, events: SceneSessionEventRecord[]) {
  const turnStart = new Date(turn.startedAt).getTime();
  const fromTrace = traceEvents(turn.trace).map((evt) => ({
    ms: evt.ms ?? 0,
    name: evt.name ?? "event",
    detail: evt.data ? compactJson(evt.data, 100) : "",
    source: "server",
    amber: false as boolean,
  }));
  const fromEvents = events
    .filter((e) => e.type.startsWith("server.") || e.type.startsWith("stt.") || e.type.includes("voice."))
    .slice(0, 30)
    .map((e) => ({
      ms: Math.max(0, new Date(e.createdAt).getTime() - turnStart),
      name: e.type,
      detail: compactJson(e.payload, 100),
      source: e.source,
      amber: e.type.includes("error") || e.type.includes("interrupt") || e.type.includes("barge"),
    }));
  return [...fromTrace, ...fromEvents].sort((a, b) => a.ms - b.ms);
}

function bargeInEvents(events: SceneSessionEventRecord[], turn: SceneSessionTurnRecord) {
  return events.filter(
    (e) => e.turnId === turn.id && (e.type.includes("barge") || e.type.includes("interrupt")),
  );
}

function msFromTurnStart(turn: SceneSessionTurnRecord, isoTime: string) {
  return new Date(isoTime).getTime() - new Date(turn.startedAt).getTime();
}

function countTimeGated(context: SceneSessionContextBuildRecord | null) {
  if (!context) return 0;
  return asArray(asRecord(context.curatorTrace)?.timelineFiltered).length;
}

function countDropped(context: SceneSessionContextBuildRecord | null) {
  if (!context) return 0;
  const r = asRecord(context.curatorTrace);
  return asArray(r?.scoreDropped).length + asArray(r?.budgetDropped).length;
}

function userInitials(name: string) {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function stripCharacterPrefix(value: string | null) {
  if (!value) return "";
  return value.replace(/['']s\s+(Tent|Story|Saga|Tale|World|Show)\s*$/i, "").trim();
}

function prettyCharacterId(id: string) {
  const stripped = id.replace(/^char_/, "").replace(/[-_]/g, " ");
  return stripped.replace(/\b\w/g, (c) => c.toUpperCase());
}

function wordCount(text: string | null | undefined) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function pageCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function formatTimecode(start: string, when: string) {
  const ms = new Date(when).getTime() - new Date(start).getTime();
  const totalSeconds = Math.max(0, ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = seconds.toFixed(1).padStart(4, "0");
  return `${mm}:${ss}`;
}

function traceEvents(trace: unknown): { name: string; ms: number | null; data?: unknown }[] {
  const record = asRecord(trace);
  const events = asArray(record?.events);
  return events.map((event, index) => {
    const eventRecord = asRecord(event);
    const name =
      stringField(eventRecord, "name") ??
      stringField(eventRecord, "label") ??
      `event.${index + 1}`;
    const ms =
      numberField(eventRecord, "elapsedMs") ??
      numberField(eventRecord, "t") ??
      numberField(eventRecord, "ms");
    const data = eventRecord?.data ?? eventRecord?.payload;
    return { name, ms, data };
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringField(record: Record<string, unknown> | null | undefined, field: string) {
  const value = record?.[field];
  return typeof value === "string" ? value : null;
}

function numberField(record: Record<string, unknown> | null | undefined, field: string) {
  const value = record?.[field];
  return typeof value === "number" ? value : null;
}

function payloadField(payload: unknown, field: string) {
  return asRecord(payload)?.[field];
}

function compactJson(value: unknown, limit = 200) {
  const json = JSON.stringify(value);
  if (!json) return "null";
  return json.length > limit ? `${json.slice(0, limit)}...` : json;
}

function shortId(id: string) {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function formatDate(input: string) {
  return new Date(input).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(input: string) {
  return new Date(input).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatNumber(n: number) {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatCost(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "$0.0000";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(3)}`;
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
