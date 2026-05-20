"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

/* ── Tokens ───────────────────────────────────────────────────── */

const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_MONO = "var(--font-mono, 'JetBrains Mono', monospace)";

/* ── Types ────────────────────────────────────────────────────── */

export type PickerVoice = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  durationS: number | null;
  boundCharacterCount?: number;
  status: string;
};

type Props = {
  /** Currently bound voice id on the character. `null` = legacy slug fallback. */
  currentVoiceId: string | null;
  /** All `ready` voices in the library (filtering happens upstream). */
  voices: PickerVoice[];
  /** Called with the new voice id, or null to clear the binding. */
  onChange: (next: string | null) => void;
};

/* ── Component ────────────────────────────────────────────────── */

export function VoiceLibraryPicker({ currentVoiceId, voices, onChange }: Props) {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Audio preview: a single shared HTMLAudioElement that's torn down + recreated
  // on each play. Signed preview URLs are 1h-TTL — cache them so re-playing the
  // same voice doesn't re-hit /api/voices/<id>.
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlCache = useRef(new Map<string, string>());

  const current = useMemo(
    () => (currentVoiceId ? voices.find((v) => v.id === currentVoiceId) ?? null : null),
    [currentVoiceId, voices],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return voices;
    return voices.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.slug.toLowerCase().includes(q) ||
        (v.description ?? "").toLowerCase().includes(q),
    );
  }, [voices, search]);

  /* ── Popover positioning ────────────────────────────────────── */

  // Position the popover via fixed coordinates from the trigger's
  // bounding rect so it escapes any ancestor with overflow:auto
  // (the character config sidebar has that on the tab body).
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      const node = triggerRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      setPosition({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    };
    update();
    window.addEventListener("resize", update);
    // capture-phase so we catch scroll on any ancestor, not just window.
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  /* ── Close on outside click + escape ────────────────────────── */

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        triggerRef.current?.contains(t) ||
        popoverRef.current?.contains(t)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /* ── Audio cleanup ──────────────────────────────────────────── */

  // Stop playback when picker closes or component unmounts.
  useEffect(() => {
    if (!open && audioRef.current) {
      audioRef.current.pause();
      setPlayingVoiceId(null);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const playPreview = useCallback(async (voiceId: string) => {
    // Click on currently-playing → stop.
    if (playingVoiceId === voiceId) {
      audioRef.current?.pause();
      setPlayingVoiceId(null);
      return;
    }
    // Stop any in-flight playback.
    audioRef.current?.pause();

    let url = previewUrlCache.current.get(voiceId) ?? null;
    if (!url) {
      try {
        const res = await fetch(`/api/voices/${voiceId}`);
        if (!res.ok) return;
        const body = (await res.json()) as { previewUrl?: string | null };
        if (!body.previewUrl) return;
        url = body.previewUrl;
        previewUrlCache.current.set(voiceId, url);
      } catch {
        return;
      }
    }

    const audio = new Audio(url);
    audio.onended = () => {
      setPlayingVoiceId((prev) => (prev === voiceId ? null : prev));
    };
    audioRef.current = audio;
    setPlayingVoiceId(voiceId);
    audio.play().catch(() => setPlayingVoiceId(null));
  }, [playingVoiceId]);

  const selectVoice = useCallback(
    (voiceId: string | null) => {
      onChange(voiceId);
      setOpen(false);
      setSearch("");
    },
    [onChange],
  );

  /* ── Render ─────────────────────────────────────────────────── */

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {/* Label row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: "var(--text-tertiary)",
              letterSpacing: "0.10em",
            }}
          >
            voice (TTS) ·{" "}
            <span
              style={{
                color: current
                  ? "var(--accent-strong)"
                  : "var(--text-quaternary)",
              }}
            >
              {current ? current.slug : "none"}
            </span>
          </span>
          {!current && (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: "var(--text-quaternary)",
                letterSpacing: "0.06em",
              }}
            >
              using slug as fallback
            </span>
          )}
          {current && (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: "var(--accent-strong)",
                letterSpacing: "0.06em",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  background: "var(--accent-strong)",
                  boxShadow: "0 0 8px var(--accent-strong)",
                }}
              />
              READY
            </span>
          )}
        </div>

        {/* Trigger card — variant depends on bound/unbound */}
        <div ref={triggerRef}>
          {current ? (
            <BoundCard
              voice={current}
              isPlaying={playingVoiceId === current.id}
              onPreview={(e) => {
                e.stopPropagation();
                playPreview(current.id);
              }}
              onClick={() => setOpen(true)}
              focused={open}
            />
          ) : (
            <UnboundCard onClick={() => setOpen(true)} />
          )}
        </div>

        {/* Trigger actions (bound only) */}
        {current && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={() => setOpen(true)}
              style={smallButtonStyle("neutral")}
            >
              change
            </button>
            <button
              type="button"
              onClick={() => selectVoice(null)}
              style={smallButtonStyle("danger")}
            >
              unbind
            </button>
          </div>
        )}
      </div>

      {/* Popover — portaled to body so it escapes overflow:auto ancestors */}
      {open &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
          <Popover
            ref={popoverRef}
            position={position}
            search={search}
            onSearch={setSearch}
            voices={filtered}
            totalCount={voices.length}
            currentVoiceId={currentVoiceId}
            playingVoiceId={playingVoiceId}
            onPreview={playPreview}
            onSelect={selectVoice}
          />,
          document.body,
        )}
    </>
  );
}

