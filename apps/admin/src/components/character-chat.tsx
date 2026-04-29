"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EraConfig, WikiEdgeRecord, WikiPageRecord } from "@odyssey/db";
import { ChatGraph } from "@/components/chat-graph";
import { CharacterVoicePanel } from "@/components/character-voice-panel";
import { useHeaderContent } from "@/components/header-context";

type ChatMode = "chat" | "voice";

/* ── Tokens ────────────────────────────────────────────────────── */

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  panel: "var(--panel)",
  border: "var(--border)",
  cardHover: "var(--card-hover)",
  accent: "var(--accent-strong)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontSerif: "'Instrument Serif', Georgia, serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

/* ── Types ─────────────────────────────────────────────────────── */

type CharacterProp = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  image: string | null;
  eras: EraConfig[];
};

type Moment = { era: string; index: number };

type CuratorTrace = {
  totalPages: number;
  seeds: Array<{ slug: string; reason: string; score: number }>;
  edges: Array<{ fromSlug: string; toSlug: string; kind: string; contribution: number }>;
  timelineFiltered: string[];
  scoreDropped: string[];
  budgetDropped: string[];
};

type CuratorEvent = {
  trace: CuratorTrace;
  pages: Array<{
    slug: string;
    title: string;
    type: string;
    rendering: "full" | "summary" | "title";
    score: number;
    origin: string;
    trail: string[];
    tokens: number;
  }>;
  promptChunk: string;
  tokensUsed: number;
  tokensBudget: number;
  elapsedMs: number;
};

type Turn = {
  id: string;
  userMessage: string;
  assistantMessage: string;
  curator: CuratorEvent | null;
  status: "pending" | "curator-done" | "streaming" | "done" | "error";
  error: string | null;
  tokensIn: number;
  tokensOut: number;
  /** Snapshot of scene/moment at the time of the turn (for "re-run last"). */
  momentSnap: Moment | null;
  sceneSnap: { activeEntities: string[]; location: string | null };
};

type Props = {
  character: CharacterProp;
  pages: WikiPageRecord[];
  edges: WikiEdgeRecord[];
};

/* ── Component ─────────────────────────────────────────────────── */

