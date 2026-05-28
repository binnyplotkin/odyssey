"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import type { IngestionEvent, ModelId } from "@odyssey/wiki-ingest";
import {
  classifySource,
  previewPurgeIngestionRun,
  purgeIngestionRun,
  updateCharacterIngestionPrompt,
} from "@/app/(authenticated)/characters/actions";
import { PurgeConfirmModal, type PurgePreview } from "./purge-confirm-modal";

/* ── Tokens ────────────────────────────────────────────────────── */

const T = {
  fg: "var(--foreground)",
  muted: "var(--text-tertiary)",
  panel: "var(--surface-1)",
  border: "var(--border)",
  cardHover: "var(--surface-hover)",
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
  ingestionPrompt: string | null;
  history: HistoryRow[];
  stats: { totalRuns: number; weekRuns: number; weekTokens: number };
};

type IngestionTab = "prompt" | "data";

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
  ingestionPrompt,
  history,
  stats,
}: Props) {
  const router = useRouter();

  const hasIngestionPrompt = !!ingestionPrompt?.trim();
  const [tab, setTab] = useState<IngestionTab>(hasIngestionPrompt ? "data" : "prompt");

  const [kind, setKind] = useState<SourceKind>("primary");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [content, setContent] = useState("");
  const [model, setModel] = useState<ModelId>("claude-sonnet-4-5");

  const [stream, setStream] = useState<StreamState>(INITIAL_STREAM);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-classification: fires on paste when the form is pristine. The user
  // can always regenerate or edit the result.
  const [classifying, setClassifying] = useState(false);
  const [classifiedBy, setClassifiedBy] = useState<"ai" | null>(null);
  const [classifyError, setClassifyError] = useState<string | null>(null);
  // Progressive disclosure: the detail fields (kind/title/tags) only render
  // after the classifier succeeds OR the user opts into manual fill. Keeps
  // the starting state to just a single input.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Fresh ref → lets us cancel stale responses if the user pastes twice fast.
  const classifyGenRef = useRef(0);

  const runClassify = useCallback(
    async (text: string, mode: "auto" | "regenerate") => {
      const body = text.trim();
      if (body.length < 80) return;
      const gen = ++classifyGenRef.current;
      setClassifying(true);
      setClassifyError(null);
      try {
        const res = await classifySource(characterId, body);
        if (gen !== classifyGenRef.current) return; // superseded
        if (!res.ok) {
          setClassifyError(res.error);
          return;
        }
        if (!res.data) return;
        // On auto-fire, only fill pristine fields; regenerate overwrites.
        if (mode === "regenerate" || !title.trim()) setTitle(res.data.title);
        if (mode === "regenerate" || tags.length === 0) setTags(res.data.tags);
        setKind(res.data.kind);
        setClassifiedBy("ai");
        setDetailsOpen(true);
      } catch (err) {
        if (gen !== classifyGenRef.current) return;
        setClassifyError(err instanceof Error ? err.message : String(err));
      } finally {
        if (gen === classifyGenRef.current) setClassifying(false);
      }
    },
    [characterId, title, tags],
  );

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
    setClassifiedBy(null);
    setClassifyError(null);
    setDetailsOpen(false);
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
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-20)" }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>

      {/* Tab toggle: Prompt ↔ Data */}
      <IngestionTabToggle tab={tab} setTab={setTab} hasPrompt={hasIngestionPrompt} />

      {/* Prompt tab */}
      <div style={{ display: tab === "prompt" ? "block" : "none" }}>
        <IngestionPromptEditor characterId={characterId} initialValue={ingestionPrompt} />
      </div>

      {/* Data tab */}
      <div
        style={{
          display: tab === "data" ? "flex" : "none",
          flexDirection: "column",
          gap: "var(--space-20)",
        }}
      >
        {/* Missing-prompt warning */}
        {!hasIngestionPrompt && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: "var(--space-10)",
            padding: "12px 16px", borderRadius: "var(--radius-xl)",
            background: "color-mix(in srgb, var(--status-draft) 6%, transparent)",
            border: "1px solid color-mix(in srgb, var(--status-draft) 24%, transparent)",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--status-draft)" strokeWidth="2" strokeLinecap="round" style={{ marginTop: "var(--space-1)", flexShrink: 0 }}>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", flex: 1 }}>
              <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-md)", fontWeight: 500, color: T.fg }}>
                No ingestion prompt set
              </span>
              <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted, lineHeight: "18px" }}>
                This character has no domain-awareness steering. Ingestion will run, but the LLM won&apos;t know what tradition the source comes from.{" "}
                <button
                  type="button"
                  onClick={() => setTab("prompt")}
                  style={{
                    background: "none", border: "none", padding: 0,
                    color: "var(--accent-strong)", cursor: "pointer", font: "inherit",
                  }}
                >
                  Set a prompt →
                </button>
              </span>
            </div>
          </div>
        )}

        {/* Top row: form + active run side-by-side */}
        <div style={{ display: "flex", flexDirection: "row", gap: "var(--space-20)" }}>
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
              classifying={classifying}
              classifiedBy={classifiedBy}
              classifyError={classifyError}
              onClassify={runClassify}
              detailsOpen={detailsOpen}
              onOpenDetails={() => setDetailsOpen(true)}
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
        <HistoryCard history={history} stats={stats} characterId={characterId} />
      </div>
    </div>
  );
}

