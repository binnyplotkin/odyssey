"use client";

/**
 * Prompt editor as an overlay on the ingestion page. It keeps the prompt
 * body as the primary operational surface and lets supporting state recede.
 */

import { type ReactNode, useEffect, useMemo, useState } from "react";

/* ── Tokens ─────────────────────────────────────────────────── */

const MONO = "var(--font-mono, 'JetBrains Mono'), ui-monospace, monospace";
const DISPLAY = "var(--font-display, 'Space Grotesk'), system-ui, sans-serif";
const BODY = "var(--font-body, Inter), system-ui, sans-serif";

const T = {
  bg: "var(--background)",
  panel: "var(--surface-1)",
  card: "var(--material-card)",
  border: "var(--border)",
  divider: "var(--border-subtle)",
  inputBg: "var(--control-bg)",
  inputBorder: "var(--control-border)",
  headerBg: "var(--header-bg, var(--background))",
  headerBorder: "var(--header-border, var(--border-subtle))",
  headerBlur: "var(--header-blur, 18px)",
  fg: "var(--text-primary)",
  text: "var(--text-secondary)",
  muted: "var(--text-tertiary)",
  faded: "var(--text-quaternary)",
  ghost: "var(--text-placeholder)",
  accent: "var(--accent-strong)",
  accentSoft: "var(--accent-soft)",
  accentLine: "var(--accent-border)",
  onAccent: "var(--accent-on)",
};

const PROMPT_OVERLAY_CSS = `
  .ingestion-prompt-editor:focus-within,
  .ingestion-prompt-test-field:focus-within {
    border-color: var(--accent-border) !important;
    box-shadow: var(--ring-shadow-selected);
  }

  .ingestion-prompt-input::placeholder,
  .ingestion-prompt-test-input::placeholder {
    color: var(--text-placeholder);
  }
`;

const MINT_PURPLE = "var(--accent-secondary)"; // secondary dot for model

export type PromptOverlayProps = {
  open: boolean;
  wikiId: string;
  wikiTitle: string;
  promptText: string;
  /** Custom display name for the prompt. Null falls back to "{title} lens." */
  promptName: string | null;
  inheritedFromCharacter: boolean;
  characterName: string;
  onClose: () => void;
  /** Fired after a successful save so the parent can refresh server data. */
  onPromptSaved?: () => void;
};

type SaveState = "idle" | "saving" | "error";

const MAX_PROMPT_NAME_LENGTH = 120;

function defaultPromptName(wikiTitle: string) {
  return `${wikiTitle} lens.`;
}

