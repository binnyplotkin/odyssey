"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useHeaderContent } from "@/components/header-context";
import type { CharacterSummary } from "@/app/(authenticated)/characters/page";

/* ── Tokens ────────────────────────────────────────────────────── */

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  panel: "var(--panel)",
  border: "var(--border)",
  accent: "var(--accent)",
  accentStrong: "var(--accent-strong)",
  accentSoft: "var(--accent-soft)",
  cardHover: "var(--card-hover)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
} as const;

/* ── Gradient palette (per-character) ──────────────────────────── */

const GRADIENTS = [
  "linear-gradient(135deg, #105A59 0%, #1a3a3a 50%, #0f2828 100%)", // Emerald
  "linear-gradient(135deg, #3a1a1a 0%, #2a1018 50%, #1a0a12 100%)", // Crimson
  "linear-gradient(135deg, #1a2a4a 0%, #101830 50%, #080e1a 100%)", // Midnight
  "linear-gradient(135deg, #2a1a4a 0%, #1a1035 50%, #0f0a22 100%)", // Violet
  "linear-gradient(135deg, #3a2a1a 0%, #2a1a10 50%, #1a1008 100%)", // Burnt amber
  "linear-gradient(135deg, #1a3a2a 0%, #0f2218 50%, #081510 100%)", // Forest
];

const AVATAR_GRADIENTS = [
  { bg: "linear-gradient(135deg, #8CE7D2 0%, #4FB8A8 100%)", fg: "#0C0E14" },
  { bg: "linear-gradient(135deg, #E8A0A0 0%, #B4635F 100%)", fg: "#0C0E14" },
  { bg: "linear-gradient(135deg, #A8C4E8 0%, #6B8AFF 100%)", fg: "#0C0E14" },
  { bg: "linear-gradient(135deg, #C7A5FF 0%, #8C6BE8 100%)", fg: "#0C0E14" },
  { bg: "linear-gradient(135deg, #E8B87A 0%, #B48447 100%)", fg: "#0C0E14" },
  { bg: "linear-gradient(135deg, #8AD09A 0%, #4F8D62 100%)", fg: "#0C0E14" },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function gradientFor(slug: string): string {
  return GRADIENTS[hash(slug) % GRADIENTS.length];
}

function avatarFor(slug: string) {
  return AVATAR_GRADIENTS[hash(slug) % AVATAR_GRADIENTS.length];
}

function initial(c: CharacterSummary): string {
  return (c.title.trim() || c.slug).charAt(0).toUpperCase();
}

/* ── Time formatting ───────────────────────────────────────────── */

function relative(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ── Status pill ───────────────────────────────────────────────── */

function StatusPill({ status }: { status: "live" | "draft" }) {
  const live = status === "live";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 10px", borderRadius: 999,
      background: live ? "rgba(74,222,128,0.12)" : "rgba(250,204,21,0.12)",
      fontFamily: T.fontMono, fontSize: 10, fontWeight: 700,
      color: live ? "#4ADE80" : "#FACC15",
      letterSpacing: "0.08em",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: live ? "#4ADE80" : "#FACC15" }} />
      {live ? "LIVE" : "DRAFT"}
    </span>
  );
}

/* ── Sort ──────────────────────────────────────────────────────── */

type SortKey = "recent" | "title" | "pages" | "status";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently ingested" },
  { key: "title",  label: "Title A–Z" },
  { key: "pages",  label: "Most pages" },
  { key: "status", label: "Status (live first)" },
];

function applySort(list: CharacterSummary[], sort: SortKey): CharacterSummary[] {
  const base = [...list];
  switch (sort) {
    case "title":
      return base.sort((a, b) => a.title.localeCompare(b.title));
    case "pages":
      return base.sort((a, b) => b.pageCount - a.pageCount);
    case "status":
      return base.sort((a, b) => {
        if (a.status === b.status) {
          const at = a.lastIngestAt ? new Date(a.lastIngestAt).getTime() : 0;
          const bt = b.lastIngestAt ? new Date(b.lastIngestAt).getTime() : 0;
          return bt - at;
        }
        return a.status === "live" ? -1 : 1;
      });
    case "recent":
    default:
      return base.sort((a, b) => {
        const at = a.lastIngestAt ? new Date(a.lastIngestAt).getTime() : 0;
        const bt = b.lastIngestAt ? new Date(b.lastIngestAt).getTime() : 0;
        return bt - at;
      });
  }
}

