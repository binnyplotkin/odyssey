"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import type { IngestionEvent, ModelId } from "@odyssey/wiki-ingest";

/* ── Tokens ────────────────────────────────────────────────────── */

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  panel: "var(--panel)",
  border: "var(--border)",
  cardHover: "var(--card-hover)",
  accent: "var(--accent-strong)",
  accentSoft: "var(--accent-soft)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

/* ── Types ─────────────────────────────────────────────────────── */

type SourceKind = "primary" | "commentary" | "annotation" | "transcript" | "reference";

const KINDS: { value: SourceKind; label: string }[] = [
  { value: "primary", label: "Primary" },
  { value: "commentary", label: "Commentary" },
  { value: "annotation", label: "Annotation" },
  { value: "transcript", label: "Transcript" },
  { value: "reference", label: "Reference" },
];

type HistoryRow = {
  id: string;
  sourceTitle: string;
  sourceKind: string;
  sourceTags: string[];
  status: "running" | "succeeded" | "failed";
  model: string | null;
  pagesCreated: number;
  pagesUpdated: number;
  edgesAdded: number;
  contradictionsFound: number;
  tokensUsed: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type Props = {
  characterId: string;
  characterSlug: string;
  hasIngestionPrompt: boolean;
  history: HistoryRow[];
  stats: { totalRuns: number; weekRuns: number; weekTokens: number };
};

/* ── Run stream state ──────────────────────────────────────────── */

type StreamStatus = "idle" | "running" | "succeeded" | "failed";

type StreamState = {
  status: StreamStatus;
  events: IngestionEvent[];
  error: string | null;
  startedAt: number | null;
};

const INITIAL_STREAM: StreamState = {
  status: "idle",
  events: [],
  error: null,
  startedAt: null,
};

/* ── Component ─────────────────────────────────────────────────── */

export function CharacterIngestion({
  characterId,
  characterSlug,
  hasIngestionPrompt,
  history,
  stats,
}: Props) {
  const router = useRouter();

  const [kind, setKind] = useState<SourceKind>("primary");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [content, setContent] = useState("");
  const [model, setModel] = useState<ModelId>("claude-sonnet-4-5");

  const [stream, setStream] = useState<StreamState>(INITIAL_STREAM);
  const abortRef = useRef<AbortController | null>(null);

  const canCompile =
    title.trim().length > 0 && content.trim().length > 20 && stream.status !== "running";

  const wordCount = useMemo(
    () => (content.trim() ? content.trim().split(/\s+/).length : 0),
    [content],
  );
  const kbSize = Math.round(new TextEncoder().encode(content).length / 102.4) / 10;

  /* ── Start a run ───────────────────────────────────────────── */

  const startRun = useCallback(async () => {
    if (!canCompile) return;
    setStream({
      status: "running",
      events: [],
      error: null,
      startedAt: Date.now(),
    });
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/characters/${characterId}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, kind, tags, content, model }),
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

        let frame: number;
        while ((frame = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, frame);
          buffer = buffer.slice(frame + 2);
          for (const line of raw.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const jsonStr = line.slice(5).trim();
            if (!jsonStr) continue;
            let ev: IngestionEvent;
            try {
              ev = JSON.parse(jsonStr) as IngestionEvent;
            } catch {
              continue;
            }
            setStream((s) => ({ ...s, events: [...s.events, ev] }));
            if (ev.type === "succeeded") {
              setStream((s) => ({ ...s, status: "succeeded" }));
            } else if (ev.type === "failed") {
              setStream((s) => ({ ...s, status: "failed", error: ev.error }));
            }
          }
        }
      }
      // Refresh server data (history, character stats) once stream closes.
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStream((s) => ({ ...s, status: "failed", error: msg }));
    }
  }, [canCompile, characterId, title, kind, tags, content, model, router]);

  const cancelRun = useCallback(() => {
    abortRef.current?.abort();
    setStream((s) =>
      s.status === "running"
        ? { ...s, status: "failed", error: "Cancelled" }
        : s,
    );
  }, []);

  const resetForm = useCallback(() => {
    setStream(INITIAL_STREAM);
    setTitle("");
    setTags([]);
    setContent("");
  }, []);

  /* ── Tag input handlers ────────────────────────────────────── */

  function addTag() {
    const t = tagDraft.trim().toLowerCase();
    if (!t) return;
    if (tags.includes(t)) { setTagDraft(""); return; }
    setTags([...tags, t]);
    setTagDraft("");
  }

  function removeTag(t: string) {
    setTags(tags.filter((x) => x !== t));
  }

  /* ── Render ────────────────────────────────────────────────── */

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Missing-prompt warning */}
      {!hasIngestionPrompt && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: "12px 16px", borderRadius: 12,
          background: "rgba(250,204,21,0.05)",
          border: "1px solid rgba(250,204,21,0.25)",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FACC15" strokeWidth="2" strokeLinecap="round" style={{ marginTop: 1, flexShrink: 0 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
            <span style={{ fontFamily: T.fontBody, fontSize: 13, fontWeight: 500, color: T.fg }}>
              No ingestion prompt set
            </span>
            <span style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted, lineHeight: "18px" }}>
              This character has no domain-awareness steering. Ingestion will run, but the LLM won't know what tradition the source comes from.{" "}
              <a href={`/characters/${characterSlug}`} style={{ color: "#8CE7D2", textDecoration: "none" }}>Set a prompt →</a>
            </span>
          </div>
        </div>
      )}

      {/* Top row: form + active run side-by-side */}
      <div style={{ display: "flex", flexDirection: "row", gap: 20 }}>
        <div style={{ flex: "1 1 0", minWidth: 0 }}>
          <SourceForm
            kind={kind} setKind={setKind}
            title={title} setTitle={setTitle}
            tags={tags} tagDraft={tagDraft} setTagDraft={setTagDraft} addTag={addTag} removeTag={removeTag}
            content={content} setContent={setContent}
            wordCount={wordCount} kbSize={kbSize}
            model={model} setModel={setModel}
            canCompile={canCompile}
            running={stream.status === "running"}
            onCompile={startRun}
          />
        </div>
        <div style={{ width: 520, flexShrink: 0 }}>
          <ActiveRunPanel
            stream={stream}
            onCancel={cancelRun}
            onReset={resetForm}
          />
        </div>
      </div>

      {/* History */}
      <HistoryCard history={history} stats={stats} />
    </div>
  );
}

