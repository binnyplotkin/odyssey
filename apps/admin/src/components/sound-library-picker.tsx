"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/* Sibling of VoiceLibraryPicker, for the global sound library. Binds by
 * SLUG (the runtime track id — SceneState.ambience / world-audio key on
 * it), not by row id. Compact variant: one trigger card + a portaled
 * popover with search, inline preview, and a "no sound" sentinel. */

const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_MONO = "var(--font-mono, 'JetBrains Mono', monospace)";

export type PickerSound = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  durationS: number | null;
  loopable: boolean;
  status: string;
};

type Props = {
  /** Currently bound asset slug. `null` = no sound (silence). */
  currentSlug: string | null;
  /** Ready library assets (filtering happens upstream). */
  sounds: PickerSound[];
  /** Called with the new slug, or null to clear the binding. */
  onChange: (next: string | null) => void;
};

export function SoundLibraryPicker({ currentSlug, sounds, onChange }: Props) {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);

  const current = useMemo(
    () => (currentSlug ? sounds.find((s) => s.slug === currentSlug) ?? null : null),
    [currentSlug, sounds],
  );

  // Beds first (it's an ambience picker), then name.
  const sorted = useMemo(
    () =>
      [...sounds].sort((a, b) =>
        a.loopable === b.loopable ? a.name.localeCompare(b.name) : a.loopable ? -1 : 1,
      ),
    [sounds],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q),
    );
  }, [sorted, search]);

  /* Popover position — fixed coords so it escapes overflow:auto ancestors. */
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPosition({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  /* Close on outside click / escape; stop preview on close. */
  useEffect(() => {
    if (!open) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
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

  useEffect(() => {
    return () => audioRef.current?.pause();
  }, []);

  const preview = useCallback(
    (sound: PickerSound) => {
      let el = audioRef.current;
      if (!el) {
        el = new Audio();
        audioRef.current = el;
      }
      if (playingId === sound.id) {
        el.pause();
        setPlayingId(null);
        return;
      }
      el.pause();
      el.src = `/api/sounds/${sound.id}/stream`;
      el.loop = sound.loopable;
      el.onended = () => setPlayingId(null);
      void el.play().catch(() => setPlayingId(null));
      setPlayingId(sound.id);
    },
    [playingId],
  );

  const select = useCallback(
    (slug: string | null) => {
      onChange(slug);
      setOpen(false);
      setSearch("");
    },
    [onChange],
  );

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            color: "var(--text-tertiary)",
            letterSpacing: "0.10em",
          }}
        >
          ambience bed ·{" "}
          <span style={{ color: current ? "var(--accent-strong)" : "var(--text-quaternary)" }}>
            {current ? current.slug : "none"}
          </span>
        </span>

        <div
          ref={triggerRef}
          onClick={() => setOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(true);
            }
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-12)",
            padding: "13px 16px",
            borderRadius: "var(--radius-xl)",
            background: current ? "rgba(140,231,210,0.04)" : "rgba(255,255,255,0.025)",
            border: current
              ? `1px solid ${open ? "var(--accent-glow)" : "color-mix(in srgb, var(--accent-strong) 18%, transparent)"}`
              : "1px dashed rgba(255,255,255,0.14)",
            cursor: "pointer",
          }}
        >
          <NoteThumb bound={!!current} />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", flex: 1, minWidth: 0 }}>
            <span
              style={{
                fontFamily: FONT_BODY,
                fontSize: "var(--font-size-md)",
                fontWeight: current ? 600 : 500,
                color: current ? "var(--text-primary)" : "var(--text-secondary)",
              }}
            >
              {current ? current.name : "No sound bound"}
            </span>
            <span
              style={{
                fontFamily: FONT_BODY,
                fontSize: "var(--font-size-sm)",
                color: "var(--text-tertiary)",
                lineHeight: "16px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {current
                ? current.description ?? "No description."
                : "The character's sandbox plays in silence."}
            </span>
          </div>
          {current ? (
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                preview(current);
              }}
              aria-label={playingId === current.id ? "Stop preview" : "Play preview"}
              style={roundButtonStyle(playingId === current.id)}
            >
              {playingId === current.id ? <PauseIcon /> : <PlayIcon />}
            </button>
          ) : (
            <span
              style={{
                padding: "7px 14px",
                borderRadius: "var(--radius-md)",
                background: "rgba(140,231,210,0.06)",
                border: "1px solid var(--accent-border)",
                color: "var(--accent-strong)",
                fontFamily: FONT_BODY,
                fontSize: "var(--font-size-sm)",
                fontWeight: 600,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              choose sound
            </span>
          )}
        </div>

        {current && (
          <div style={{ display: "flex", gap: "var(--space-6)" }}>
            <button type="button" onClick={() => setOpen(true)} style={smallButtonStyle(false)}>
              change
            </button>
            <button type="button" onClick={() => select(null)} style={smallButtonStyle(true)}>
              unbind
            </button>
          </div>
        )}
      </div>

      {open &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            role="listbox"
            style={{
              position: "fixed",
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: "min(60vh, 440px)",
              display: "flex",
              flexDirection: "column",
              background: "#0F1112",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "var(--elevation-panel)",
              zIndex: 100,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-10)",
                padding: "12px 14px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                flexShrink: 0,
              }}
            >
              <input
                type="text"
                placeholder="search enviro sounds..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                style={{
                  flex: 1,
                  background: "transparent",
                  border: 0,
                  outline: 0,
                  fontFamily: FONT_BODY,
                  fontSize: "var(--font-size-base)",
                  color: "var(--text-primary)",
                }}
              />
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-xs)",
                  color: "var(--text-quaternary)",
                  letterSpacing: "0.06em",
                }}
              >
                {filtered.length} of {sounds.length}
              </span>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              {/* Sentinel — no sound */}
              <div
                onClick={() => select(null)}
                role="option"
                aria-selected={currentSlug === null}
                style={rowStyle(currentSlug === null)}
              >
                <NoteThumb bound={false} small />
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", flex: 1, minWidth: 0 }}>
                  <span style={{ fontFamily: FONT_BODY, fontSize: "var(--font-size-base)", fontWeight: 500, color: "var(--text-secondary)" }}>
                    — no sound —
                  </span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)", letterSpacing: "0.04em" }}>
                    sandbox plays in silence
                  </span>
                </div>
                {currentSlug === null && <CheckIcon />}
              </div>

              {filtered.map((s) => (
                <div
                  key={s.id}
                  onClick={() => select(s.slug)}
                  role="option"
                  aria-selected={s.slug === currentSlug}
                  style={rowStyle(s.slug === currentSlug)}
                >
                  <NoteThumb bound small />
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-6)" }}>
                      <span style={{ fontFamily: FONT_BODY, fontSize: "var(--font-size-md)", fontWeight: 600, color: "var(--text-primary)" }}>
                        {s.name}
                      </span>
                      <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-xs)", color: "var(--text-quaternary)", letterSpacing: "0.04em" }}>
                        {s.slug}
                        {s.loopable ? " · loop" : ""}
                        {s.durationS != null ? ` · ${s.durationS.toFixed(1)}s` : ""}
                      </span>
                    </div>
                    <span
                      style={{
                        fontFamily: FONT_BODY,
                        fontSize: "var(--font-size-sm)",
                        color: "var(--text-tertiary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.description ?? "No description."}
                    </span>
                  </div>
                  {s.slug === currentSlug ? (
                    <CheckIcon />
                  ) : (
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        preview(s);
                      }}
                      aria-label={playingId === s.id ? "Stop preview" : "Play preview"}
                      style={roundButtonStyle(playingId === s.id, 26)}
                    >
                      {playingId === s.id ? <PauseIcon small /> : <PlayIcon small />}
                    </button>
                  )}
                </div>
              ))}
              {filtered.length === 0 && (
                <div style={{ padding: "20px 14px", fontFamily: FONT_BODY, fontSize: "var(--font-size-base)", color: "var(--text-tertiary)", textAlign: "center" }}>
                  No enviro sounds match{search ? ` "${search}"` : ""}.
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.02)",
                flexShrink: 0,
              }}
            >
              <span style={{ fontFamily: FONT_MONO, fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)", letterSpacing: "0.06em" }}>
                esc to close
              </span>
              <Link
                href="/sounds"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-5)",
                  fontFamily: FONT_BODY,
                  fontSize: "var(--font-size-sm)",
                  color: "var(--accent-strong)",
                  textDecoration: "none",
                }}
              >
                manage enviro sounds
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17 17 7" />
                  <path d="M7 7h10v10" />
                </svg>
              </Link>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/* ── Atoms ────────────────────────────────────────────────────── */

