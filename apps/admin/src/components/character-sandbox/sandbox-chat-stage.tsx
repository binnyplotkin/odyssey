"use client";

import { type CSSProperties, useEffect, useRef } from "react";
import type { SandboxCharacter } from "@/app/(authenticated)/characters/[slug]/sandbox/page";
import type { SandboxTurn } from "../character-sandbox";

/**
 * SandboxChatStage — center stage when the sandbox is in chat mode.
 * Scrollable turn log with mono speaker/timestamp gutter, Inter message
 * body, and a per-turn telemetry row for character replies. Composer
 * docked at the bottom with a mint-edge field; Enter submits.
 */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";

export function SandboxChatStage({
  character,
  turns,
  composerValue,
  onComposerChange,
  onSend,
  micOn,
  voiceState,
  onMicToggle,
  savedTurnIds,
  onSaveExample,
}: {
  character: SandboxCharacter;
  turns: SandboxTurn[];
  composerValue: string;
  onComposerChange: (next: string) => void;
  onSend: () => void;
  micOn: boolean;
  voiceState: "idle" | "listening" | "thinking" | "speaking";
  onMicToggle: () => void;
  savedTurnIds: Set<string>;
  onSaveExample: (characterTurnId: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the latest turn whenever the log grows.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [turns.length]);

  const initial =
    (character.title.trim() || character.slug).charAt(0).toUpperCase() || "A";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div
        ref={scrollerRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "80px 64px 32px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-24)",
        }}
      >
        {turns.length === 0 ? (
          <EmptyState characterTitle={character.title} />
        ) : (
          turns.map((turn) => (
            <ChatTurn
              key={turn.id}
              turn={turn}
              initial={initial}
              saved={savedTurnIds.has(turn.id)}
              onSave={() => onSaveExample(turn.id)}
            />
          ))
        )}
      </div>

      <Composer
        value={composerValue}
        onChange={onComposerChange}
        onSend={onSend}
        characterTitle={character.title}
        micOn={micOn}
        voiceState={voiceState}
        onMicToggle={onMicToggle}
      />
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────────── */

function EmptyState({ characterTitle }: { characterTitle: string }) {
  return (
    <div
      style={{
        margin: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-12)",
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
        sandbox · chat mode
      </span>
      <span
        style={{
          fontFamily: FONT_HEAD,
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: "var(--text-primary)",
        }}
      >
        Ask {characterTitle} anything
      </span>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-sm)",
          letterSpacing: "0.10em",
          color: "var(--text-tertiary)",
        }}
      >
        type below · enter to send · ⌘↵ for newline
      </span>
    </div>
  );
}

function ChatTurn({
  turn,
  initial,
  saved,
  onSave,
}: {
  turn: SandboxTurn;
  initial: string;
  saved: boolean;
  onSave: () => void;
}) {
  const isUser = turn.speaker === "user";
  const speakerLabel = isUser ? "you" : initial;
  const speakerColor = isUser ? "var(--text-tertiary)" : ACCENT;
  const timestamp = fmtTimestamp(turn.timestampMs);

  return (
    <div style={{ display: "flex", gap: "var(--space-14)" }}>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: speakerColor,
          width: 64,
          flexShrink: 0,
          paddingTop: "var(--space-4)",
        }}
      >
        {speakerLabel} · {timestamp}
      </span>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-8)",
          maxWidth: 720,
          minWidth: 0,
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-xl)",
            lineHeight: "26px",
            color: "var(--text-primary)",
          }}
        >
          {turn.text}
          {turn.inFlight && (
            <span
              style={{
                display: "inline-block",
                marginLeft: "var(--space-4)",
                color: ACCENT,
                animation: "sandbox-caret 1s steps(2) infinite",
              }}
            >
              ▍
            </span>
          )}
        </p>
        {!isUser && !turn.inFlight && (
          <TurnTelemetry turn={turn} saved={saved} onSave={onSave} />
        )}
      </div>
      <style>{ANIM_CSS}</style>
    </div>
  );
}

function TurnTelemetry({
  turn,
  saved,
  onSave,
}: {
  turn: SandboxTurn;
  saved: boolean;
  onSave: () => void;
}) {
  const recallLabel =
    (turn.factsRecalled ?? 0) > 0
      ? `${turn.factsRecalled} facts recalled`
      : "no recall";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-12)",
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.10em",
        color: "var(--text-tertiary)",
      }}
    >
      {turn.ttftMs != null && (
        <>
          <span>{turn.ttftMs}ms ttft</span>
          <span style={{ color: "var(--text-quaternary)" }}>·</span>
        </>
      )}
      {turn.tokens != null && (
        <>
          <span>{turn.tokens} tok</span>
          <span style={{ color: "var(--text-quaternary)" }}>·</span>
        </>
      )}
      <span
        style={{
          color: (turn.factsRecalled ?? 0) > 0 ? ACCENT : "var(--text-tertiary)",
        }}
      >
        {recallLabel}
      </span>
      <button
        type="button"
        onClick={onSave}
        disabled={saved}
        style={{
          marginLeft: "auto",
          padding: "4px 10px",
          border: saved
            ? "1px solid color-mix(in srgb, var(--accent-strong) 60%, transparent)"
            : "1px solid color-mix(in srgb, var(--accent-strong) 35%, transparent)",
          background: saved
            ? "color-mix(in srgb, var(--accent-strong) 18%, transparent)"
            : "transparent",
          color: ACCENT,
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-2xs)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          cursor: saved ? "default" : "pointer",
        }}
      >
        {saved ? "✓ saved" : "+ save"}
      </button>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  characterTitle,
  micOn,
  voiceState,
  onMicToggle,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  characterTitle: string;
  micOn: boolean;
  voiceState: "idle" | "listening" | "thinking" | "speaking";
  onMicToggle: () => void;
}) {
  return (
    <div
      style={{
        padding: "18px 32px 22px",
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-10)",
        flexShrink: 0,
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-12)",
          padding: "14px 18px",
          background: "var(--material-card)",
          border:
            "1px solid color-mix(in srgb, var(--accent-strong) 28%, transparent)",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            color: ACCENT,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          you →
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={`ask ${characterTitle.toLowerCase()} something…`}
          style={inputStyle}
        />
        <button
          type="button"
          onClick={onMicToggle}
          aria-label={micOn ? "Turn voice input off" : "Turn voice input on"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-6)",
            minHeight: 30,
            padding: "0 10px",
            border: micOn
              ? "1px solid color-mix(in srgb, var(--accent-strong) 55%, transparent)"
              : "1px solid var(--border)",
            background: micOn
              ? "color-mix(in srgb, var(--accent-strong) 12%, transparent)"
              : "transparent",
            color: micOn ? ACCENT : "var(--text-tertiary)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: micOn ? ACCENT : "var(--text-quaternary)",
              boxShadow: micOn ? `0 0 10px ${ACCENT}` : "none",
            }}
          />
          {micOn ? voiceState : "mic"}
        </button>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            color: "var(--text-quaternary)",
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          enter ↵
        </span>
      </label>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────── */

const inputStyle: CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  outline: "none",
  fontFamily: FONT_HEAD,
  fontSize: 15,
  color: "var(--text-primary)",
};

function fmtTimestamp(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const ANIM_CSS = `@keyframes sandbox-caret{0%,49%{opacity:1}50%,100%{opacity:0}}`;