const MODEL_OPTIONS = [
  { id: "claude-opus-4-5", label: "Opus 4.5" },
  { id: "claude-sonnet-4-5", label: "Sonnet 4.5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
] as const;

export function CharacterChat({ character, pages, edges }: Props) {
  const { setContent, setFlush } = useHeaderContent();
  const [model, setModel] = useState<string>("claude-sonnet-4-5");
  const [budget, setBudget] = useState<number>(3000);

  const [activeEntities, setActiveEntities] = useState<string[]>([]);
  const [location, setLocation] = useState<string | null>(null);
  const [mode, setMode] = useState<ChatMode>("chat");

  const defaultMoment = useMemo<Moment | null>(() => {
    const sortedEras = [...character.eras].sort((a, b) => b.order - a.order);
    if (sortedEras.length === 0) return null;
    return { era: sortedEras[0].key, index: 99 }; // latest era, far index → knows everything
  }, [character.eras]);
  const [moment, setMoment] = useState<Moment | null>(defaultMoment);

  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom when new content arrives.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns]);

  // Render the chat-specific header into the global header bar, and remove
  // the page padding so the chat fills the viewport edge-to-edge.
  useEffect(() => {
    setFlush(true);
    return () => setFlush(false);
  }, [setFlush]);

  useEffect(() => {
    setContent(
      <ChatHeaderInner
        character={character}
        model={model}
        setModel={setModel}
        moment={moment}
        setMoment={setMoment}
        eras={character.eras}
      />,
    );
    return () => setContent(null);
  }, [setContent, character, model, moment]);

  const pageBySlug = useMemo(
    () => new Map(pages.map((p) => [p.slug, p] as const)),
    [pages],
  );
  // Surface only entity + place slugs for scene selectors.
  const entityOptions = useMemo(
    () =>
      pages
        .filter((p) => p.type === "entity")
        .map((p) => p.slug)
        .sort(),
    [pages],
  );

  const busy = turns.some((t) => t.status === "pending" || t.status === "streaming" || t.status === "curator-done");

  /* ── Send a message ───────────────────────────────────────────── */

  const send = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      const turnId = crypto.randomUUID();
      const history = turns
        .filter((t) => t.status === "done" || t.status === "error")
        .flatMap((t) => [
          { role: "user" as const, content: t.userMessage },
          { role: "assistant" as const, content: t.assistantMessage },
        ]);

      const newTurn: Turn = {
        id: turnId,
        userMessage: text,
        assistantMessage: "",
        curator: null,
        status: "pending",
        error: null,
        tokensIn: 0,
        tokensOut: 0,
        momentSnap: moment,
        sceneSnap: { activeEntities: [...activeEntities], location },
      };
      setTurns((ts) => [...ts, newTurn]);
      setInput("");

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`/api/characters/${character.id}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            history,
            moment,
            scene: {
              activeEntities,
              location: location ?? undefined,
            },
            model,
            tokenBudget: budget,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`${res.status}: ${body.slice(0, 200)}`);
        }
        if (!res.body) throw new Error("no response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let frameEnd: number;
          while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
            const raw = buffer.slice(0, frameEnd);
            buffer = buffer.slice(frameEnd + 2);

            let eventName: string | null = null;
            let dataLine = "";
            for (const line of raw.split("\n")) {
              if (line.startsWith("event: ")) eventName = line.slice(7).trim();
              else if (line.startsWith("data: ")) dataLine += line.slice(6);
            }
            if (!eventName || !dataLine) continue;
            let payload: unknown;
            try { payload = JSON.parse(dataLine); } catch { continue; }
            applyEvent(turnId, eventName, payload);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setTurns((ts) =>
          ts.map((t) =>
            t.id === turnId ? { ...t, status: "error", error: msg } : t,
          ),
        );
      }
    },
    [character.id, turns, moment, activeEntities, location, model, budget],
  );

  function applyEvent(turnId: string, name: string, data: unknown) {
    setTurns((ts) =>
      ts.map((t) => {
        if (t.id !== turnId) return t;
        switch (name) {
          case "curator": {
            const cur = data as CuratorEvent;
            return { ...t, curator: cur, status: "curator-done" };
          }
          case "token": {
            const d = data as { delta: string };
            return { ...t, assistantMessage: t.assistantMessage + d.delta, status: "streaming" };
          }
          case "done": {
            const d = data as { inputTokens: number; outputTokens: number };
            return { ...t, tokensIn: d.inputTokens, tokensOut: d.outputTokens, status: "done" };
          }
          case "error": {
            const d = data as { message: string };
            return { ...t, status: "error", error: d.message };
          }
        }
        return t;
      }),
    );
  }

  function cancel() {
    abortRef.current?.abort();
    setTurns((ts) =>
      ts.map((t) =>
        t.status === "pending" || t.status === "streaming" || t.status === "curator-done"
          ? { ...t, status: "error", error: "Cancelled" }
          : t,
      ),
    );
  }

  function clearChat() {
    cancel();
    setTurns([]);
  }

  function reRunLast() {
    const last = [...turns].reverse().find((t) => t.status === "done" || t.status === "error");
    if (!last) return;
    // Drop the last turn and re-send its user message.
    setTurns((ts) => ts.filter((t) => t.id !== last.id));
    send(last.userMessage);
  }

  /* ── Render ────────────────────────────────────────────────────── */

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--background)" }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Left: chat or voice */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, borderRight: `1px solid ${T.border}` }}>
          <SceneBar
            activeEntities={activeEntities}
            setActiveEntities={setActiveEntities}
            location={location}
            setLocation={setLocation}
            entityOptions={entityOptions}
            budget={budget}
            setBudget={setBudget}
            mode={mode}
            setMode={setMode}
          />
          {mode === "chat" ? (
            <>
              <div
                ref={scrollRef}
                style={{
                  flex: 1, minHeight: 0, overflow: "auto",
                  display: "flex", flexDirection: "column", gap: 22,
                  padding: "24px 32px 24px 32px",
                }}
              >
                {turns.length === 0 ? (
                  <EmptyState character={character} />
                ) : (
                  turns.map((turn) => <TurnView key={turn.id} turn={turn} />)
                )}
              </div>
              <Composer
                input={input}
                setInput={setInput}
                onSend={() => send(input)}
                onCancel={cancel}
                onClear={clearChat}
                onRerun={reRunLast}
                busy={busy}
                hasTurns={turns.length > 0}
              />
            </>
          ) : (
            <CharacterVoicePanel
              character={character}
              moment={moment}
              scene={{ activeEntities, location }}
              model={model}
              tokenBudget={budget}
            />
          )}
        </div>

        {/* Right: graph + trace panel */}
        <TracePanel
          turns={turns}
          character={character}
          pages={pages}
          edges={edges}
          pageBySlug={pageBySlug}
        />
      </div>
    </div>
  );
}

/* ── Chat header (rendered into the global header bar) ──────────── */

function ChatHeaderInner({
  character, model, setModel, moment, setMoment, eras,
}: {
  character: CharacterProp;
  model: string; setModel: (m: string) => void;
  moment: Moment | null; setMoment: (m: Moment | null) => void;
  eras: EraConfig[];
}) {
  return (
    <>
      <Link href={`/characters/${character.slug}`} style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, borderRadius: 6,
        border: `1px solid ${T.border}`, background: "transparent",
        color: T.muted, textDecoration: "none", flexShrink: 0, marginRight: 14,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <CharacterAvatar character={character} size={24} />
        <span style={{ fontFamily: T.fontHeading, fontSize: 16, fontWeight: 700, color: T.fg, whiteSpace: "nowrap" }}>
          {character.title}
        </span>
        <span style={{ width: 1, height: 20, background: T.border }} />
        <span style={{ fontFamily: T.fontMono, fontSize: 11, fontWeight: 600, color: "#8CE7D2", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Test Chat
        </span>
        <span style={{ padding: "2px 8px", borderRadius: 4, background: "rgba(250,204,21,0.08)", border: "1px solid rgba(250,204,21,0.25)", fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, color: "#FACC15", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Sandbox
        </span>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <MomentPicker moment={moment} setMoment={setMoment} eras={eras} />
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          style={{
            padding: "6px 10px", borderRadius: 8,
            border: `1px solid ${T.border}`, background: "transparent",
            color: T.fg, fontFamily: T.fontBody, fontSize: 11, outline: "none",
            cursor: "pointer",
          }}
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m.id} value={m.id} style={{ background: "var(--background)", color: T.fg }}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

function MomentPicker({
  moment, setMoment, eras,
}: {
  moment: Moment | null; setMoment: (m: Moment | null) => void; eras: EraConfig[];
}) {
  const sortedEras = [...eras].sort((a, b) => a.order - b.order);
  if (sortedEras.length === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", border: `1px solid ${T.border}`, borderRadius: 8 }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.muted} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>Moment</span>
      <select
        value={moment?.era ?? ""}
        onChange={(e) => {
          const key = e.target.value;
          if (!key) { setMoment(null); return; }
          setMoment({ era: key, index: moment?.era === key ? moment.index : 0 });
        }}
        style={{
          border: "none", outline: "none", background: "transparent",
          color: "#8CE7D2", fontFamily: T.fontMono, fontSize: 11, fontWeight: 500, cursor: "pointer",
        }}
      >
        <option value="" style={{ background: "var(--background)", color: T.fg }}>all</option>
        {sortedEras.map((e) => (
          <option key={e.key} value={e.key} style={{ background: "var(--background)", color: T.fg }}>
            {e.key}
          </option>
        ))}
      </select>
      {moment && (
        <>
          <span style={{ fontFamily: T.fontMono, fontSize: 11, color: "#8CE7D2" }}>·</span>
          <input
            type="number"
            value={moment.index}
            min={0}
            max={999}
            onChange={(e) => setMoment({ era: moment.era, index: Number(e.target.value) || 0 })}
            style={{
              width: 44, border: "none", outline: "none", background: "transparent",
              color: "#8CE7D2", fontFamily: T.fontMono, fontSize: 11, fontWeight: 500,
              textAlign: "right",
            }}
          />
        </>
      )}
    </div>
  );
}

/* ── Scene setup bar ───────────────────────────────────────────── */

function SceneBar({
  activeEntities, setActiveEntities, location, setLocation,
  entityOptions, budget, setBudget, mode, setMode,
}: {
  activeEntities: string[]; setActiveEntities: (s: string[]) => void;
  location: string | null; setLocation: (s: string | null) => void;
  entityOptions: string[];
  budget: number; setBudget: (n: number) => void;
  mode: ChatMode; setMode: (m: ChatMode) => void;
}) {
  const [draft, setDraft] = useState("");
  const suggestions = useMemo(() => {
    if (!draft.trim()) return [];
    const q = draft.trim().toLowerCase();
    return entityOptions
      .filter((s) => s.toLowerCase().includes(q) && !activeEntities.includes(s))
      .slice(0, 6);
  }, [draft, entityOptions, activeEntities]);

  function addEntity(slug: string) {
    if (!slug.trim() || activeEntities.includes(slug)) return;
    setActiveEntities([...activeEntities, slug]);
    setDraft("");
  }
  function removeEntity(slug: string) {
    setActiveEntities(activeEntities.filter((s) => s !== slug));
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 10,
      padding: "14px 32px", borderBottom: `1px solid ${T.border}`,
      background: "rgba(255,255,255,0.02)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Scene
        </span>
        <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>
          what's present in this moment
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        {/* Active entities */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.muted} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M5 21v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1"/></svg>
          <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>Active</span>
          {activeEntities.map((slug) => (
            <span key={slug} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "2px 8px 2px 10px", borderRadius: 999,
              background: "rgba(251,167,192,0.1)", border: "1px solid rgba(251,167,192,0.25)",
              fontFamily: T.fontBody, fontSize: 11, color: "#FBA7C0",
            }}>
              {slug}
              <button type="button" onClick={() => removeEntity(slug)} style={{ border: "none", background: "transparent", color: "#FBA7C0", cursor: "pointer", padding: 0, display: "flex" }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </span>
          ))}
          <div style={{ position: "relative" }}>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) {
                  e.preventDefault();
                  addEntity(draft.trim().toLowerCase());
                } else if (e.key === "Backspace" && !draft && activeEntities.length > 0) {
                  removeEntity(activeEntities[activeEntities.length - 1]);
                }
              }}
              placeholder="+ add"
              style={{
                border: "none", outline: "none", background: "transparent",
                color: T.fg, fontFamily: T.fontBody, fontSize: 11,
                width: 80, padding: "2px 4px",
              }}
            />
            {suggestions.length > 0 && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: 180,
                background: "var(--panel-strong, #1E2230)", border: `1px solid ${T.border}`,
                borderRadius: 8, padding: "4px 0", zIndex: 20,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              }}>
                {suggestions.map((s) => (
                  <button key={s} onClick={() => addEntity(s)} style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "5px 10px", border: "none", background: "transparent",
                    fontFamily: T.fontBody, fontSize: 11, color: T.fg, cursor: "pointer",
                  }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <span style={{ width: 1, height: 18, background: T.border }} />

        {/* Location */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.muted} strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>Location</span>
          <input
            type="text"
            value={location ?? ""}
            onChange={(e) => setLocation(e.target.value || null)}
            placeholder="(none)"
            style={{
              border: "none", outline: "none", background: "transparent",
              color: location ? "#7AB0E8" : T.muted,
              fontFamily: T.fontBody, fontSize: 11,
              width: 120, padding: "2px 4px",
            }}
          />
        </div>

        <span style={{ width: 1, height: 18, background: T.border }} />

        {/* Budget */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>Budget</span>
          <input
            type="range"
            min={500}
            max={6000}
            step={100}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            style={{ width: 120, accentColor: "#8CE7D2" }}
          />
          <span style={{ fontFamily: T.fontMono, fontSize: 11, color: "#8CE7D2", width: 48, textAlign: "right" }}>
            {budget.toLocaleString()}
          </span>
        </div>

        <span style={{ flex: 1 }} />

        {/* Mode toggle: Chat ↔ Voice */}
        <div
          role="tablist"
          aria-label="Conversation mode"
          style={{
            display: "inline-flex",
            padding: 2,
            borderRadius: 8,
            border: `1px solid ${T.border}`,
            background: "rgba(0,0,0,0.25)",
          }}
        >
          {(["chat", "voice"] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(m)}
                style={{
                  padding: "5px 12px",
                  fontFamily: T.fontMono,
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: active ? T.fg : T.muted,
                  background: active ? "rgba(140, 231, 210, 0.12)" : "transparent",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {m === "chat" ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                  </svg>
                )}
                {m}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Turn / message views ──────────────────────────────────────── */

function TurnView({ turn }: { turn: Turn }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <UserBubble text={turn.userMessage} />
      <AssistantBubble turn={turn} />
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div style={{
        maxWidth: 560,
        padding: "10px 14px",
        borderRadius: 14, borderTopRightRadius: 4,
        background: T.panel, border: `1px solid ${T.border}`,
      }}>
        <span style={{ fontFamily: T.fontBody, fontSize: 14, color: T.fg, lineHeight: "20px", whiteSpace: "pre-wrap" }}>
          {text}
        </span>
      </div>
    </div>
  );
}

function AssistantBubble({ turn }: { turn: Turn }) {
  const isStreaming = turn.status === "streaming" || turn.status === "curator-done";
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div style={{ position: "relative" }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: "linear-gradient(135deg, #8CE7D2 0%, #4FB8A8 100%)",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <span style={{ fontFamily: T.fontHeading, fontSize: 14, fontWeight: 600, color: "#0C0E14", lineHeight: "16px" }}>
            A
          </span>
        </div>
        {isStreaming && (
          <span style={{
            position: "absolute", bottom: -2, right: -2, width: 10, height: 10,
            borderRadius: "50%", background: "#4ADE80", border: "2px solid var(--background)",
          }}/>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 720, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: T.fontHeading, fontSize: 11, fontWeight: 600, color: "#8CE7D2", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Abraham
          </span>
          {turn.status === "pending" && <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted }}>● curating…</span>}
          {turn.status === "curator-done" && <span style={{ fontFamily: T.fontMono, fontSize: 10, color: "#4ADE80" }}>● speaking</span>}
          {turn.status === "streaming" && <span style={{ fontFamily: T.fontMono, fontSize: 10, color: "#4ADE80" }}>● speaking</span>}
        </div>
        {turn.status === "error" ? (
          <span style={{ fontFamily: T.fontBody, fontSize: 13, color: "#E89090" }}>
            {turn.error ?? "Failed"}
          </span>
        ) : turn.assistantMessage.length === 0 && turn.status !== "done" ? (
          <span style={{ fontFamily: T.fontBody, fontSize: 13, color: T.muted, fontStyle: "italic" }}>
            curating context…
          </span>
        ) : (
          <p style={{
            fontFamily: T.fontSerif, fontSize: 16, color: T.fg,
            lineHeight: "25px", margin: 0, whiteSpace: "pre-wrap",
          }}>
            {turn.assistantMessage}
            {isStreaming && <span style={{ display: "inline-block", width: 2, height: 16, background: "#8CE7D2", marginLeft: 2, verticalAlign: "middle", animation: "blink 1s steps(2) infinite" }}/>}
          </p>
        )}
        <TraceFooter turn={turn} />
      </div>
      <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
    </div>
  );
}

function TraceFooter({ turn }: { turn: Turn }) {
  const c = turn.curator;
  if (!c && turn.status !== "error") {
    return null;
  }
  const accent = turn.status === "done" ? "#FFFFFF5C" : turn.status === "error" ? "#E89090" : "#8CE7D2";
  const bg = turn.status === "streaming" || turn.status === "curator-done" ? "rgba(140,231,210,0.06)" : "rgba(255,255,255,0.03)";
  const border = turn.status === "streaming" || turn.status === "curator-done" ? "rgba(140,231,210,0.2)" : T.border;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      marginTop: 6, padding: "8px 12px", borderRadius: 10,
      background: bg, border: `1px solid ${border}`, flexWrap: "wrap",
    }}>
      {c ? (
        <>
          <span style={{ fontFamily: T.fontMono, fontSize: 10, color: accent }}>
            curator: {c.pages.length} pages · {c.tokensUsed.toLocaleString()} tok · {c.elapsedMs}ms
          </span>
          {c.trace.seeds.length > 0 && (
            <span style={{ padding: "1px 7px", borderRadius: 4, background: "rgba(140,231,210,0.1)", fontFamily: T.fontMono, fontSize: 9, color: "#8CE7D2", letterSpacing: "0.05em" }}>
              {c.trace.seeds.length} seeds
            </span>
          )}
          {c.trace.timelineFiltered.length > 0 && (
            <span style={{ padding: "1px 7px", borderRadius: 4, background: "rgba(250,204,21,0.1)", fontFamily: T.fontMono, fontSize: 9, color: "#FACC15", letterSpacing: "0.05em" }}>
              {c.trace.timelineFiltered.length} time-gated
            </span>
          )}
          {turn.status === "done" && (turn.tokensIn > 0 || turn.tokensOut > 0) && (
            <span style={{ marginLeft: "auto", fontFamily: T.fontMono, fontSize: 10, color: T.muted }}>
              llm: {turn.tokensIn}→{turn.tokensOut} tok
            </span>
          )}
        </>
      ) : (
        <span style={{ fontFamily: T.fontMono, fontSize: 10, color: accent }}>
          {turn.error}
        </span>
      )}
    </div>
  );
}

/* ── Composer ──────────────────────────────────────────────────── */

function Composer({
  input, setInput, onSend, onCancel, onClear, onRerun, busy, hasTurns,
}: {
  input: string; setInput: (s: string) => void;
  onSend: () => void; onCancel: () => void;
  onClear: () => void; onRerun: () => void;
  busy: boolean; hasTurns: boolean;
}) {
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 8,
      padding: "16px 32px 18px 32px",
      borderTop: `1px solid ${T.border}`, background: "rgba(255,255,255,0.02)", flexShrink: 0,
    }}>
      <div style={{
        display: "flex", alignItems: "flex-end", gap: 10,
        padding: "10px 14px", borderRadius: 12,
        background: T.panel, border: `1px solid ${T.border}`,
      }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Ask the character something…"
          style={{
            flex: 1, border: "none", outline: "none", resize: "none",
            background: "transparent", color: T.fg, fontFamily: T.fontBody,
            fontSize: 14, lineHeight: "20px", maxHeight: 180,
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <span style={{ padding: "2px 7px", borderRadius: 4, background: "rgba(255,255,255,0.04)", fontFamily: T.fontMono, fontSize: 9, color: T.muted, letterSpacing: "0.05em" }}>
            ⌘ ↵
          </span>
          {busy ? (
            <button onClick={onCancel} style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, borderRadius: 8,
              background: "#E89090", border: "none", cursor: "pointer",
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0C0E14" strokeWidth="2.5" strokeLinecap="round"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
            </button>
          ) : (
            <button onClick={onSend} disabled={!input.trim()} style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, borderRadius: 8,
              background: input.trim() ? "#8CE7D2" : "var(--card-hover)",
              border: "none", cursor: input.trim() ? "pointer" : "not-allowed",
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0C0E14" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
            </button>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>Tip:</span>
        <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>
          Edit a wiki page, then re-run the last turn to see how the answer shifts.
        </span>
        <span style={{ flex: 1 }} />
        {hasTurns && (
          <>
            <button onClick={onRerun} disabled={busy} style={ghostBtn}>Re-run last</button>
            <button onClick={onClear} disabled={busy} style={ghostBtn}>Clear chat</button>
          </>
        )}
      </div>
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 5,
  padding: "4px 10px", borderRadius: 6,
  border: "1px solid var(--border)", background: "transparent",
  color: "var(--foreground)", fontFamily: T.fontBody, fontSize: 10,
  cursor: "pointer",
};

/* ── Trace panel (right column) ────────────────────────────────── */

function TracePanel({
  turns, character, pages, edges, pageBySlug,
}: {
  turns: Turn[];
  character: CharacterProp;
  pages: WikiPageRecord[];
  edges: WikiEdgeRecord[];
  pageBySlug: Map<string, WikiPageRecord>;
}) {
  const [tab, setTab] = useState<"trace" | "prompt">("trace");
  /**
   * selectedTurnIdx tracks which turn the trace panel is focused on.
   * - `null` means "Live" — always track the latest turn, even as new ones arrive.
   * - An integer index locks to a specific turn (by its position in `turns`).
   */
  const [selectedTurnIdx, setSelectedTurnIdx] = useState<number | null>(null);

  // When a new turn starts and we're in "Live" mode, nothing special to do —
  // the derived focusedTurn below already points to the latest. If the user
  // was locked to a past turn, keep them there.
  const focusedTurn =
    selectedTurnIdx !== null && turns[selectedTurnIdx]
      ? turns[selectedTurnIdx]
      : turns[turns.length - 1] ?? null;

  const c = focusedTurn?.curator ?? null;

  // Current era for the graph header (majority event-page era).
  const currentEra = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of pages) {
      if (p.timeIndex?.era) counts.set(p.timeIndex.era, (counts.get(p.timeIndex.era) ?? 0) + 1);
    }
    let best: string | null = null; let bestN = 0;
    for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
    return best;
  }, [pages]);

  const graphCurator = useMemo(() => {
    if (!c) return null;
    return {
      trace: {
        seeds: c.trace.seeds,
        timelineFiltered: c.trace.timelineFiltered,
        scoreDropped: c.trace.scoreDropped,
        budgetDropped: c.trace.budgetDropped,
        edges: c.trace.edges,
      },
      pages: c.pages.map((p) => ({ slug: p.slug, rendering: p.rendering })),
    };
  }, [c]);

  void character;

  return (
    <div style={{ width: 640, flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0, background: "var(--background)" }}>
      {/* Turn scrubber */}
      <TurnScrubber
        turns={turns}
        selectedIdx={selectedTurnIdx}
        onSelect={setSelectedTurnIdx}
      />

      {/* Graph */}
      <div style={{ borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <ChatGraph
          pages={pages}
          edges={edges}
          eras={character.eras}
          currentEra={currentEra}
          curator={graphCurator}
        />
      </div>

      {/* Tab header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 20px", borderBottom: `1px solid ${T.border}`, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Curator Trace
          </span>
          {c && (
            <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>
              {c.pages.length} selected · {c.elapsedMs}ms
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <TabPill active={tab === "trace"} onClick={() => setTab("trace")} label="Trace" />
          <TabPill active={tab === "prompt"} onClick={() => setTab("prompt")} label="Prompt" />
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 20px" }}>
        {!c ? (
          <div style={{ color: T.muted, fontFamily: T.fontBody, fontSize: 13 }}>
            {turns.length === 0
              ? "Send a message to see the curator's work."
              : "This turn hasn't been curated yet."}
          </div>
        ) : tab === "prompt" ? (
          <pre style={{
            margin: 0, padding: "12px 14px", borderRadius: 10,
            background: "var(--panel)", border: `1px solid ${T.border}`,
            fontFamily: T.fontMono, fontSize: 11, color: T.fg, lineHeight: "18px",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {c.promptChunk}
          </pre>
        ) : (
          <TraceContent curator={c} pageBySlug={pageBySlug} />
        )}
      </div>
    </div>
  );
}

function TurnScrubber({
  turns, selectedIdx, onSelect,
}: {
  turns: Turn[];
  selectedIdx: number | null;
  onSelect: (idx: number | null) => void;
}) {
  if (turns.length === 0) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 20px", borderBottom: `1px solid ${T.border}`,
        background: "rgba(255,255,255,0.02)", flexShrink: 0,
      }}>
        <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Turn
        </span>
        <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>
          no turns yet
        </span>
      </div>
    );
  }

  const liveActive = selectedIdx === null;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "8px 14px", borderBottom: `1px solid ${T.border}`,
      background: "rgba(255,255,255,0.02)", flexShrink: 0,
      overflowX: "auto",
    }}>
      <span style={{
        fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted,
        letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0, paddingRight: 4,
      }}>
        Turn
      </span>
      {/* Live pill — tracks latest */}
      <ScrubberPill
        active={liveActive}
        onClick={() => onSelect(null)}
        label="Live"
        dot={liveActive}
      />
      {turns.map((_, i) => {
        const isLatest = i === turns.length - 1;
        const active = selectedIdx === i;
        return (
          <ScrubberPill
            key={turns[i].id}
            active={active}
            onClick={() => onSelect(i)}
            label={`T${i + 1}`}
            status={turns[i].status}
            isLatest={isLatest}
          />
        );
      })}
    </div>
  );
}

function ScrubberPill({
  active, onClick, label, dot, status, isLatest,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  dot?: boolean;
  status?: Turn["status"];
  isLatest?: boolean;
}) {
  let dotColor: string | null = null;
  if (dot) dotColor = "#8CE7D2";
  else if (isLatest && status === "streaming") dotColor = "#4ADE80";
  else if (status === "error") dotColor = "#E89090";

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "3px 10px", borderRadius: 999,
        border: active ? "none" : `1px solid ${T.border}`,
        background: active ? "rgba(140,231,210,0.12)" : "transparent",
        color: active ? "#8CE7D2" : T.muted,
        fontFamily: T.fontMono, fontSize: 10, fontWeight: active ? 600 : 500,
        letterSpacing: "0.04em", textTransform: "uppercase",
        cursor: "pointer", flexShrink: 0,
      }}
    >
      {dotColor && <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, boxShadow: active ? `0 0 6px ${dotColor}` : undefined }} />}
      {label}
    </button>
  );
}

function TabPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
      background: active ? "rgba(140,231,210,0.1)" : "transparent",
      color: active ? "#8CE7D2" : T.muted,
      fontFamily: T.fontMono, fontSize: 10, fontWeight: active ? 600 : 500,
      letterSpacing: "0.06em", textTransform: "uppercase",
    }}>
      {label}
    </button>
  );
}

function TraceContent({ curator, pageBySlug }: { curator: CuratorEvent; pageBySlug: Map<string, WikiPageRecord> }) {
  const byRendering = {
    full: curator.pages.filter((p) => p.rendering === "full"),
    summary: curator.pages.filter((p) => p.rendering === "summary"),
    title: curator.pages.filter((p) => p.rendering === "title"),
  };
  const fullTokens = byRendering.full.reduce((s, p) => s + p.tokens, 0);
  const summaryTokens = byRendering.summary.reduce((s, p) => s + p.tokens, 0);
  const titleTokens = byRendering.title.reduce((s, p) => s + p.tokens, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* Seeds */}
      <section>
        <SectionHeader label={`Seeds · ${curator.trace.seeds.length}`} hint="why these pages were picked first" />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {curator.trace.seeds.map((s, i) => {
            const color = seedColor(s.reason);
            return (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "6px 10px", borderRadius: 8,
                background: `${color}0D`, border: `1px solid ${color}33`,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                <span style={{ fontFamily: T.fontHeading, fontSize: 12, fontWeight: 500, color: T.fg }}>{s.slug}</span>
                <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted }}>{s.reason}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: T.fontMono, fontSize: 10, color }}>+{Math.round(s.score)}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Rendered breakdown */}
      <section>
        <SectionHeader label={`Rendered · ${curator.pages.length}`} hint="full → summary → title" />
        <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--card-hover)", marginBottom: 8 }}>
          <div style={{ width: `${Math.round(fullTokens / Math.max(1, curator.tokensUsed) * 100)}%`, background: "#8CE7D2" }}/>
          <div style={{ width: `${Math.round(summaryTokens / Math.max(1, curator.tokensUsed) * 100)}%`, background: "#FACC15" }}/>
          <div style={{ width: `${Math.round(titleTokens / Math.max(1, curator.tokensUsed) * 100)}%`, background: "#A88CFF" }}/>
        </div>
        <div style={{ display: "flex", gap: 14, fontFamily: T.fontMono, fontSize: 10, flexWrap: "wrap" }}>
          <span style={{ color: "#8CE7D2" }}>● {byRendering.full.length} full · {fullTokens}t</span>
          <span style={{ color: "#FACC15" }}>● {byRendering.summary.length} summary · {summaryTokens}t</span>
          <span style={{ color: "#A88CFF" }}>● {byRendering.title.length} title · {titleTokens}t</span>
          <span style={{ color: T.muted, marginLeft: "auto" }}>{curator.tokensUsed}/{curator.tokensBudget} used</span>
        </div>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {curator.pages.slice(0, 12).map((p) => {
            const page = pageBySlug.get(p.slug);
            const typeColor = page ? TYPE_COLOR[page.type] ?? T.muted : T.muted;
            return (
              <div key={p.slug} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 8px", borderRadius: 6,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: typeColor, flexShrink: 0 }} />
                <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted, width: 60, flexShrink: 0, textTransform: "uppercase" }}>
                  {p.rendering}
                </span>
                <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.fg, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.title}
                </span>
                <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.muted }}>{p.origin}</span>
                <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted, width: 40, textAlign: "right" }}>{p.tokens}t</span>
              </div>
            );
          })}
          {curator.pages.length > 12 && (
            <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted, padding: "5px 8px" }}>
              + {curator.pages.length - 12} more…
            </span>
          )}
        </div>
      </section>

      {/* Exclusions */}
      {(curator.trace.timelineFiltered.length > 0 || curator.trace.budgetDropped.length > 0) && (
        <section>
          <SectionHeader label={`Excluded · ${curator.trace.timelineFiltered.length + curator.trace.budgetDropped.length}`} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {curator.trace.timelineFiltered.length > 0 && (
              <ExclusionGroup
                color="#E89090"
                label="Time-gated"
                hint="the character hasn't lived these yet"
                slugs={curator.trace.timelineFiltered}
              />
            )}
            {curator.trace.budgetDropped.length > 0 && (
              <ExclusionGroup
                color={T.muted}
                label="Budget-dropped"
                hint="ranked but didn't fit the token budget"
                slugs={curator.trace.budgetDropped}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function ExclusionGroup({ color, label, hint, slugs }: { color: string; label: string; hint: string; slugs: string[] }) {
  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "6px 10px", borderRadius: 8,
        border: `1px dashed ${color}4D`,
      }}>
        <span style={{ fontFamily: T.fontHeading, fontSize: 12, color: T.fg }}>{label}</span>
        <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted }}>{hint}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: T.fontMono, fontSize: 10, color }}>{slugs.length} pages</span>
      </div>
      <div style={{ padding: "4px 10px 2px 30px", display: "flex", flexWrap: "wrap", gap: 6 }}>
        {slugs.map((s, i) => (
          <span key={i} style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted, textDecoration: "line-through" }}>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

function SectionHeader({ label, hint }: { label: string; hint?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
      <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </span>
      {hint && <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>{hint}</span>}
    </div>
  );
}

/* ── Atoms ─────────────────────────────────────────────────────── */

function CharacterAvatar({ character, size }: { character: CharacterProp; size: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: "linear-gradient(135deg, #8CE7D2 0%, #4FB8A8 100%)",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      <span style={{ fontFamily: T.fontHeading, fontSize: Math.round(size * 0.45), fontWeight: 600, color: "#0C0E14" }}>
        {character.title.charAt(0).toUpperCase()}
      </span>
    </div>
  );
}

function EmptyState({ character }: { character: CharacterProp }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "4rem 2rem", gap: 12, textAlign: "center", margin: "auto",
    }}>
      <CharacterAvatar character={character} size={72} />
      <h2 style={{ fontFamily: T.fontHeading, fontSize: 22, fontWeight: 600, margin: 0, color: T.fg }}>
        Talk to {character.title}
      </h2>
      {character.summary && (
        <p style={{ fontFamily: T.fontBody, fontSize: 14, color: T.muted, margin: 0, maxWidth: 480, lineHeight: 1.55 }}>
          {character.summary}
        </p>
      )}
      <p style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted, margin: "12px 0 0 0", maxWidth: 480, lineHeight: 1.6 }}>
        Set the scene above (who's present, where, at what moment of their life). Send a message. The curator will pick pages from {character.title}'s wiki; the LLM will speak in their voice.
      </p>
    </div>
  );
}

/* ── Type-color map (shared w/ wiki-graph palette) ─────────────── */

const TYPE_COLOR: Record<string, string> = {
  entity:         "#FBA7C0",
  event:          "#FACC15",
  concept:        "#A88CFF",
  relationship:   "#8CE7D2",
  timeline:       "#94A3B8",
  voice_identity: "#E879A0",
};

function seedColor(reason: string): string {
  switch (reason) {
    case "voice-identity": return "#E879A0";
    case "scene-entity":
    case "scene-location": return "#FBA7C0";
    case "query-title":
    case "query-alias":
    case "query-summary":  return "#8CE7D2";
    default:               return "#94A3B8";
  }
}