function rowStyle(selected: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-12)",
    padding: "10px 14px",
    background: selected ? "rgba(140,231,210,0.06)" : "transparent",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    cursor: "pointer",
  };
}

function roundButtonStyle(active: boolean, size = 32): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: size,
    height: size,
    borderRadius: "var(--radius-pill)",
    flexShrink: 0,
    background: active ? "var(--accent-strong)" : "transparent",
    border: `1px solid ${active ? "var(--accent-strong)" : "var(--border)"}`,
    color: active ? "var(--background)" : "var(--text-secondary)",
    cursor: "pointer",
  };
}

function NoteThumb({ bound, small }: { bound: boolean; small?: boolean }) {
  const size = small ? 32 : 44;
  return (
    <div
      aria-hidden
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: small ? "var(--radius-md)" : "var(--radius-lg)",
        flexShrink: 0,
        background: bound
          ? "linear-gradient(135deg, #105A59 0%, #1a3a3a 50%, #0f2828 100%)"
          : "rgba(255,255,255,0.03)",
        border: bound
          ? "1px solid color-mix(in srgb, var(--accent-strong) 22%, transparent)"
          : "1px dashed rgba(255,255,255,0.14)",
      }}
    >
      <svg
        width={small ? 13 : 17}
        height={small ? 13 : 17}
        viewBox="0 0 24 24"
        fill="none"
        stroke={bound ? "var(--accent-strong)" : "rgba(255,255,255,0.30)"}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
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

function smallButtonStyle(danger: boolean): React.CSSProperties {
  return {
    padding: "5px 12px",
    borderRadius: "var(--radius-md)",
    background: "transparent",
    fontFamily: FONT_BODY,
    fontSize: "var(--font-size-sm)",
    cursor: "pointer",
    lineHeight: 1,
    border: danger ? "1px solid rgba(232,160,160,0.18)" : "1px solid var(--border)",
    color: danger ? "rgba(232,160,160,0.85)" : "var(--text-secondary)",
  };
}
