"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EraConfig, WikiEdgeRecord, WikiPageRecord } from "@odyssey/db";
import { ChatGraph } from "@/components/chat-graph";
import { useHeaderContent } from "@/components/header-context";
import { Menu, type MenuItem } from "@/components/menu";
import { EntityPicker, type EntityOption, type EntityKind } from "@/components/entity-picker";
import { prewarmMoshiServers } from "@/lib/moshi-client";
import { CharacterVoiceWavefield } from "@/components/character-voice-wavefield";
import {
  MODEL_REGISTRY,
  DEFAULT_CHAT_MODEL,
  type ModelOption,
} from "@/lib/model-registry";

type ChatView = "chat" | "voice" | "context";

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
  /** Final system prompt actually sent to the LLM for this turn. */
  systemPrompt: string;
  /** True if the user supplied an override and the curator was skipped. */
  overridden: boolean;
  routingMode?: string;
  promptKind?: "chat" | "voice";
  timingTrace?: {
    startedAt: string;
    elapsedMs: number;
    events: Array<{ name: string; elapsedMs: number; meta?: Record<string, unknown> }>;
  };
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

const ENTITY_KINDS = ["person", "place", "object", "group"] as const;
function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === "string" && (ENTITY_KINDS as readonly string[]).includes(value);
}