export function PromptOverlay({
  open,
  wikiId,
  wikiTitle,
  promptText: initialPrompt,
  promptName: initialPromptName,
  inheritedFromCharacter,
  characterName,
  onClose,
  onPromptSaved,
}: PromptOverlayProps) {
  // `savedPrompt` / `savedName` are the baselines we compare against for
  // the dirty indicator. They start as the prop values and advance when
  // a Save round-trips successfully — so the chip can flip back to
  // "saved" without waiting for the parent to refresh.
  const [savedPrompt, setSavedPrompt] = useState(initialPrompt);
  const [draft, setDraft] = useState(initialPrompt);
  const [savedName, setSavedName] = useState<string | null>(initialPromptName);
  const [nameDraft, setNameDraft] = useState<string>(initialPromptName ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!open) return;
    setSavedPrompt(initialPrompt);
    setDraft(initialPrompt);
    setSavedName(initialPromptName);
    setNameDraft(initialPromptName ?? "");
    setSaveState("idle");
    setSaveError("");
  }, [open, initialPrompt, initialPromptName]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    const prevOverflow = document.body.style.overflow;
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const savedTokens = approxTokens(savedPrompt);
  const draftTokens = approxTokens(draft);
  const normalizedNameDraft = nameDraft.trim();
  const normalizedSavedName = savedName?.trim() ?? "";
  const promptDirty = draft !== savedPrompt;
  const nameDirty = normalizedNameDraft !== normalizedSavedName;
  const isDirty = promptDirty || nameDirty;
  const diff = draftTokens - savedTokens;
  const displayName =
    normalizedNameDraft.length > 0
      ? normalizedNameDraft
      : defaultPromptName(wikiTitle);
  const hasCustomName = normalizedNameDraft.length > 0;

  const handleSave = async () => {
    if (!isDirty || saveState === "saving") return;
    setSaveState("saving");
    setSaveError("");
    try {
      const body: { prompt?: string; name?: string | null } = {};
      if (promptDirty) body.prompt = draft;
      if (nameDirty)
        body.name =
          normalizedNameDraft.length === 0 ? null : normalizedNameDraft;

      const res = await fetch(`/api/wiki/${wikiId}/prompt`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      let payload: {
        error?: string;
        prompt?: string;
        name?: string | null;
      } = {};
      try {
        payload = raw ? (JSON.parse(raw) as typeof payload) : {};
      } catch {
        // non-JSON response
      }
      if (!res.ok) {
        setSaveError(
          payload.error ?? `Failed to save prompt (HTTP ${res.status})`,
        );
        setSaveState("error");
        return;
      }
      const nextPrompt = payload.prompt ?? draft;
      const nextName =
        payload.name !== undefined
          ? payload.name
          : nameDirty
            ? normalizedNameDraft.length === 0
              ? null
              : normalizedNameDraft
            : savedName;
      setSavedPrompt(nextPrompt);
      setDraft(nextPrompt);
      setSavedName(nextName);
      setNameDraft(nextName ?? "");
      setSaveState("idle");
      onPromptSaved?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
      setSaveState("error");
    }
  };

  const handleDiscard = () => {
    setDraft(savedPrompt);
    setNameDraft(savedName ?? "");
  };
  const lineCount = useMemo(
    () => Math.max(1, draft.split("\n").length),
    [draft],
  );
  const sectionCount = useMemo(
    () => (draft.match(/^##\s/gm) ?? []).length,
    [draft],
  );
  const variableCount = useMemo(
    () => new Set(draft.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).size,
    [draft],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "var(--modal-backdrop)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(16px, 3vw, 32px)",
      }}
    >
      <style>{PROMPT_OVERLAY_CSS}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          maxWidth: 1640,
          height: "100%",
          maxHeight: 980,
          background: T.panel,
          border: `1px solid ${T.headerBorder}`,
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
          boxShadow: "var(--elevation-panel)",
          fontFamily: BODY,
        }}
      >
        <Topbar
          headlineSummary={displayName}
          isDirty={isDirty}
          saveState={saveState}
          saveError={saveError}
          onDiscard={handleDiscard}
          onSave={handleSave}
          onClose={onClose}
        />
        <div
          style={{
            flex: 1,
            overflow: "auto",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 340px",
            gap: "var(--space-24)",
            padding: "clamp(22px, 3vw, 32px)",
            alignItems: "flex-start",
            background: T.bg,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-18)",
              minWidth: 0,
            }}
          >
            <IdentityStrip
              wikiTitle={wikiTitle}
              tokens={savedTokens}
              inheritedFromCharacter={inheritedFromCharacter}
              characterName={characterName}
              nameDraft={nameDraft}
              setNameDraft={setNameDraft}
              hasCustomName={hasCustomName}
              displayName={displayName}
              nameDirty={nameDirty}
            />
            <EditorCard
              draft={draft}
              setDraft={setDraft}
              lineCount={lineCount}
              tokens={draftTokens}
              diff={diff}
              sections={sectionCount}
              variables={variableCount}
              isDirty={isDirty}
              saveState={saveState}
            />
            <TestPanel wikiId={wikiId} draft={draft} />
          </div>

          <aside
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-16)",
              position: "sticky",
              top: 0,
            }}
          >
            <StateCard
              isDirty={isDirty}
              draftTokens={draftTokens}
              savedTokens={savedTokens}
              diff={diff}
              saveState={saveState}
              saveError={saveError}
            />
            <VariablesCard wikiTitle={wikiTitle} variableCount={variableCount} />
            <RuntimeCard />
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ── Topbar ─────────────────────────────────────────────────── */

