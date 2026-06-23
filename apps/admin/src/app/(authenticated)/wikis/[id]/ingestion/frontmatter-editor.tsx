"use client";

import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

const FONT_BODY = "var(--font-body, Inter), system-ui, sans-serif";
const FONT_MONO =
  "var(--font-mono, 'JetBrains Mono'), ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";
const DANGER = "var(--status-error)";
const ACTIVE_RING =
  "0 0 0 3px color-mix(in srgb, var(--accent-strong) 22%, transparent)";

const FRONTMATTER_CSS = `
  .ingestion-frontmatter-input::placeholder {
    color: var(--text-placeholder);
  }

  .ingestion-frontmatter-input:focus {
    border-color: var(--accent-border) !important;
    box-shadow: var(--ring-shadow-selected);
  }
`;

const COMMON_FRONTMATTER_KEYS = [
  "title",
  "book",
  "chapter",
  "verses",
  "source_type",
  "passage_type",
  "canonicality",
  "character_focus",
  "chronological_order",
  "time_period",
  "location",
  "participants",
  "speaker",
  "knowledge_accessible",
  "themes",
  "relationships",
  "emotions",
  "confidence",
] as const;

const LIST_KEYS = new Set([
  "character_focus",
  "location",
  "participants",
  "speaker",
  "themes",
  "emotions",
]);

const EXAMPLE_FRONTMATTER = [
  "title: Genesis 11:27–32 — Sarah's Introduction",
  "book: Genesis",
  "chapter: 11",
  'verses: "27-32"',
  "",
  "source_type: primary",
  "canonicality: biblical",
  "",
  "character_focus:",
  "  - Sarah",
  "",
  "chronological_order: 1",
  "",
  "time_period: Sarah's lifetime",
  "",
  "location:",
  "  - Ur of the Chaldeans",
  "  - Haran",
  "",
  "participants:",
  "  - Sarah",
  "  - Abraham",
  "  - Terah",
  "  - Lot",
  "",
  "speaker:",
  "  - Narrator",
  "",
  "knowledge_accessible: true",
  "",
  "themes:",
  "  - family",
  "  - barrenness",
  "  - migration",
  "  - origins",
  "",
  "relationships:",
  "  Sarah: wife of Abraham",
  "  Abraham: husband of Sarah",
  "  Terah: father-in-law of Sarah",
  "  Lot: nephew of Abraham",
  "",
  "emotions:",
  "  - uncertainty",
  "  - displacement",
  "  - longing",
  "",
  "confidence: high",
].join("\n");

export type FrontmatterEditorProps = {
  value: string;
  onChange: (next: string) => void;
  error?: string | null;
  generateError?: string | null;
  generating?: boolean;
  onGenerate?: () => void;
  stepLabel?: string;
};

export function FrontmatterEditor({
  value,
  onChange,
  error,
  generateError,
  generating = false,
  onGenerate,
  stepLabel = "frontmatter",
}: FrontmatterEditorProps) {
  const [focused, setFocused] = useState(false);
  const [selectionStart, setSelectionStart] = useState(0);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const keyContext = useMemo(
    () => currentKeyContext(value, selectionStart),
    [selectionStart, value],
  );
  const suggestions = useMemo(() => {
    if (!focused || suggestionsDismissed || !keyContext.canSuggest) return [];
    const prefix = keyContext.prefix.toLowerCase();
    return COMMON_FRONTMATTER_KEYS.filter(
      (key) => key.startsWith(prefix) && key !== keyContext.prefix,
    );
  }, [focused, keyContext.canSuggest, keyContext.prefix, suggestionsDismissed]);

  function syncSelection(node: HTMLTextAreaElement) {
    setSelectionStart(node.selectionStart);
    setSuggestionsDismissed(false);
  }

  function applySuggestion(key: string) {
    const next = insertSuggestedKey(value, selectionStart, keyContext, key);
    onChange(next.value);
    setSuggestionsDismissed(true);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(next.caret, next.caret);
      setSelectionStart(next.caret);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && suggestions.length > 0) {
      setSuggestionsDismissed(true);
      return;
    }
    if (
      suggestions.length > 0 &&
      keyContext.prefix.length > 0 &&
      (event.key === "Tab" || event.key === "Enter")
    ) {
      event.preventDefault();
      applySuggestion(suggestions[0]);
    }
  }

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
      }}
    >
      <style>{FRONTMATTER_CSS}</style>
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "var(--space-14)",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: ACCENT,
          }}
        >
          {stepLabel}
        </span>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-8)",
          }}
        >
          {onGenerate && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onGenerate}
              disabled={generating}
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 24,
                padding: "0 10px",
                background: generating ? "transparent" : "var(--accent-soft)",
                border: `1px solid ${
                  generating ? "var(--control-border)" : "var(--accent-border)"
                }`,
                borderRadius: "var(--radius-pill)",
                color: generating ? "var(--text-placeholder)" : ACCENT,
                cursor: generating ? "not-allowed" : "pointer",
                fontFamily: FONT_MONO,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              {generating ? "Generating" : "Generate Metadata"}
            </button>
          )}
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: error ? DANGER : "var(--text-quaternary)",
            }}
          >
            YAML
          </span>
        </div>
      </header>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          syncSelection(event.target);
        }}
        onSelect={(event) => syncSelection(event.currentTarget)}
        onKeyDown={handleKeyDown}
        onFocus={(event) => {
          setFocused(true);
          syncSelection(event.currentTarget);
        }}
        onBlur={() => setFocused(false)}
        className="ingestion-frontmatter-input"
        spellCheck={false}
        placeholder={EXAMPLE_FRONTMATTER}
        style={inputStyle(focused, Boolean(error))}
      />

      {focused && (
        <SuggestionRail
          suggestions={suggestions.length > 0 ? suggestions : COMMON_FRONTMATTER_KEYS}
          contextual={suggestions.length > 0}
          onPick={applySuggestion}
        />
      )}

      {error && (
        <div
          role="alert"
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            lineHeight: 1.45,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: DANGER,
          }}
        >
          {error}
        </div>
      )}

      {generateError && (
        <div
          role="alert"
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            lineHeight: 1.45,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: DANGER,
          }}
        >
          {generateError}
        </div>
      )}
    </section>
  );
}