/* ── Trigger: unbound ─────────────────────────────────────────── */

function UnboundCard({ onClick }: { onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        background: "rgba(255,255,255,0.025)",
        border: "1px dashed rgba(255,255,255,0.14)",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          flexShrink: 0,
          background: "rgba(255,255,255,0.03)",
          border: "1px dashed rgba(255,255,255,0.14)",
        }}
      >
        <WaveformGlyph color="rgba(255,255,255,0.30)" />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          flex: 1,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-secondary)",
          }}
        >
          No voice bound
        </span>
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 11,
            color: "var(--text-tertiary)",
            lineHeight: "16px",
          }}
        >
          Audio-rt falls back to the character&apos;s slug against baked-in voices.
        </span>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        style={{
          padding: "7px 12px",
          background: "transparent",
          border: "1px solid color-mix(in srgb, var(--accent-strong) 30%, transparent)",
          color: "var(--accent-strong)",
          fontFamily: FONT_BODY,
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        choose voice
      </button>
    </div>
  );
}

/* ── Trigger: bound ───────────────────────────────────────────── */

function BoundCard({
  voice,
  isPlaying,
  onPreview,
  onClick,
  focused,
}: {
  voice: PickerVoice;
  isPlaying: boolean;
  onPreview: (e: React.MouseEvent) => void;
  onClick: () => void;
  focused: boolean;
}) {
  const meta = [
    voice.durationS != null ? `${voice.durationS.toFixed(1)}s` : null,
    "24 kHz",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        background: "rgba(140,231,210,0.04)",
        border: `1px solid ${
          focused
            ? "color-mix(in srgb, var(--accent-strong) 40%, transparent)"
            : "color-mix(in srgb, var(--accent-strong) 18%, transparent)"
        }`,
        cursor: "pointer",
      }}
    >
      <WaveformThumb size={44} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          flex: 1,
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              fontFamily: FONT_BODY,
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {voice.name}
          </span>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: "var(--text-quaternary)",
              letterSpacing: "0.04em",
            }}
          >
            {meta}
          </span>
        </div>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontSize: 11,
            lineHeight: "16px",
            color: "var(--text-tertiary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {voice.description ?? "No description."}
        </div>
      </div>
      <button
        type="button"
        onClick={onPreview}
        aria-label={isPlaying ? "Stop preview" : "Play preview"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          flexShrink: 0,
          background: isPlaying ? "var(--accent-strong)" : "transparent",
          border: `1px solid ${
            isPlaying ? "var(--accent-strong)" : "var(--border)"
          }`,
          color: isPlaying ? "var(--background)" : "var(--text-secondary)",
          cursor: "pointer",
        }}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>
    </div>
  );
}

