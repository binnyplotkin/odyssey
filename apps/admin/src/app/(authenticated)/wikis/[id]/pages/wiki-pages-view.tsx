"use client";

import Link from "next/link";
import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  EraConfig,
  WikiEdgeRecord,
  WikiPageRecord,
  WikiPageType,
  WikiSourceRecord,
  WikiSourceRefRecord,
} from "@odyssey/db";

/* ── Tokens (phosphor / terminal) ──────────────────────────────── */

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const DISPLAY = '"Space Grotesk", system-ui, sans-serif';
const BODY = '"Geist", "Inter", system-ui, sans-serif';

const FG = "rgba(255, 255, 255, 0.95)";
const TEXT_PRIMARY = "rgba(255, 255, 255, 0.88)";
const TEXT_SECONDARY = "rgba(255, 255, 255, 0.7)";
const TEXT_MUTED = "rgba(255, 255, 255, 0.55)";
const TEXT_FADED = "rgba(255, 255, 255, 0.4)";
const TEXT_GHOST = "rgba(255, 255, 255, 0.32)";
const TEXT_QUIET = "rgba(255, 255, 255, 0.2)";

const GROUND = "#050505";
const PANEL_BG = "#0A0A0A";
const BORDER = "rgba(255, 255, 255, 0.08)";
const DIVIDER = "rgba(255, 255, 255, 0.06)";
const INPUT_BG = "rgba(255, 255, 255, 0.02)";

const ACCENT = "#8CE7D2";
const ACCENT_SOFT = "rgba(140, 231, 210, 0.06)";
const ACCENT_RING = "rgba(140, 231, 210, 0.3)";

const SECONDARY = "#B79EFF";
const DANGER = "#f87171";

/** Six-color type palette — same one used in the knowledge graph. */
const TYPE_COLOR: Record<WikiPageType, string> = {
  entity: "#8CE7D2",
  event: "#60A5FA",
  concept: "#A78BFA",
  relationship: "#FACC15",
  timeline: "#2DD4BF",
  voice_identity: "#F472B6",
};

const TYPE_PLURAL: Record<WikiPageType, string> = {
  entity: "entities",
  event: "events",
  concept: "concepts",
  relationship: "relations",
  timeline: "timeline",
  voice_identity: "voice",
};

type TypeFilter = "all" | WikiPageType;

const FILTER_ORDER: TypeFilter[] = [
  "all",
  "entity",
  "event",
  "concept",
  "relationship",
  "timeline",
  "voice_identity",
];

/* ── Helpers ───────────────────────────────────────────────────── */