/* ── Component ─────────────────────────────────────────────────── */

type Props = { characters: CharacterSummary[] };

export function CharactersGrid({ characters }: Props) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");

  const counts = useMemo(() => {
    const c = { all: characters.length, live: 0, draft: 0 };
    for (const ch of characters) c[ch.status]++;
    return c;
  }, [characters]);

  const filtered = useMemo(() => {
    const base = !search.trim()
      ? characters
      : (() => {
          const q = search.trim().toLowerCase();
          return characters.filter((c) =>
            c.title.toLowerCase().includes(q) ||
            c.slug.toLowerCase().includes(q) ||
            (c.summary ?? "").toLowerCase().includes(q),
          );
        })();
    return applySort(base, sort);
  }, [characters, search, sort]);

  /* ── Header injection ───────────────────────────────────────── */

  const { setContent } = useHeaderContent();
  useEffect(() => {
    setContent(
      <>
        <h1 style={{
          fontSize: 16, fontWeight: 700, color: T.fg,
          marginTop: 0, marginRight: 12, marginBottom: 0, marginLeft: 0,
          whiteSpace: "nowrap", fontFamily: T.fontHeading,
        }}>
          Characters
        </h1>
        <div style={{ flex: 1 }} />
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <RefreshButton />
          <Link
            href="/characters/new"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 8, border: "none",
              background: "#8CE7D2", color: "#000",
              fontSize: 11, fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit", whiteSpace: "nowrap", textDecoration: "none",
            }}
          >
            + New Character
          </Link>
        </div>
      </>,
    );
    return () => setContent(null);
  }, [setContent]);

  /* ── Empty state ────────────────────────────────────────────── */

  if (characters.length === 0) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "5rem 2rem", gap: 14,
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          background: T.panel, border: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M5 21v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1" />
          </svg>
        </div>
        <h2 style={{ fontFamily: T.fontHeading, fontSize: 20, fontWeight: 600, margin: 0, color: T.fg }}>
          No characters yet
        </h2>
        <p style={{ fontFamily: T.fontBody, fontSize: 13, color: T.muted, margin: 0, maxWidth: 440, textAlign: "center", lineHeight: 1.55 }}>
          A character is a simulated AI persona grounded in source material. Create one to open a wiki + ingestion surface.
        </p>
        <Link
          href="/characters/new"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 18px", borderRadius: 10, border: "none",
            background: T.accentStrong, color: "var(--background)",
            fontSize: 13, fontWeight: 600, fontFamily: T.fontBody,
            textDecoration: "none", cursor: "pointer",
          }}
        >
          + Create your first character
        </Link>
      </div>
    );
  }

  /* ── Populated state ────────────────────────────────────────── */

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "0.5rem 0.75rem", borderRadius: 10,
            background: T.panel, border: `1px solid ${T.border}`,
            width: 320,
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="var(--muted)" strokeWidth="1.5" />
              <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Search characters…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, border: "none", background: "transparent", outline: "none", fontSize: 13, color: T.fg, fontFamily: T.fontBody }}
            />
          </div>
          <span style={{
            fontFamily: T.fontMono, fontSize: 11, fontWeight: 500, color: T.muted,
            letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            {filtered.length} {filtered.length === 1 ? "character" : "characters"} · {counts.live} live
          </span>
        </div>

        <SortMenu sort={sort} onChange={setSort} />
      </div>

      {/* Grid */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 20,
      }}>
        {filtered.map((c) => <CharacterCard key={c.id} character={c} />)}
      </div>
    </div>
  );
}

