"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useHeaderContent } from "@/components/header-context";

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #8CE7D2 0%, #4FB8A8 100%)",
  "linear-gradient(135deg, #E8A0A0 0%, #B4635F 100%)",
  "linear-gradient(135deg, #A8C4E8 0%, #6B8AFF 100%)",
  "linear-gradient(135deg, #C7A5FF 0%, #8C6BE8 100%)",
  "linear-gradient(135deg, #E8B87A 0%, #B48447 100%)",
  "linear-gradient(135deg, #8AD09A 0%, #4F8D62 100%)",
];

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "wiki", label: "Wiki" },
  { key: "sources", label: "Sources" },
  { key: "ingestion", label: "Ingestion" },
] as const;

type Props = {
  character: { id: string; slug: string; title: string };
};

export function CharacterHeader({ character }: Props) {
  const pathname = usePathname();
  const { setContent } = useHeaderContent();

  const activeTab = (() => {
    for (const t of TABS) {
      if (pathname.includes(`/${t.key}`)) return t.key;
    }
    return "overview";
  })();

  const gradient = AVATAR_GRADIENTS[hash(character.slug) % AVATAR_GRADIENTS.length];
  const initial = character.title.charAt(0).toUpperCase();

  useEffect(() => {
    // Chat route renders its own immersive header — leave it alone so this
    // layout-level header doesn't compete for the global header slot.
    if (pathname.endsWith("/chat")) {
      return;
    }
    setContent(
      <>
        <Link
          href="/characters"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: 6,
            border: "1px solid var(--border)", background: "transparent",
            color: "var(--muted)", textDecoration: "none", marginRight: 14, flexShrink: 0,
          }}
          aria-label="Back to characters"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{
            width: 24, height: 24, borderRadius: "50%", background: gradient,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <span style={{ fontFamily: T.fontHeading, fontSize: 11, fontWeight: 600, color: "#0C0E14", lineHeight: "12px" }}>
              {initial}
            </span>
          </div>
          <span style={{
            fontFamily: T.fontHeading, fontSize: 16, fontWeight: 700, color: T.fg, lineHeight: "18px", whiteSpace: "nowrap",
          }}>
            {character.title}
          </span>
        </div>

        <span style={{ width: 1, height: 20, background: "var(--border)", display: "block", marginLeft: 14, marginRight: 14, flexShrink: 0 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {TABS.map((t) => {
            const active = t.key === activeTab;
            return (
              <Link
                key={t.key}
                href={`/characters/${character.slug}${t.key === "overview" ? "" : `/${t.key}`}`}
                style={{
                  padding: "5px 12px", borderRadius: 8,
                  background: active ? "rgba(140,231,210,0.12)" : "transparent",
                  color: active ? "#8CE7D2" : T.muted,
                  fontFamily: T.fontBody, fontSize: 12, fontWeight: 500,
                  textDecoration: "none", whiteSpace: "nowrap",
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <Link
            href={`/characters/${character.slug}/ingestion`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 12px", borderRadius: 8,
              border: "1px solid var(--border)", background: "transparent",
              color: "var(--foreground)",
              fontFamily: T.fontBody, fontSize: 11, fontWeight: 500,
              textDecoration: "none", whiteSpace: "nowrap",
            }}
          >
            + Ingest
          </Link>
          <Link
            href={`/characters/${character.slug}/chat`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 8, border: "none",
              background: "#8CE7D2", color: "#0C0E14",
              fontFamily: T.fontBody, fontSize: 11, fontWeight: 600,
              textDecoration: "none", whiteSpace: "nowrap",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            Test Chat
          </Link>
        </div>
      </>,
    );
    return () => setContent(null);
  }, [pathname, setContent, character.id, character.slug, character.title, activeTab, gradient, initial]);

  return null;
}