function frontmatterSubkind(p: WikiPageRecord): string | null {
  const fm = p.frontmatter as Record<string, unknown>;
  return typeof fm.kind === "string" ? (fm.kind as string) : null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
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
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ── Props ─────────────────────────────────────────────────────── */

export type WikiPagesViewProps = {
  wikiId: string;
  eras: EraConfig[];
  pages: WikiPageRecord[];
  edges: WikiEdgeRecord[];
  sources: WikiSourceRecord[];
  /** All source refs for this wiki — filtered to the selected page client-side. */
  allSourceRefs: WikiSourceRefRecord[];
  initialSelectedSlug: string | null;
  routeBase: string;
};

/* ── Component ─────────────────────────────────────────────────── */

export function WikiPagesView({
  eras,
  pages,
  edges,
  sources,
  allSourceRefs,
  initialSelectedSlug,
  routeBase,
}: WikiPagesViewProps) {
  const router = useRouter();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(
    initialSelectedSlug ?? (pages[0]?.slug ?? null),
  );
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  /* Indices */
  const pageById = useMemo(
    () => new Map(pages.map((p) => [p.id, p])),
    [pages],
  );
  const pageBySlug = useMemo(
    () => new Map(pages.map((p) => [p.slug, p])),
    [pages],
  );
  const linksCountById = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) {
      m.set(e.fromPageId, (m.get(e.fromPageId) ?? 0) + 1);
      m.set(e.toPageId, (m.get(e.toPageId) ?? 0) + 1);
    }
    return m;
  }, [edges]);
  const sourceById = useMemo(
    () => new Map(sources.map((s) => [s.id, s])),
    [sources],
  );
  const refsByPageId = useMemo(() => {
    const m = new Map<string, WikiSourceRefRecord[]>();
    for (const r of allSourceRefs) {
      const list = m.get(r.pageId) ?? [];
      list.push(r);
      m.set(r.pageId, list);
    }
    return m;
  }, [allSourceRefs]);

  /* Type counts drive the chip badges */
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = { all: pages.length };
    for (const p of pages) c[p.type] = (c[p.type] ?? 0) + 1;
    return c;
  }, [pages]);

  /* Filtered + grouped pages for the left list */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pages
      .filter((p) => (typeFilter === "all" ? true : p.type === typeFilter))
      .filter((p) => {
        if (!q) return true;
        return (
          p.title.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q) ||
          (p.summary ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [pages, query, typeFilter]);

  const grouped = useMemo(() => {
    const byEra = new Map<string, WikiPageRecord[]>();
    for (const p of filtered) {
      const eraKey = p.timeIndex?.era ?? "_unscoped";
      const list = byEra.get(eraKey) ?? [];
      list.push(p);
      byEra.set(eraKey, list);
    }
    const order: Array<{ key: string; title: string; pages: WikiPageRecord[] }> =
      [];
    const sortedEras = [...eras].sort((a, b) => a.order - b.order);
    for (const era of sortedEras) {
      const list = byEra.get(era.key);
      if (list && list.length > 0) {
        order.push({ key: era.key, title: era.title, pages: list });
        byEra.delete(era.key);
      }
    }
    for (const [key, list] of byEra) {
      order.push({
        key,
        title: key === "_unscoped" ? "Unscoped" : key,
        pages: list,
      });
    }
    return order;
  }, [filtered, eras]);

  const selected = selectedSlug ? pageBySlug.get(selectedSlug) ?? null : null;

  function handleSelect(p: WikiPageRecord) {
    setSelectedSlug(p.slug);
    router.replace(`${routeBase}/pages?page=${p.slug}`, { scroll: false });
  }

  const totalEdges = edges.length;
  const totalSources = sources.length;
  const hasResults = grouped.length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 67px)",
        background: GROUND,
      }}
    >
      {/* Top eyebrow */}
      <TopEyebrow
        pageCount={pages.length}
        edgeCount={totalEdges}
        sourceCount={totalSources}
        routeBase={routeBase}
      />

      {/* Filter strip */}
      <FilterStrip
        query={query}
        onQueryChange={setQuery}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        typeCounts={typeCounts}
      />

      {/* Two columns */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "480px minmax(0, 1fr)",
          gap: 24,
          flex: 1,
          minHeight: 0,
          padding: "16px 24px 24px",
        }}
      >
        {/* List */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            border: `1px solid ${BORDER}`,
            background: PANEL_BG,
            overflow: "hidden",
          }}
        >
          <ListHeader
            total={pages.length}
            visible={filtered.length}
          />
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {!hasResults ? (
              <EmptyState>No pages match this filter.</EmptyState>
            ) : (
              grouped.map((group) => (
                <EraGroup
                  key={group.key}
                  era={group}
                  selectedSlug={selectedSlug}
                  linksCountById={linksCountById}
                  refsByPageId={refsByPageId}
                  onSelect={handleSelect}
                />
              ))
            )}
          </div>
          <ListFooter
            visible={filtered.length}
            total={pages.length}
            embedded={pages.length}
          />
        </div>

        {/* Detail */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            border: `1px solid ${BORDER}`,
            background: PANEL_BG,
            overflow: "hidden",
          }}
        >
          {selected ? (
            <PageDetail
              page={selected}
              edges={edges}
              pageById={pageById}
              sourceRefs={refsByPageId.get(selected.id) ?? []}
              sourceById={sourceById}
              linksCountById={linksCountById}
              routeBase={routeBase}
              onSelectLinked={handleSelect}
            />
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <EmptyState>Select a page to see its details.</EmptyState>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Top eyebrow ─────────────────────────────────────────────── */

function TopEyebrow({
  pageCount,
  edgeCount,
  sourceCount,
  routeBase,
}: {
  pageCount: number;
  edgeCount: number;
  sourceCount: number;
  routeBase: string;
}) {
  const slug = routeBase.replace("/wikis/", "");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "20px 24px 16px",
        color: TEXT_FADED,
        fontFamily: MONO,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: ACCENT,
          flexShrink: 0,
        }}
      />
      <Link
        href="/wikis"
        style={{ color: TEXT_FADED, textDecoration: "none" }}
      >
        WIKIS
      </Link>
      <span style={{ color: TEXT_QUIET }}>/</span>
      <Link
        href={routeBase}
        style={{
          color: TEXT_SECONDARY,
          textDecoration: "none",
          letterSpacing: "0.06em",
        }}
      >
        {slug.toUpperCase()}
      </Link>
      <span style={{ color: TEXT_QUIET }}>/</span>
      <span style={{ color: ACCENT, letterSpacing: "0.06em" }}>PAGES</span>
      <span style={{ flex: 1, height: 1, background: DIVIDER }} />
      <span
        style={{
          color: TEXT_GHOST,
          letterSpacing: "0.1em",
        }}
      >
        {pageCount} page{pageCount === 1 ? "" : "s"} · {edgeCount} edges ·{" "}
        {sourceCount} source{sourceCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}

/* ── Filter strip ────────────────────────────────────────────── */

function FilterStrip({
  query,
  onQueryChange,
  typeFilter,
  onTypeFilterChange,
  typeCounts,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  typeFilter: TypeFilter;
  onTypeFilterChange: (t: TypeFilter) => void;
  typeCounts: Record<string, number>;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 44,
        margin: "0 24px",
        padding: "0 12px",
        background: PANEL_BG,
        border: `1px solid ${BORDER}`,
      }}
    >
      <SearchInput value={query} onChange={onQueryChange} />
      <span style={{ width: 1, height: 20, background: BORDER }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {FILTER_ORDER.map((t) => {
          const active = typeFilter === t;
          const count = typeCounts[t] ?? 0;
          if (t === "all") {
            return (
              <button
                key={t}
                type="button"
                onClick={() => onTypeFilterChange(t)}
                style={chipStyle(active, ACCENT, ACCENT_RING, ACCENT_SOFT)}
              >
                <span style={{ letterSpacing: "0.1em" }}>ALL</span>
                <span
                  style={{
                    color: active ? "rgba(140,231,210,0.6)" : TEXT_FADED,
                  }}
                >
                  {count}
                </span>
              </button>
            );
          }
          const color = TYPE_COLOR[t as WikiPageType];
          return (
            <button
              key={t}
              type="button"
              onClick={() => onTypeFilterChange(t)}
              style={chipStyle(
                active,
                color,
                `${color}4D`,
                `${color}10`,
              )}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  background: color,
                  flexShrink: 0,
                }}
              />
              <span style={{ letterSpacing: "0.1em" }}>
                {TYPE_PLURAL[t as WikiPageType].toUpperCase()}
              </span>
              <span
                style={{
                  color: active ? `${color}AA` : TEXT_FADED,
                }}
              >
                {pad2(count)}
              </span>
            </button>
          );
        })}
      </div>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 28,
          padding: "0 14px",
          background: ACCENT,
          color: "#050505",
          border: "none",
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          cursor: "pointer",
        }}
      >
        + Page
      </button>
    </div>
  );
}