/* ── Popover ──────────────────────────────────────────────────── */

const Popover = function PopoverInner({
  position,
  search,
  onSearch,
  voices,
  totalCount,
  currentVoiceId,
  playingVoiceId,
  onPreview,
  onSelect,
  ref,
}: {
  position: { top: number; left: number; width: number };
  search: string;
  onSearch: (next: string) => void;
  voices: PickerVoice[];
  totalCount: number;
  currentVoiceId: string | null;
  playingVoiceId: string | null;
  onPreview: (voiceId: string) => void;
  onSelect: (voiceId: string | null) => void;
  ref: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      role="listbox"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        width: position.width,
        // Bounded so it doesn't overflow the viewport on shorter screens.
        maxHeight: "min(60vh, 480px)",
        display: "flex",
        flexDirection: "column",
        background: "#0F1112",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.50)",
        zIndex: 100,
      }}
    >
      {/* Header — search + count */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          padding: "12px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="var(--text-tertiary)" strokeWidth="1.5" />
          <line
            x1="9.5"
            y1="9.5"
            x2="12.5"
            y2="12.5"
            stroke="var(--text-tertiary)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <input
          type="text"
          placeholder="search voices…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          autoFocus
          style={{
            flex: 1,
            background: "transparent",
            border: 0,
            outline: 0,
            fontFamily: FONT_BODY,
            fontSize: 12,
            color: "var(--text-primary)",
          }}
        />
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: "var(--text-quaternary)",
            letterSpacing: "0.06em",
            flexShrink: 0,
          }}
        >
          {voices.length} of {totalCount}
        </span>
      </div>

      {/* Scrollable rows */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {/* Sentinel — fallback to slug */}
        <SentinelRow
          selected={currentVoiceId === null}
          onClick={() => onSelect(null)}
        />

        {voices.length === 0 ? (
          <div
            style={{
              padding: "20px 14px",
              fontFamily: FONT_BODY,
              fontSize: 12,
              color: "var(--text-tertiary)",
              textAlign: "center",
            }}
          >
            No voices match{search ? ` "${search}"` : ""}.
          </div>
        ) : (
          voices.map((v) => (
            <VoiceRow
              key={v.id}
              voice={v}
              selected={v.id === currentVoiceId}
              isPlaying={playingVoiceId === v.id}
              onPreview={(e) => {
                e.stopPropagation();
                onPreview(v.id);
              }}
              onClick={() => onSelect(v.id)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.02)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: "var(--text-tertiary)",
            letterSpacing: "0.06em",
          }}
        >
          esc to close
        </span>
        <Link
          href="/voices"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontFamily: FONT_BODY,
            fontSize: 11,
            color: "var(--accent-strong)",
            textDecoration: "none",
          }}
        >
          <span>manage voices</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17 17 7" />
            <path d="M7 7h10v10" />
          </svg>
        </Link>
      </div>
    </div>
  );
};

/* ── Sentinel / Voice rows ────────────────────────────────────── */

function SentinelRow({
  selected,
  onClick,
}: {
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role="option"
      aria-selected={selected}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: selected ? "rgba(140,231,210,0.06)" : "transparent",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          flexShrink: 0,
          background: "rgba(255,255,255,0.03)",
          border: "1px dashed rgba(255,255,255,0.14)",
        }}
      >
        <WaveformGlyph color="rgba(255,255,255,0.30)" size="small" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 12,
            fontWeight: 500,
            color: "var(--text-secondary)",
          }}
        >
          — use character slug —
        </span>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: "var(--text-tertiary)",
            letterSpacing: "0.04em",
          }}
        >
          audio-rt resolves baked-in voices by slug (legacy)
        </span>
      </div>
      {selected && <CheckIcon />}
    </div>
  );
}

