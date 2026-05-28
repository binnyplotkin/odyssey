"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { KnowledgeGraphIcon } from "@/components/knowledge-graph-icon";
import { useHeaderContent } from "@/components/header-context";
import { SortMenu } from "@/components/sort-menu";
import { createUnnamedWiki } from "./actions";
import type { WikiListItem } from "./page";

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";

type SortKey = "recent" | "title" | "pages";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently updated" },
  { key: "title", label: "Title A-Z" },
  { key: "pages", label: "Most pages" },
];

function applySort(list: WikiListItem[], sort: SortKey): WikiListItem[] {
  const base = [...list];
  if (sort === "title") {
    return base.sort((a, b) => a.title.localeCompare(b.title));
  }
  if (sort === "pages") {
    return base.sort((a, b) => b.pageCount - a.pageCount);
  }
  return base.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

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
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");

  const filtered = useMemo(() => {
    const base = !search.trim()
      ? wikis
      : (() => {
          const q = search.trim().toLowerCase();
          return wikis.filter(
            (wiki) =>
              wiki.title.toLowerCase().includes(q) ||
              wiki.slug.toLowerCase().includes(q) ||
              (wiki.summary ?? "").toLowerCase().includes(q) ||
              wiki.boundCharacters.some((c) =>
                c.title.toLowerCase().includes(q),
              ),
          );
        })();
    return applySort(base, sort);
  }, [wikis, search, sort]);

  const { setContent, setFlush } = useHeaderContent();
  useEffect(() => {
    setFlush(true);
    setContent(
      <div
        style={{
          height: "100%",
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
            whiteSpace: "nowrap",
          }}
        >
          WIKIS
        </span>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-8)" }}>
          {wikis.length > 0 && <RefreshButton />}
          <CreateWikiButton />
        </div>
      </div>,
    );
    return () => {
      setContent(null);
      setFlush(false);
    };
  }, [setContent, setFlush, wikis.length]);

  if (wikis.length === 0) {
    return (
      <div
        style={{
          minHeight: "100%",
          background: "var(--page-atmosphere)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "96px 32px",
          gap: "var(--space-18)",
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
          wikis · empty
        </span>
        <h2
          style={{
            fontFamily: FONT_HEAD,
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: 0,
            color: "var(--text-primary)",
            textAlign: "center",
          }}
        >
          No shared wikis yet
        </h2>
        <p
          style={{
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-lg)",
            lineHeight: "22px",
            color: "var(--text-secondary)",
            margin: 0,
            maxWidth: 560,
            textAlign: "center",
          }}
        >
          Shared wikis collect source material, pages, eras, and character
          bindings. Migrate existing character knowledge to populate this page.
        </p>
        <code
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.04em",
            color: "var(--text-tertiary)",
            padding: "8px 12px",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            background: "var(--material-card)",
          }}
        >
          scripts/migrate-wikis-to-shared.ts
        </code>
        <CreateWikiButton size="large" label="+ create your first wiki" />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100%",
        background: "var(--page-atmosphere)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-16)",
          flexWrap: "wrap",
          padding: "24px 40px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-16)",
            flex: "1 1 490px",
            flexWrap: "wrap",
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-10)",
              padding: "9px 16px",
              background: "var(--control-bg)",
              border: "1px solid var(--control-border)",
              borderRadius: "var(--radius-pill)",
              width: 360,
              maxWidth: "100%",
              flex: "0 1 360px",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <circle
                cx="6"
                cy="6"
                r="4.5"
                stroke="var(--text-tertiary)"
                strokeWidth="1.5"
              />
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
              placeholder="search wikis..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                outline: "none",
                fontSize: "var(--font-size-md)",
                color: "var(--text-primary)",
                fontFamily: FONT_HEAD,
              }}
            />
          </div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
            }}
          >
            showing {filtered.length} of {wikis.length}
          </span>
        </div>

        <SortMenu options={SORT_OPTIONS} sort={sort} onChange={setSort} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: "var(--space-16)",
          width: "100%",
          padding: "0 40px 56px",
        }}
      >
        {filtered.map((wiki) => (
          <WikiCard key={wiki.id} wiki={wiki} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "4rem 2rem",
            gap: "var(--space-10)",
          }}
        >
          <div
            style={{
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-2xl)",
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            No wikis match that search
          </div>
          <div
            style={{
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-base)",
              color: "var(--text-secondary)",
            }}
          >
            Try a title, slug, summary, or bound character.
          </div>
        </div>
      )}
    </div>
  );
}