/* ── Tab toggle ────────────────────────────────────────────────── */

function IngestionTabToggle({
  tab, setTab, hasPrompt,
}: {
  tab: IngestionTab;
  setTab: (t: IngestionTab) => void;
  hasPrompt: boolean;
}) {
  const TABS: { value: IngestionTab; label: string }[] = [
    { value: "prompt", label: "Prompt" },
    { value: "data", label: "Data" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Ingestion view"
      style={{
        display: "inline-flex", padding: "var(--space-2)", borderRadius: "var(--radius-md)",
        border: `1px solid ${T.border}`, background: "var(--control-bg)",
        alignSelf: "flex-start",
      }}
    >
      {TABS.map((t) => {
        const active = tab === t.value;
        const showWarn = t.value === "prompt" && !hasPrompt;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setTab(t.value)}
            style={{
              padding: "5px 14px",
              fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 600,
              letterSpacing: "0.1em", textTransform: "uppercase",
              color: active ? T.fg : T.muted,
              background: active ? "var(--accent-soft)" : "transparent",
              border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: "var(--space-6)",
            }}
          >
            {t.label}
            {showWarn && (
              <span
                aria-hidden
                style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "var(--status-draft)",
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Ingestion prompt editor ───────────────────────────────────── */

function IngestionPromptEditor({
  characterId, initialValue,
}: {
  characterId: string;
  initialValue: string | null;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [saved, setSaved] = useState<string>(initialValue ?? "");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const dirty = value !== saved;
  const charCount = value.length;
  const tokenEst = Math.ceil(value.length / 4);

  function save() {
    setError(null);
    start(async () => {
      const res = await updateCharacterIngestionPrompt(characterId, value);
      if (res.ok) {
        setSaved(value);
        setSavedAt(new Date());
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div style={cardShell}>
      <div style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        padding: "14px 20px", borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: "var(--space-6)",
            padding: "4px 10px", borderRadius: "var(--radius-button, 12px)",
            background: "var(--accent-soft)", border: "1px solid var(--border-active)",
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent-strong)" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 600, color: "var(--accent-strong)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Ingestion Prompt
            </span>
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted }}>
            The single domain knob — injected into every compile run.
          </span>
        </div>
      </div>

      <div style={{
        padding: "12px 20px", background: "color-mix(in srgb, var(--accent-strong) 5%, transparent)",
        borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "flex-start", gap: "var(--space-10)",
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-strong)" strokeWidth="2" strokeLinecap="round" style={{ marginTop: "var(--space-1)", flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted, lineHeight: "18px" }}>
          The engine is domain-agnostic. Pages, edges, eras, source kinds — all generic. This prompt is where you teach the LLM what tradition this character belongs to and how to treat its sources.
        </span>
      </div>

      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={18}
        placeholder="e.g. You are compiling source material into <Name>'s knowledge graph. <Name> is … Treat … as primary. Treat … as commentary. Always link … Voice: …"
        style={{
          width: "100%", border: "none", outline: "none", resize: "vertical",
          padding: "18px 22px", background: "var(--background)",
          fontFamily: T.fontMono, fontSize: "var(--font-size-md)", color: T.fg, lineHeight: "21px",
          minHeight: 320, boxSizing: "border-box",
        }}
      />

      {error && (
        <div style={{
          padding: "10px 20px", borderTop: `1px solid ${T.border}`,
          background: "color-mix(in srgb, var(--status-error) 8%, transparent)",
          color: "var(--status-error)", fontFamily: T.fontBody, fontSize: "var(--font-size-md)",
        }}>
          {error}
        </div>
      )}

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px", borderTop: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)" }}>
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted, letterSpacing: "0.05em" }}>
            {charCount.toLocaleString()} chars · ~{tokenEst.toLocaleString()} tokens
          </span>
          {!dirty && savedAt && (
            <span style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--status-live)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--status-live)" }} />
              Saved {relativeShort(savedAt)}
            </span>
          )}
          {dirty && (
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--status-draft)" }}>
              Unsaved changes
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          {dirty && (
            <button
              type="button"
              onClick={() => { setValue(saved); setError(null); }}
              style={ghostBtn}
            >
              Discard
            </button>
          )}
          <button
            type="button"
            disabled={!dirty || pending}
            onClick={save}
            style={{
              padding: "6px 16px", borderRadius: "var(--radius-md)", border: "none",
              background: T.accent, color: "var(--background)",
              fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 600,
              cursor: !dirty || pending ? "not-allowed" : "pointer",
              opacity: !dirty || pending ? 0.5 : 1,
            }}
          >
            {pending ? "Saving…" : "Save prompt"}
          </button>
        </div>
      </div>
    </div>
  );
}

function relativeShort(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleString();
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
  classifying: boolean;
  classifiedBy: "ai" | null;
  classifyError: string | null;
  onClassify: (text: string, mode: "auto" | "regenerate") => void;
  detailsOpen: boolean;
  onOpenDetails: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-fire the classifier on paste — but only when the form is still
  // pristine (no title, no tags). We read the textarea value *after* the
  // default paste lands so we classify the full text, not a stale slice.
  function handlePaste() {
    if (p.classifying) return;
    if (p.title.trim() || p.tags.length > 0) return;
    requestAnimationFrame(() => {
      const text = textareaRef.current?.value ?? "";
      if (text.trim().length >= 500) p.onClassify(text, "auto");
    });
  }

  return (
    <div style={cardShell}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 20px", borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            New Source
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted }}>
            Paste your text — we&apos;ll auto-fill the title, kind, and tags.
          </span>
        </div>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}>
          ~30s – 3min
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-16)", padding: "18px 20px 20px 20px" }}>
        {/* Content — always visible, always first. */}
        <Field
          label="Content"
          trailing={
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
              {p.classifying && (
                <span style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--accent-strong)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent-strong)", animation: "pulse 1.5s ease-in-out infinite" }} />
                  Analyzing…
                </span>
              )}
              {!p.classifying && p.classifiedBy === "ai" && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-6)", fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--accent-strong)" }}>
                  <SparkIcon />
                  AI-filled
                  <button
                    type="button"
                    onClick={() => p.onClassify(p.content, "regenerate")}
                    disabled={p.classifying || p.content.trim().length < 80}
                    style={{
                      marginLeft: "var(--space-4)", padding: 0, border: "none", background: "transparent",
                      color: "var(--accent-strong)", textDecoration: "underline", cursor: "pointer",
                      fontFamily: "inherit", fontSize: "inherit",
                    }}
                  >
                    regenerate
                  </button>
                </span>
              )}
              {!p.classifying && p.classifiedBy !== "ai" && p.content.trim().length >= 500 && (
                <button
                  type="button"
                  onClick={() => p.onClassify(p.content, "regenerate")}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "var(--space-5)",
                    padding: "3px 9px", borderRadius: "var(--radius-button, 12px)",
                    border: "1px solid var(--border-active)", background: "var(--accent-soft)",
                    color: "var(--accent-strong)", fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", cursor: "pointer",
                  }}
                >
                  <SparkIcon />
                  Auto-fill
                </button>
              )}
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}>
                {p.wordCount.toLocaleString()} words · {p.kbSize} kb
              </span>
            </div>
          }
        >
          <textarea
            ref={textareaRef}
            value={p.content}
            onChange={(e) => p.setContent(e.target.value)}
            onPaste={handlePaste}
            rows={14}
            placeholder="Paste the full source text here. Markdown, plain prose, verse-numbered scripture — whatever the LLM should draw on."
            style={{
              ...inputStyle, resize: "vertical",
              fontFamily: T.fontMono, fontSize: "var(--font-size-base)", lineHeight: "20px",
              minHeight: 220,
            }}
          />
          {p.classifyError && (
            <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: "var(--status-error)", marginTop: "var(--space-4)" }}>
              Auto-fill failed: {p.classifyError}
            </span>
          )}
          {/* Manual escape hatch when content is too short (or the user just
              wants to skip the AI round-trip). Hidden once details open. */}
          {!p.detailsOpen && !p.classifying && (
            <button
              type="button"
              onClick={p.onOpenDetails}
              style={{
                alignSelf: "flex-start", marginTop: "var(--space-6)",
                padding: 0, border: "none", background: "transparent",
                color: T.muted, fontFamily: T.fontBody, fontSize: "var(--font-size-sm)",
                cursor: "pointer", textDecoration: "underline",
              }}
            >
              Fill in details manually →
            </button>
          )}
        </Field>

        {/* Details — kind, title, tags. Revealed after the classifier runs
            or the user opts in manually via the link above. */}
        {p.detailsOpen && (
          <>
            <Field label="Source kind">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => p.setKind(k.value)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "var(--space-6)",
                      padding: "6px 12px", borderRadius: "var(--radius-button, 12px)",
                      border: `1px solid ${p.kind === k.value ? "var(--border-active)" : T.border}`,
                      background: p.kind === k.value ? "var(--accent-soft)" : "transparent",
                      color: p.kind === k.value ? "var(--accent-strong)" : T.muted,
                      fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 500, cursor: "pointer",
                    }}
                  >
                    {p.kind === k.value && (
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent-strong)" }} />
                    )}
                    {k.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Title">
              <input
                type="text"
                value={p.title}
                onChange={(e) => p.setTitle(e.target.value)}
                placeholder="e.g. Genesis 22 — The Binding of Isaac"
                style={inputStyle}
              />
            </Field>

            <Field label="Tags" optional help="Domain labels — searchable, no engine behaviour.">
              <div style={{
                display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-6)",
                padding: "8px 12px", borderRadius: "var(--radius-lg)",
                background: "var(--background)", border: `1px solid ${T.border}`,
                minHeight: 42,
              }}>
                {p.tags.map((t) => (
                  <span key={t} style={{
                    display: "inline-flex", alignItems: "center", gap: "var(--space-6)",
                    padding: "2px 8px 2px 10px", borderRadius: "var(--radius-button, 12px)",
                    background: "color-mix(in srgb, var(--event-violet) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--event-violet) 24%, transparent)",
                  }}>
                    <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: "var(--event-violet)" }}>{t}</span>
                    <button
                      type="button" onClick={() => p.removeTag(t)}
                      aria-label={`remove ${t}`}
                      style={{ border: "none", background: "transparent", color: "var(--event-violet)", cursor: "pointer", padding: 0, display: "flex" }}
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
                    fontFamily: T.fontBody, fontSize: "var(--font-size-base)",
                  }}
                />
              </div>
            </Field>
          </>
        )}

        {/* Footer actions */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: "var(--space-6)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
            <label style={{
              display: "flex", alignItems: "center", gap: "var(--space-6)",
              fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted,
            }}>
              Model
              <select
                value={p.model}
                onChange={(e) => p.setModel(e.target.value as ModelId)}
                style={{
                  padding: "5px 8px", borderRadius: "var(--radius-sm)",
                  border: `1px solid ${T.border}`, background: "var(--background)",
                  color: T.fg, fontSize: "var(--font-size-sm)", outline: "none", cursor: "pointer",
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
              padding: "8px 18px", borderRadius: "var(--radius-lg)", border: "none",
              background: p.canCompile ? "var(--emissive-mint)" : "var(--surface-hover)",
              color: p.canCompile ? "#07100E" : T.muted,
              fontFamily: T.fontBody, fontSize: "var(--font-size-md)", fontWeight: 600,
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
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)", alignItems: "center", maxWidth: 320 }}>
        <div style={{
          width: 48, height: 48, borderRadius: "50%",
          background: T.cardHover, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>
        <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-md)", fontWeight: 500, color: T.fg }}>
          No active run
        </span>
        <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted, lineHeight: 1.55 }}>
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
          label: `Loaded knowledge graph · ${ev.pageCount} nodes, ${ev.edgeCount} edges`,
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

  const headerAccent = isDone ? "var(--status-live)" : isFail ? "var(--status-error)" : "var(--accent-strong)";
  const headerLabel = isDone ? "Succeeded" : isFail ? "Failed" : "Compiling · live";

  return (
    <div className="odyssey-log-panel" style={{
      ...cardShell,
      border: `1px solid ${isDone ? "color-mix(in srgb, var(--status-live) 34%, transparent)" : isFail ? "color-mix(in srgb, var(--status-error) 34%, transparent)" : "var(--border-active)"}`,
      display: "flex", flexDirection: "column", minHeight: 360,
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 20px", borderBottom: `1px solid ${T.border}`,
        background: isDone ? "color-mix(in srgb, var(--status-live) 6%, transparent)" : isFail ? "var(--critical-wash)" : "color-mix(in srgb, var(--accent-strong) 6%, transparent)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%",
            background: headerAccent,
            boxShadow: isRunning ? `0 0 12px ${headerAccent}` : "none",
            animation: isRunning ? "pulse 1.5s ease-in-out infinite" : "none",
          }} />
          <span style={{
            fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 600,
            color: headerAccent, letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            {headerLabel}
          </span>
        </div>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: headerAccent }}>
          {elapsedLabel}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-8)" }}>
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {contextLabel || "Progress"}
          </span>
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", fontWeight: 500, color: headerAccent }}>
            {progressPct}%
          </span>
        </div>
        <div style={{ height: 4, borderRadius: "var(--radius-2xs)", background: "var(--surface-hover)", position: "relative", overflow: "hidden" }}>
          <div style={{
            position: "absolute", top: 0, left: 0, height: "100%",
            width: `${progressPct}%`,
            background: `linear-gradient(90deg, ${headerAccent} 0%, ${headerAccent}99 100%)`,
            borderRadius: "var(--radius-2xs)",
            transition: "width 350ms ease-out",
          }} />
        </div>
      </div>

      {/* Stream log */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)", padding: "14px 20px", flex: 1, overflow: "auto", maxHeight: 420 }}>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Stream
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          {progressItems.map((item, i) => <StreamItem key={i} item={item} />)}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px", borderTop: `1px solid ${T.border}`,
        background: "var(--background)",
      }}>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}>
          {runTokens.toLocaleString()} tokens
        </span>
        <div style={{ display: "flex", gap: "var(--space-8)" }}>
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
    active: { bg: "color-mix(in srgb, var(--accent-strong) 12%, transparent)", icon: "var(--accent-strong)" },
    done:   { bg: "color-mix(in srgb, var(--status-live) 10%, transparent)", icon: "var(--status-live)" },
    error:  { bg: "color-mix(in srgb, var(--status-error) 12%, transparent)", icon: "var(--status-error)" },
    success:{ bg: "color-mix(in srgb, var(--status-live) 15%, transparent)", icon: "var(--status-live)" },
  }[item.kind];

  return (
    <div className="odyssey-stream-row" style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-10)" }}>
      <span style={{
        width: 16, height: 16, borderRadius: "50%",
        background: colors.bg,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, marginTop: "var(--space-1)",
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
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", flex: 1, minWidth: 0 }}>
        <span style={{
          fontFamily: T.fontBody, fontSize: "var(--font-size-base)",
          fontWeight: item.kind === "active" ? 500 : 400,
          color: item.kind === "error" ? "var(--status-error)" : T.fg,
          wordBreak: "break-word",
        }}>
          {item.label}
        </span>
        {item.detail && (
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}>
            {item.detail}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── History ───────────────────────────────────────────────────── */

function HistoryCard({
  history, stats, characterId,
}: { history: HistoryRow[]; stats: Props["stats"]; characterId: string }) {
  const [filter, setFilter] = useState<"all" | "succeeded" | "failed">("all");
  const filtered = history.filter((r) => filter === "all" || r.status === filter);

  return (
    <div style={cardShell}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 20px", borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Recent runs
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted }}>
            {stats.totalRuns} total · {stats.weekTokens.toLocaleString()} tokens this week
          </span>
        </div>
        <div style={{ display: "flex", gap: "var(--space-6)" }}>
          {(["all","succeeded","failed"] as const).map((f) => (
            <button
              key={f} type="button" onClick={() => setFilter(f)}
              style={{
                padding: "4px 10px", borderRadius: "var(--radius-button, 12px)",
                border: filter === f ? "none" : `1px solid ${T.border}`,
                background: filter === f ? "var(--accent-soft)" : "transparent",
                color: filter === f ? "var(--accent-strong)" : T.muted,
                fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", cursor: "pointer",
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
          color: T.muted, fontSize: "var(--font-size-md)", fontFamily: T.fontBody,
        }}>
          No runs yet. Hit Compile above to kick one off.
        </div>
      ) : (
        <>
          <div style={{
            display: "flex", alignItems: "center", gap: "var(--space-16)",
            padding: "10px 20px",
            borderBottom: `1px solid ${T.border}`, background: "var(--surface-hover)",
          }}>
            <span style={{ width: 20, flexShrink: 0 }} />
            <span style={{ ...colHeader, flex: 1 }}>Source</span>
            <span style={{ ...colHeader, width: 130 }}>Result</span>
            <span style={{ ...colHeader, width: 90, textAlign: "right" }}>Duration</span>
            <span style={{ ...colHeader, width: 90, textAlign: "right" }}>Tokens</span>
            <span style={{ ...colHeader, width: 90 }}>When</span>
            <span style={{ width: 60, flexShrink: 0 }} />
          </div>
          {filtered.map((r) => <HistoryRowView key={r.id} row={r} characterId={characterId} />)}
        </>
      )}
    </div>
  );
}

function HistoryRowView({ row, characterId }: { row: HistoryRow; characterId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dur = durationLabel(row.startedAt, row.finishedAt);
  const when = relative(row.startedAt);
  const statusColor = row.status === "succeeded" ? "var(--status-live)" : row.status === "failed" ? "var(--status-error)" : "var(--accent-strong)";
  const iconBg = row.status === "succeeded"
    ? "color-mix(in srgb, var(--status-live) 12%, transparent)"
    : row.status === "failed"
      ? "color-mix(in srgb, var(--status-error) 12%, transparent)"
      : "color-mix(in srgb, var(--accent-strong) 12%, transparent)";

  function openPurge() {
    setError(null);
    setPreview(null);
    setOpen(true);
    setPreviewLoading(true);
    void previewPurgeIngestionRun(characterId, row.id).then((res) => {
      setPreviewLoading(false);
      if (res.ok && res.data) setPreview(res.data);
      else if (!res.ok) setError(res.error);
    });
  }

  function confirmPurge() {
    setError(null);
    start(async () => {
      const res = await purgeIngestionRun(characterId, row.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "var(--space-16)",
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

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flexWrap: "wrap" }}>
          <span style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-md)", fontWeight: 500, color: T.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>
            {row.sourceTitle}
          </span>
          <span style={miniPill}>{row.sourceKind}</span>
          {row.sourceTags.slice(0, 2).map((t) => (
            <span key={t} style={{ ...miniPill, background: "color-mix(in srgb, var(--event-violet) 8%, transparent)", color: "var(--event-violet)" }}>{t}</span>
          ))}
        </div>
        <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: row.status === "failed" ? "color-mix(in srgb, var(--status-error) 70%, transparent)" : T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.status === "failed" && row.errorMessage
            ? row.errorMessage
            : `${row.pagesCreated} created · ${row.pagesUpdated} updated · ${row.edgesAdded} edges${row.contradictionsFound ? ` · ${row.contradictionsFound} contradiction${row.contradictionsFound === 1 ? "" : "s"}` : ""}`}
        </span>
      </div>

      <span style={{ width: 130, flexShrink: 0, fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: statusColor }}>
        {row.status}
      </span>
      <span style={{ width: 90, flexShrink: 0, textAlign: "right", fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: T.fg }}>
        {dur}
      </span>
      <span style={{ width: 90, flexShrink: 0, textAlign: "right", fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: T.fg }}>
        {row.tokensUsed.toLocaleString()}
      </span>
      <span style={{ width: 90, flexShrink: 0, fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted }}>
        {when}
      </span>
      <span style={{ width: 60, flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={openPurge}
          disabled={pending}
          title="Purge this run + its source + orphan pages"
          style={{
            padding: "4px 10px", borderRadius: "var(--radius-sm)",
            border: "1px solid color-mix(in srgb, var(--status-error) 22%, transparent)",
            background: "transparent", color: "var(--status-error)",
            fontFamily: T.fontBody, fontSize: 10.5,
            cursor: pending ? "not-allowed" : "pointer",
            opacity: pending ? 0.5 : 1,
          }}
        >
          {pending ? "…" : "Purge"}
        </button>
      </span>
      <PurgeConfirmModal
        open={open}
        kind="run"
        preview={preview}
        loading={previewLoading}
        pending={pending}
        error={error}
        onCancel={() => { if (!pending) setOpen(false); }}
        onConfirm={confirmPurge}
      />
    </div>
  );
}

/* ── Atoms ─────────────────────────────────────────────────────── */

function SparkIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
    </svg>
  );
}

function Field({
  label, optional, help, trailing, children,
}: {
  label: string; optional?: boolean; help?: string;
  trailing?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-8)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-8)" }}>
          <span style={{
            fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500, color: T.muted,
            letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            {label}{optional && " · optional"}
          </span>
          {help && (
            <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted }}>{help}</span>
          )}
        </div>
        {trailing}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: "var(--radius-button, 12px)",
  background: "var(--control-bg)", border: "1px solid var(--control-border)",
  color: T.fg, outline: "none", fontFamily: T.fontBody, fontSize: "var(--font-size-md)",
  boxSizing: "border-box",
};

const cardShell: React.CSSProperties = {
  display: "flex", flexDirection: "column",
  background: "var(--material-card, var(--surface-1))",
  border: "1px solid var(--border-subtle, var(--border))",
  borderRadius: "var(--radius-card, 18px)",
  boxShadow: "var(--elevation-card)",
  overflow: "clip",
};

const ghostBtn: React.CSSProperties = {
  padding: "5px 12px", borderRadius: "var(--radius-button, 12px)",
  border: "1px solid var(--control-border)", background: "var(--control-bg)",
  color: T.fg, fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", cursor: "pointer",
};

const colHeader: React.CSSProperties = {
  fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", fontWeight: 500, color: T.muted,
  letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0,
};

const miniPill: React.CSSProperties = {
  padding: "1px 7px", borderRadius: "var(--radius-xs)", background: "var(--surface-hover)",
  fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", fontWeight: 500,
  color: "var(--text-tertiary)", letterSpacing: "0.06em", textTransform: "uppercase",
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