/* ── Source form ───────────────────────────────────────────────── */

function SourceForm(p: {
  kind: SourceKind; setKind: (k: SourceKind) => void;
  title: string; setTitle: (s: string) => void;
  tags: string[]; tagDraft: string; setTagDraft: (s: string) => void;
  addTag: () => void; removeTag: (t: string) => void;
  content: string; setContent: (s: string) => void;
  wordCount: number; kbSize: number;
  model: ModelId; setModel: (m: ModelId) => void;
  canCompile: boolean; running: boolean;
  onCompile: () => void;
}) {
  return (
    <div style={cardShell}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 20px", borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            New Source
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted }}>
            Paste or upload raw material — the LLM compiles it into wiki pages.
          </span>
        </div>
        <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted }}>
          ~30s – 3min
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "18px 20px 20px 20px" }}>
        {/* Kind */}
        <Field label="Source kind">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => p.setKind(k.value)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "6px 12px", borderRadius: 999,
                  border: `1px solid ${p.kind === k.value ? "rgba(140,231,210,0.4)" : T.border}`,
                  background: p.kind === k.value ? "rgba(140,231,210,0.1)" : "transparent",
                  color: p.kind === k.value ? "#8CE7D2" : T.muted,
                  fontFamily: T.fontBody, fontSize: 12, fontWeight: 500, cursor: "pointer",
                }}
              >
                {p.kind === k.value && (
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#8CE7D2" }} />
                )}
                {k.label}
              </button>
            ))}
          </div>
        </Field>

        {/* Title */}
        <Field label="Title">
          <input
            type="text"
            value={p.title}
            onChange={(e) => p.setTitle(e.target.value)}
            placeholder="e.g. Genesis 22 — The Binding of Isaac"
            style={inputStyle}
          />
        </Field>

        {/* Tags */}
        <Field label="Tags" optional help="Domain labels — searchable, no engine behaviour.">
          <div style={{
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6,
            padding: "8px 12px", borderRadius: 10,
            background: "var(--background)", border: `1px solid ${T.border}`,
            minHeight: 42,
          }}>
            {p.tags.map((t) => (
              <span key={t} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "2px 8px 2px 10px", borderRadius: 999,
                background: "rgba(251,167,192,0.1)", border: "1px solid rgba(251,167,192,0.25)",
              }}>
                <span style={{ fontFamily: T.fontBody, fontSize: 11, color: "#FBA7C0" }}>{t}</span>
                <button
                  type="button" onClick={() => p.removeTag(t)}
                  aria-label={`remove ${t}`}
                  style={{ border: "none", background: "transparent", color: "#FBA7C0", cursor: "pointer", padding: 0, display: "flex" }}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </span>
            ))}
            <input
              type="text"
              value={p.tagDraft}
              onChange={(e) => p.setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  p.addTag();
                } else if (e.key === "Backspace" && !p.tagDraft && p.tags.length > 0) {
                  p.removeTag(p.tags[p.tags.length - 1]);
                }
              }}
              onBlur={p.addTag}
              placeholder={p.tags.length === 0 ? "bible, genesis, torah…" : "+ add tag…"}
              style={{
                flex: 1, minWidth: 120, border: "none", outline: "none",
                background: "transparent", color: T.fg,
                fontFamily: T.fontBody, fontSize: 12,
              }}
            />
          </div>
        </Field>

        {/* Content */}
        <Field
          label="Content"
          trailing={<span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted }}>
            {p.wordCount.toLocaleString()} words · {p.kbSize} kb
          </span>}
        >
          <textarea
            value={p.content}
            onChange={(e) => p.setContent(e.target.value)}
            rows={14}
            placeholder="Paste the full source text here. Markdown, plain prose, verse-numbered scripture — whatever the LLM should draw on."
            style={{
              ...inputStyle, resize: "vertical",
              fontFamily: T.fontMono, fontSize: 12, lineHeight: "20px",
              minHeight: 220,
            }}
          />
        </Field>

        {/* Footer actions */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{
              display: "flex", alignItems: "center", gap: 6,
              fontFamily: T.fontBody, fontSize: 11, color: T.muted,
            }}>
              Model
              <select
                value={p.model}
                onChange={(e) => p.setModel(e.target.value as ModelId)}
                style={{
                  padding: "5px 8px", borderRadius: 6,
                  border: `1px solid ${T.border}`, background: "var(--background)",
                  color: T.fg, fontSize: 11, outline: "none", cursor: "pointer",
                  fontFamily: T.fontBody,
                }}
              >
                <option value="claude-opus-4-5">Opus 4.5</option>
                <option value="claude-sonnet-4-5">Sonnet 4.5</option>
                <option value="claude-haiku-4-5">Haiku 4.5</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={!p.canCompile}
            onClick={p.onCompile}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "8px 18px", borderRadius: 10, border: "none",
              background: p.canCompile ? "#8CE7D2" : "var(--card-hover)",
              color: p.canCompile ? "#0C0E14" : T.muted,
              fontFamily: T.fontBody, fontSize: 13, fontWeight: 600,
              cursor: p.canCompile ? "pointer" : "not-allowed",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            {p.running ? "Compiling…" : "Compile"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Active run panel ──────────────────────────────────────────── */

function ActiveRunPanel({
  stream, onCancel, onReset,
}: {
  stream: StreamState;
  onCancel: () => void;
  onReset: () => void;
}) {
  if (stream.status === "idle") return <IdleRunPanel />;
  return <LiveRunPanel stream={stream} onCancel={onCancel} onReset={onReset} />;
}

function IdleRunPanel() {
  return (
    <div style={{
      ...cardShell, minHeight: 360,
      border: `1px dashed ${T.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      textAlign: "center", padding: "3rem 2rem",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", maxWidth: 320 }}>
        <div style={{
          width: 48, height: 48, borderRadius: "50%",
          background: T.cardHover, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>
        <span style={{ fontFamily: T.fontBody, fontSize: 13, fontWeight: 500, color: T.fg }}>
          No active run
        </span>
        <span style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted, lineHeight: 1.55 }}>
          Fill out the form and hit Compile — progress will stream here.
        </span>
      </div>
    </div>
  );
}

function LiveRunPanel({
  stream, onCancel, onReset,
}: { stream: StreamState; onCancel: () => void; onReset: () => void }) {
  const elapsed = stream.startedAt ? Date.now() - stream.startedAt : 0;
  const elapsedLabel = formatElapsed(elapsed);

  // Parse the stream into structured views.
  let opTotal = 0;
  let opIndex = 0;
  let runTokens = 0;
  let contextLabel = "";
  const progressItems: ProgressItem[] = [];

  for (const ev of stream.events) {
    switch (ev.type) {
      case "started":
        progressItems.push({ kind: "done", label: `Started · model ${ev.model}` });
        contextLabel = `model ${ev.model}`;
        break;
      case "loaded-index":
        progressItems.push({
          kind: "done",
          label: `Loaded wiki index · ${ev.pageCount} pages, ${ev.edgeCount} edges`,
        });
        break;
      case "planning":
        progressItems.push({ kind: "active", label: "Planning…" });
        break;
      case "plan-complete": {
        // Mark planning as done.
        const p = progressItems.find((i) => i.label === "Planning…");
        if (p) { p.kind = "done"; p.label = `Planned ${ev.opCount} ops · ${ev.contradictionCount} contradictions`; p.detail = `${ev.tokens.toLocaleString()} tokens`; }
        else progressItems.push({ kind: "done", label: `Planned ${ev.opCount} ops`, detail: `${ev.tokens} tokens` });
        opTotal = ev.opCount;
        runTokens += ev.tokens;
        break;
      }
      case "op-start":
        opIndex = ev.index + 1;
        progressItems.push({
          kind: "active",
          label: `${ev.op.action} ${ev.op.slug}`,
          detail: `${ev.op.type} · op ${ev.index + 1}/${ev.total}`,
          slug: ev.op.slug,
        });
        break;
      case "op-complete": {
        const current = progressItems.findLast?.((i) => i.slug === ev.op.slug && i.kind === "active")
          ?? progressItems.slice().reverse().find((i) => i.slug === ev.op.slug && i.kind === "active");
        if (current) {
          current.kind = "done";
          current.label = `✓ wrote "${ev.page.title}"`;
          current.detail = `+${ev.edgesAdded}/-${ev.edgesRemoved} edges · ${ev.tokens.toLocaleString()} tokens`;
        }
        runTokens += ev.tokens;
        break;
      }
      case "op-failed": {
        const current = progressItems.slice().reverse().find((i) => i.slug === ev.op.slug && i.kind === "active");
        if (current) {
          current.kind = "error";
          current.label = `✗ ${ev.op.slug}`;
          current.detail = ev.error.slice(0, 120);
        }
        break;
      }
      case "edges-reconciled":
        progressItems.push({
          kind: "done",
          label: "Edges reconciled",
          detail: `+${ev.added}/-${ev.removed}`,
        });
        break;
      case "succeeded":
        progressItems.push({
          kind: "success",
          label: `Done · ${ev.result.pagesCreated} created, ${ev.result.pagesUpdated} updated`,
          detail: `${ev.result.tokensUsed.toLocaleString()} tokens total`,
        });
        runTokens = ev.result.tokensUsed;
        break;
      case "failed":
        progressItems.push({ kind: "error", label: "Failed", detail: ev.error });
        runTokens = ev.tokensUsed;
        break;
    }
  }

  const progressPct = opTotal > 0 ? Math.min(100, Math.round((opIndex / opTotal) * 100)) : stream.status === "running" ? 25 : 100;
  const isRunning = stream.status === "running";
  const isDone = stream.status === "succeeded";
  const isFail = stream.status === "failed";

  const headerAccent = isDone ? "#4ADE80" : isFail ? "#E89090" : "#8CE7D2";
  const headerLabel = isDone ? "Succeeded" : isFail ? "Failed" : "Compiling · live";

  return (
    <div style={{
      ...cardShell,
      border: `1px solid ${isDone ? "rgba(74,222,128,0.35)" : isFail ? "rgba(232,144,144,0.35)" : "rgba(140,231,210,0.35)"}`,
      display: "flex", flexDirection: "column", minHeight: 360,
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 20px", borderBottom: `1px solid ${T.border}`,
        background: isDone ? "rgba(74,222,128,0.06)" : isFail ? "rgba(232,144,144,0.06)" : "rgba(140,231,210,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%",
            background: headerAccent,
            boxShadow: isRunning ? `0 0 12px ${headerAccent}` : "none",
            animation: isRunning ? "pulse 1.5s ease-in-out infinite" : "none",
          }} />
          <span style={{
            fontFamily: T.fontMono, fontSize: 10, fontWeight: 600,
            color: headerAccent, letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            {headerLabel}
          </span>
        </div>
        <span style={{ fontFamily: T.fontMono, fontSize: 11, color: headerAccent }}>
          {elapsedLabel}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {contextLabel || "Progress"}
          </span>
          <span style={{ fontFamily: T.fontMono, fontSize: 11, fontWeight: 500, color: headerAccent }}>
            {progressPct}%
          </span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: "var(--card-hover)", position: "relative", overflow: "hidden" }}>
          <div style={{
            position: "absolute", top: 0, left: 0, height: "100%",
            width: `${progressPct}%`,
            background: `linear-gradient(90deg, ${headerAccent} 0%, ${headerAccent}99 100%)`,
            borderRadius: 2,
            transition: "width 350ms ease-out",
          }} />
        </div>
      </div>

      {/* Stream log */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 20px", flex: 1, overflow: "auto", maxHeight: 420 }}>
        <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Stream
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {progressItems.map((item, i) => <StreamItem key={i} item={item} />)}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px", borderTop: `1px solid ${T.border}`,
        background: "var(--background)",
      }}>
        <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted }}>
          {runTokens.toLocaleString()} tokens
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {isRunning && (
            <button onClick={onCancel} style={ghostBtn}>Cancel</button>
          )}
          {!isRunning && (
            <button onClick={onReset} style={ghostBtn}>Clear</button>
          )}
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
    </div>
  );
}

type ProgressItem = {
  kind: "active" | "done" | "error" | "success";
  label: string;
  detail?: string;
  slug?: string;
};

function StreamItem({ item }: { item: ProgressItem }) {
  const colors = {
    active: { bg: "rgba(140,231,210,0.12)", icon: "#8CE7D2" },
    done:   { bg: "rgba(74,222,128,0.1)", icon: "#4ADE80" },
    error:  { bg: "rgba(232,144,144,0.12)", icon: "#E89090" },
    success:{ bg: "rgba(74,222,128,0.15)", icon: "#4ADE80" },
  }[item.kind];

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <span style={{
        width: 16, height: 16, borderRadius: "50%",
        background: colors.bg,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, marginTop: 1,
      }}>
        {item.kind === "active" ? (
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: colors.icon,
            animation: "pulse 1.5s ease-in-out infinite",
          }} />
        ) : item.kind === "error" ? (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={colors.icon} strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        ) : (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={colors.icon} strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        )}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
        <span style={{
          fontFamily: T.fontBody, fontSize: 12,
          fontWeight: item.kind === "active" ? 500 : 400,
          color: item.kind === "error" ? "#E89090" : T.fg,
          wordBreak: "break-word",
        }}>
          {item.label}
        </span>
        {item.detail && (
          <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted }}>
            {item.detail}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── History ───────────────────────────────────────────────────── */

function HistoryCard({ history, stats }: { history: HistoryRow[]; stats: Props["stats"] }) {
  const [filter, setFilter] = useState<"all" | "succeeded" | "failed">("all");
  const filtered = history.filter((r) => filter === "all" || r.status === filter);

  return (
    <div style={cardShell}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 20px", borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Recent runs
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted }}>
            {stats.totalRuns} total · {stats.weekTokens.toLocaleString()} tokens this week
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["all","succeeded","failed"] as const).map((f) => (
            <button
              key={f} type="button" onClick={() => setFilter(f)}
              style={{
                padding: "4px 10px", borderRadius: 999,
                border: filter === f ? "none" : `1px solid ${T.border}`,
                background: filter === f ? "rgba(140,231,210,0.1)" : "transparent",
                color: filter === f ? "#8CE7D2" : T.muted,
                fontFamily: T.fontBody, fontSize: 11, cursor: "pointer",
              }}
            >
              {f === "all" ? "All" : f === "succeeded" ? "Succeeded" : "Failed"}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{
          padding: "3rem 2rem", textAlign: "center",
          color: T.muted, fontSize: 13, fontFamily: T.fontBody,
        }}>
          No runs yet. Hit Compile above to kick one off.
        </div>
      ) : (
        <>
          <div style={{
            display: "flex", alignItems: "center", gap: 16,
            padding: "10px 20px",
            borderBottom: `1px solid ${T.border}`, background: "var(--card-hover)",
          }}>
            <span style={{ width: 20, flexShrink: 0 }} />
            <span style={{ ...colHeader, flex: 1 }}>Source</span>
            <span style={{ ...colHeader, width: 130 }}>Result</span>
            <span style={{ ...colHeader, width: 90, textAlign: "right" }}>Duration</span>
            <span style={{ ...colHeader, width: 90, textAlign: "right" }}>Tokens</span>
            <span style={{ ...colHeader, width: 90 }}>When</span>
          </div>
          {filtered.map((r) => <HistoryRowView key={r.id} row={r} />)}
        </>
      )}
    </div>
  );
}

function HistoryRowView({ row }: { row: HistoryRow }) {
  const dur = durationLabel(row.startedAt, row.finishedAt);
  const when = relative(row.startedAt);
  const statusColor = row.status === "succeeded" ? "#4ADE80" : row.status === "failed" ? "#E89090" : "#8CE7D2";
  const iconBg = row.status === "succeeded" ? "rgba(74,222,128,0.12)" : row.status === "failed" ? "rgba(232,144,144,0.12)" : "rgba(140,231,210,0.12)";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 16,
      padding: "14px 20px", borderBottom: `1px solid ${T.border}`,
    }}>
      <span style={{
        width: 20, height: 20, borderRadius: "50%", background: iconBg,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        {row.status === "succeeded" ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={statusColor} strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
        ) : row.status === "failed" ? (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={statusColor} strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        ) : (
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, animation: "pulse 1.5s ease-in-out infinite" }} />
        )}
      </span>

      <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: T.fontHeading, fontSize: 13, fontWeight: 500, color: T.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>
            {row.sourceTitle}
          </span>
          <span style={miniPill}>{row.sourceKind}</span>
          {row.sourceTags.slice(0, 2).map((t) => (
            <span key={t} style={{ ...miniPill, background: "rgba(251,167,192,0.08)", color: "#FBA7C0" }}>{t}</span>
          ))}
        </div>
        <span style={{ fontFamily: T.fontBody, fontSize: 11, color: row.status === "failed" ? "#E89090B3" : T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.status === "failed" && row.errorMessage
            ? row.errorMessage
            : `${row.pagesCreated} created · ${row.pagesUpdated} updated · ${row.edgesAdded} edges${row.contradictionsFound ? ` · ${row.contradictionsFound} contradiction${row.contradictionsFound === 1 ? "" : "s"}` : ""}`}
        </span>
      </div>

      <span style={{ width: 130, flexShrink: 0, fontFamily: T.fontMono, fontSize: 11, color: statusColor }}>
        {row.status}
      </span>
      <span style={{ width: 90, flexShrink: 0, textAlign: "right", fontFamily: T.fontMono, fontSize: 11, color: T.fg }}>
        {dur}
      </span>
      <span style={{ width: 90, flexShrink: 0, textAlign: "right", fontFamily: T.fontMono, fontSize: 11, color: T.fg }}>
        {row.tokensUsed.toLocaleString()}
      </span>
      <span style={{ width: 90, flexShrink: 0, fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>
        {when}
      </span>
    </div>
  );
}

/* ── Atoms ─────────────────────────────────────────────────────── */

function Field({
  label, optional, help, trailing, children,
}: {
  label: string; optional?: boolean; help?: string;
  trailing?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{
            fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted,
            letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            {label}{optional && " · optional"}
          </span>
          {help && (
            <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted }}>{help}</span>
          )}
        </div>
        {trailing}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: 10,
  background: "var(--background)", border: `1px solid ${T.border}`,
  color: T.fg, outline: "none", fontFamily: T.fontBody, fontSize: 13,
  boxSizing: "border-box",
};

const cardShell: React.CSSProperties = {
  display: "flex", flexDirection: "column",
  background: T.panel, border: `1px solid ${T.border}`,
  borderRadius: 14, overflow: "clip",
};

const ghostBtn: React.CSSProperties = {
  padding: "5px 12px", borderRadius: 8,
  border: `1px solid ${T.border}`, background: "transparent",
  color: T.fg, fontFamily: T.fontBody, fontSize: 11, cursor: "pointer",
};

const colHeader: React.CSSProperties = {
  fontFamily: T.fontMono, fontSize: 9, fontWeight: 500, color: T.muted,
  letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0,
};

const miniPill: React.CSSProperties = {
  padding: "1px 7px", borderRadius: 4, background: "var(--card-hover)",
  fontFamily: T.fontMono, fontSize: 9, fontWeight: 500,
  color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase",
};

/* ── Helpers ───────────────────────────────────────────────────── */

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs.toString().padStart(2, "0")}s`;
}

function durationLabel(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return "—";
  return formatElapsed(new Date(finishedAt).getTime() - new Date(startedAt).getTime());
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