function Topbar({
  headlineSummary,
  isDirty,
  saveState,
  saveError,
  onDiscard,
  onSave,
  onClose,
}: {
  headlineSummary: string;
  isDirty: boolean;
  saveState: SaveState;
  saveError: string;
  onDiscard: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const saving = saveState === "saving";
  const errored = saveState === "error";

  const statusLabel = errored
    ? saveError || "save failed"
    : saving
      ? "saving…"
      : isDirty
        ? "unsaved"
        : "saved";
  const statusActive = isDirty || saving || errored;
  const statusColor = errored ? "var(--status-error)" : T.accent;
  const statusBorder = errored
    ? `1px solid color-mix(in srgb, var(--status-error) 36%, transparent)`
    : statusActive
      ? `1px solid ${T.accentLine}`
      : `1px solid ${T.border}`;
  const statusBg = errored
    ? "color-mix(in srgb, var(--status-error) 8%, transparent)"
    : statusActive
      ? T.accentSoft
      : "transparent";
  const statusDot = errored
    ? "var(--status-error)"
    : statusActive
      ? T.accent
      : T.faded;
  const statusText = errored
    ? "var(--status-error)"
    : statusActive
      ? statusColor
      : T.muted;

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-14)",
        padding: "0 16px 0 20px",
        height: 52,
        borderBottom: `1px solid ${T.headerBorder}`,
        background: T.headerBg,
        backdropFilter: `blur(${T.headerBlur})`,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: T.accent,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          color: T.muted,
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        Ingestion Prompt
      </span>
      <span style={{ color: T.faded, fontFamily: MONO, fontSize: "var(--font-size-sm)" }}>/</span>
      <span
        style={{
          color: T.text,
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          maxWidth: 320,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {headlineSummary}
      </span>

      <span style={{ flex: 1 }} />

      {/* Status chip */}
      <div
        title={errored && saveError ? saveError : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-8)",
          padding: "0 12px",
          maxWidth: 320,
          height: 26,
          border: statusBorder,
          background: statusBg,
          borderRadius: "var(--radius-pill)",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: statusDot,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            color: statusText,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 500,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {statusLabel}
        </span>
      </div>

      <GhostButton
        onClick={onDiscard}
        disabled={!isDirty || saving}
        hovered={hovered === "discard"}
        onHover={() => setHovered("discard")}
        onUnhover={() => setHovered(null)}
      >
        Discard
      </GhostButton>
      <PrimaryButton
        onClick={onSave}
        disabled={!isDirty || saving}
        hovered={hovered === "save"}
        onHover={() => setHovered("save")}
        onUnhover={() => setHovered(null)}
      >
        {saving ? "Saving…" : "Save"}
      </PrimaryButton>

      <span style={{ width: 1, height: 20, background: T.headerBorder, margin: "0 4px" }} />
      <button
        type="button"
        onClick={onClose}
        onMouseEnter={() => setHovered("close")}
        onMouseLeave={() => setHovered(null)}
        aria-label="Close prompt editor"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          border: "none",
          borderRadius: "var(--radius-sm)",
          background:
            hovered === "close" ? "var(--sidebar-hover, var(--surface-1))" : "transparent",
          color: hovered === "close" ? T.fg : T.muted,
          fontFamily: MONO,
          fontSize: "var(--font-size-xl)",
          cursor: "pointer",
          transition: "background 150ms, color 150ms",
        }}
      >
        ×
      </button>
    </header>
  );
}

/* ── Identity strip ─────────────────────────────────────────── */

