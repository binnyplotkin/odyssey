"use client";

import {
  type CSSProperties,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SandboxCharacter } from "@/app/(authenticated)/characters/[slug]/sandbox/page";
import type { SandboxTurn } from "../character-sandbox";

/**
 * SandboxChatStage — centered message carousel over the wavefield.
 * The focused turn is fully visible; nearby turns rotate/fade around it.
 */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";
const VISIBLE_DISTANCE = 2;
const WHEEL_ROTATE_THRESHOLD = 118;
const WHEEL_RESET_MS = 280;
const DRAG_ROTATE_THRESHOLD = 58;
const DRAG_DEAD_ZONE = 10;

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
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartYRef = useRef<number | null>(null);
  const dragStartIndexRef = useRef(0);
  const wheelDeltaRef = useRef(0);
  const lastWheelAtRef = useRef(0);

  const carouselTurns = useMemo(
    () => turns.filter((turn) => !turn.inFlight || turn.text.trim().length > 0),
    [turns],
  );

  useEffect(() => {
    setFocusedIndex(Math.max(0, carouselTurns.length - 1));
  }, [carouselTurns.length]);

  const clampedFocus = clamp(
    0,
    Math.max(0, carouselTurns.length - 1),
    focusedIndex,
  );
  const visibleTurns = useMemo(
    () =>
      carouselTurns
        .map((turn, index) => ({ turn, index, distance: index - clampedFocus }))
        .filter(({ distance }) => Math.abs(distance) <= VISIBLE_DISTANCE),
    [carouselTurns, clampedFocus],
  );

  const focusTurn = (nextIndex: number) => {
    setFocusedIndex(clamp(0, Math.max(0, carouselTurns.length - 1), nextIndex));
  };

  const rotateBy = (direction: number) => {
    if (carouselTurns.length <= 1) return;
    setFocusedIndex((current) =>
      clamp(0, Math.max(0, carouselTurns.length - 1), current + direction),
    );
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (isTextSelectionTarget(event.target)) return;
    dragStartYRef.current = event.clientY;
    dragStartIndexRef.current = clampedFocus;
    setDragging(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartYRef.current === null) return;
    const delta = event.clientY - dragStartYRef.current;
    if (Math.abs(delta) < DRAG_DEAD_ZONE) return;
    event.preventDefault();
    setDragging(true);
    const adjustedDelta =
      delta > 0 ? delta - DRAG_DEAD_ZONE : delta + DRAG_DEAD_ZONE;
    const steps = Math.trunc(adjustedDelta / DRAG_ROTATE_THRESHOLD);
    if (steps === 0) return;
    focusTurn(dragStartIndexRef.current + steps);
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    dragStartYRef.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  };

  const initial =
    (character.title.trim() || character.slug).charAt(0).toUpperCase() || "A";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
      }}
    >
      <div
        aria-label="Chat message carousel"
        tabIndex={0}
        onWheel={(event) => {
          event.preventDefault();
          if (carouselTurns.length <= 1) return;
          const now = performance.now();
          if (now - lastWheelAtRef.current > WHEEL_RESET_MS) {
            wheelDeltaRef.current = 0;
          }
          lastWheelAtRef.current = now;
          wheelDeltaRef.current += event.deltaY;
          if (Math.abs(wheelDeltaRef.current) < WHEEL_ROTATE_THRESHOLD) return;
          rotateBy(wheelDeltaRef.current > 0 ? 1 : -1);
          wheelDeltaRef.current = 0;
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerEnd}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            rotateBy(-1);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            rotateBy(1);
          }
        }}
        style={{
          position: "absolute",
          left: "50%",
          top: "47%",
          width: "min(660px, calc(100vw - 56px))",
          height: "min(520px, calc(100vh - 210px))",
          transform: "translate(-50%, -50%)",
          pointerEvents: "auto",
          perspective: 1100,
          outline: "none",
          cursor: carouselTurns.length > 1 ? (dragging ? "grabbing" : "grab") : "default",
          touchAction: "pan-y",
          overflow: "hidden",
          maskImage:
            "linear-gradient(180deg, transparent 0%, black 18%, black 82%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(180deg, transparent 0%, black 18%, black 82%, transparent 100%)",
        }}
      >
        {carouselTurns.length === 0 ? (
          <EmptyState characterTitle={character.title} />
        ) : (
          visibleTurns.map(({ turn, index, distance }) => (
            <ChatTurn
              key={turn.id}
              turn={turn}
              initial={initial}
              saved={savedTurnIds.has(turn.id)}
              onSave={() => onSaveExample(turn.id)}
              distance={distance}
              onFocus={() => focusTurn(index)}
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

/* -- Sub-components ---------------------------------------------------- */

function EmptyState({ characterTitle }: { characterTitle: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: "min(440px, 100%)",
        transform: "translate(-50%, -50%)",
        borderRadius: "var(--radius-lg)",
        border:
          "1px solid color-mix(in srgb, var(--accent-strong) 22%, transparent)",
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--background) 42%, transparent), color-mix(in srgb, var(--background) 24%, transparent))",
        backdropFilter: "blur(18px) saturate(1.12)",
        boxShadow:
          "0 20px 64px color-mix(in srgb, var(--background) 70%, transparent)",
        padding: "18px",
      }}
    >
      <span
        style={{
          display: "block",
          width: 42,
          height: 2,
          marginBottom: "var(--space-12)",
          borderRadius: "var(--radius-pill)",
          background: ACCENT,
          boxShadow:
            "0 0 20px color-mix(in srgb, var(--accent-strong) 70%, transparent)",
        }}
      />
      <span
        style={{
          display: "block",
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-xl)",
          lineHeight: "24px",
          fontWeight: 600,
          color: "var(--text-primary)",
        }}
      >
        Start with {characterTitle}
      </span>
    </div>
  );
}