function VoiceRow({
  voice,
  selected,
  isPlaying,
  onPreview,
  onClick,
}: {
  voice: PickerVoice;
  selected: boolean;
  isPlaying: boolean;
  onPreview: (e: React.MouseEvent) => void;
  onClick: () => void;
}) {
  const metaBits: string[] = [];
  if (voice.description) metaBits.push(voice.description);
  if (voice.durationS != null) metaBits.push(`${voice.durationS.toFixed(1)}s`);
  if (voice.boundCharacterCount && voice.boundCharacterCount > 0) {
    metaBits.push(
      `bound to ${voice.boundCharacterCount} character${voice.boundCharacterCount === 1 ? "" : "s"}`,
    );
  } else {
    metaBits.push("unbound");
  }

  return (
    <div
      onClick={onClick}
      role="option"
      aria-selected={selected}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: selected ? "rgba(140,231,210,0.06)" : "transparent",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        cursor: "pointer",
      }}
    >
      <WaveformThumb size={32} />
      <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span
            style={{
              fontFamily: FONT_BODY,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {voice.name}
          </span>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: "var(--text-quaternary)",
              letterSpacing: "0.04em",
            }}
          >
            {voice.slug}
          </span>
        </div>
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 11,
            color: "var(--text-tertiary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {metaBits.join(" · ")}
        </span>
      </div>
      {selected ? (
        <CheckIcon />
      ) : (
        <button
          type="button"
          onClick={onPreview}
          aria-label={isPlaying ? "Stop preview" : "Play preview"}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            flexShrink: 0,
            background: isPlaying ? "var(--accent-strong)" : "transparent",
            border: `1px solid ${
              isPlaying ? "var(--accent-strong)" : "var(--border)"
            }`,
            color: isPlaying ? "var(--background)" : "var(--text-tertiary)",
            cursor: "pointer",
          }}
        >
          {isPlaying ? <PauseIcon small /> : <PlayIcon small />}
        </button>
      )}
    </div>
  );
}

/* ── Atoms ────────────────────────────────────────────────────── */

function WaveformThumb({ size }: { size: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flexShrink: 0,
        background:
          "linear-gradient(135deg, #105A59 0%, #1a3a3a 50%, #0f2828 100%)",
        border: "1px solid color-mix(in srgb, var(--accent-strong) 22%, transparent)",
      }}
      aria-hidden
    >
      <WaveformGlyph color="var(--accent-strong)" size={size <= 32 ? "small" : "regular"} />
    </div>
  );
}

function WaveformGlyph({
  color,
  size = "regular",
}: {
  color: string;
  size?: "small" | "regular";
}) {
  const lines =
    size === "small"
      ? [
          [14, 22, 38],
          [30, 14, 46],
          [46, 6, 54],
          [62, 16, 44],
          [78, 24, 36],
        ]
      : [
          [6, 30, 30],
          [14, 22, 38],
          [22, 14, 46],
          [30, 8, 52],
          [38, 18, 42],
          [46, 6, 54],
          [54, 12, 48],
          [62, 20, 40],
          [70, 10, 50],
          [78, 24, 36],
          [86, 18, 42],
          [94, 28, 32],
        ];
  const w = size === "small" ? 18 : 26;
  const h = size === "small" ? 13 : 18;
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 100 60"
      fill="none"
      stroke={color}
      strokeWidth="3"
      strokeLinecap="round"
    >
      {lines.map(([x, y1, y2]) => (
        <line key={x} x1={x} y1={y1} x2={x} y2={y2} />
      ))}
    </svg>
  );
}

function PlayIcon({ small }: { small?: boolean }) {
  const s = small ? 10 : 13;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="6 3 22 12 6 21 6 3" />
    </svg>
  );
}

function PauseIcon({ small }: { small?: boolean }) {
  const s = small ? 10 : 13;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-strong)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

function smallButtonStyle(tone: "neutral" | "danger"): CSSProperties {
  if (tone === "danger") {
    return {
      padding: "5px 10px",
      background: "transparent",
      border: "1px solid rgba(232,160,160,0.18)",
      color: "rgba(232,160,160,0.85)",
      fontFamily: FONT_BODY,
      fontSize: 11,
      cursor: "pointer",
    };
  }
  return {
    padding: "5px 10px",
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text-secondary)",
    fontFamily: FONT_BODY,
    fontSize: 11,
    cursor: "pointer",
  };
}