function IdentityStrip({
  wikiTitle,
  tokens,
  inheritedFromCharacter,
  characterName,
  nameDraft,
  setNameDraft,
  hasCustomName,
  displayName,
  nameDirty,
}: {
  wikiTitle: string;
  tokens: number;
  inheritedFromCharacter: boolean;
  characterName: string;
  nameDraft: string;
  setNameDraft: (next: string) => void;
  hasCustomName: boolean;
  displayName: string;
  nameDirty: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const placeholder = defaultPromptName(wikiTitle);

  return (
    <section
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: "var(--space-24)",
        paddingBottom: "var(--space-4)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-12)",
          maxWidth: 760,
          minWidth: 0,
          flex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-14)",
            color: T.muted,
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            fontWeight: 500,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          <span>Lens · {wikiTitle}</span>
          {inheritedFromCharacter && (
            <>
              <span style={{ color: T.ghost }}>·</span>
              <span
                style={{
                  color: T.faded,
                  letterSpacing: "0.12em",
                  textTransform: "none",
                }}
              >
                inherited from {characterName}
              </span>
            </>
          )}
        </div>
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "var(--space-10)",
            position: "relative",
          }}
        >
          <input
            value={nameDraft}
            maxLength={MAX_PROMPT_NAME_LENGTH}
            spellCheck={false}
            onChange={(e) => setNameDraft(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            aria-label="Prompt name"
            style={{
              flex: 1,
              minWidth: 0,
              margin: 0,
              padding: "2px 4px",
              border: "none",
              outline: "none",
              background: "transparent",
              color: hasCustomName ? T.fg : T.muted,
              fontStyle: hasCustomName ? "normal" : "italic",
              fontFamily: DISPLAY,
              fontSize: 30,
              fontWeight: 500,
              lineHeight: "38px",
              letterSpacing: 0,
              borderBottom: `1px solid ${focused ? T.accentLine : hovered || nameDirty ? T.inputBorder : "transparent"}`,
              transition: "border-color 150ms, color 150ms, box-shadow 150ms",
              boxShadow: focused ? "0 1px 0 var(--accent-border)" : "none",
            }}
          />
          {nameDirty && (
            <span
              title="Unsaved name change"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: T.accent,
                flexShrink: 0,
                marginBottom: "var(--space-14)",
              }}
            />
          )}
        </div>
        <p
          style={{
            margin: 0,
            maxWidth: 680,
            color: T.text,
            fontFamily: BODY,
            fontSize: "var(--font-size-md)",
            lineHeight: "20px",
          }}
        >
          {hasCustomName
            ? `Saved as “${displayName}”. Defines how the engine reads source material into wiki pages.`
            : "Defines how the engine reads source material into wiki pages."}
        </p>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 28,
          flexShrink: 0,
        }}
      >
        <StatBlock label="Version" value="v1 · active" />
        <Divider />
        <StatBlock label="Tokens" value={tokens.toLocaleString()} />
      </div>
    </section>
  );
}

/* ── Editor card ───────────────────────────────────────────── */