function ChatTurn({
  turn,
  initial,
  saved,
  onSave,
  distance,
  onFocus,
}: {
  turn: SandboxTurn;
  initial: string;
  saved: boolean;
  onSave: () => void;
  distance: number;
  onFocus: () => void;
}) {
  const isUser = turn.speaker === "user";
  const speakerLabel = isUser ? "you" : initial;
  const timestamp = fmtTimestamp(turn.timestampMs);
  const abs = Math.abs(distance);
  const opacity = abs === 0 ? 1 : abs === 1 ? 0.44 : 0.12;
  const y = distance * 96;
  const rotate = distance * -24;
  const scale = 1 - abs * 0.09;
  const blur = abs > 1 ? 1.5 : abs * 0.35;

  return (
    <article
      onClick={onFocus}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: "50%",
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: "var(--space-6)",
        opacity,
        filter: blur > 0.05 ? `blur(${blur}px)` : "none",
        transform: `translateY(calc(-50% + ${y}px)) rotateX(${rotate}deg) scale(${scale})`,
        transformOrigin: "50% 50%",
        transformStyle: "preserve-3d",
        transition:
          "opacity 180ms ease, transform 180ms ease, filter 180ms ease",
        zIndex: 40 - abs,
        pointerEvents: abs <= 1 ? "auto" : "none",
        userSelect: abs === 0 ? "text" : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: isUser ? "flex-end" : "flex-start",
          gap: "var(--space-6)",
          width: "100%",
          padding: isUser ? "0 10px 0 0" : "0 0 0 10px",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-2xs)",
          letterSpacing: 0,
          textTransform: "uppercase",
          color: isUser ? "var(--text-tertiary)" : ACCENT,
        }}
      >
        <span>{speakerLabel}</span>
        <span style={{ color: "var(--text-quaternary)" }}>{timestamp}</span>
      </div>
      <div
        style={{
          width: "fit-content",
          maxWidth: "100%",
          maxHeight: abs === 0 ? "min(300px, 42vh)" : 170,
          overflowY: abs === 0 ? "auto" : "hidden",
          borderRadius: "var(--radius-lg)",
          border: isUser
            ? "1px solid color-mix(in srgb, var(--text-primary) 16%, transparent)"
            : "1px solid color-mix(in srgb, var(--accent-strong) 32%, transparent)",
          background: isUser
            ? "linear-gradient(180deg, color-mix(in srgb, var(--background) 54%, transparent), color-mix(in srgb, var(--background) 34%, transparent))"
            : "linear-gradient(180deg, color-mix(in srgb, var(--accent-strong) 14%, transparent), color-mix(in srgb, var(--background) 32%, transparent))",
          boxShadow:
            abs === 0
              ? "0 24px 80px color-mix(in srgb, var(--background) 76%, transparent)"
              : "none",
          backdropFilter: "blur(18px) saturate(1.12)",
          padding: abs === 0 ? "14px 16px" : "10px 12px",
          cursor: abs === 0 ? "auto" : "pointer",
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: FONT_HEAD,
            fontSize: abs === 0 ? "var(--font-size-lg)" : "var(--font-size-base)",
            lineHeight: abs === 0 ? "25px" : "21px",
            color: "var(--text-primary)",
          }}
        >
          {turn.text}
        </p>
      </div>
      {!isUser && !turn.inFlight && abs === 0 && (
        <TurnTelemetry turn={turn} saved={saved} onSave={onSave} />
      )}
    </article>
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
      ? `${turn.factsRecalled} recall`
      : "no recall";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-8)",
        width: "100%",
        paddingLeft: 10,
        fontFamily: FONT_MONO,
        fontSize: "var(--font-size-2xs)",
        letterSpacing: 0,
        color: "var(--text-tertiary)",
      }}
    >
      {turn.ttftMs != null && <span>{turn.ttftMs}ms</span>}
      {turn.tokens != null && <span>{turn.tokens} tok</span>}
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
          padding: "3px 8px",
          borderRadius: "var(--radius-md)",
          border: saved
            ? "1px solid color-mix(in srgb, var(--accent-strong) 56%, transparent)"
            : "1px solid color-mix(in srgb, var(--accent-strong) 26%, transparent)",
          background: saved
            ? "color-mix(in srgb, var(--accent-strong) 14%, transparent)"
            : "color-mix(in srgb, var(--background) 24%, transparent)",
          color: ACCENT,
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-2xs)",
          letterSpacing: 0,
          textTransform: "uppercase",
          cursor: saved ? "default" : "pointer",
        }}
      >
        {saved ? "saved" : "save"}
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
        position: "absolute",
        left: "50%",
        bottom: 32,
        width: "min(620px, calc(100vw - 56px))",
        transform: "translateX(-50%)",
        flexShrink: 0,
        padding: "10px",
        borderRadius: "var(--radius-lg)",
        border:
          "1px solid color-mix(in srgb, var(--accent-strong) 24%, transparent)",
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--background) 64%, transparent), color-mix(in srgb, var(--background) 48%, transparent))",
        boxShadow:
          "0 18px 54px color-mix(in srgb, var(--background) 68%, transparent)",
        backdropFilter: "blur(18px) saturate(1.12)",
        pointerEvents: "auto",
      }}
    >
      <label
        style={{
          display: "grid",
          gridTemplateColumns: "32px minmax(0, 1fr) 32px 32px",
          alignItems: "center",
          gap: "var(--space-8)",
          minHeight: 44,
          padding: "0 8px",
          borderRadius: "var(--radius-md)",
          border:
            "1px solid color-mix(in srgb, var(--accent-strong) 24%, transparent)",
          background: "color-mix(in srgb, var(--background) 46%, transparent)",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid color-mix(in srgb, var(--text-primary) 16%, transparent)",
            color: "var(--text-tertiary)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-2xs)",
          }}
        >
          Y
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
          placeholder={`Message ${characterTitle}`}
          style={inputStyle}
        />
        <button
          type="button"
          onClick={onMicToggle}
          aria-label={micOn ? "Turn voice input off" : "Turn voice input on"}
          title={micOn ? voiceState : "mic"}
          style={iconButtonStyle(micOn)}
        >
          <MicGlyph off={!micOn} />
        </button>
        <button
          type="button"
          onClick={onSend}
          aria-label="Send message"
          title="send"
          style={iconButtonStyle(Boolean(value.trim()))}
        >
          <ArrowGlyph />
        </button>
      </label>
    </div>
  );
}

function MicGlyph({ off }: { off: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <g
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <path d="M12 19v3" />
        {off && <path d="M4 4l16 16" />}
      </g>
    </svg>
  );
}

function ArrowGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h13m-5-5 5 5-5 5"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* -- Helpers ----------------------------------------------------------- */

const inputStyle: CSSProperties = {
  minWidth: 0,
  width: "100%",
  background: "transparent",
  border: "none",
  outline: "none",
  fontFamily: FONT_HEAD,
  fontSize: 14,
  color: "var(--text-primary)",
};

function iconButtonStyle(active: boolean): CSSProperties {
  return {
    width: 30,
    height: 30,
    borderRadius: "var(--radius-md)",
    border: active
      ? "1px solid color-mix(in srgb, var(--accent-strong) 46%, transparent)"
      : "1px solid color-mix(in srgb, var(--text-primary) 12%, transparent)",
    background: active
      ? "color-mix(in srgb, var(--accent-strong) 12%, transparent)"
      : "transparent",
    color: active ? ACCENT : "var(--text-tertiary)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  };
}

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

function fmtTimestamp(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function isTextSelectionTarget(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("p, span, button, input, textarea, a, [data-chat-text]"),
  );
}