function chipStyle(
  active: boolean,
  color: string,
  ring: string,
  soft: string,
): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 26,
    padding: "0 10px",
    border: `1px solid ${active ? ring : BORDER}`,
    background: active ? soft : "transparent",
    color: active ? color : TEXT_SECONDARY,
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: active ? 500 : 400,
    cursor: "pointer",
    textTransform: "uppercase",
  };
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 32,
        width: 320,
        padding: "0 12px",
        border: `1px solid rgba(255, 255, 255, 0.12)`,
        background: INPUT_BG,
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 13 13"
        fill="none"
        style={{ flexShrink: 0 }}
      >
        <circle cx="5.5" cy="5.5" r="3.5" stroke={TEXT_MUTED} strokeWidth="1" />
        <line
          x1="8.5"
          y1="8.5"
          x2="11.5"
          y2="11.5"
          stroke={TEXT_MUTED}
          strokeWidth="1"
          strokeLinecap="square"
        />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search title · summary · body…"
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: FG,
          fontFamily: MONO,
          fontSize: 12,
        }}
      />
      <span style={{ color: TEXT_GHOST, fontFamily: MONO, fontSize: 10 }}>
        ⌘F
      </span>
    </div>
  );
}

/* ── List chrome ─────────────────────────────────────────────── */

function ListHeader({
  total,
  visible,
}: {
  total: number;
  visible: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderBottom: `1px solid ${BORDER}`,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          color: FG,
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        Pages
      </span>
      <span style={{ flex: 1, height: 1, background: DIVIDER }} />
      <span style={{ color: TEXT_GHOST, fontFamily: MONO, fontSize: 10 }}>
        {visible} of {total}
      </span>
    </div>
  );
}