function EditorCard({
  draft,
  setDraft,
  lineCount,
  tokens,
  diff,
  sections,
  variables,
  isDirty,
  saveState,
}: {
  draft: string;
  setDraft: (s: string) => void;
  lineCount: number;
  tokens: number;
  diff: number;
  sections: number;
  variables: number;
  isDirty: boolean;
  saveState: SaveState;
}) {
  const footerLabel =
    saveState === "saving"
      ? "saving…"
      : saveState === "error"
        ? "save failed"
        : isDirty
          ? "unsaved"
          : "saved";
  const footerDotColor =
    saveState === "error"
      ? "var(--status-error)"
      : isDirty || saveState === "saving"
        ? T.accent
        : T.faded;
  const footerTextColor =
    saveState === "error"
      ? "var(--status-error)"
      : isDirty || saveState === "saving"
        ? T.accent
        : T.muted;
  const dirtyComparison = isDirty || diff !== 0;
  return (
    <div
      className="ingestion-prompt-editor"
      style={{
        display: "flex",
        flexDirection: "column",
        border: `1px solid ${T.inputBorder}`,
        borderRadius: "var(--radius-lg)",
        background: T.inputBg,
        overflow: "hidden",
        transition: "border-color 150ms, box-shadow 150ms",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-14)",
          padding: "12px 18px",
          borderBottom: `1px solid ${T.divider}`,
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ color: T.fg, fontWeight: 500 }}>Prompt body</span>
        <span style={{ color: T.faded }}>·</span>
        <span style={{ color: T.muted }}>Markdown</span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            display: "flex",
            gap: "var(--space-14)",
            color: T.muted,
            letterSpacing: "0.08em",
          }}
        >
          <span>
            {sections} section{sections === 1 ? "" : "s"}
          </span>
          <span style={{ color: T.ghost }}>/</span>
          <span>
            {variables} variable{variables === 1 ? "" : "s"}
          </span>
        </span>
      </div>

      {/* Body */}
      <div style={{ display: "flex", minHeight: 520, position: "relative" }}>
        <pre
          aria-hidden
          style={{
            margin: 0,
            padding: "20px 12px 20px 16px",
            background: "transparent",
            borderRight: `1px solid ${T.divider}`,
            fontFamily: MONO,
            fontSize: "var(--font-size-base)",
            lineHeight: "24px",
            color: T.faded,
            textAlign: "right",
            userSelect: "none",
            minWidth: 50,
          }}
        >
          {Array.from(
            { length: Math.max(24, lineCount) },
            (_, i) => i + 1,
          ).join("\n")}
        </pre>
        <textarea
          className="ingestion-prompt-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          placeholder="Describe the lens. Tone. Structure. What kind of pages should the engine write?"
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            color: T.fg,
            fontFamily: BODY,
            fontSize: "var(--font-size-md)",
            lineHeight: "24px",
            padding: "20px 22px",
            resize: "vertical",
            minHeight: 520,
            whiteSpace: "pre-wrap",
          }}
        />
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 18px",
          borderTop: `1px solid ${T.divider}`,
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          color: T.text,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-18)" }}>
          <span>
            <span style={{ color: T.fg }}>{tokens.toLocaleString()}</span>{" "}
            tokens
            {dirtyComparison && diff !== 0 && (
              <>
                {" · diff "}
                <span style={{ color: T.accent }}>
                  {diff > 0 ? "+" : ""}
                  {diff}
                </span>
                {" from saved"}
              </>
            )}
          </span>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-8)",
            color: footerTextColor,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: footerDotColor,
            }}
          />
          {footerLabel}
        </span>
      </div>
    </div>
  );
}

/* ── Test panel ─────────────────────────────────────────────── */

