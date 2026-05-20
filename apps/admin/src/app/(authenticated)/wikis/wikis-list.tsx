"use client";

import Link from "next/link";
import { useHeaderContent } from "@/components/header-context";
import { useEffect } from "react";
import type { WikiListItem } from "./page";
import { KnowledgeGraphIcon } from "@/components/knowledge-graph-icon";

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

function relative(iso: string): string {
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
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function WikisList({ wikis }: { wikis: WikiListItem[] }) {
  const { setContent } = useHeaderContent();
  useEffect(() => {
    setContent(
      <h1
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: T.fg,
          margin: 0,
          fontFamily: T.fontHeading,
        }}
      >
        Wikis
      </h1>,
    );
    return () => setContent(null);
  }, [setContent]);

  return (
    <div
      style={{
        padding: "28px 32px",
        fontFamily: T.fontBody,
        color: T.fg,
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            style={{
              fontFamily: T.fontMono,
              fontSize: 10,
              color: T.muted,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {wikis.length} wiki{wikis.length === 1 ? "" : "s"}
          </div>
          <div
            style={{
              fontFamily: T.fontHeading,
              fontSize: 26,
              letterSpacing: "-0.02em",
            }}
          >
            Wikis
          </div>
        </div>
        {/* TODO: Phase 2 — create-wiki action */}
      </div>

      {wikis.length === 0 ? (
        <div
          style={{
            padding: 40,
            border: `1px dashed ${T.border}`,
            borderRadius: 14,
            color: T.muted,
            fontFamily: T.fontMono,
            fontSize: 12,
            textAlign: "center",
          }}
        >
          No wikis yet. Run{" "}
          <code
            style={{ fontFamily: T.fontMono, color: T.accent }}
          >
            scripts/migrate-wikis-to-shared.ts
          </code>{" "}
          to migrate existing per-character wikis into shared ones.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {wikis.map((wiki) => (
            <WikiRow key={wiki.id} wiki={wiki} />
          ))}
        </div>
      )}
    </div>
  );
}

function WikiRow({ wiki }: { wiki: WikiListItem }) {
  return (
    <Link
      href={`/wikis/${wiki.id}`}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1.6fr 1.4fr 1fr",
        gap: 20,
        padding: "18px 22px",
        background: T.panel,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        textDecoration: "none",
        color: "inherit",
        transition: "background 120ms ease",
        alignItems: "center",
      }}
    >
      {/* Graph fingerprint */}
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 10,
          border: `1px solid ${T.border}`,
          background: "var(--card-hover)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: T.accentStrong,
          flexShrink: 0,
        }}
      >
        <KnowledgeGraphIcon data={wiki.iconData} size={44} density="spacious" />
      </div>

      {/* Identity */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            fontFamily: T.fontHeading,
            fontSize: 16,
            letterSpacing: "-0.01em",
          }}
        >
          {wiki.title}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 10,
            alignItems: "center",
            fontFamily: T.fontMono,
            fontSize: 10,
            color: T.muted,
            letterSpacing: "0.04em",
          }}
        >
          <span>{wiki.slug}</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{wiki.eras.length} era{wiki.eras.length === 1 ? "" : "s"}</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>updated {relative(wiki.updatedAt)}</span>
        </div>
        {wiki.summary && (
          <div
            style={{
              fontFamily: T.fontBody,
              fontSize: 12,
              color: T.muted,
              lineHeight: 1.5,
              marginTop: 2,
            }}
          >
            {wiki.summary}
          </div>
        )}
      </div>

      {/* Bound characters */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            fontFamily: T.fontMono,
            fontSize: 10,
            color: T.muted,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          bound to {wiki.boundCharacters.length} character{wiki.boundCharacters.length === 1 ? "" : "s"}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {wiki.boundCharacters.length === 0 ? (
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 11,
                color: T.muted,
                fontStyle: "italic",
              }}
            >
              unbound
            </span>
          ) : (
            wiki.boundCharacters.map((c) => (
              <span
                key={c.id}
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 11,
                  padding: "3px 9px",
                  border: `1px solid ${T.border}`,
                  borderRadius: 999,
                  color: T.fg,
                }}
              >
                {c.title}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Counts */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "10px 18px",
          alignContent: "start",
          fontFamily: T.fontMono,
        }}
      >
        <Counter label="pages" n={wiki.pageCount} />
        <Counter label="sources" n={wiki.sourceCount} />
      </div>
    </Link>
  );
}

function Counter({ label, n }: { label: string; n: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div
        style={{
          fontSize: 18,
          color: T.fg,
          fontFamily: T.fontHeading,
          letterSpacing: "-0.01em",
        }}
      >
        {n.toLocaleString()}
      </div>
      <div
        style={{
          fontSize: 9,
          color: T.muted,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
    </div>
  );
}