function WikiCard({ wiki }: { wiki: WikiListItem }) {
  const [hovered, setHovered] = useState(false);
  const visibleCharacters = wiki.boundCharacters.slice(0, 3);
  const overflowCharacters = wiki.boundCharacters.length - visibleCharacters.length;
  const promptName = wiki.ingestionPromptName ?? `${wiki.title} lens`;

  return (
    <Link
      href={`/wikis/${wiki.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 280,
        position: "relative",
        padding: "var(--space-18)",
        gap: "var(--space-14)",
        borderRadius: "var(--radius-2xl)",
        background: "var(--material-card)",
        border: `1px solid ${hovered ? "var(--accent-glow)" : "var(--border-subtle)"}`,
        textDecoration: "none",
        color: "inherit",
        cursor: "pointer",
        transition: "border-color 120ms ease, background 120ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
        <div
          style={{
            width: 48,
            height: 48,
            flexShrink: 0,
            borderRadius: "var(--radius-lg)",
            background: "var(--ink-fill)",
            border: "1px solid color-mix(in srgb, var(--accent-strong) 18%, transparent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: ACCENT,
          }}
        >
          <KnowledgeGraphIcon data={wiki.iconData} size={38} density="spacious" />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
            flex: 1,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-2xl)",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              lineHeight: 1.15,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {wiki.title}
          </span>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.04em",
              color: "var(--text-tertiary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {wiki.slug}
            {wiki.eras.length > 0 &&
              ` · ${wiki.eras.length} era${wiki.eras.length === 1 ? "" : "s"}`}
            {` · updated ${relative(wiki.updatedAt)}`}
          </span>
        </div>
      </div>

      <p
        style={{
          margin: 0,
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-base)",
          lineHeight: "18px",
          color: "var(--text-secondary)",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
        }}
      >
        {wiki.summary ?? "No summary written yet."}
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          padding: "var(--space-14)",
          background: "var(--ink-wash)",
          border: "1px solid var(--ink-soft)",
          borderRadius: "var(--radius-lg)",
        }}
      >
        <StatCell
          label="pages"
          value={wiki.pageCount === 0 ? "-" : String(wiki.pageCount)}
          accent={wiki.pageCount > 0}
          dim={wiki.pageCount === 0}
          first
        />
        <StatCell
          label="sources"
          value={wiki.sourceCount === 0 ? "-" : String(wiki.sourceCount)}
          dim={wiki.sourceCount === 0}
        />
        <StatCell
          label="characters"
          value={
            wiki.boundCharacters.length === 0
              ? "unbound"
              : String(wiki.boundCharacters.length)
          }
          dim={wiki.boundCharacters.length === 0}
          last
        />
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-6)",
          minHeight: 24,
        }}
      >
        {visibleCharacters.length === 0 ? (
          <span
            style={{
              padding: "3px 8px",
              borderRadius: "var(--radius-sm)",
              background: "var(--ink-soft)",
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-sm)",
              color: "var(--text-tertiary)",
              whiteSpace: "nowrap",
            }}
          >
            unbound
          </span>
        ) : (
          visibleCharacters.map((c) => (
            <span
              key={c.id}
              style={{
                padding: "3px 8px",
                borderRadius: "var(--radius-sm)",
                background: "var(--ink-soft)",
                fontFamily: FONT_HEAD,
                fontSize: "var(--font-size-sm)",
                color: "var(--text-secondary)",
                whiteSpace: "nowrap",
              }}
            >
              {c.title}
            </span>
          ))
        )}
        {overflowCharacters > 0 && (
          <span
            style={{
              padding: "3px 8px",
              borderRadius: "var(--radius-sm)",
              background: "var(--ink-soft)",
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-sm)",
              color: "var(--text-secondary)",
              whiteSpace: "nowrap",
            }}
          >
            +{overflowCharacters}
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-12)",
          paddingTop: "var(--space-10)",
          marginTop: "auto",
          borderTop: "1px solid var(--ink-soft)",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            minWidth: 0,
            padding: "2px 8px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--ink-line)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-2xs)",
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={`Ingestion prompt: ${promptName}`}
        >
          {promptName}
        </span>
        <span
          aria-hidden
          style={{
            color: "var(--text-tertiary)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-base)",
            flexShrink: 0,
          }}
        >
          →
        </span>
      </div>
    </Link>
  );
}

function StatCell({
  label,
  value,
  accent,
  dim,
  first,
  last,
}: {
  label: string;
  value: string;
  accent?: boolean;
  dim?: boolean;
  first?: boolean;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        flex: 1,
        minWidth: 0,
        paddingLeft: first ? 0 : 14,
        paddingRight: last ? 0 : 14,
        borderRight: last
          ? "none"
          : "1px solid color-mix(in srgb, var(--text-primary) 5%, transparent)",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-2xs)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: accent ? FONT_HEAD : FONT_MONO,
          fontSize: accent ? 14 : 11,
          fontWeight: accent ? 600 : 400,
          letterSpacing: accent ? "-0.01em" : "normal",
          color: dim
            ? "var(--text-quaternary)"
            : accent
              ? ACCENT
              : "var(--text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <>
      <style>{`@keyframes wikis-refresh-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        aria-label={pending ? "Refreshing" : "Refresh"}
        title="Refresh"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 28,
          padding: 0,
          border: "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)",
          borderRadius: "var(--radius-pill)",
          background: "transparent",
          color: "var(--text-tertiary)",
          cursor: pending ? "progress" : "pointer",
          opacity: pending ? 0.75 : 1,
          transition: "color 120ms, border-color 120ms",
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            animation: pending
              ? "wikis-refresh-spin 800ms linear infinite"
              : undefined,
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

function CreateWikiButton({
  label = "+ wiki",
  size = "default",
}: {
  label?: string;
  size?: "default" | "large";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const large = size === "large";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await createUnnamedWiki();
            if (!res.ok) setError(res.error);
          });
        }}
        disabled={pending}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-6)",
          padding: large ? "12px 22px" : "7px 16px",
          border: `1px solid ${ACCENT}`,
          borderRadius: "var(--radius-pill)",
          background: ACCENT,
          color: "var(--accent-on)",
          fontFamily: FONT_HEAD,
          fontSize: large ? "var(--font-size-lg)" : "var(--font-size-base)",
          fontWeight: 600,
          cursor: pending ? "progress" : "pointer",
          opacity: pending ? 0.72 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {pending ? "creating..." : label}
      </button>
      {error && (
        <div
          role="alert"
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 1200,
            padding: "12px 16px",
            background:
              "color-mix(in srgb, var(--status-error) 12%, transparent)",
            border:
              "1px solid color-mix(in srgb, var(--status-error) 40%, transparent)",
            color: "var(--status-error)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-base)",
          }}
        >
          {error}
        </div>
      )}
    </>
  );
}