function SuggestionRail({
  suggestions,
  contextual,
  onPick,
}: {
  suggestions: readonly string[];
  contextual: boolean;
  onPick: (key: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-6)",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: contextual ? ACCENT : "var(--text-quaternary)",
        }}
      >
        Keys
      </span>
      {suggestions.map((key) => (
        <button
          key={key}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(key)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 24,
            padding: "0 8px",
            background: contextual
              ? "var(--accent-soft)"
              : "color-mix(in srgb, var(--text-primary) 4%, transparent)",
            border: `1px solid ${
              contextual
                ? "var(--accent-border)"
                : "color-mix(in srgb, var(--border) 70%, transparent)"
            }`,
            borderRadius: "var(--radius-pill)",
            color: contextual ? ACCENT : "var(--text-tertiary)",
            cursor: "pointer",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.08em",
          }}
        >
          {key}
        </button>
      ))}
    </div>
  );
}

function currentKeyContext(value: string, caret: number) {
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const nextBreak = value.indexOf("\n", caret);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const line = value.slice(lineStart, lineEnd);
  const beforeCaret = value.slice(lineStart, caret);
  const canSuggest =
    !line.startsWith(" ") &&
    !line.startsWith("\t") &&
    !line.includes(":") &&
    /^[A-Za-z_]*$/.test(beforeCaret);

  return {
    lineStart,
    lineEnd,
    prefix: canSuggest ? beforeCaret : "",
    canSuggest,
  };
}

function insertSuggestedKey(
  value: string,
  caret: number,
  context: ReturnType<typeof currentKeyContext>,
  key: string,
) {
  if (context.canSuggest) return replaceCurrentKey(value, context, key);

  const template = frontmatterKeyTemplate(key);
  const needsLeadingBreak = value.length > 0 && !value.slice(0, caret).endsWith("\n");
  const needsTrailingBreak =
    caret < value.length && !value.slice(caret).startsWith("\n");
  const insertion = `${needsLeadingBreak ? "\n" : ""}${template}${needsTrailingBreak ? "\n" : ""}`;
  const nextValue = value.slice(0, caret) + insertion + value.slice(caret);
  const caretOffset = (needsLeadingBreak ? 1 : 0) + template.length;
  return { value: nextValue, caret: caret + caretOffset };
}

function replaceCurrentKey(
  value: string,
  context: ReturnType<typeof currentKeyContext>,
  key: string,
) {
  const template = frontmatterKeyTemplate(key);
  const nextValue =
    value.slice(0, context.lineStart) +
    template +
    value.slice(context.lineEnd);
  const caret = context.lineStart + template.length;
  return { value: nextValue, caret };
}

function frontmatterKeyTemplate(key: string) {
  if (key === "relationships") return "relationships:\n  ";
  if (LIST_KEYS.has(key)) return `${key}:\n  - `;
  return `${key}: `;
}

function inputStyle(focused: boolean, error: boolean): CSSProperties {
  return {
    width: "100%",
    minHeight: 150,
    padding: "14px 16px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: error
      ? "var(--critical-border)"
      : focused
        ? "var(--accent-border)"
        : "var(--control-border)",
    borderRadius: "var(--radius-lg)",
    background: "var(--control-bg)",
    boxShadow: focused && !error ? ACTIVE_RING : undefined,
    color: "var(--text-primary)",
    caretColor: error ? DANGER : ACCENT,
    fontFamily: FONT_BODY,
    fontSize: "var(--font-size-base)",
    lineHeight: 1.55,
    outline: "none",
    resize: "vertical",
    transition: "border-color 140ms ease, box-shadow 140ms ease",
  };
}