/* ── Card ──────────────────────────────────────────────────────── */

function CharacterCard({ character }: { character: CharacterSummary }) {
  const ref = useRef<HTMLAnchorElement | null>(null);
  const av = avatarFor(character.slug);
  return (
    <Link
      ref={ref}
      href={`/characters/${character.slug}`}
      style={{
        display: "flex", flexDirection: "column",
        width: 363, background: T.panel, border: `1px solid ${T.border}`,
        borderRadius: 14, overflow: "hidden", textDecoration: "none", color: "inherit",
        transition: "border-color 150ms, box-shadow 150ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.boxShadow = "0 4px 24px rgba(0,0,0,0.2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = T.border;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Gradient header — status pill only; slug now lives under the title. */}
      <div style={{
        position: "relative", height: 128,
        background: gradientFor(character.slug),
      }}>
        <div style={{ position: "absolute", top: 14, right: 14 }}>
          <StatusPill status={character.status} />
        </div>
      </div>

      {/* Body */}
      <div style={{
        padding: "16px 18px 18px 18px",
        display: "flex", flexDirection: "column", gap: 18,
      }}>
        {/* Header-row: pulled up into the gradient, provides positioning
            context for the avatar. Matches the Paper design UE2-0 structure:
            relative wrapper + marginTop:-44 + absolute avatar at top:17, left:0. */}
        <div style={{ position: "relative", marginTop: -44, minHeight: 56 }}>
          {character.image ? (
            <img
              src={character.image}
              alt={character.title}
              referrerPolicy="no-referrer"
              style={{
                position: "absolute", top: 17, left: 0,
                width: 56, height: 56, boxSizing: "border-box",
                borderRadius: "50%", objectFit: "cover",
                // Solid ring in the card's page bg → clean cutout against the
                // gradient in either theme. box-shadow is used instead of
                // border so the ring sits outside the image and never clips
                // the circular shape on sub-pixel renders.
                boxShadow: "0 0 0 3px var(--background)",
              }}
            />
          ) : (
            <div style={{
              position: "absolute", top: 17, left: 0,
              width: 56, height: 56, boxSizing: "border-box",
              borderRadius: "50%",
              background: av.bg,
              boxShadow: "0 0 0 3px var(--background)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{
                fontFamily: T.fontHeading, fontSize: 22, fontWeight: 600,
                color: av.fg, lineHeight: "24px",
              }}>
                {initial(character)}
              </span>
            </div>
          )}

          {/* Title + slug — padded left to clear the avatar (with extra
              breathing room), padded top so the stack sits near the avatar's
              lower half. */}
          <div style={{
            paddingLeft: 78, // 56px avatar + 22px gap (up from 14)
            paddingTop: 34,
            minWidth: 0,
            display: "flex", flexDirection: "column", gap: 3,
          }}>
            <span style={{
              display: "block",
              fontFamily: T.fontHeading, fontSize: 18, fontWeight: 600, color: T.fg, lineHeight: "22px",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {character.title}
            </span>
            <span style={{
              display: "block",
              fontFamily: T.fontMono, fontSize: 10, letterSpacing: "0.06em",
              color: T.muted, lineHeight: "14px",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {character.slug}
            </span>
          </div>
        </div>

        {/* Description — always reserves 2 lines of height (so card bodies
            stay a consistent height across the grid), clamps + ellipses when
            longer. Uses var(--foreground) with reduced opacity so it reads in
            both dark and light themes. */}
        <p style={{
          margin: 0,
          minHeight: 38, // 2 lines × 19px line-height
          fontFamily: T.fontBody, fontSize: 13, lineHeight: "19px",
          color: "var(--foreground)", opacity: 0.72,
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
        }}>
          {character.summary ?? ""}
        </p>

        {/* Stats row */}
        <div style={{
          display: "flex", alignItems: "center", gap: 20,
          padding: "12px 0", borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}`,
        }}>
          <Stat label="Pages" value={character.pageCount} />
          <Stat label="Sources" value={character.sourceCount} />
          <Stat label="Eras" value={character.eraCount} />
          <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
            <span style={{
              fontFamily: T.fontHeading, fontSize: 13, fontWeight: 500, color: T.fg, lineHeight: "16px",
            }}>
              {relative(character.lastIngestAt)}
            </span>
            <span style={{
              fontFamily: T.fontMono, fontSize: 9, fontWeight: 500, color: T.muted,
              letterSpacing: "0.08em", textTransform: "uppercase",
            }}>
              Last ingest
            </span>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.muted} strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20M12 2c3 3.5 4.5 7.5 4.5 10S15 18.5 12 22M12 2c-3 3.5-4.5 7.5-4.5 10S9 18.5 12 22" />
          </svg>
          {character.worldCount === 0 ? (
            <span style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted }}>
              Not used in any world
            </span>
          ) : (
            <>
              <span style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted }}>Used in</span>
              <span style={{ fontFamily: T.fontBody, fontSize: 12, fontWeight: 500, color: T.accentStrong }}>
                {character.worldCount} {character.worldCount === 1 ? "world" : "worlds"}
              </span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontFamily: T.fontHeading, fontSize: 22, fontWeight: 600, color: T.fg, lineHeight: "24px" }}>
        {value}
      </span>
      <span style={{
        fontFamily: T.fontMono, fontSize: 9, fontWeight: 500, color: T.muted,
        letterSpacing: "0.08em", textTransform: "uppercase",
      }}>
        {label}
      </span>
    </div>
  );
}

/* ── Refresh button ────────────────────────────────────────────── */

function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <>
      <style>{`@keyframes chars-refresh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        aria-label={pending ? "Refreshing" : "Refresh"}
        title="Refresh"
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 28, height: 26, padding: 0,
          borderRadius: 8,
          border: `1px solid ${T.border}`,
          background: "rgba(255,255,255,0.05)",
          color: T.muted,
          cursor: pending ? "progress" : "pointer",
          opacity: pending ? 0.75 : 1,
          transition: "color 120ms, border-color 120ms",
        }}
        onMouseEnter={(e) => {
          if (pending) return;
          e.currentTarget.style.color = T.fg;
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = T.muted;
          e.currentTarget.style.borderColor = T.border;
        }}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{
            animation: pending ? "chars-refresh-spin 800ms linear infinite" : undefined,
            transformOrigin: "center",
          }}
        >
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      </button>
    </>
  );
}

/* ── Sort menu ─────────────────────────────────────────────────── */

function SortMenu({
  sort,
  onChange,
}: {
  sort: SortKey;
  onChange: (next: SortKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const current = SORT_OPTIONS.find((o) => o.key === sort) ?? SORT_OPTIONS[0];

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "7px 12px", borderRadius: 999,
          border: `1px solid ${T.border}`, background: "transparent",
          color: T.fg, cursor: "pointer",
          fontFamily: T.fontBody, fontSize: 12, lineHeight: "14px",
        }}
      >
        <span style={{ color: T.muted }}>Sort</span>
        <span style={{ color: T.fg, fontWeight: 500 }}>{current.label}</span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, color: T.muted, transform: open ? "rotate(180deg)" : "none", transition: "transform 120ms" }}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0,
            minWidth: 200, padding: 4, borderRadius: 10,
            background: T.panel, border: `1px solid ${T.border}`,
            boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
            zIndex: 10,
            display: "flex", flexDirection: "column", gap: 2,
          }}
        >
          {SORT_OPTIONS.map((opt) => {
            const active = opt.key === sort;
            return (
              <button
                key={opt.key}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { onChange(opt.key); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", textAlign: "left",
                  padding: "8px 10px", borderRadius: 6,
                  border: "none",
                  background: active ? "rgba(140,231,210,0.08)" : "transparent",
                  color: active ? T.accentStrong : T.fg,
                  fontFamily: T.fontBody, fontSize: 12, fontWeight: active ? 500 : 400,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = "var(--card-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                <span>{opt.label}</span>
                {active && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