type TestResult = {
  output: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type TestState = "idle" | "running" | "error";

function TestPanel({ wikiId, draft }: { wikiId: string; draft: string }) {
  const [sample, setSample] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const [state, setState] = useState<TestState>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);

  const canRun =
    sample.trim().length > 0 &&
    draft.trim().length > 0 &&
    state !== "running";

  const handleRun = async () => {
    if (!canRun) return;
    setState("running");
    setError("");
    setResult(null);
    try {
      const res = await fetch(`/api/wiki/${wikiId}/prompt/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: draft, sample }),
      });
      const raw = await res.text();
      let payload: Partial<TestResult> & { error?: string } = {};
      try {
        payload = raw ? (JSON.parse(raw) as typeof payload) : {};
      } catch {
        // non-JSON
      }
      if (!res.ok) {
        setError(payload.error ?? `Run failed (HTTP ${res.status})`);
        setState("error");
        return;
      }
      setResult({
        output: payload.output ?? "",
        model: payload.model ?? "",
        inputTokens: payload.inputTokens ?? 0,
        outputTokens: payload.outputTokens ?? 0,
        totalTokens: payload.totalTokens ?? 0,
      });
      setState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
      setState("error");
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: `1px solid color-mix(in srgb, var(--border) 70%, transparent)`,
        borderRadius: "var(--radius-md)",
        background: T.card,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-10)",
          padding: "12px 18px",
          borderBottom: `1px solid ${T.divider}`,
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
          fontWeight: 500,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ color: T.fg }}>Test prompt</span>
        <span style={{ flex: 1, height: 1, background: T.divider }} />
      </div>

      {/* Body */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-14)",
          padding: "18px 20px",
        }}
      >
        <p
          style={{
            margin: 0,
            color: T.text,
            fontFamily: BODY,
            fontSize: "var(--font-size-md)",
            lineHeight: "20px",
            maxWidth: 720,
          }}
        >
          Preview how the current prompt interprets source material before a
          full ingestion run.
        </p>

        {/* Source lane */}
        <div
          className="ingestion-prompt-test-field"
          style={{
            display: "flex",
            alignItems: "stretch",
            border: `1px solid ${T.inputBorder}`,
            borderRadius: "var(--radius-md)",
            background: T.inputBg,
            overflow: "hidden",
            transition: "border-color 150ms, box-shadow 150ms",
          }}
        >
          <div
            style={{
              width: 90,
              flexShrink: 0,
              padding: "14px 14px",
              borderRight: `1px solid ${T.divider}`,
              background: "transparent",
              color: T.muted,
              fontFamily: MONO,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            Source
          </div>
          <textarea
            className="ingestion-prompt-test-input"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            placeholder="Paste a passage to test..."
            rows={3}
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              color: T.fg,
              fontFamily: BODY,
              fontSize: "var(--font-size-base)",
              lineHeight: "20px",
              padding: "14px 16px",
              resize: "vertical",
            }}
          />
        </div>

        {/* Actions */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-12)",
            paddingTop: "var(--space-4)",
          }}
        >
          <GhostButton
            onClick={() =>
              setSample(
                "22:1 And it came to pass after these things, that God did tempt Abraham, and said unto him, Abraham: and he said, Behold, here I am.\n22:2 And he said, Take now thy son, thine only son Isaac, whom thou lovest, and get thee into the land of Moriah; and offer him there for a burnt offering upon one of the mountains which I will tell thee of.",
              )
            }
            hovered={hovered === "load"}
            onHover={() => setHovered("load")}
            onUnhover={() => setHovered(null)}
          >
            Load sample · §22
          </GhostButton>
          <span style={{ flex: 1 }} />
          <span
            style={{
              color: T.faded,
              fontFamily: MONO,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.06em",
            }}
          >
            claude-sonnet-4-5 · live model call
          </span>
          <button
            type="button"
            onClick={handleRun}
            disabled={!canRun}
            aria-label="Run test"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-8)",
              height: 32,
              padding: "0 16px",
              background: canRun ? T.accent : T.accentSoft,
              border: canRun ? "none" : `1px solid ${T.accentLine}`,
              borderRadius: "var(--radius-sm)",
              color: canRun ? T.onAccent : T.accent,
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              opacity: canRun ? 1 : 0.55,
              cursor: canRun ? "pointer" : "not-allowed",
              transition: "background 150ms, opacity 150ms",
            }}
          >
            {state === "running" ? "▸ Running…" : "▸ Run test"}
          </button>
        </div>

        {/* Result / error */}
        {state === "error" && error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-10)",
              padding: "10px 14px",
              border: `1px solid color-mix(in srgb, var(--status-error) 36%, transparent)`,
              borderRadius: "var(--radius-md)",
              background:
                "color-mix(in srgb, var(--status-error) 8%, transparent)",
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              color: "var(--status-error)",
              letterSpacing: "0.04em",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--status-error)",
              }}
            />
            <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>
              {error}
            </span>
          </div>
        )}

        {result && (
          <TestResultPanel
            result={result}
            onClear={() => setResult(null)}
          />
        )}
      </div>
    </div>
  );
}

function TestResultPanel({
  result,
  onClear,
}: {
  result: TestResult;
  onClear: () => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: `1px solid ${T.border}`,
        borderRadius: "var(--radius-md)",
        background: T.card,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-10)",
          padding: "12px 16px",
          borderBottom: `1px solid ${T.divider}`,
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
          fontWeight: 500,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: T.muted,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: T.accent,
          }}
        />
        <span style={{ color: T.fg }}>Result</span>
        <span style={{ flex: 1, height: 1, background: T.divider }} />
        <span
          style={{
            color: T.faded,
            letterSpacing: "0.06em",
            textTransform: "none",
          }}
        >
          {result.model}
          {result.totalTokens > 0 &&
            ` · ${result.inputTokens}in + ${result.outputTokens}out tok`}
        </span>
        <button
          type="button"
          onClick={onClear}
          onMouseEnter={() => setHovered("clear")}
          onMouseLeave={() => setHovered(null)}
          aria-label="Clear result"
          style={{
            border: "none",
            borderRadius: "var(--radius-sm)",
            background:
              hovered === "clear" ? "var(--sidebar-hover, var(--surface-1))" : "transparent",
            color: hovered === "clear" ? T.fg : T.muted,
            fontFamily: MONO,
            fontSize: "var(--font-size-lg)",
            cursor: "pointer",
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 150ms, color 150ms",
          }}
        >
          ×
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: "16px 18px",
          fontFamily: MONO,
          fontSize: "var(--font-size-base)",
          lineHeight: "20px",
          color: T.fg,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 360,
          overflow: "auto",
        }}
      >
        {result.output || "(empty response)"}
      </pre>
    </div>
  );
}

/* ── Versions card ──────────────────────────────────────────── */

function StateCard({
  isDirty,
  draftTokens,
  savedTokens,
  diff,
  saveState,
  saveError,
}: {
  isDirty: boolean;
  draftTokens: number;
  savedTokens: number;
  diff: number;
  saveState: SaveState;
  saveError: string;
}) {
  const showDraft = isDirty || saveState !== "idle";
  return (
    <Card>
      <CardHeader label="State" />
      {showDraft && (
        <StateRow
          tone="draft"
          title="Draft"
          meta={
            saveState === "saving"
              ? "saving"
              : saveState === "error"
                ? "save failed"
                : "unsaved"
          }
          metaColor={saveState === "error" ? "var(--status-error)" : T.accent}
          dotColor={saveState === "error" ? "var(--status-error)" : T.accent}
          detail={
            <>
              {draftTokens} tok ·{" "}
              <span style={{ color: T.accent }}>
                {diff > 0 ? "+" : ""}
                {diff}
              </span>{" "}
              from saved
            </>
          }
        />
      )}
      <StateRow
        tone="saved"
        title="Saved"
        meta="baseline"
        detail={`${savedTokens} tok`}
        last={saveState !== "error"}
      />
      {saveState === "error" && saveError && (
        <div
          style={{
            padding: "10px 16px",
            color: "var(--status-error)",
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.04em",
            borderTop: `1px solid ${T.divider}`,
            wordBreak: "break-word",
          }}
        >
          ● {saveError}
        </div>
      )}
    </Card>
  );
}

function StateRow({
  tone,
  title,
  meta,
  metaColor,
  dotColor,
  detail,
  last,
}: {
  tone: "saved" | "draft";
  title: string;
  meta: string;
  metaColor?: string;
  dotColor?: string;
  detail: ReactNode;
  last?: boolean;
}) {
  const isDraft = tone === "draft";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        padding: "12px 16px",
        borderLeft: `2px solid ${isDraft ? dotColor ?? T.accent : "transparent"}`,
        background: isDraft ? T.accentSoft : "transparent",
        borderBottom: last ? "none" : `1px solid ${T.divider}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-8)",
          fontFamily: MONO,
          fontSize: "var(--font-size-base)",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: isDraft ? dotColor ?? T.accent : T.muted,
          }}
        />
        <span style={{ color: T.fg, fontWeight: 500 }}>{title}</span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            color: isDraft ? metaColor ?? T.accent : T.faded,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {meta}
        </span>
      </div>
      <div
        style={{
          paddingLeft: "var(--space-14)",
          color: T.text,
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
        }}
      >
        {detail}
      </div>
    </div>
  );
}