function ListFooter({
  visible,
  total,
  embedded,
}: {
  visible: number;
  total: number;
  embedded: number;
}) {
  const allShown = visible === total;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderTop: `1px solid ${BORDER}`,
        flexShrink: 0,
        color: TEXT_FADED,
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: "0.06em",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: ACCENT,
          }}
        />
        <span style={{ color: TEXT_SECONDARY }}>
          {embedded} embedded
        </span>
      </span>
      <span style={{ color: TEXT_QUIET }}>·</span>
      <span>
        showing {visible} of {total}
        {!allShown && " · scroll for more"}
      </span>
    </div>
  );
}

/* ── Era group ───────────────────────────────────────────────── */

function EraGroup({
  era,
  selectedSlug,
  linksCountById,
  refsByPageId,
  onSelect,
}: {
  era: { key: string; title: string; pages: WikiPageRecord[] };
  selectedSlug: string | null;
  linksCountById: Map<string, number>;
  refsByPageId: Map<string, WikiSourceRefRecord[]>;
  onSelect: (p: WikiPageRecord) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px 8px 16px",
          color: TEXT_FADED,
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        <span>{era.title}</span>
        <span style={{ flex: 1, height: 1, background: DIVIDER }} />
        <span style={{ color: TEXT_GHOST }}>
          {pad2(era.pages.length)} page{era.pages.length === 1 ? "" : "s"}
        </span>
      </div>
      {era.pages.map((p) => (
        <PageRow
          key={p.id}
          page={p}
          active={p.slug === selectedSlug}
          links={linksCountById.get(p.id) ?? 0}
          sourceRefCount={(refsByPageId.get(p.id) ?? []).length}
          onSelect={() => onSelect(p)}
        />
      ))}
    </div>
  );
}

/* ── Page row ────────────────────────────────────────────────── */

function PageRow({
  page,
  active,
  links,
  sourceRefCount,
  onSelect,
}: {
  page: WikiPageRecord;
  active: boolean;
  links: number;
  sourceRefCount: number;
  onSelect: () => void;
}) {
  const color = TYPE_COLOR[page.type];
  const sub = frontmatterSubkind(page);
  const conf = Math.round((page.confidence ?? 0) * 100) / 100;
  const lowConf = page.confidence < 0.5;
  const era = page.timeIndex?.era ?? null;
  const era_t = page.timeIndex?.index ?? null;

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "12px 14px 12px 12px",
        borderTop: "none",
        borderRight: "none",
        borderBottom: `1px solid ${DIVIDER}`,
        borderLeft: `2px solid ${active ? ACCENT : "transparent"}`,
        background: active ? ACCENT_SOFT : "transparent",
        textAlign: "left",
        cursor: "pointer",
        color: "inherit",
        fontFamily: "inherit",
        opacity: lowConf ? 0.72 : 1,
        transition: "background 150ms",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 6,
            height: 6,
            background: color,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            color: active ? FG : TEXT_PRIMARY,
            fontFamily: BODY,
            fontSize: 13,
            fontWeight: active ? 500 : 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
        >
          {page.title}
        </span>
        <span
          style={{
            color: active ? ACCENT : TEXT_MUTED,
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: "0.06em",
            flexShrink: 0,
          }}
        >
          {pad2(links)} link{links === 1 ? "" : "s"}
        </span>
      </div>
      {page.summary && (
        <div
          style={{
            paddingLeft: 16,
            color: TEXT_MUTED,
            fontFamily: BODY,
            fontSize: 12,
            lineHeight: "18px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {page.summary}
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          paddingLeft: 16,
          color: TEXT_FADED,
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: "0.04em",
        }}
      >
        {sub && <span>kind · {sub}</span>}
        {era && (
          <>
            {sub && <span style={{ color: TEXT_QUIET }}>·</span>}
            <span>
              {era}
              {era_t !== null ? ` · t=${pad2(era_t)}` : ""}
            </span>
          </>
        )}
        {sourceRefCount > 0 && (
          <>
            {(sub || era) && <span style={{ color: TEXT_QUIET }}>·</span>}
            <span>
              {sourceRefCount} source{sourceRefCount === 1 ? "" : "s"}
            </span>
          </>
        )}
        {!lowConf && (
          <>
            {(sub || era || sourceRefCount > 0) && (
              <span style={{ color: TEXT_QUIET }}>·</span>
            )}
            <span>conf {conf.toFixed(2)}</span>
          </>
        )}
        {lowConf && (
          <>
            {(sub || era || sourceRefCount > 0) && (
              <span style={{ color: TEXT_QUIET }}>·</span>
            )}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                color: DANGER,
              }}
            >
              <span
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: DANGER,
                }}
              />
              low confidence · {conf.toFixed(2)}
            </span>
          </>
        )}
      </div>
    </button>
  );
}

