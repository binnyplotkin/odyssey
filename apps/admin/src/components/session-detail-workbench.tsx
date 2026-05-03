"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import type {
  WorldSessionAudioArtifactRecord,
  WorldSessionDetailRecord,
  WorldSessionEventRecord,
} from "@odyssey/db";

type Props = {
  detail: WorldSessionDetailRecord;
};

type TimelineKind = "session" | "context" | "turn" | "event";

type TimelineItem = {
  id: string;
  kind: TimelineKind;
  at: string;
  label: string;
  detail: string;
  turnId?: string | null;
  contextId?: string | null;
  event?: WorldSessionEventRecord;
};

type TimelineFilter = "all" | "conversation" | "context" | "voice" | "stt" | "stream";

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  panel: "var(--panel)",
  border: "var(--border)",
  accent: "var(--accent)",
  accentStrong: "var(--accent-strong)",
  accentSoft: "var(--accent-soft)",
  cardHover: "var(--card-hover)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
} as const;

const FILTERS: { value: TimelineFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "conversation", label: "Conversation" },
  { value: "context", label: "Context" },
  { value: "voice", label: "Voice" },
  { value: "stt", label: "STT" },
  { value: "stream", label: "Stream" },
];

export function SessionDetailWorkbench({ detail }: Props) {
  const { session, user, contextBuilds, turns, events, audioArtifacts } = detail;
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const timeline = useMemo(() => buildTimeline(detail), [detail]);
  const filteredTimeline = useMemo(
    () => timeline.filter((item) => matchesFilter(item, filter)),
    [timeline, filter],
  );

  useEffect(() => {
    setActiveIndex(0);
    setPlaying(false);
  }, [filter]);

  useEffect(() => {
    if (!playing) return;
    if (filteredTimeline.length <= 1) {
      setPlaying(false);
      return;
    }
    const id = window.setInterval(() => {
      setActiveIndex((current) => {
        if (current >= filteredTimeline.length - 1) {
          window.clearInterval(id);
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 850);
    return () => window.clearInterval(id);
  }, [playing, filteredTimeline.length]);

  const activeItem = filteredTimeline[Math.min(activeIndex, Math.max(filteredTimeline.length - 1, 0))] ?? null;
  const activeTurn =
    turns.find((turn) => turn.id === activeItem?.turnId) ??
    latestAtOrBefore(turns, activeItem?.at, (turn) => turn.startedAt) ??
    turns.at(-1) ??
    null;
  const activeContext =
    contextBuilds.find((context) => context.id === activeItem?.contextId) ??
    latestAtOrBefore(contextBuilds, activeItem?.at, (context) => context.createdAt) ??
    contextBuilds.at(-1) ??
    null;

  const wordEvents = events.filter((event) => event.type === "stt.word");
  const acceptedWordEvents = wordEvents.filter((event) => payloadField(event.payload, "accepted") !== false);
  const stepEvents = events.filter((event) => event.type === "stt.step");
  const voiceEvents = events.filter((event) => event.source === "voice" || event.type.startsWith("voice."));
  const streamEvents = events.filter((event) => event.type.startsWith("voice_stream."));
  const activeRelatedEvents = events
    .filter((event) => (activeTurn?.id ? event.turnId === activeTurn.id : event.turnId === activeItem?.turnId))
    .slice(0, 80);
  const activeAudioArtifacts = audioArtifacts.filter((artifact) => artifact.turnId === activeTurn?.id);

  const progress = filteredTimeline.length <= 1 ? 0 : (activeIndex / (filteredTimeline.length - 1)) * 100;
  const userLabel = user?.name?.trim() || user?.email || (session.userId ? shortId(session.userId) : "Unknown user");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <BackLink />

      <header style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 18,
        alignItems: "start",
      }}>
        <div>
          <div style={eyebrowStyle}>World Session</div>
          <h1 style={{
            margin: 0,
            color: T.fg,
            fontFamily: T.fontHeading,
            fontSize: "1.6rem",
            lineHeight: 1.1,
          }}>
            Conversation Playback
          </h1>
          <p style={{
            margin: "0.55rem 0 0",
            color: T.muted,
            fontFamily: T.fontMono,
            fontSize: "0.78rem",
            overflowWrap: "anywhere",
          }}>
            {session.id}
          </p>
        </div>
        <StatusPill status={session.status} />
      </header>

      <MetricGrid
        items={[
          ["User", userLabel],
          ["Mode", session.mode],
          ["Character", session.characterId ? shortId(session.characterId) : "none"],
          ["Turns", turns.length],
          ["Context Builds", contextBuilds.length],
          ["Events", events.length],
          ["Accepted Words", acceptedWordEvents.length],
          ["Audio Clips", audioArtifacts.length],
          ["Last Active", formatDate(session.lastActiveAt)],
        ]}
      />

      <section style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <SectionTitle>Session Playback</SectionTitle>
            <Muted>
              {activeItem
                ? `${activeItem.label} - ${formatDate(activeItem.at)}`
                : "No captured timeline entries."}
            </Muted>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                style={filter === option.value ? activeFilterButtonStyle : filterButtonStyle}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="session-detail-playback-controls" style={{ marginTop: 16, display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", gap: 12, alignItems: "center" }}>
          <button type="button" onClick={() => setPlaying((value) => !value)} style={primaryButtonStyle}>
            {playing ? "Pause" : "Play"}
          </button>
          <div>
            <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{ width: `${progress}%`, height: "100%", borderRadius: 999, background: T.accentStrong }} />
            </div>
            <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", gap: 12 }}>
              <Muted>{filteredTimeline.length === 0 ? "0 / 0" : `${activeIndex + 1} / ${filteredTimeline.length}`}</Muted>
              <Muted>{activeItem ? activeItem.kind : "none"}</Muted>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={() => setActiveIndex((value) => Math.max(0, value - 1))} style={iconButtonStyle} aria-label="Previous event">
              Prev
            </button>
            <button type="button" onClick={() => setActiveIndex((value) => Math.min(filteredTimeline.length - 1, value + 1))} style={iconButtonStyle} aria-label="Next event">
              Next
            </button>
          </div>
        </div>

        <div style={{ marginTop: 16, maxHeight: 310, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {filteredTimeline.length === 0 ? (
            <Empty>No timeline entries for this filter.</Empty>
          ) : (
            filteredTimeline.map((item, index) => (
              <TimelineButton
                key={item.id}
                item={item}
                active={index === activeIndex}
                onClick={() => {
                  setActiveIndex(index);
                  setPlaying(false);
                }}
              />
            ))
          )}
        </div>
      </section>

      <div className="session-detail-two-column" style={{ display: "grid", gridTemplateColumns: "minmax(320px, 0.9fr) minmax(0, 1.4fr)", gap: 16, alignItems: "start" }}>
        <section style={sectionStyle}>
          <SectionTitle>Conversation State</SectionTitle>
          <Muted>
            {activeTurn
              ? `Focused on ${shortId(activeTurn.id)} - ${activeTurn.status}`
              : "No turn has been captured yet."}
          </Muted>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            {turns.length === 0 ? (
              <Empty>No turns recorded.</Empty>
            ) : (
              turns.map((turn, index) => (
                <button
                  key={turn.id}
                  type="button"
                  onClick={() => {
                    const nextIndex = filteredTimeline.findIndex((item) => item.turnId === turn.id);
                    if (nextIndex >= 0) setActiveIndex(nextIndex);
                    setPlaying(false);
                  }}
                  style={turn.id === activeTurn?.id ? activeTurnCardStyle : turnCardStyle}
                >
                  <RowBetween>
                    <strong>Turn {index + 1}</strong>
                    <span style={miniPillStyle}>{turn.status}</span>
                  </RowBetween>
                  <p style={compactLineStyle}>
                    {turn.provider ?? "provider?"} / {turn.model ?? "model?"}
                  </p>
                  <TranscriptPreview label="User" text={turn.userText ?? ""} />
                  <TranscriptPreview label="Assistant" text={turn.assistantText ?? ""} />
                </button>
              ))
            )}
          </div>
        </section>

        <section style={sectionStyle}>
          <SectionTitle>Active Turn Data</SectionTitle>
          {activeTurn ? (
            <div className="session-detail-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              <SmallStat label="Input" value={activeTurn.inputMode} />
              <SmallStat label="Started" value={formatTime(activeTurn.startedAt)} />
              <SmallStat label="Completed" value={activeTurn.completedAt ? formatTime(activeTurn.completedAt) : "open"} />
              <SmallStat label="Words" value={String(activeRelatedEvents.filter((event) => event.type === "stt.word").length)} />
              <SmallStat label="Steps" value={String(activeRelatedEvents.filter((event) => event.type === "stt.step").length)} />
              <SmallStat label="Trace Marks" value={String(traceEventCount(activeTurn.trace))} />
            </div>
          ) : (
            <Empty>No active turn.</Empty>
          )}

          {activeTurn ? (
            <div className="session-detail-split-grid" style={{ marginTop: 14, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
              <TranscriptBlock label="User Transcript" text={activeTurn.userText ?? ""} />
              <TranscriptBlock label="Assistant Transcript" text={activeTurn.assistantText ?? ""} />
            </div>
          ) : null}

          {activeTurn ? (
            <div style={{ marginTop: 14 }}>
              <AudioArtifactPanel sessionId={session.id} artifacts={activeAudioArtifacts} title="Turn Audio" />
              <TraceRail title="Turn Trace" trace={activeTurn.trace} />
              <JsonDetails label="Latency summary" value={activeTurn.latencySummary} open />
              <JsonDetails label="Audio metrics" value={activeTurn.audioMetrics} />
            </div>
          ) : null}
        </section>
      </div>

      <div className="session-detail-two-column" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.8fr)", gap: 16, alignItems: "start" }}>
        <section style={sectionStyle}>
          <SectionTitle>Context, Knowledge Graph, Prompt Creation</SectionTitle>
          {activeContext ? (
            <>
              <div className="session-detail-context-stats" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                <SmallStat label="Prompt Kind" value={activeContext.promptKind} />
                <SmallStat label="Pages" value={String(pageCount(activeContext.selectedPages))} />
                <SmallStat label="Tokens Used" value={String(activeContext.tokensUsed ?? "?")} />
                <SmallStat label="Budget" value={String(activeContext.tokensBudget ?? activeContext.tokenBudget ?? "?")} />
              </div>

              <div style={{ marginTop: 14 }}>
                <TraceRail title="Context Build Trace" trace={activeContext.timingTrace} />
              </div>

              <div className="session-detail-split-grid" style={{ marginTop: 14, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                <KnowledgeGraphPanel trace={activeContext.curatorTrace} selectedPages={activeContext.selectedPages} />
                <PromptPanel promptChunk={activeContext.promptChunk ?? ""} systemPrompt={activeContext.systemPrompt ?? ""} />
              </div>
            </>
          ) : (
            <Empty>No context build has been recorded for this session.</Empty>
          )}
        </section>

        <section style={sectionStyle}>
          <SectionTitle>Voice Pipeline Snapshot</SectionTitle>
          <div className="session-detail-split-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            <SmallStat label="STT Words" value={String(wordEvents.length)} />
            <SmallStat label="Accepted" value={String(acceptedWordEvents.length)} />
            <SmallStat label="STT Steps" value={String(stepEvents.length)} />
            <SmallStat label="Stream Events" value={String(streamEvents.length)} />
            <SmallStat label="Audio In" value={String(audioArtifacts.filter((artifact) => artifact.direction === "input").length)} />
            <SmallStat label="Audio Out" value={String(audioArtifacts.filter((artifact) => artifact.direction === "output").length)} />
          </div>
          <div style={{ marginTop: 14 }}>
            <AudioArtifactPanel sessionId={session.id} artifacts={audioArtifacts} title="All Audio Artifacts" />
          </div>
          <div style={{ marginTop: 14 }}>
            <EventList title="Current Turn Events" events={activeRelatedEvents} limit={36} />
          </div>
          <div style={{ marginTop: 14 }}>
            <EventList title="Recent Voice Events" events={[...voiceEvents, ...streamEvents].sort(byCreatedAt).slice(-40)} limit={40} />
          </div>
        </section>
      </div>

      <section style={sectionStyle}>
        <SectionTitle>Raw Session Data</SectionTitle>
        <div className="session-detail-split-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
          <JsonDetails label="Session" value={session} />
          <JsonDetails label="Selected Timeline Event" value={activeItem?.event ?? activeItem ?? null} open />
          <JsonDetails label="All Context Builds" value={contextBuilds} />
          <JsonDetails label="All Turns" value={turns} />
          <JsonDetails label="Audio Artifacts" value={audioArtifacts} />
        </div>
        <div style={{ marginTop: 14 }}>
          <EventTable events={events} limit={300} />
        </div>
      </section>
    </div>
  );
}

function buildTimeline(detail: WorldSessionDetailRecord): TimelineItem[] {
  const items: TimelineItem[] = [
    {
      id: "session-start",
      kind: "session",
      at: detail.session.startedAt,
      label: "Session started",
      detail: `${detail.session.mode} / ${detail.session.status}`,
    },
  ];

  for (const context of detail.contextBuilds) {
    items.push({
      id: `context-${context.id}`,
      kind: "context",
      at: context.createdAt,
      label: `Context built: ${context.promptKind}`,
      detail: `${pageCount(context.selectedPages)} pages / ${context.tokensUsed ?? "?"}/${context.tokensBudget ?? "?"} tokens`,
      turnId: context.turnId,
      contextId: context.id,
    });
  }

  for (const [index, turn] of detail.turns.entries()) {
    items.push({
      id: `turn-${turn.id}`,
      kind: "turn",
      at: turn.startedAt,
      label: `Turn ${index + 1}: ${turn.status}`,
      detail: `${turn.inputMode} / ${turn.provider ?? "provider?"} / ${turn.model ?? "model?"}`,
      turnId: turn.id,
    });
    if (turn.completedAt) {
      items.push({
        id: `turn-complete-${turn.id}`,
        kind: "turn",
        at: turn.completedAt,
        label: `Turn ${index + 1} completed`,
        detail: turn.assistantText ? truncate(turn.assistantText, 110) : "No assistant text captured",
        turnId: turn.id,
      });
    }
  }

  for (const event of detail.events) {
    items.push({
      id: `event-${event.id}`,
      kind: "event",
      at: event.createdAt,
      label: event.type,
      detail: `${event.source}${event.turnId ? ` / turn ${shortId(event.turnId)}` : ""}`,
      turnId: event.turnId,
      event,
    });
  }

  if (detail.session.endedAt) {
    items.push({
      id: "session-end",
      kind: "session",
      at: detail.session.endedAt,
      label: "Session ended",
      detail: detail.session.status,
    });
  }

  return items.sort(byTimelineAt);
}

function matchesFilter(item: TimelineItem, filter: TimelineFilter) {
  if (filter === "all") return true;
  if (filter === "conversation") return item.kind === "turn";
  if (filter === "context") return item.kind === "context";
  if (filter === "stt") return item.event?.type.startsWith("stt.") ?? false;
  if (filter === "stream") return item.event?.type.startsWith("voice_stream.") ?? false;
  if (filter === "voice") {
    return item.kind === "turn" || item.event?.source === "voice" || item.event?.type.startsWith("voice.") || item.event?.type.startsWith("voice_stream.");
  }
  return true;
}

function TimelineButton({ item, active, onClick }: { item: TimelineItem; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={active ? activeTimelineButtonStyle : timelineButtonStyle}>
      <div style={{ display: "grid", gridTemplateColumns: "130px minmax(0, 1fr) auto", gap: 12, alignItems: "start", width: "100%" }}>
        <span style={{ color: active ? T.accentStrong : T.muted, fontFamily: T.fontMono, fontSize: "0.72rem" }}>{formatTime(item.at)}</span>
        <span style={{ minWidth: 0, textAlign: "left" }}>
          <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</strong>
          <span style={{ display: "block", marginTop: 3, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.detail}</span>
        </span>
        <span style={miniPillStyle}>{item.kind}</span>
      </div>
    </button>
  );
}

function KnowledgeGraphPanel({ trace, selectedPages }: { trace: unknown; selectedPages: unknown }) {
  const record = asRecord(trace);
  const seeds = asArray(record?.seeds);
  const edges = asArray(record?.edges);
  const timelineFiltered = asArray(record?.timelineFiltered);
  const scoreDropped = asArray(record?.scoreDropped);
  const budgetDropped = asArray(record?.budgetDropped);
  const pages = asArray(selectedPages);

  return (
    <Panel title="Knowledge Graph Trace" hint={`${pages.length} selected pages`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        <SmallStat label="Seeds" value={String(seeds.length)} />
        <SmallStat label="Edges" value={String(edges.length)} />
        <SmallStat label="Time-Gated" value={String(timelineFiltered.length)} />
        <SmallStat label="Dropped" value={String(scoreDropped.length + budgetDropped.length)} />
      </div>
      <div style={{ marginTop: 12 }}>
        <MiniList title="Selected Pages" items={pages.map(pageLabel).slice(0, 16)} empty="No selected pages." />
        <MiniList title="Seed Reasons" items={seeds.map(seedLabel).slice(0, 10)} empty="No seeds captured." />
        <JsonDetails label="Full curator trace" value={trace} />
      </div>
    </Panel>
  );
}

function PromptPanel({ promptChunk, systemPrompt }: { promptChunk: string; systemPrompt: string }) {
  return (
    <Panel title="Prompt Creation" hint={`${systemPrompt.length.toLocaleString()} system chars`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        <SmallStat label="Prompt Chunk" value={`${promptChunk.length.toLocaleString()} chars`} />
        <SmallStat label="System Prompt" value={`${systemPrompt.length.toLocaleString()} chars`} />
      </div>
      <TextDetails label="Prompt chunk" value={promptChunk} open />
      <TextDetails label="System prompt" value={systemPrompt} />
    </Panel>
  );
}

function TraceRail({ title, trace }: { title: string; trace: unknown }) {
  const events = traceEvents(trace);
  return (
    <Panel title={title} hint={`${events.length} marks`}>
      {events.length === 0 ? (
        <Empty>No trace events captured.</Empty>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {events.slice(0, 24).map((event, index) => (
            <div key={`${event.name}-${index}`} style={{
              display: "grid",
              gridTemplateColumns: "72px minmax(0, 1fr)",
              gap: 10,
              alignItems: "start",
            }}>
              <span style={{ color: T.accentStrong, fontFamily: T.fontMono, fontSize: "0.7rem" }}>{formatMs(event.ms)}</span>
              <span style={{ minWidth: 0 }}>
                <strong style={{ display: "block", fontSize: "0.78rem" }}>{event.name}</strong>
                {event.data ? <span style={{ display: "block", color: T.muted, fontSize: "0.72rem", overflowWrap: "anywhere" }}>{compactJson(event.data, 180)}</span> : null}
              </span>
            </div>
          ))}
          {events.length > 24 ? <Muted>Showing first 24 of {events.length} trace marks.</Muted> : null}
        </div>
      )}
    </Panel>
  );
}

function EventList({ title, events, limit }: { title: string; events: WorldSessionEventRecord[]; limit: number }) {
  const shown = events.slice(0, limit);
  return (
    <Panel title={title} hint={`${events.length} events`}>
      {shown.length === 0 ? (
        <Empty>No matching events.</Empty>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shown.map((event) => (
            <div key={event.id} style={{
              padding: "0.6rem",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              background: "rgba(255,255,255,0.025)",
            }}>
              <RowBetween>
                <strong style={{ fontSize: "0.78rem" }}>{event.type}</strong>
                <Muted>{formatTime(event.createdAt)}</Muted>
              </RowBetween>
              <code style={{ display: "block", marginTop: 6, color: T.muted, fontFamily: T.fontMono, fontSize: "0.68rem", overflowWrap: "anywhere" }}>
                {compactJson(event.payload, 240)}
              </code>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function AudioArtifactPanel({
  sessionId,
  artifacts,
  title,
}: {
  sessionId: string;
  artifacts: WorldSessionAudioArtifactRecord[];
  title: string;
}) {
  return (
    <Panel title={title} hint={`${artifacts.length} clips`}>
      {artifacts.length === 0 ? (
        <Empty>No audio artifacts captured.</Empty>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {artifacts.map((artifact) => (
            <div key={artifact.id} style={{
              display: "grid",
              gridTemplateColumns: "110px minmax(0, 1fr)",
              gap: 10,
              alignItems: "center",
              padding: "0.65rem",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              background: "rgba(255,255,255,0.025)",
            }}>
              <div>
                <span style={miniPillStyle}>{artifact.direction}</span>
                <div style={{ marginTop: 6 }}>
                  <Muted>{artifact.durationMs ? `${artifact.durationMs}ms` : "duration ?"}</Muted>
                </div>
                <div>
                  <Muted>{formatBytes(artifact.byteSize)}</Muted>
                </div>
              </div>
              <audio
                controls
                preload="metadata"
                src={`/api/world-sessions/${sessionId}/audio/${artifact.id}`}
                style={{ width: "100%" }}
              />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function EventTable({ events, limit }: { events: WorldSessionEventRecord[]; limit: number }) {
  const shown = events.slice(0, limit);
  if (shown.length === 0) return <Empty>No events recorded.</Empty>;
  return (
    <div style={{ overflowX: "auto", marginTop: "0.75rem" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
        <thead>
          <tr>
            <th style={smallHeaderStyle}>Time</th>
            <th style={smallHeaderStyle}>Type</th>
            <th style={smallHeaderStyle}>Source</th>
            <th style={smallHeaderStyle}>Turn</th>
            <th style={smallHeaderStyle}>Payload</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((event) => (
            <tr key={event.id} style={{ borderTop: `1px solid ${T.border}` }}>
              <td style={smallCellStyle}>{formatTime(event.createdAt)}</td>
              <td style={smallCellStyle}>{event.type}</td>
              <td style={smallCellStyle}>{event.source}</td>
              <td style={smallCellStyle}>{event.turnId ? shortId(event.turnId) : "none"}</td>
              <td style={{ ...smallCellStyle, maxWidth: 620 }}>
                <code style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {compactJson(event.payload, 520)}
                </code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {events.length > limit ? <Muted>Showing {limit} of {events.length} events.</Muted> : null}
    </div>
  );
}

function BackLink() {
  return (
    <div>
      <Link href="/sessions" style={{ color: T.accent, fontSize: "0.875rem", textDecoration: "none" }}>
        &larr; Back to Sessions
      </Link>
    </div>
  );
}

function MetricGrid({ items }: { items: Array<[string, unknown]> }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
      gap: "0.75rem",
    }}>
      {items.map(([label, value]) => (
        <Card key={label} compact>
          <div style={eyebrowStyle}>{label}</div>
          <div style={{ fontWeight: 700, fontSize: "0.9rem", overflowWrap: "anywhere" }}>{String(value ?? "none")}</div>
        </Card>
      ))}
    </div>
  );
}

function Card({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <div style={{
      background: T.panel,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      padding: compact ? "0.75rem" : "1rem",
    }}>
      {children}
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{
      minWidth: 0,
      background: "rgba(255,255,255,0.025)",
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      padding: "0.85rem",
    }}>
      <RowBetween>
        <strong style={{ fontSize: "0.86rem" }}>{title}</strong>
        {hint ? <Muted>{hint}</Muted> : null}
      </RowBetween>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      minWidth: 0,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      padding: "0.65rem",
      background: T.cardHover,
    }}>
      <div style={eyebrowStyle}>{label}</div>
      <div style={{ color: T.fg, fontWeight: 700, fontSize: "0.82rem", overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}

function RowBetween({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 0.35rem", fontFamily: T.fontHeading }}>{children}</h2>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ color: T.muted, margin: 0 }}>{children}</p>;
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ color: T.muted, fontSize: "0.82rem" }}>{children}</span>;
}

function TranscriptPreview({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ marginTop: 8, textAlign: "left" }}>
      <div style={eyebrowStyle}>{label}</div>
      <div style={{ color: text ? T.fg : T.muted, fontSize: "0.82rem", lineHeight: 1.45 }}>
        {text ? truncate(text, 170) : "none"}
      </div>
    </div>
  );
}

function TranscriptBlock({ label, text }: { label: string; text: string }) {
  return (
    <Panel title={label}>
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55, color: text ? T.fg : T.muted }}>
        {text || "none"}
      </div>
    </Panel>
  );
}

function JsonDetails({ label, value, open = false }: { label: string; value: unknown; open?: boolean }) {
  return (
    <details open={open} style={{ marginTop: "0.75rem" }}>
      <summary style={{ cursor: "pointer", color: T.accent, fontSize: "0.82rem" }}>{label}</summary>
      <JsonBlock value={value} />
    </details>
  );
}

function TextDetails({ label, value, open = false }: { label: string; value: string; open?: boolean }) {
  return (
    <details open={open} style={{ marginTop: "0.75rem" }}>
      <summary style={{ cursor: "pointer", color: T.accent, fontSize: "0.82rem" }}>{label}</summary>
      <pre style={preStyle}>{value || "empty"}</pre>
    </details>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre style={preStyle}>{JSON.stringify(value, null, 2)}</pre>;
}

function MiniList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={eyebrowStyle}>{title}</div>
      {items.length === 0 ? (
        <Muted>{empty}</Muted>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((item, index) => (
            <div key={`${item}-${index}`} style={{ color: T.fg, fontSize: "0.78rem", overflowWrap: "anywhere" }}>
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = status === "active" ? "#8CE7D2" : status === "error" ? "#F4A8A8" : "#A3E635";
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "0.45rem 0.75rem",
      borderRadius: 999,
      border: `1px solid ${color}66`,
      color,
      fontFamily: T.fontMono,
      fontSize: "0.72rem",
      fontWeight: 700,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
      {status}
    </span>
  );
}

function latestAtOrBefore<T>(items: T[], at: string | undefined, getAt: (item: T) => string): T | null {
  if (!at) return null;
  const target = new Date(at).getTime();
  return items
    .filter((item) => new Date(getAt(item)).getTime() <= target)
    .sort((a, b) => new Date(getAt(b)).getTime() - new Date(getAt(a)).getTime())[0] ?? null;
}

function traceEvents(trace: unknown): { name: string; ms: number | null; data?: unknown }[] {
  const record = asRecord(trace);
  const events = asArray(record?.events);
  return events.map((event, index) => {
    const eventRecord = asRecord(event);
    const name = stringField(eventRecord, "name") ?? stringField(eventRecord, "label") ?? `event.${index + 1}`;
    const ms = numberField(eventRecord, "elapsedMs") ?? numberField(eventRecord, "t") ?? numberField(eventRecord, "ms");
    const data = eventRecord?.data ?? eventRecord?.payload;
    return { name, ms, data };
  });
}

function traceEventCount(trace: unknown) {
  return traceEvents(trace).length;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringField(record: Record<string, unknown> | null, field: string) {
  const value = record?.[field];
  return typeof value === "string" ? value : null;
}

function numberField(record: Record<string, unknown> | null, field: string) {
  const value = record?.[field];
  return typeof value === "number" ? value : null;
}

function payloadField(payload: unknown, field: string) {
  return asRecord(payload)?.[field];
}

function pageLabel(value: unknown) {
  const record = asRecord(value);
  if (!record) return String(value);
  const title = stringField(record, "title") ?? stringField(record, "slug") ?? stringField(record, "id") ?? "untitled";
  const type = stringField(record, "type") ?? stringField(record, "pageType");
  return type ? `${title} (${type})` : title;
}

function seedLabel(value: unknown) {
  const record = asRecord(value);
  if (!record) return String(value);
  const slug = stringField(record, "slug") ?? stringField(record, "id") ?? "seed";
  const reason = stringField(record, "reason") ?? stringField(record, "source") ?? "";
  return reason ? `${slug} - ${reason}` : slug;
}

function pageCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function compactJson(value: unknown, limit = 420) {
  const json = JSON.stringify(value);
  if (!json) return "null";
  return json.length > limit ? `${json.slice(0, limit)}...` : json;
}

function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function formatDate(input: string) {
  return new Date(input).toLocaleString();
}

function formatTime(input: string) {
  return new Date(input).toLocaleTimeString();
}

function formatMs(ms: number | null) {
  return typeof ms === "number" ? `${Math.round(ms)}ms` : "-";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function byTimelineAt(a: TimelineItem, b: TimelineItem) {
  return new Date(a.at).getTime() - new Date(b.at).getTime();
}

function byCreatedAt(a: WorldSessionEventRecord, b: WorldSessionEventRecord) {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

const sectionStyle: React.CSSProperties = {
  minWidth: 0,
  background: T.panel,
  border: `1px solid ${T.border}`,
  borderRadius: 10,
  padding: "1rem",
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: "0.68rem",
  textTransform: "uppercase",
  color: T.muted,
  letterSpacing: "0.08em",
  marginBottom: "0.3rem",
  fontFamily: T.fontMono,
};

const compactLineStyle: React.CSSProperties = {
  margin: "0.5rem 0 0",
  color: T.muted,
  fontSize: "0.78rem",
};

const preStyle: React.CSSProperties = {
  margin: "0.75rem 0 0",
  padding: "0.85rem",
  borderRadius: 8,
  background: "rgba(0,0,0,0.25)",
  border: `1px solid ${T.border}`,
  color: T.fg,
  overflow: "auto",
  maxHeight: 420,
  fontSize: "0.76rem",
  lineHeight: 1.45,
  fontFamily: T.fontMono,
};

const smallHeaderStyle: React.CSSProperties = {
  textAlign: "left",
  color: T.muted,
  padding: "0.45rem 0.55rem",
  fontWeight: 650,
};

const smallCellStyle: React.CSSProperties = {
  verticalAlign: "top",
  padding: "0.45rem 0.55rem",
  fontFamily: T.fontMono,
};

const filterButtonStyle: React.CSSProperties = {
  border: `1px solid ${T.border}`,
  background: "transparent",
  color: T.muted,
  borderRadius: 999,
  padding: "0.38rem 0.7rem",
  fontSize: "0.72rem",
  cursor: "pointer",
};

const activeFilterButtonStyle: React.CSSProperties = {
  ...filterButtonStyle,
  border: "1px solid rgba(140, 231, 210, 0.4)",
  background: T.accentSoft,
  color: T.accentStrong,
};

const primaryButtonStyle: React.CSSProperties = {
  border: "none",
  background: T.accentStrong,
  color: "#06110f",
  borderRadius: 8,
  padding: "0.55rem 0.95rem",
  fontWeight: 800,
  cursor: "pointer",
};

const iconButtonStyle: React.CSSProperties = {
  border: `1px solid ${T.border}`,
  background: "transparent",
  color: T.muted,
  borderRadius: 8,
  padding: "0.5rem 0.65rem",
  cursor: "pointer",
};

const timelineButtonStyle: React.CSSProperties = {
  width: "100%",
  border: `1px solid ${T.border}`,
  background: "rgba(255,255,255,0.02)",
  color: T.fg,
  borderRadius: 8,
  padding: "0.7rem",
  cursor: "pointer",
};

const activeTimelineButtonStyle: React.CSSProperties = {
  ...timelineButtonStyle,
  border: "1px solid rgba(140, 231, 210, 0.55)",
  background: "rgba(140, 231, 210, 0.08)",
};

const turnCardStyle: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  border: `1px solid ${T.border}`,
  background: "rgba(255,255,255,0.02)",
  color: T.fg,
  borderRadius: 8,
  padding: "0.85rem",
  cursor: "pointer",
};

const activeTurnCardStyle: React.CSSProperties = {
  ...turnCardStyle,
  border: "1px solid rgba(140, 231, 210, 0.55)",
  background: "rgba(140, 231, 210, 0.08)",
};

const miniPillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  border: `1px solid ${T.border}`,
  borderRadius: 999,
  padding: "0.16rem 0.45rem",
  color: T.muted,
  fontFamily: T.fontMono,
  fontSize: "0.62rem",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};