/* ── Variables card ─────────────────────────────────────────── */

function VariablesCard({
  wikiTitle,
  variableCount,
}: {
  wikiTitle: string;
  variableCount: number;
}) {
  return (
    <Card>
      <CardHeader
        label="Variables"
        trailing={
          variableCount > 0
            ? `${variableCount} used`
            : "none used"
        }
      />
      <VariableRow token="{{wiki.title}}" value={`"${wikiTitle}"`} />
      <VariableRow token="{{source.title}}" value="per run" />
      <VariableRow token="{{wiki.page_count}}" value="14" last />
    </Card>
  );
}

function VariableRow({
  token,
  value,
  muted,
  last,
}: {
  token: string;
  value: string;
  muted?: boolean;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: 40,
        borderBottom: last ? "none" : `1px solid ${T.divider}`,
        opacity: muted ? 0.55 : 1,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: muted ? T.faded : T.accent,
          margin: "0 12px 0 16px",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          flex: 1,
          color: muted ? T.muted : T.accent,
          fontFamily: MONO,
          fontSize: "var(--font-size-base)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {token}
      </span>
      <span
        style={{
          color: muted ? T.faded : T.text,
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          paddingRight: "var(--space-16)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ── Runtime card ───────────────────────────────────────────── */

function RuntimeCard() {
  // Only surfaces values that are actually wired into the pipeline today.
  // Temperature / chunk size / contradiction handling will surface here
  // once they're persisted per-wiki and read by the ingest pipeline.
  return (
    <Card>
      <CardHeader label="Runtime" trailing="defaults" />
      <RuntimeRow
        label="model"
        value={
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-8)",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: MINT_PURPLE,
              }}
            />
            <span style={{ color: T.fg }}>claude-sonnet-4-5</span>
          </span>
        }
      />
      <RuntimeRow label="max output tokens" value="4,096" last />
    </Card>
  );
}

function RuntimeRow({
  label,
  value,
  last,
}: {
  label: string;
  value: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: 40,
        padding: "0 16px",
        borderBottom: last ? "none" : `1px solid ${T.divider}`,
      }}
    >
      <span
        style={{
          flex: 1,
          color: T.text,
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
        }}
      >
        {label}
      </span>
      <span style={{ color: T.fg, fontFamily: MONO, fontSize: "var(--font-size-base)" }}>
        {value}
      </span>
    </div>
  );
}