/* ── Page detail ─────────────────────────────────────────────── */

function PageDetail({
  page,
  edges,
  pageById,
  sourceRefs,
  sourceById,
  linksCountById,
  routeBase,
  onSelectLinked,
}: {
  page: WikiPageRecord;
  edges: WikiEdgeRecord[];
  pageById: Map<string, WikiPageRecord>;
  sourceRefs: WikiSourceRefRecord[];
  sourceById: Map<string, WikiSourceRecord>;
  linksCountById: Map<string, number>;
  routeBase: string;
  onSelectLinked: (p: WikiPageRecord) => void;
}) {
  const color = TYPE_COLOR[page.type];
  const sub = frontmatterSubkind(page);
  const era = page.timeIndex?.era ?? null;
  const fm = page.frontmatter as Record<string, unknown>;
  const aliases = Array.isArray(fm.aliases) ? (fm.aliases as string[]) : [];
  const participants = Array.isArray(fm.participants)
    ? (fm.participants as string[])
    : [];

  const linkedIds = new Set<string>();
  for (const e of edges) {
    if (e.fromPageId === page.id) linkedIds.add(e.toPageId);
    else if (e.toPageId === page.id) linkedIds.add(e.fromPageId);
  }
  const linkedPages = Array.from(linkedIds)
    .map((id) => pageById.get(id))
    .filter((p): p is WikiPageRecord => Boolean(p))
    .sort(
      (a, b) =>
        (linksCountById.get(b.id) ?? 0) - (linksCountById.get(a.id) ?? 0),
    );

  const links = linksCountById.get(page.id) ?? 0;
  const bodyExcerpt =
    page.body.length > 720 ? `${page.body.slice(0, 720)}…` : page.body;
  const words = page.body.trim().split(/\s+/).filter(Boolean).length;
  const chars = page.body.length;
  const conf = Math.round((page.confidence ?? 0) * 100) / 100;

  const frontmatterRows: Array<{ label: string; value: ReactNode }> = [];
  if (sub) frontmatterRows.push({ label: "Kind", value: sub });
  if (aliases.length > 0) {
    frontmatterRows.push({
      label: "Aliases",
      value: (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {aliases.map((a) => (
            <span
              key={a}
              style={{
                padding: "2px 8px",
                border: `1px solid rgba(255, 255, 255, 0.12)`,
                color: TEXT_PRIMARY,
                fontFamily: MONO,
                fontSize: 11,
              }}
            >
              {a}
            </span>
          ))}
        </div>
      ),
    });
  }
  if (typeof fm.firstAppearance === "string") {
    frontmatterRows.push({
      label: "First appears",
      value: String(fm.firstAppearance),
    });
  }
  if (typeof fm.lastAppearance === "string") {
    frontmatterRows.push({
      label: "Last appears",
      value: String(fm.lastAppearance),
    });
  }
  if (typeof fm.where === "string") {
    frontmatterRows.push({ label: "Where", value: String(fm.where) });
  }
  if (participants.length > 0) {
    frontmatterRows.push({
      label: "Participants",
      value: participants.join(", "),
    });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: ACCENT,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            color: TEXT_FADED,
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Page
        </span>
        <span style={{ color: TEXT_QUIET, fontFamily: MONO }}>·</span>
        <span
          style={{
            color: TEXT_SECONDARY,
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {page.type === "voice_identity" ? "Voice" : page.type}
        </span>
        <span style={{ color: TEXT_QUIET, fontFamily: MONO }}>·</span>
        <span style={{ color: TEXT_MUTED, fontFamily: MONO, fontSize: 10 }}>
          /pages/{page.slug}
        </span>
        <span style={{ flex: 1 }} />
        <Link
          href={`${routeBase}/pages/${page.slug}?edit=1`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 26,
            padding: "0 10px",
            border: `1px solid rgba(255, 255, 255, 0.16)`,
            color: TEXT_PRIMARY,
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            textDecoration: "none",
          }}
        >
          EDIT ↗
        </Link>
        <Link
          href={`${routeBase}/knowledge?page=${page.slug}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 26,
            padding: "0 10px",
            border: `1px solid rgba(255, 255, 255, 0.16)`,
            color: TEXT_PRIMARY,
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            textDecoration: "none",
          }}
        >
          FOCUS ↻
        </Link>
        <button
          type="button"
          aria-label="More"
          style={{
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            background: "transparent",
            color: TEXT_MUTED,
            fontFamily: MONO,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          ⋯
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {/* Identity */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "22px 24px 18px",
            borderBottom: `1px solid ${DIVIDER}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                color: FG,
                fontFamily: DISPLAY,
                fontSize: 32,
                fontWeight: 500,
                lineHeight: "38px",
                letterSpacing: "-0.01em",
              }}
            >
              {page.title}
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 8px",
                border: `1px solid ${color}4D`,
                background: `${color}14`,
                color,
                fontFamily: MONO,
                fontSize: 9,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: color,
                }}
              />
              {page.type === "voice_identity" ? "voice" : page.type}
              {sub && <span style={{ opacity: 0.7 }}>· {sub}</span>}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              color: TEXT_FADED,
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: "0.04em",
            }}
          >
            {era && (
              <span>
                {era}
                {page.timeIndex ? ` · t=${pad2(page.timeIndex.index)}` : ""}
              </span>
            )}
            {era && <span style={{ color: TEXT_QUIET }}>·</span>}
            <span>
              {pad2(links)} link{links === 1 ? "" : "s"}
            </span>
            <span style={{ color: TEXT_QUIET }}>·</span>
            <span>
              {pad2(sourceRefs.length)} source
              {sourceRefs.length === 1 ? "" : "s"}
            </span>
            <span style={{ color: TEXT_QUIET }}>·</span>
            <span>conf {conf.toFixed(2)}</span>
            <span style={{ color: TEXT_QUIET }}>·</span>
            <span>updated {relative(page.updatedAt)}</span>
          </div>
          {page.summary && (
            <div
              style={{
                paddingTop: 4,
                color: TEXT_SECONDARY,
                fontFamily: BODY,
                fontSize: 14,
                lineHeight: "22px",
                maxWidth: 760,
              }}
            >
              {page.summary}
            </div>
          )}
        </div>

        {/* Frontmatter */}
        {frontmatterRows.length > 0 && (
          <>
            <PanelSectionHeader
              label="Frontmatter"
              trailing={`${pad2(frontmatterRows.length)} field${frontmatterRows.length === 1 ? "" : "s"}`}
            />
            <div style={{ display: "flex", flexDirection: "column" }}>
              {frontmatterRows.map((r, i) => (
                <KvRow
                  key={r.label}
                  label={r.label}
                  value={r.value}
                  last={i === frontmatterRows.length - 1}
                />
              ))}
            </div>
          </>
        )}

        {/* Body */}
        {page.body.trim() && (
          <>
            <PanelSectionHeader
              label="Body"
              trailing={`${words.toLocaleString()} word${words === 1 ? "" : "s"} · ${chars.toLocaleString()} chars · markdown`}
              withTopBorder
            />
            <pre
              style={{
                margin: 0,
                padding: "4px 24px 14px 24px",
                fontFamily: MONO,
                fontSize: 12,
                lineHeight: "20px",
                color: TEXT_PRIMARY,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 240,
                overflow: "hidden",
              }}
            >
              {bodyExcerpt}
            </pre>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 24px 14px",
                color: TEXT_FADED,
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: "0.06em",
              }}
            >
              <Link
                href={`${routeBase}/pages/${page.slug}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  border: `1px solid rgba(255, 255, 255, 0.12)`,
                  color: TEXT_SECONDARY,
                  textDecoration: "none",
                  textTransform: "uppercase",
                }}
              >
                Expand ↗
              </Link>
              <span style={{ flex: 1 }} />
              <span>~{Math.max(1, Math.ceil(words / 12))} lines</span>
            </div>
          </>
        )}

        {/* Links */}
        {linkedPages.length > 0 && (
          <>
            <PanelSectionHeader
              label="Links"
              trailing={`${pad2(linkedPages.length)} connected`}
              withTopBorder
            />
            {linkedPages.slice(0, 12).map((p, i) => (
              <LinkRow
                key={p.id}
                page={p}
                routeBase={routeBase}
                onClick={() => onSelectLinked(p)}
                last={i === Math.min(linkedPages.length, 12) - 1}
              />
            ))}
          </>
        )}

        {/* Sources */}
        {sourceRefs.length > 0 && (
          <>
            <PanelSectionHeader
              label="Sources"
              trailing={`${pad2(sourceRefs.length)} cited`}
              withTopBorder
            />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "8px 24px 24px 24px",
              }}
            >
              {sourceRefs.map((ref) => {
                const src = sourceById.get(ref.sourceId);
                if (!src) return null;
                return <SourceCard key={ref.id} src={src} ref_={ref} />;
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────── */

function PanelSectionHeader({
  label,
  trailing,
  withTopBorder,
}: {
  label: string;
  trailing?: string;
  withTopBorder?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "14px 24px 8px 24px",
        borderTop: withTopBorder ? `1px solid ${DIVIDER}` : "none",
        color: TEXT_FADED,
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
      }}
    >
      <span>{label}</span>
      <span style={{ flex: 1, height: 1, background: DIVIDER }} />
      {trailing && <span style={{ color: TEXT_GHOST }}>{trailing}</span>}
    </div>
  );
}

function KvRow({
  label,
  value,
  last,
}: {
  label: string;
  value: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 24px",
        gap: 16,
        borderTop: `1px solid ${DIVIDER}`,
        borderBottom: last ? `1px solid ${DIVIDER}` : "none",
      }}
    >
      <span
        style={{
          width: 140,
          color: TEXT_FADED,
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          color: TEXT_PRIMARY,
          fontFamily: MONO,
          fontSize: 12,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function LinkRow({
  page,
  routeBase: _routeBase,
  onClick,
  last,
}: {
  page: WikiPageRecord;
  routeBase: string;
  onClick: () => void;
  last?: boolean;
}) {
  const color = TYPE_COLOR[page.type];
  const era = page.timeIndex?.era ?? null;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 38,
        padding: "0 24px",
        borderTop: `1px solid ${DIVIDER}`,
        borderRight: "none",
        borderBottom: last ? `1px solid ${DIVIDER}` : "none",
        borderLeft: "none",
        background: "transparent",
        color: "inherit",
        fontFamily: "inherit",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          background: color,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          flex: 1,
          color: TEXT_PRIMARY,
          fontFamily: BODY,
          fontSize: 13,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {page.title}
      </span>
      <span
        style={{
          color: TEXT_FADED,
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: "0.04em",
        }}
      >
        {page.type === "voice_identity" ? "voice" : page.type}
        {era ? ` · ${era}` : ""}
      </span>
    </button>
  );
}

function SourceCard({
  src,
  ref_,
}: {
  src: WikiSourceRecord;
  ref_: WikiSourceRefRecord;
}) {
  const kindLabel = src.kind.toUpperCase();
  const kindColor =
    src.kind === "bible"
      ? ACCENT
      : src.kind === "commentary" || src.kind === "midrash"
        ? SECONDARY
        : TEXT_SECONDARY;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "12px 14px",
        border: `1px solid ${BORDER}`,
        background: INPUT_BG,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            flex: 1,
            color: FG,
            fontFamily: BODY,
            fontSize: 13,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {src.title}
        </span>
        <span
          style={{
            color: kindColor,
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: "0.1em",
            flexShrink: 0,
          }}
        >
          {kindLabel}
        </span>
      </div>
      {ref_.passage && (
        <div
          style={{
            color: TEXT_FADED,
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: "0.04em",
          }}
        >
          {ref_.passage}
        </div>
      )}
      {ref_.quote && (
        <blockquote
          style={{
            margin: 0,
            paddingLeft: 10,
            borderLeft: `2px solid ${ACCENT_RING}`,
            color: TEXT_SECONDARY,
            fontFamily: BODY,
            fontSize: 12,
            fontStyle: "italic",
            lineHeight: "18px",
          }}
        >
          {ref_.quote}
        </blockquote>
      )}
      {ref_.relevanceNote && (
        <div
          style={{
            color: TEXT_SECONDARY,
            fontFamily: BODY,
            fontSize: 12,
            lineHeight: "18px",
          }}
        >
          {ref_.relevanceNote}
        </div>
      )}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "40px 24px",
        textAlign: "center",
        color: TEXT_FADED,
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </div>
  );
}