export function CharacterChat({ character, pages, edges }: Props) {
  const { setContent, setFlush } = useHeaderContent();
  // Chat-only model slot; the Voice tab's wavefield manages its own model
  // state independently.
  const [chatModel, setChatModel] = useState<string>(DEFAULT_CHAT_MODEL);
  const [budget, setBudget] = useState<number>(3000);

  const [activeEntities, setActiveEntities] = useState<string[]>([]);
  const [location, setLocation] = useState<string | null>(null);
  const [view, setView] = useState<ChatView>("chat");

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

  // System-prompt override (the "prompt" tab). When `overrideEnabled` and the
  // draft is non-empty, every turn sends the draft as the full system prompt
  // and the server skips the curator.
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overrideDraft, setOverrideDraft] = useState("");

  // Latest actually-sent system prompt — read from the most recent completed
  // turn's curator event. The system-prompt tab uses this as a reference.
  const latestSentPrompt = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const cur = turns[i].curator;
      if (cur?.systemPrompt) return cur.systemPrompt;
    }
    return null;
  }, [turns]);

  // Live preview of the assembled system prompt for the current scene/moment.
  // Populated lazily — only when the user opens the prompt tab and there's no
  // actually-sent prompt to show. Refreshes on demand from the panel.
  const [previewedPrompt, setPreviewedPrompt] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const fetchPromptPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch(`/api/characters/${character.id}/system-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moment,
          scene: { activeEntities, location: location ?? undefined },
          tokenBudget: budget,
        }),
      });
      const data = (await res.json()) as { systemPrompt?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPreviewedPrompt(data.systemPrompt ?? "");
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  }, [character.id, moment, activeEntities, location, budget]);

  // Auto-fetch the first time the context view is shown without a turn yet.
  useEffect(() => {
    if (view !== "context") return;
    if (latestSentPrompt) return;
    if (previewedPrompt !== null) return;
    if (previewLoading) return;
    fetchPromptPreview();
  }, [view, latestSentPrompt, previewedPrompt, previewLoading, fetchPromptPreview]);

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

  // Fire HTTP probes at the Modal STT/TTS containers as soon as the chat
  // mounts. If the user toggles to voice mode later, the containers are
  // already warm — first turn dodges the 30-60s cold-start. We don't surface
  // the result here (chat doesn't have a "warming…" gate); the panel itself
  // still gates listening on its own prewarm checks.
  useEffect(() => {
    void prewarmMoshiServers();
  }, []);

  const overrideActive = overrideEnabled && overrideDraft.trim().length > 0;

  useEffect(() => {
    setContent(
      <ChatHeaderInner
        character={character}
        view={view}
        setView={setView}
        overrideActive={overrideActive}
      />,
    );
    return () => setContent(null);
  }, [setContent, character, view, overrideActive]);

  const pageBySlug = useMemo(
    () => new Map(pages.map((p) => [p.slug, p] as const)),
    [pages],
  );
  // Surface entity records (slug + title + kind) for scene selectors.
  // `kind` lives in EntityFrontmatter ("person" | "place" | "object" | "group");
  // it's a soft tag — entities without a kind still appear in the "All" bucket.
  const entityOptions = useMemo<EntityOption[]>(
    () =>
      pages
        .filter((p) => p.type === "entity")
        .map((p) => {
          const fm = (p.frontmatter ?? {}) as { kind?: string };
          const kind = isEntityKind(fm.kind) ? fm.kind : undefined;
          return { slug: p.slug, title: p.title, summary: p.summary, kind };
        })
        .sort((a, b) => a.title.localeCompare(b.title)),
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
            model: chatModel,
            tokenBudget: budget,
            systemPromptOverride:
              overrideEnabled && overrideDraft.trim() ? overrideDraft : undefined,
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
    [character.id, turns, moment, activeEntities, location, chatModel, budget, overrideEnabled, overrideDraft],
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

  // Chat tab is text-only; the picker shows chat-compatible models.
  const availableModels = useMemo(
    () => MODEL_REGISTRY.filter((m) => m.modes.includes("chat")),
    [],
  );

  /* ── Render ────────────────────────────────────────────────────── */

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--background)" }}>
      {/* Voice tab takes over the workspace — wavefield is self-contained. */}
      {view === "voice" ? (
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <CharacterVoiceWavefield character={character} />
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, borderRight: `1px solid ${T.border}` }}>
            <SceneBar
              activeEntities={activeEntities}
              setActiveEntities={setActiveEntities}
              location={location}
              setLocation={setLocation}
              entityOptions={entityOptions}
              budget={budget}
              setBudget={setBudget}
              moment={moment}
              setMoment={setMoment}
              eras={character.eras}
              model={chatModel}
              setModel={setChatModel}
              availableModels={availableModels}
            />
            {view === "chat" && (
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
            )}
            {view === "context" && (
              <SystemPromptPanel
                characterTitle={character.title}
                latestSentPrompt={latestSentPrompt}
                previewedPrompt={previewedPrompt}
                previewLoading={previewLoading}
                previewError={previewError}
                onRefreshPreview={fetchPromptPreview}
                overrideEnabled={overrideEnabled}
                setOverrideEnabled={setOverrideEnabled}
                overrideDraft={overrideDraft}
                setOverrideDraft={setOverrideDraft}
                onResetChat={clearChat}
                hasTurns={turns.length > 0}
                busy={busy}
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
      )}
    </div>
  );
}

/* ── Chat header (rendered into the global header bar) ──────────── */

function ChatHeaderInner({
  character, view, setView, overrideActive,
}: {
  character: CharacterProp;
  view: ChatView;
  setView: (v: ChatView) => void;
  overrideActive: boolean;
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
        <span style={{ padding: "2px 8px", borderRadius: 4, background: "rgba(250,204,21,0.08)", border: "1px solid rgba(250,204,21,0.25)", fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, color: "#FACC15", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Sandbox
        </span>
      </div>
      <div style={{ flex: 1 }} />
      <ViewTabs view={view} setView={setView} overrideActive={overrideActive} />
    </>
  );
}

function ViewTabs({
  view, setView, overrideActive,
}: {
  view: ChatView;
  setView: (v: ChatView) => void;
  overrideActive: boolean;
}) {
  const TABS: { value: ChatView; label: string }[] = [
    { value: "chat", label: "Chat" },
    { value: "voice", label: "Voice" },
    { value: "context", label: "Context" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Sandbox view"
      style={{
        display: "inline-flex", padding: 2, borderRadius: 8, marginLeft: 4,
        border: `1px solid ${T.border}`,
        background: "color-mix(in srgb, var(--background) 25%, transparent)",
      }}
    >
      {TABS.map((t) => {
        const active = view === t.value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setView(t.value)}
            style={{
              padding: "4px 12px", borderRadius: 6, border: "none",
              background: active
                ? "color-mix(in srgb, var(--accent-strong) 12%, transparent)"
                : "transparent",
              color: active ? T.fg : T.muted,
              fontFamily: T.fontMono, fontSize: 10, fontWeight: 600,
              letterSpacing: "0.1em", textTransform: "uppercase",
              cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            {t.label}
            {t.value === "context" && overrideActive && (
              <span
                aria-hidden
                title="Override active"
                style={{ width: 6, height: 6, borderRadius: "50%", background: "#FACC15" }}
              />
            )}
          </button>
        );
      })}
    </div>
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
      <Menu
        value={moment?.era ?? ""}
        onChange={(key) => {
          if (!key) { setMoment(null); return; }
          setMoment({ era: key, index: moment?.era === key ? moment.index : 0 });
        }}
        ariaLabel="Era"
        items={[
          { value: "", label: "all" },
          ...sortedEras.map((e): MenuItem<string> => ({ value: e.key, label: e.key })),
        ]}
        triggerStyle={{
          border: "none", padding: 0, background: "transparent",
          color: "#8CE7D2", fontFamily: T.fontMono, fontSize: 11, fontWeight: 500,
        }}
      />
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
  entityOptions, budget, setBudget,
  moment, setMoment, eras, model, setModel, availableModels,
}: {
  activeEntities: string[]; setActiveEntities: (s: string[]) => void;
  location: string | null; setLocation: (s: string | null) => void;
  entityOptions: EntityOption[];
  budget: number; setBudget: (n: number) => void;
  moment: Moment | null; setMoment: (m: Moment | null) => void;
  eras: EraConfig[];
  model: string; setModel: (m: string) => void;
  availableModels: ModelOption[];
}) {
  const titleBySlug = useMemo(
    () => new Map(entityOptions.map((e) => [e.slug, e.title] as const)),
    [entityOptions],
  );

  function toggleEntity(slug: string) {
    setActiveEntities(
      activeEntities.includes(slug)
        ? activeEntities.filter((s) => s !== slug)
        : [...activeEntities, slug],
    );
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Scene
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <MomentPicker moment={moment} setMoment={setMoment} eras={eras} />
          <Menu
            value={model}
            onChange={setModel}
            ariaLabel="Model"
            items={availableModels.map((m): MenuItem<string> => ({
              value: m.id,
              label: m.label,
              meta: m.provider,
            }))}
            triggerStyle={{ fontFamily: T.fontMono, fontSize: 11 }}
          />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        {/* Active entities */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.muted} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M5 21v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1"/></svg>
          <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>Active</span>
          {activeEntities.map((slug) => (
            <span key={slug} title={slug} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "2px 8px 2px 10px", borderRadius: 999,
              background: "rgba(251,167,192,0.1)", border: "1px solid rgba(251,167,192,0.25)",
              fontFamily: T.fontBody, fontSize: 11, color: "#FBA7C0",
            }}>
              {titleBySlug.get(slug) ?? slug}
              <button type="button" onClick={() => removeEntity(slug)} style={{ border: "none", background: "transparent", color: "#FBA7C0", cursor: "pointer", padding: 0, display: "flex" }} aria-label={`Remove ${titleBySlug.get(slug) ?? slug}`}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </span>
          ))}
          <EntityPicker
            active={activeEntities}
            onToggle={toggleEntity}
            entities={entityOptions}
          />
        </div>

        <span style={{ width: 1, height: 18, background: T.border }} />

        {/* Location */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.muted} strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>Location</span>
          {location && (
            <span title={location} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "2px 8px 2px 10px", borderRadius: 999,
              background: "rgba(122,176,232,0.1)", border: "1px solid rgba(122,176,232,0.25)",
              fontFamily: T.fontBody, fontSize: 11, color: "#7AB0E8",
            }}>
              {titleBySlug.get(location) ?? location}
              <button
                type="button"
                onClick={() => setLocation(null)}
                style={{ border: "none", background: "transparent", color: "#7AB0E8", cursor: "pointer", padding: 0, display: "flex" }}
                aria-label={`Clear location ${titleBySlug.get(location) ?? location}`}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </span>
          )}
          <EntityPicker
            active={location ? [location] : []}
            onToggle={(slug) => setLocation(slug === location ? null : slug)}
            entities={entityOptions}
            kindFilter="place"
            closeOnSelect
            triggerLabel={location ? "change" : "+ set"}
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

/* ── System prompt panel (mode === "prompt") ──────────────────── */

function SystemPromptPanel({
  characterTitle,
  latestSentPrompt,
  previewedPrompt,
  previewLoading,
  previewError,
  onRefreshPreview,
  overrideEnabled,
  setOverrideEnabled,
  overrideDraft,
  setOverrideDraft,
  onResetChat,
  hasTurns,
  busy,
}: {
  characterTitle: string;
  latestSentPrompt: string | null;
  previewedPrompt: string | null;
  previewLoading: boolean;
  previewError: string | null;
  onRefreshPreview: () => void;
  overrideEnabled: boolean;
  setOverrideEnabled: (b: boolean) => void;
  overrideDraft: string;
  setOverrideDraft: (s: string) => void;
  onResetChat: () => void;
  hasTurns: boolean;
  busy: boolean;
}) {
  const draftActive = overrideEnabled && overrideDraft.trim().length > 0;
  const charCount = overrideDraft.length;
  const tokenEst = Math.ceil(overrideDraft.length / 4);

  // Prefer the actually-sent prompt; fall back to the live preview.
  const displayedPrompt = latestSentPrompt ?? previewedPrompt;
  const displayedSource: "sent" | "preview" | null =
    latestSentPrompt ? "sent" : previewedPrompt ? "preview" : null;

  return (
    <div
      style={{
        flex: 1, minHeight: 0, overflow: "auto",
        display: "flex", flexDirection: "column", gap: 16,
        padding: "20px 32px 24px 32px",
      }}
    >
      {/* Top row: status + reset chat */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            System Prompt
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted }}>
            What {characterTitle} sees before each turn. Override to test pure model behavior — the curator is skipped while override is active.
          </span>
        </div>
        <button
          type="button"
          onClick={onResetChat}
          disabled={!hasTurns || busy}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 8,
            border: `1px solid ${T.border}`,
            background: "transparent",
            color: hasTurns && !busy ? T.fg : T.muted,
            fontFamily: T.fontBody, fontSize: 11, fontWeight: 500,
            cursor: hasTurns && !busy ? "pointer" : "not-allowed",
            opacity: hasTurns && !busy ? 1 : 0.5,
            flexShrink: 0,
          }}
          title="Clear all turns and start a fresh conversation"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
          Reset chat
        </button>
      </div>

      {/* Override editor */}
      <div
        style={{
          display: "flex", flexDirection: "column",
          background: T.panel, border: `1px solid ${T.border}`,
          borderRadius: 12, overflow: "clip",
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 12, padding: "12px 16px",
            borderBottom: `1px solid ${T.border}`,
            background: draftActive ? "rgba(250,204,21,0.06)" : "transparent",
          }}
        >
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={overrideEnabled}
              onChange={(e) => setOverrideEnabled(e.target.checked)}
              style={{ accentColor: "#FACC15" }}
            />
            <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 600, color: draftActive ? "#FACC15" : T.fg, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Use this override
            </span>
            {draftActive && (
              <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>
                · curator skipped
              </span>
            )}
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => displayedPrompt && setOverrideDraft(displayedPrompt)}
              disabled={!displayedPrompt}
              style={{
                ...ghostBtn,
                opacity: displayedPrompt ? 1 : 0.4,
                cursor: displayedPrompt ? "pointer" : "not-allowed",
              }}
              title={
                displayedSource === "sent"
                  ? "Copy the last actually-sent system prompt into the override"
                  : "Copy the previewed system prompt into the override"
              }
            >
              Load current
            </button>
            <button
              type="button"
              onClick={() => setOverrideDraft("")}
              disabled={!overrideDraft}
              style={{
                ...ghostBtn,
                opacity: overrideDraft ? 1 : 0.4,
                cursor: overrideDraft ? "pointer" : "not-allowed",
              }}
            >
              Clear
            </button>
          </div>
        </div>

        <textarea
          value={overrideDraft}
          onChange={(e) => setOverrideDraft(e.target.value)}
          rows={18}
          placeholder={`Write a complete system prompt for ${characterTitle}.\n\nWhen "Use this override" is on, this exact text is sent as the system prompt and the curator is bypassed — useful for isolating model behavior from retrieved context.`}
          style={{
            width: "100%", border: "none", outline: "none", resize: "vertical",
            padding: "16px 20px", background: "var(--background)",
            fontFamily: T.fontMono, fontSize: 12, color: T.fg, lineHeight: "20px",
            minHeight: 320, boxSizing: "border-box",
          }}
        />

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 16px", borderTop: `1px solid ${T.border}`,
        }}>
          <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted, letterSpacing: "0.05em" }}>
            {charCount.toLocaleString()} chars · ~{tokenEst.toLocaleString()} tokens
          </span>
          {overrideEnabled && !overrideDraft.trim() && (
            <span style={{ fontFamily: T.fontBody, fontSize: 11, color: "#E89090" }}>
              Override is on but the draft is empty — turns will fall back to the curator.
            </span>
          )}
        </div>
      </div>

      {/* Resolved system prompt — actually-sent if available, else live preview. */}
      <div
        style={{
          display: "flex", flexDirection: "column",
          background: T.panel, border: `1px solid ${T.border}`,
          borderRadius: 12, overflow: "clip",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, padding: "12px 16px", borderBottom: `1px solid ${T.border}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {displayedSource === "sent" ? "Latest sent prompt" : "Resolved prompt · preview"}
            </span>
            {displayedSource === "preview" && (
              <span
                title="Curator runs with a placeholder query so you can see the prompt before sending a turn."
                style={{
                  padding: "1px 7px", borderRadius: 999,
                  background: "rgba(140,231,210,0.1)", border: "1px solid rgba(140,231,210,0.25)",
                  fontFamily: T.fontMono, fontSize: 9, fontWeight: 600, color: "#8CE7D2",
                  letterSpacing: "0.06em", textTransform: "uppercase",
                }}
              >
                Live
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {displayedPrompt && (
              <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted }}>
                {displayedPrompt.length.toLocaleString()} chars
              </span>
            )}
            <button
              type="button"
              onClick={onRefreshPreview}
              disabled={previewLoading}
              style={{
                ...ghostBtn,
                opacity: previewLoading ? 0.6 : 1,
                cursor: previewLoading ? "wait" : "pointer",
              }}
              title="Re-run the curator with the current scene/moment/budget"
            >
              {previewLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        {previewError && !displayedPrompt && (
          <div style={{
            padding: "12px 20px", borderBottom: `1px solid ${T.border}`,
            background: "rgba(232,144,144,0.08)",
            fontFamily: T.fontBody, fontSize: 12, color: "#E89090",
          }}>
            {previewError}
          </div>
        )}
        {displayedPrompt ? (
          <pre
            style={{
              margin: 0,
              padding: "16px 20px",
              background: "var(--background)",
              fontFamily: T.fontMono, fontSize: 11.5, color: T.fg, lineHeight: "19px",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              maxHeight: 480, overflow: "auto",
            }}
          >
            {displayedPrompt}
          </pre>
        ) : (
          <div style={{
            padding: "16px 20px",
            fontFamily: T.fontBody, fontSize: 12, color: T.muted, lineHeight: "18px",
          }}>
            {previewLoading
              ? "Assembling preview…"
              : "Click Refresh to assemble a preview of the system prompt for the current scene."}
          </div>
        )}
      </div>
    </div>
  );
}

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
            {c.systemPrompt}
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
      {curator.timingTrace && (
        <section>
          <SectionHeader
            label={`Context Harness · ${curator.routingMode ?? "chat-turn"}`}
            hint={`${curator.promptKind ?? "chat"} prompt · ${curator.timingTrace.elapsedMs}ms`}
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {curator.timingTrace.events.map((event) => (
              <div key={`${event.name}-${event.elapsedMs}`} style={{
                padding: "8px 10px",
                borderRadius: 8,
                background: "var(--panel)",
                border: `1px solid ${T.border}`,
                minWidth: 0,
              }}>
                <div style={{
                  fontFamily: T.fontMono,
                  fontSize: 10,
                  color: T.muted,
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {event.name}
                </div>
                <div style={{ marginTop: 5, fontFamily: T.fontHeading, fontSize: 14, color: T.fg }}>
                  {event.elapsedMs}ms
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

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