/* ── Atoms ──────────────────────────────────────────────────── */

function Card({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: `1px solid color-mix(in srgb, var(--border) 70%, transparent)`,
        borderRadius: "var(--radius-md)",
        background: T.card,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({
  label,
  trailing,
}: {
  label: string;
  trailing?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-10)",
        padding: "14px 16px 12px 16px",
        borderBottom: `1px solid ${T.divider}`,
        fontFamily: MONO,
        fontSize: "var(--font-size-xs)",
        fontWeight: 500,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: T.muted,
      }}
    >
      <span>{label}</span>
      <span style={{ flex: 1, height: 1, background: T.divider }} />
      {trailing && (
        <span
          style={{
            color: T.faded,
            letterSpacing: "0.06em",
            textTransform: "none",
          }}
        >
          {trailing}
        </span>
      )}
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <span
        style={{
          color: T.muted,
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span style={{ color: T.fg, fontFamily: MONO, fontSize: "var(--font-size-md)" }}>
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return (
    <span style={{ width: 1, height: 32, background: T.border }} />
  );
}

function PrimaryButton({
  onClick,
  disabled,
  hovered,
  onHover,
  onUnhover,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  hovered?: boolean;
  onHover?: () => void;
  onUnhover?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={onHover}
      onMouseLeave={onUnhover}
      style={{
        display: "flex",
        alignItems: "center",
        height: 30,
        padding: "0 14px",
        background: disabled ? T.accentSoft : T.accent,
        color: disabled ? T.accent : T.onAccent,
        border: disabled ? `1px solid ${T.accentLine}` : "none",
        borderRadius: "var(--radius-sm)",
        fontFamily: MONO,
        fontSize: "var(--font-size-sm)",
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : hovered ? 0.92 : 1,
        transition: "opacity 150ms, background 150ms",
      }}
    >
      {children}
    </button>
  );
}

function GhostButton({
  onClick,
  disabled,
  hovered,
  onHover,
  onUnhover,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  hovered?: boolean;
  onHover?: () => void;
  onUnhover?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={onHover}
      onMouseLeave={onUnhover}
      style={{
        display: "flex",
        alignItems: "center",
        height: 30,
        padding: "0 14px",
        background: hovered && !disabled ? "var(--sidebar-hover, var(--surface-1))" : "transparent",
        color: disabled ? T.faded : T.text,
        border: `1px solid ${disabled ? T.divider : T.border}`,
        borderRadius: "var(--radius-sm)",
        fontFamily: MONO,
        fontSize: "var(--font-size-sm)",
        fontWeight: 500,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 150ms, border-color 150ms",
      }}
    >
      {children}
    </button>
  );
}

/* ── Approx tokens (≈ 4 chars / token) ─────────────────────── */

function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}
