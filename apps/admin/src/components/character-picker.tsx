"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  listLibraryCharacters,
  linkCharacterToWorld,
  type LibraryCharacterSummary,
} from "@/app/(authenticated)/worlds/[worldId]/editor/actions";

const T = {
  fg: "#E6E8EE",
  fgDim: "rgba(230,232,238,0.82)",
  muted: "rgba(255,255,255,0.60)",
  mutedSoft: "rgba(255,255,255,0.44)",
  ground: "#07090D",
  panel: "#13161D",
  panelRaised: "#191C24",
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.14)",
  backdrop: "rgba(4,6,10,0.72)",
  pink: "#E8A0B5",
  pinkSoft: "rgba(232,160,181,0.10)",
  pinkBorder: "rgba(232,160,181,0.35)",
  mint: "#7AE5C5",
  mintSoft: "rgba(122,229,197,0.10)",
  mintBorder: "rgba(122,229,197,0.35)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "'JetBrains Mono', monospace",
};

type Props = {
  worldId: string;
  open: boolean;
  onClose: () => void;
  onLinked: (result: { characterId: string; nodeId: string }) => void;
};

export function CharacterPicker({ worldId, open, onClose, onLinked }: Props) {
  const [characters, setCharacters] = useState<LibraryCharacterSummary[]>([]);
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [, startLink] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Load library when opened.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setQuery("");
    setActiveIdx(0);
    listLibraryCharacters(worldId).then((res) => {
      setLoading(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCharacters(res.data?.characters ?? []);
      setLinkedIds(new Set(res.data?.linkedIds ?? []));
      // Focus input on open
      requestAnimationFrame(() => inputRef.current?.focus());
    });
  }, [open, worldId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return characters;
    return characters.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q) ||
        (c.summary ?? "").toLowerCase().includes(q),
    );
  }, [characters, query]);

  // Clamp active index when filter changes.
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, activeIdx]);

  // Keep active row in view.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  // Escape to close, arrows to navigate, enter to link.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter") {
        const row = filtered[activeIdx];
        if (row && !linkedIds.has(row.id)) {
          e.preventDefault();
          handleLink(row);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filtered, activeIdx, linkedIds]);

  function handleLink(row: LibraryCharacterSummary) {
    if (linkedIds.has(row.id)) return;
    setLinkingId(row.id);
    setError(null);
    startLink(async () => {
      const res = await linkCharacterToWorld(worldId, row.id);
      setLinkingId(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onLinked({ characterId: row.id, nodeId: res.data!.nodeId });
    });
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="character-picker-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "88px 16px 16px",
        backgroundColor: T.backdrop,
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        animation: "cpFade 140ms ease-out",
      }}
    >
      <style>{`
        @keyframes cpFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes cpRise { from { opacity: 0; transform: translateY(-6px) scale(0.99) } to { opacity: 1; transform: none } }
      `}</style>

      <div
        style={{
          width: 640, maxWidth: "100%",
          background: T.panel,
          border: `1px solid ${T.border}`,
          borderRadius: 16,
          boxShadow: "0 24px 64px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.03) inset",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "calc(100vh - 120px)",
          animation: "cpRise 180ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* Header + Search */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "20px 20px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: 999, background: T.pink }} />
            <span
              id="character-picker-title"
              style={{
                fontFamily: T.fontMono, fontSize: 11, letterSpacing: "0.14em",
                color: T.muted, textTransform: "uppercase",
              }}
            >
              Character library
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.mutedSoft, letterSpacing: "0.04em" }}>
              Esc to close · ↵ to link
            </span>
          </div>
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px",
              background: T.ground, border: `1px solid ${T.border}`, borderRadius: 10,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="6" cy="6" r="4.25" stroke={T.mutedSoft} strokeWidth="1.4" />
              <path d="M9.25 9.25L12 12" stroke={T.mutedSoft} strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIdx(0);
              }}
              placeholder="Search by name, slug, or summary…"
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: T.fg, fontFamily: T.fontBody, fontSize: 14,
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  color: T.mutedSoft, fontFamily: T.fontMono, fontSize: 11,
                  padding: "4px 8px", borderRadius: 6,
                }}
              >
                clear
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div
          ref={listRef}
          style={{
            overflowY: "auto",
            padding: "4px 10px 10px",
            flex: 1,
            minHeight: 120,
          }}
        >
          {loading && (
            <div style={{ padding: 40, textAlign: "center", color: T.muted, fontFamily: T.fontBody, fontSize: 13 }}>
              Loading library…
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: T.muted, fontFamily: T.fontBody, fontSize: 13 }}>
              {characters.length === 0
                ? "No characters in the library yet. Create one in /characters first."
                : "No matches."}
            </div>
          )}

          {!loading &&
            filtered.map((c, idx) => {
              const linked = linkedIds.has(c.id);
              const active = idx === activeIdx;
              const linking = linkingId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  data-idx={idx}
                  disabled={linked || linking}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => handleLink(c)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    width: "100%", textAlign: "left",
                    padding: "10px 12px",
                    background: active && !linked ? T.panelRaised : "transparent",
                    border: `1px solid ${active && !linked ? T.borderStrong : "transparent"}`,
                    borderRadius: 10,
                    cursor: linked ? "default" : "pointer",
                    opacity: linked ? 0.55 : 1,
                    marginBottom: 2,
                  }}
                >
                  <CharacterAvatar title={c.title} image={c.image} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        fontFamily: T.fontHeading, fontSize: 14, fontWeight: 500, color: T.fg,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {c.title}
                      </span>
                      <span style={{
                        fontFamily: T.fontMono, fontSize: 10, color: T.mutedSoft, letterSpacing: "0.02em",
                      }}>
                        {c.slug}
                      </span>
                    </div>
                    {c.summary && (
                      <span style={{
                        fontFamily: T.fontBody, fontSize: 12, color: T.muted,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {c.summary}
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    {linked ? (
                      <span style={{
                        fontFamily: T.fontMono, fontSize: 10, color: T.mint, letterSpacing: "0.04em",
                        padding: "3px 7px", borderRadius: 999,
                        background: T.mintSoft, border: `1px solid ${T.mintBorder}`,
                      }}>
                        linked
                      </span>
                    ) : linking ? (
                      <span style={{
                        fontFamily: T.fontMono, fontSize: 10, color: T.muted, letterSpacing: "0.04em",
                      }}>
                        linking…
                      </span>
                    ) : (
                      <span style={{
                        fontFamily: T.fontMono, fontSize: 10, color: T.mutedSoft, letterSpacing: "0.04em",
                      }}>
                        {c.worldCount === 0 ? "unused" : c.worldCount === 1 ? "1 world" : `${c.worldCount} worlds`}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 10, padding: "12px 20px",
          borderTop: `1px solid ${T.border}`,
          background: "rgba(0,0,0,0.18)",
        }}>
          {error ? (
            <span style={{ fontFamily: T.fontBody, fontSize: 12, color: "#E8B76A" }}>{error}</span>
          ) : (
            <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.mutedSoft, letterSpacing: "0.04em" }}>
              {filtered.length === 1 ? "1 character" : `${filtered.length} characters`}
            </span>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "7px 14px", borderRadius: 999,
                background: "transparent", border: `1px solid ${T.borderStrong}`,
                color: T.fg, fontFamily: T.fontBody, fontSize: 12, cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CharacterAvatar({ title, image }: { title: string; image: string | null }) {
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  if (image) {
    return (
      <img
        src={image}
        alt=""
        style={{
          width: 36, height: 36, borderRadius: 10,
          objectFit: "cover", flexShrink: 0,
          border: `1px solid ${T.pinkBorder}`,
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: T.pinkSoft, border: `1px solid ${T.pinkBorder}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: T.fontHeading, fontSize: 13, color: T.pink, fontWeight: 500,
        letterSpacing: "-0.01em",
      }}
    >
      {initials}
    </div>
  );
}
