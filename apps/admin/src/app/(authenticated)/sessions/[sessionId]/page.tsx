import type React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorldSessionStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const worldDetail = await getWorldSessionStore().getSessionDetail(sessionId);

  if (!worldDetail) notFound();
  return <WorldSessionDebugger detail={worldDetail} />;
}

function WorldSessionDebugger({
  detail,
}: {
  detail: Awaited<ReturnType<ReturnType<typeof getWorldSessionStore>["getSessionDetail"]>>;
}) {
  if (!detail) return null;
  const { session, contextBuilds, turns, events } = detail;
  const wordEvents = events.filter((event) => event.type === "stt.word");
  const stepEvents = events.filter((event) => event.type === "stt.step");
  const streamEvents = events.filter((event) => event.type.startsWith("voice_stream."));
  const latestTurn = turns.at(-1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <BackLink />

      <div>
        <h1 style={titleStyle}>World Session Debugger</h1>
        <p style={idStyle}>{session.id}</p>
      </div>

      <MetricGrid
        items={[
          ["Mode", session.mode],
          ["Status", session.status],
          ["Character", session.characterId ? shortId(session.characterId) : "none"],
          ["Context Builds", contextBuilds.length],
          ["Turns", turns.length],
          ["Events", events.length],
          ["STT Words", wordEvents.length],
          ["STT Steps", stepEvents.length],
          ["Last Active", formatDate(session.lastActiveAt)],
        ]}
      />

      <section>
        <SectionTitle>Progression</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <TimelineItem label="Session started" at={session.startedAt} detail={`${session.mode} · ${session.status}`} />
          {contextBuilds.map((context) => (
            <TimelineItem
              key={context.id}
              label={`Context built · ${context.mode}`}
              at={context.createdAt}
              detail={`${context.tokensUsed ?? "?"}/${context.tokensBudget ?? "?"} tokens · ${pageCount(context.selectedPages)} pages`}
            />
          ))}
          {turns.map((turn, index) => (
            <TimelineItem
              key={turn.id}
              label={`Turn ${index + 1} · ${turn.status}`}
              at={turn.startedAt}
              detail={`${turn.inputMode} · ${turn.provider ?? "provider?"}/${turn.model ?? "model?"}`}
            />
          ))}
          {session.endedAt ? (
            <TimelineItem label="Session ended" at={session.endedAt} detail={session.status} />
          ) : null}
        </div>
      </section>

      <section>
        <SectionTitle>Context Builds ({contextBuilds.length})</SectionTitle>
        {contextBuilds.length === 0 ? (
          <Empty>No context builds recorded.</Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {contextBuilds.map((context) => (
              <Card key={context.id}>
                <RowBetween>
                  <strong>{context.mode} · {context.promptKind}</strong>
                  <Muted>{formatDate(context.createdAt)}</Muted>
                </RowBetween>
                <p style={compactLineStyle}>
                  Tokens: {context.tokensUsed ?? "?"}/{context.tokensBudget ?? "?"} · Pages: {pageCount(context.selectedPages)}
                </p>
                <JsonDetails label="Selected pages" value={context.selectedPages} />
                <JsonDetails label="Curator trace" value={context.curatorTrace} />
                <JsonDetails label="Timing trace" value={context.timingTrace} />
                <TextDetails label="Prompt chunk" value={context.promptChunk ?? ""} />
                <TextDetails label="System prompt" value={context.systemPrompt ?? ""} />
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Turns ({turns.length})</SectionTitle>
        {turns.length === 0 ? (
          <Empty>No turns recorded.</Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {turns.map((turn, index) => (
              <Card key={turn.id}>
                <RowBetween>
                  <strong>Turn {index + 1} · {turn.status}</strong>
                  <Muted>{formatDate(turn.startedAt)}</Muted>
                </RowBetween>
                <p style={compactLineStyle}>
                  {turn.provider ?? "provider?"} · {turn.model ?? "model?"}
                </p>
                <Transcript label="User" text={turn.userText ?? ""} />
                <Transcript label="Assistant" text={turn.assistantText ?? ""} />
                <JsonDetails label="Latency summary" value={turn.latencySummary} open={index === turns.length - 1} />
                <JsonDetails label="Audio metrics" value={turn.audioMetrics} />
                <JsonDetails label="Trace" value={turn.trace} />
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>STT Debug</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
          <Card>
            <strong>Words ({wordEvents.length})</strong>
            <EventTable events={wordEvents} limit={120} />
          </Card>
          <Card>
            <strong>Steps ({stepEvents.length})</strong>
            <EventTable events={stepEvents} limit={120} />
          </Card>
        </div>
      </section>

      <section>
        <SectionTitle>Stream Events ({streamEvents.length})</SectionTitle>
        {streamEvents.length === 0 ? (
          <Empty>No voice-stream events recorded.</Empty>
        ) : (
          <EventTable events={streamEvents} limit={50} />
        )}
      </section>

      <section>
        <SectionTitle>Raw Event Timeline ({events.length})</SectionTitle>
        <EventTable events={events} limit={250} />
        {events.length > 250 ? (
          <Muted>Showing first 250 events. Raw STT steps are intentionally high volume.</Muted>
        ) : null}
      </section>

      {latestTurn ? (
        <section>
          <SectionTitle>Latest Turn Raw JSON</SectionTitle>
          <JsonBlock value={latestTurn} />
        </section>
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <Link href="/sessions" style={{ color: "var(--accent)", fontSize: "0.875rem", textDecoration: "none" }}>
        &larr; Back to Sessions
      </Link>
    </div>
  );
}

function MetricGrid({ items }: { items: Array<[string, unknown]> }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
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

function TimelineItem({ label, at, detail }: { label: string; at: string; detail: string }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "180px minmax(0, 1fr)",
      gap: 12,
      alignItems: "start",
      padding: "0.75rem 1rem",
      background: "var(--panel)",
      border: "1px solid var(--border)",
      borderRadius: "0.5rem",
    }}>
      <Muted>{formatDate(at)}</Muted>
      <div>
        <div style={{ fontWeight: 700 }}>{label}</div>
        <Muted>{detail}</Muted>
      </div>
    </div>
  );
}

function EventTable({ events, limit }: { events: Array<{ id: string; type: string; source: string; turnId?: string | null; payload: unknown; createdAt: string }>; limit: number }) {
  const shown = events.slice(0, limit);
  if (shown.length === 0) return <Empty>No events recorded.</Empty>;
  return (
    <div style={{ overflowX: "auto", marginTop: "0.75rem" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
        <thead>
          <tr>
            <th style={smallHeaderStyle}>Time</th>
            <th style={smallHeaderStyle}>Type</th>
            <th style={smallHeaderStyle}>Turn</th>
            <th style={smallHeaderStyle}>Payload</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((event) => (
            <tr key={event.id} style={{ borderTop: "1px solid var(--border)" }}>
              <td style={smallCellStyle}>{formatTime(event.createdAt)}</td>
              <td style={smallCellStyle}>{event.type}</td>
              <td style={smallCellStyle}>{event.turnId ? shortId(event.turnId) : "none"}</td>
              <td style={{ ...smallCellStyle, maxWidth: 520 }}>
                <code style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {compactJson(event.payload)}
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

function Card({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <div style={{
      background: "var(--panel)",
      border: "1px solid var(--border)",
      borderRadius: "0.5rem",
      padding: compact ? "0.75rem" : "1rem",
    }}>
      {children}
    </div>
  );
}

function RowBetween({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 0.75rem" }}>{children}</h2>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ color: "var(--muted)", margin: 0 }}>{children}</p>;
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>{children}</span>;
}

function Transcript({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ marginTop: "0.75rem" }}>
      <div style={eyebrowStyle}>{label}</div>
      <div style={{ lineHeight: 1.5 }}>{text || "none"}</div>
    </div>
  );
}

function JsonDetails({ label, value, open = false }: { label: string; value: unknown; open?: boolean }) {
  return (
    <details open={open} style={{ marginTop: "0.75rem" }}>
      <summary style={{ cursor: "pointer", color: "var(--accent)", fontSize: "0.82rem" }}>{label}</summary>
      <JsonBlock value={value} />
    </details>
  );
}

function TextDetails({ label, value }: { label: string; value: string }) {
  return (
    <details style={{ marginTop: "0.75rem" }}>
      <summary style={{ cursor: "pointer", color: "var(--accent)", fontSize: "0.82rem" }}>{label}</summary>
      <pre style={preStyle}>{value || "empty"}</pre>
    </details>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre style={preStyle}>{JSON.stringify(value, null, 2)}</pre>;
}

function pageCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function compactJson(value: unknown) {
  const json = JSON.stringify(value);
  return json.length > 420 ? `${json.slice(0, 420)}...` : json;
}

function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

function formatDate(input: string) {
  return new Date(input).toLocaleString();
}

function formatTime(input: string) {
  return new Date(input).toLocaleTimeString();
}

const titleStyle: React.CSSProperties = {
  fontSize: "1.5rem",
  fontWeight: 700,
  marginBottom: "0.5rem",
};

const idStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "0.8rem",
  color: "var(--muted)",
  marginBottom: "1.5rem",
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: "0.7rem",
  textTransform: "uppercase",
  color: "var(--muted)",
  letterSpacing: "0.06em",
  marginBottom: "0.3rem",
};

const compactLineStyle: React.CSSProperties = {
  margin: "0.5rem 0 0",
  color: "var(--muted)",
  fontSize: "0.86rem",
};

const preStyle: React.CSSProperties = {
  margin: "0.75rem 0 0",
  padding: "0.85rem",
  borderRadius: "0.45rem",
  background: "rgba(0,0,0,0.25)",
  border: "1px solid var(--border)",
  color: "var(--foreground)",
  overflow: "auto",
  maxHeight: 420,
  fontSize: "0.76rem",
  lineHeight: 1.45,
};

const smallHeaderStyle: React.CSSProperties = {
  textAlign: "left",
  color: "var(--muted)",
  padding: "0.45rem 0.55rem",
  fontWeight: 650,
};

const smallCellStyle: React.CSSProperties = {
  verticalAlign: "top",
  padding: "0.45rem 0.55rem",
  fontFamily: "var(--font-mono)",
};
