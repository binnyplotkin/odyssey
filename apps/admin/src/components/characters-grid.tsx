"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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

/* ── Component ─────────────────────────────────────────────────── */

type Props = { characters: CharacterSummary[] };

export function CharactersGrid({ characters }: Props) {
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const c = { all: characters.length, live: 0, draft: 0 };
    for (const ch of characters) c[ch.status]++;
    return c;
  }, [characters]);

  const filtered = useMemo(() => {
    if (!search.trim()) return characters;
    const q = search.trim().toLowerCase();
    return characters.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      c.slug.toLowerCase().includes(q) ||
      (c.summary ?? "").toLowerCase().includes(q),
    );
  }, [characters, search]);

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
      {/* Gradient header */}
      <div style={{
        position: "relative", height: 128,
        background: gradientFor(character.slug),
        padding: "14px 18px", display: "flex", flexDirection: "column", justifyContent: "flex-end",
      }}>
        <div style={{ position: "absolute", top: 14, right: 14 }}>
          <StatusPill status={character.status} />
        </div>
        <span style={{
          fontFamily: T.fontMono, fontSize: 10, color: "rgba(255,255,255,0.55)", letterSpacing: "0.06em",
        }}>
          {character.slug}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: "14px 18px 18px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginTop: -44 }}>
          {character.image ? (
            <img
              src={character.image}
              alt={character.title}
              referrerPolicy="no-referrer"
              style={{
                width: 56, height: 56, flexShrink: 0,
                borderRadius: "50%", objectFit: "cover",
                border: "3px solid var(--panel)",
              }}
            />
          ) : (
            <div style={{
              width: 56, height: 56, flexShrink: 0, borderRadius: "50%",
              background: av.bg, border: "3px solid var(--panel)",
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
          <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0, paddingTop: 30 }}>
            <span style={{
              fontFamily: T.fontHeading, fontSize: 18, fontWeight: 600, color: T.fg, lineHeight: "22px",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {character.title}
            </span>
            {character.summary && (
              <span style={{
                fontFamily: T.fontBody, fontSize: 12, color: T.muted, lineHeight: "15px",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {character.summary}
              </span>
            )}
          </div>
        </div>

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
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.muted} strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20M12 2c3 3.5 4.5 7.5 4.5 10S15 18.5 12 22M12 2c-3 3.5-4.5 7.5-4.5 10S9 18.5 12 22" />
          </svg>
          <span style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted }}>Used in</span>
          <span style={{ fontFamily: T.fontBody, fontSize: 12, fontWeight: 500, color: T.accentStrong }}>
            — worlds
          </span>
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
