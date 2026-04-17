"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  EraConfig,
  WikiEdgeRecord,
  WikiPageRecord,
  WikiPageType,
  WikiSourceRecord,
  WikiSourceRefRecord,
} from "@odyssey/db";
import { WikiGraph } from "@/components/wiki-graph";

/* ── Tokens ────────────────────────────────────────────────────── */

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  panel: "var(--panel)",
  border: "var(--border)",
  cardHover: "var(--card-hover)",
  accent: "var(--accent-strong)",
  accentSoft: "var(--accent-soft)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

/* ── Type palette ──────────────────────────────────────────────── */

const TYPE_COLORS: Record<WikiPageType, { dot: string; label: string }> = {
  entity:         { dot: "#FBA7C0", label: "Entity" },
  event:          { dot: "#FACC15", label: "Event" },
  concept:        { dot: "#A88CFF", label: "Concept" },
  relationship:   { dot: "#8CE7D2", label: "Relationship" },
  timeline:       { dot: "#94A3B8", label: "Timeline" },
  voice_identity: { dot: "#E879A0", label: "Voice ID" },
};

const TYPE_ORDER: WikiPageType[] = [
  "entity", "event", "relationship", "concept", "voice_identity", "timeline",
];

/* ── Props ─────────────────────────────────────────────────────── */

type Props = {
  characterSlug: string;
  eras: EraConfig[];
  pages: WikiPageRecord[];
  edges: WikiEdgeRecord[];
  sources: WikiSourceRecord[];
  initialSelectedSlug: string | null;
  initialSourceRefs: WikiSourceRefRecord[];
};

type TypeFilter = "all" | WikiPageType;

export function CharacterWiki(props: Props) {
  const { pages, edges, sources, eras, characterSlug } = props;
  const router = useRouter();

  const [selectedSlug, setSelectedSlug] = useState<string | null>(
    props.initialSelectedSlug,
  );
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [search, setSearch] = useState("");

  /* ── Source refs for the currently-selected page ─────────────── */

  const [refsBySlug, setRefsBySlug] = useState<Record<string, WikiSourceRefRecord[]>>(
    props.initialSelectedSlug
      ? { [props.initialSelectedSlug]: props.initialSourceRefs }
      : {},
  );

  const selectedPage = useMemo(
    () => pages.find((p) => p.slug === selectedSlug) ?? null,
    [pages, selectedSlug],
  );

  // Lazy-load source refs when a page is selected that we haven't fetched yet.
  useEffect(() => {
    if (!selectedPage) return;
    if (refsBySlug[selectedPage.slug] !== undefined) return;
    let cancelled = false;
    fetch(`/api/wiki/pages/${selectedPage.id}/source-refs`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { refs: WikiSourceRefRecord[] }) => {
        if (cancelled) return;
        setRefsBySlug((m) => ({ ...m, [selectedPage.slug]: data.refs }));
      })
      .catch(() => { /* ignore — empty refs rendered */ });
    return () => { cancelled = true; };
  }, [selectedPage, refsBySlug]);

  /* ── Derived indices ─────────────────────────────────────────── */

  const pageById = useMemo(
    () => new Map(pages.map((p) => [p.id, p] as const)),
    [pages],
  );
  const pageBySlug = useMemo(
    () => new Map(pages.map((p) => [p.slug, p] as const)),
    [pages],
  );
  const sourceById = useMemo(
    () => new Map(sources.map((s) => [s.id, s] as const)),
    [sources],
  );

  // Count edges per page (used by list rows).
  const linkCountByPageId = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) {
      m.set(e.fromPageId, (m.get(e.fromPageId) ?? 0) + 1);
      m.set(e.toPageId, (m.get(e.toPageId) ?? 0) + 1);
    }
    return m;
  }, [edges]);

  const typeCounts = useMemo(() => {
    const m: Record<WikiPageType | "all", number> = {
      all: pages.length,
      entity: 0, event: 0, concept: 0, relationship: 0, timeline: 0, voice_identity: 0,
    };
    for (const p of pages) m[p.type]++;
    return m;
  }, [pages]);

  const eraOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of eras) m.set(e.key, e.order);
    return m;
  }, [eras]);

  const filteredPages = useMemo(() => {
    let result = pages;
    if (typeFilter !== "all") result = result.filter((p) => p.type === typeFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q) ||
          (p.summary ?? "").toLowerCase().includes(q),
      );
    }
    // Stable sort: type (by TYPE_ORDER), then eraOrder if event, then title.
    return [...result].sort((a, b) => {
      const ta = TYPE_ORDER.indexOf(a.type);
      const tb = TYPE_ORDER.indexOf(b.type);
      if (ta !== tb) return ta - tb;
      if (a.type === "event" && b.type === "event") {
        const ea = a.timeIndex ? (eraOrder.get(a.timeIndex.era) ?? 999) : 999;
        const eb = b.timeIndex ? (eraOrder.get(b.timeIndex.era) ?? 999) : 999;
        if (ea !== eb) return ea - eb;
        const ia = a.timeIndex?.index ?? 999;
        const ib = b.timeIndex?.index ?? 999;
        if (ia !== ib) return ia - ib;
      }
      return a.title.localeCompare(b.title);
    });
  }, [pages, typeFilter, search, eraOrder]);

  /* ── Selection + URL sync ────────────────────────────────────── */

  const selectPage = useCallback(
    (slug: string) => {
      setSelectedSlug(slug);
      // Use history.replaceState to avoid re-fetching the server page; the
      // selection is purely a client concern once data is loaded.
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("page", slug);
        window.history.replaceState({}, "", url.toString());
      }
    },
    [],
  );

  /* ── Empty state ─────────────────────────────────────────────── */

  if (pages.length === 0) {
    return <EmptyWiki characterSlug={characterSlug} />;
  }

  /* ── Graph visibility (persisted to localStorage) ────────────── */

  const [graphVisible, setGraphVisible] = useState(true);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("wiki-graph-visible");
      if (saved === "0") setGraphVisible(false);
    } catch { /* ignore */ }
  }, []);
  const toggleGraph = useCallback(() => {
    setGraphVisible((v) => {
      const next = !v;
      try { localStorage.setItem("wiki-graph-visible", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const currentEraKey = useMemo(() => {
    // "Current era" heuristic: the era with the most recent timestamped pages.
    // Cheap stand-in for a per-session moment cursor we'll add later.
    const counts = new Map<string, number>();
    for (const p of pages) {
      if (p.timeIndex?.era) {
        counts.set(p.timeIndex.era, (counts.get(p.timeIndex.era) ?? 0) + 1);
      }
    }
    let best: string | null = null;
    let bestN = 0;
    for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
    return best;
  }, [pages]);

  /* ── Layout ──────────────────────────────────────────────────── */

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, minHeight: 0 }}>
      {/* Graph band */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {graphVisible ? (
          <WikiGraph
            pages={pages}
            edges={edges}
            eras={eras}
            currentEra={currentEraKey}
            selectedSlug={selectedSlug}
            onSelect={selectPage}
          />
        ) : (
          <button
            type="button"
            onClick={toggleGraph}
            style={{
              display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 6,
              padding: "6px 12px", borderRadius: 8,
              border: `1px solid ${T.border}`, background: "transparent",
              color: T.muted, fontFamily: T.fontBody, fontSize: 11, cursor: "pointer",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" />
              <circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" />
              <line x1="6" y1="8" x2="6" y2="16" /><line x1="8" y1="6" x2="16" y2="6" />
              <line x1="8" y1="18" x2="16" y2="18" /><line x1="18" y1="8" x2="18" y2="16" />
              <line x1="8" y1="8" x2="16" y2="16" />
            </svg>
            Show graph
          </button>
        )}
        {graphVisible && (
          <button
            type="button"
            onClick={toggleGraph}
            style={{
              alignSelf: "flex-end",
              padding: "3px 10px", borderRadius: 6,
              border: `1px solid ${T.border}`, background: "transparent",
              color: T.muted, fontFamily: T.fontBody, fontSize: 10, cursor: "pointer",
            }}
          >
            Hide graph
          </button>
        )}
      </div>

      {/* Browser + detail row */}
      <div style={{ display: "flex", flexDirection: "row", gap: 20, minHeight: 0 }}>
      <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <BrowserCard
          pages={filteredPages}
          totalCount={pages.length}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          typeCounts={typeCounts}
          search={search}
          setSearch={setSearch}
          selectedSlug={selectedSlug}
          onSelect={selectPage}
          linkCountByPageId={linkCountByPageId}
          eraOrder={eraOrder}
        />
      </div>

      <div style={{ width: 600, flexShrink: 0 }}>
        {selectedPage ? (
          <DetailCard
            page={selectedPage}
            edges={edges}
            pageById={pageById}
            pageBySlug={pageBySlug}
            sourceById={sourceById}
            sourceRefs={refsBySlug[selectedPage.slug] ?? []}
            onNavigate={selectPage}
            router={router}
          />
        ) : (
          <SelectPrompt />
        )}
      </div>
      </div>
    </div>
  );
}

/* ── Browser card ──────────────────────────────────────────────── */

function BrowserCard(props: {
  pages: WikiPageRecord[];
  totalCount: number;
  typeFilter: TypeFilter;
  setTypeFilter: (t: TypeFilter) => void;
  typeCounts: Record<WikiPageType | "all", number>;
  search: string;
  setSearch: (s: string) => void;
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  linkCountByPageId: Map<string, number>;
  eraOrder: Map<string, number>;
}) {
  const filters: { key: TypeFilter; label: string }[] = [
    { key: "all", label: "All" },
    ...TYPE_ORDER.map((t) => ({ key: t, label: TYPE_COLORS[t].label })),
  ];

  return (
    <div style={cardShell}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 16, padding: "12px 20px", borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Pages
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted }}>
            {props.pages.length} of {props.totalCount}
          </span>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "5px 10px", borderRadius: 8,
          background: "var(--background)", border: `1px solid ${T.border}`, width: 240,
        }}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="var(--muted)" strokeWidth="1.5" />
            <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text" value={props.search}
            onChange={(e) => props.setSearch(e.target.value)}
            placeholder="Filter pages…"
            style={{ flex: 1, border: "none", background: "transparent", outline: "none", fontSize: 12, color: T.fg, fontFamily: T.fontBody }}
          />
        </div>
      </div>

      <div style={{
        display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 20px",
        borderBottom: `1px solid ${T.border}`,
      }}>
        {filters.map((f) => {
          const active = f.key === props.typeFilter;
          const count = props.typeCounts[f.key as WikiPageType | "all"];
          return (
            <button
              key={f.key} type="button" onClick={() => props.setTypeFilter(f.key)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "3px 10px", borderRadius: 999,
                border: active ? "none" : `1px solid ${T.border}`,
                background: active ? "rgba(140,231,210,0.1)" : "transparent",
                color: active ? "#8CE7D2" : T.muted,
                fontFamily: T.fontBody, fontSize: 11, fontWeight: active ? 500 : 400,
                cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {f.key !== "all" && (
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: TYPE_COLORS[f.key as WikiPageType].dot }} />
              )}
              {f.label}
              <span style={{ opacity: 0.6 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Column headers */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14, padding: "8px 20px",
        borderBottom: `1px solid ${T.border}`, background: T.cardHover,
      }}>
        <span style={{ ...colHeader, flex: 1 }}>Page</span>
        <span style={{ ...colHeader, width: 100 }}>Type</span>
        <span style={{ ...colHeader, width: 96 }}>Era</span>
        <span style={{ ...colHeader, width: 54, textAlign: "right" }}>Conf</span>
        <span style={{ ...colHeader, width: 52, textAlign: "right" }}>Links</span>
      </div>

      {props.pages.length === 0 ? (
        <div style={{ padding: "3rem 1rem", textAlign: "center", color: T.muted, fontSize: 13, fontFamily: T.fontBody }}>
          No pages match your filters.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", overflow: "auto", maxHeight: "70vh" }}>
          {props.pages.map((p) => (
            <PageRow
              key={p.id} page={p}
              selected={p.slug === props.selectedSlug}
              onSelect={() => props.onSelect(p.slug)}
              linkCount={props.linkCountByPageId.get(p.id) ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PageRow({
  page, selected, onSelect, linkCount,
}: {
  page: WikiPageRecord; selected: boolean; onSelect: () => void; linkCount: number;
}) {
  const typeColor = TYPE_COLORS[page.type];
  return (
    <button
      type="button" onClick={onSelect}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "10px 20px", border: "none", cursor: "pointer",
        textAlign: "left", width: "100%",
        borderBottom: `1px solid ${T.border}`,
        background: selected ? "rgba(140,231,210,0.08)" : "transparent",
        borderLeft: selected ? "2px solid #8CE7D2" : "2px solid transparent",
        fontFamily: "inherit",
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = T.cardHover; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: typeColor.dot, flexShrink: 0 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{
            fontFamily: T.fontHeading, fontSize: 13, fontWeight: selected ? 600 : 500, color: T.fg,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {page.title}
          </span>
          <span style={{
            fontFamily: T.fontBody, fontSize: 11, color: T.muted,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {page.summary ?? page.slug}
          </span>
        </div>
      </div>
      <span style={{
        width: 100, flexShrink: 0, fontFamily: T.fontMono, fontSize: 10, color: T.muted,
      }}>
        {page.type === "entity"
          ? `entity · ${(page.frontmatter as { kind?: string })?.kind ?? "—"}`
          : page.type.replace("_", " ")}
      </span>
      <span style={{
        width: 96, flexShrink: 0, fontFamily: T.fontMono, fontSize: 10,
        color: page.timeIndex ? "#8CE7D2" : T.muted,
      }}>
        {page.timeIndex ? `${page.timeIndex.era} · ${page.timeIndex.index}` : "timeless"}
      </span>
      <div style={{ width: 54, flexShrink: 0, display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
        <span style={{ width: 24, height: 3, background: T.cardHover, borderRadius: 2, position: "relative", overflow: "hidden", display: "block" }}>
          <span style={{
            position: "absolute", top: 0, left: 0, height: "100%",
            width: `${Math.max(8, Math.round(page.confidence * 100))}%`,
            background: page.confidence >= 0.85 ? "#8CE7D2" : page.confidence >= 0.7 ? "#FACC15" : "#E89090",
            borderRadius: 2,
          }} />
        </span>
        <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted }}>
          {page.confidence.toFixed(2).replace(/^0/, "")}
        </span>
      </div>
      <span style={{
        width: 52, flexShrink: 0, textAlign: "right",
        fontFamily: T.fontMono, fontSize: 11, fontWeight: 500, color: T.fg,
      }}>
        {linkCount}
      </span>
    </button>
  );
}

/* ── Detail card ───────────────────────────────────────────────── */

function DetailCard({
  page, edges, pageById, pageBySlug, sourceById, sourceRefs, onNavigate, router,
}: {
  page: WikiPageRecord;
  edges: WikiEdgeRecord[];
  pageById: Map<string, WikiPageRecord>;
  pageBySlug: Map<string, WikiPageRecord>;
  sourceById: Map<string, WikiSourceRecord>;
  sourceRefs: WikiSourceRefRecord[];
  onNavigate: (slug: string) => void;
  router: ReturnType<typeof useRouter>;
}) {
  const outbound = edges.filter((e) => e.fromPageId === page.id);
  const inbound = edges.filter((e) => e.toPageId === page.id);

  const typeColor = TYPE_COLORS[page.type];
  void router;

  return (
    <div style={{ ...cardShell, maxHeight: "82vh", overflow: "auto" }}>
      <TopBar page={page} typeColor={typeColor} />
      <TitleBlock page={page} />
      <Section title="Summary">
        <p style={bodyStyle}>{page.summary ?? <em style={{ color: T.muted }}>no summary</em>}</p>
      </Section>
      <Section title="Body">
        <MarkdownBody
          body={page.body}
          pageBySlug={pageBySlug}
          onSlugClick={onNavigate}
        />
      </Section>
      <PerspectiveBlock perspective={page.perspective} />
      <FrontmatterBlock page={page} pageBySlug={pageBySlug} onNavigate={onNavigate} />
      <SourcesBlock sourceRefs={sourceRefs} sourceById={sourceById} />
      <LinksBlock
        outbound={outbound}
        inbound={inbound}
        pageById={pageById}
        onNavigate={onNavigate}
      />
      <ContradictionsBlock
        page={page}
        pageById={pageById}
        onNavigate={(slug) => onNavigate(slug)}
      />
    </div>
  );
}

function TopBar({ page, typeColor }: { page: WikiPageRecord; typeColor: { dot: string; label: string } }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 20px", borderBottom: `1px solid ${T.border}`, background: "var(--card-hover)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "3px 9px", borderRadius: 999,
          background: `${typeColor.dot}1F`, border: `1px solid ${typeColor.dot}33`,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: typeColor.dot }} />
          <span style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 600, color: typeColor.dot, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {page.type === "entity" ? `entity · ${(page.frontmatter as { kind?: string })?.kind ?? ""}` : typeColor.label}
          </span>
        </span>
        <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.muted }}>
          {page.slug}
        </span>
      </div>
      <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted }}>
        v{page.version}
      </span>
    </div>
  );
}

function TitleBlock({ page }: { page: WikiPageRecord }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "18px 20px", borderBottom: `1px solid ${T.border}` }}>
      <h1 style={{ fontFamily: T.fontHeading, fontSize: 24, fontWeight: 700, color: T.fg, margin: 0, lineHeight: "28px" }}>
        {page.title}
      </h1>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <MetaChip
          icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#8CE7D2" strokeWidth="2.5" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
          label={`${page.confidence.toFixed(2)} confidence`}
          color={page.confidence >= 0.85 ? "#8CE7D2" : page.confidence >= 0.7 ? "#FACC15" : "#E89090"}
          tint
        />
        {page.timeIndex && (
          <MetaChip label={`${page.timeIndex.era} · ${page.timeIndex.index}`} color={T.muted} />
        )}
        {page.knowsFuture && (
          <MetaChip label="knows future" color="#A88CFF" tint />
        )}
        {page.contradictions.length > 0 && (
          <MetaChip label={`${page.contradictions.length} contradiction${page.contradictions.length === 1 ? "" : "s"}`} color="#E89090" tint />
        )}
      </div>
    </div>
  );
}

function MetaChip({ icon, label, color, tint }: { icon?: React.ReactNode; label: string; color: string; tint?: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 9px", borderRadius: 999,
      background: tint ? `${color}14` : T.cardHover,
      border: tint ? `1px solid ${color}33` : `1px solid ${T.border}`,
      fontFamily: T.fontMono, fontSize: 10, color: tint ? color : T.muted, letterSpacing: "0.04em",
    }}>
      {icon}
      {label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: "18px 20px", borderBottom: `1px solid ${T.border}` }}>
      <div style={{ fontFamily: T.fontMono, fontSize: 10, fontWeight: 500, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </section>
  );
}

const bodyStyle: CSSProperties = {
  fontFamily: T.fontBody, fontSize: 13, color: T.fg, lineHeight: "20px", margin: 0,
};

/* ── Markdown body with wikilink resolution ────────────────────── */

function MarkdownBody({
  body, pageBySlug, onSlugClick,
}: {
  body: string;
  pageBySlug: Map<string, WikiPageRecord>;
  onSlugClick: (slug: string) => void;
}) {
  // Pre-convert [[slug|Display]] or [[slug]] to a marker that react-markdown
  // will render as a custom link. Using a non-printing delimiter keeps things
  // parser-safe; our link renderer intercepts it.
  const transformed = useMemo(() => preprocessWikilinks(body), [body]);

  return (
    <div className="wiki-body" style={{ fontFamily: T.fontBody, fontSize: 13, color: T.fg, lineHeight: "20px" }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // biome-ignore lint/a11y: anchor injected by markdown
          a: (props) => {
            const href = (props.href ?? "") as string;
            const wiki = parseWikiLink(href);
            if (wiki) {
              const target = pageBySlug.get(wiki.slug);
              return (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onSlugClick(wiki.slug);
                  }}
                  style={{
                    border: "none", background: "transparent", padding: 0, cursor: target ? "pointer" : "not-allowed",
                    color: target ? "#8CE7D2" : "#E89090",
                    fontFamily: "inherit", fontSize: "inherit",
                    borderBottom: `1px dashed ${target ? "rgba(140,231,210,0.4)" : "rgba(232,144,144,0.4)"}`,
                  }}
                  title={target ? `→ ${target.title}` : `broken wikilink: ${wiki.slug}`}
                >
                  {props.children}
                  {!target && " ?"}
                </button>
              );
            }
            // Regular link.
            return (
              <a href={href} style={{ color: "#8CE7D2" }} target="_blank" rel="noreferrer">
                {props.children}
              </a>
            );
          },
          p: (p) => <p style={{ margin: "0 0 10px 0", lineHeight: "20px" }}>{p.children}</p>,
          h2: (p) => <h2 style={{ fontFamily: T.fontHeading, fontSize: 15, fontWeight: 600, color: T.fg, margin: "14px 0 8px 0" }}>{p.children}</h2>,
          h3: (p) => <h3 style={{ fontFamily: T.fontHeading, fontSize: 13, fontWeight: 600, color: T.fg, margin: "12px 0 6px 0" }}>{p.children}</h3>,
          ul: (p) => <ul style={{ margin: "0 0 10px 0", paddingLeft: 22 }}>{p.children}</ul>,
          ol: (p) => <ol style={{ margin: "0 0 10px 0", paddingLeft: 22 }}>{p.children}</ol>,
          li: (p) => <li style={{ marginBottom: 4 }}>{p.children}</li>,
          em: (p) => <em style={{ color: T.muted }}>{p.children}</em>,
          strong: (p) => <strong style={{ color: T.fg }}>{p.children}</strong>,
          code: (p) => <code style={{ fontFamily: T.fontMono, fontSize: 12, background: T.cardHover, padding: "1px 5px", borderRadius: 3 }}>{p.children}</code>,
          blockquote: (p) => <blockquote style={{ margin: "10px 0", paddingLeft: 12, borderLeft: `2px solid ${T.border}`, color: T.muted }}>{p.children}</blockquote>,
        }}
      >
        {transformed}
      </ReactMarkdown>
    </div>
  );
}

/** Replace [[slug|Display]] / [[slug]] with a marker the link renderer can detect. */
function preprocessWikilinks(body: string): string {
  if (!body) return body;
  return body.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, rawSlug: string, rawDisplay?: string) => {
    const slug = rawSlug.trim();
    const display = (rawDisplay?.trim() || slug);
    return `[${display}](wiki://${encodeURIComponent(slug)})`;
  });
}

function parseWikiLink(href: string): { slug: string } | null {
  if (!href.startsWith("wiki://")) return null;
  return { slug: decodeURIComponent(href.slice("wiki://".length)) };
}

/* ── Perspective ───────────────────────────────────────────────── */

function PerspectiveBlock({ perspective }: { perspective: WikiPageRecord["perspective"] }) {
  const knowsHow = perspective.knowsHow;
  const feels = (perspective.feels ?? []).filter(Boolean);
  const stake = perspective.stake;
  if (!knowsHow && feels.length === 0 && !stake) return null;
  return (
    <Section title="Perspective">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {knowsHow && (
          <PerspectiveRow icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#8CE7D2" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
            bg="rgba(140,231,210,0.08)" label="Knows how" value={knowsHowLabel(knowsHow)} />
        )}
        {feels.length > 0 && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{
              width: 18, height: 18, borderRadius: "50%", background: "rgba(232,121,160,0.12)",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1,
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="#E879A0"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontFamily: T.fontBody, fontSize: 12, fontWeight: 500, color: T.fg }}>Feels</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {feels.map((f, i) => (
                  <span key={i} style={{ padding: "2px 8px", borderRadius: 4, background: T.cardHover, fontFamily: T.fontMono, fontSize: 10, color: T.muted }}>
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
        {stake && (
          <PerspectiveRow icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#A88CFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15 8 22 9 17 14 18 21 12 18 6 21 7 14 2 9 9 8 12 2" /></svg>}
            bg="rgba(168,140,255,0.1)" label="Stake" value={<em style={{ color: T.muted, fontStyle: "italic" }}>{`"${stake}"`}</em>} />
        )}
      </div>
    </Section>
  );
}

function PerspectiveRow({ icon, bg, label, value }: { icon: React.ReactNode; bg: string; label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 18, height: 18, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {icon}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontFamily: T.fontBody, fontSize: 12, fontWeight: 500, color: T.fg }}>{label}</span>
        <span style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted }}>{value}</span>
      </div>
    </div>
  );
}

function knowsHowLabel(k: string): string {
  switch (k) {
    case "firsthand": return "Firsthand — lived every event";
    case "heard": return "Heard — from others";
    case "inferred": return "Inferred — from clues";
    case "unknown": return "Unknown — uncertain";
    default: return k;
  }
}

/* ── Type-specific frontmatter ─────────────────────────────────── */

function FrontmatterBlock({
  page, pageBySlug, onNavigate,
}: {
  page: WikiPageRecord;
  pageBySlug: Map<string, WikiPageRecord>;
  onNavigate: (slug: string) => void;
}) {
  const fm = page.frontmatter as Record<string, unknown>;
  const rows: { key: string; value: React.ReactNode }[] = [];

  const slugPill = (slug: string) => {
    const target = pageBySlug.get(slug);
    return (
      <button key={slug} type="button" onClick={() => onNavigate(slug)}
        style={{
          padding: "2px 8px", borderRadius: 999,
          background: T.cardHover, border: `1px solid ${T.border}`,
          fontFamily: T.fontBody, fontSize: 11, color: target ? T.fg : "#E89090",
          cursor: target ? "pointer" : "not-allowed",
        }}>
        {target?.title ?? `${slug}?`}
      </button>
    );
  };

  const stringArr = (arr: unknown): string[] =>
    Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];

  if (page.type === "entity") {
    const kind = typeof fm.kind === "string" ? fm.kind : null;
    if (kind) rows.push({ key: "Kind", value: <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.fg }}>{kind}</span> });
    const aliases = stringArr(fm.aliases);
    if (aliases.length > 0) rows.push({ key: "Aliases", value: <TagRow items={aliases} /> });
  } else if (page.type === "event") {
    const where = typeof fm.where === "string" ? fm.where : null;
    if (where) rows.push({ key: "Where", value: slugPill(where) });
    const participants = stringArr(fm.participants);
    if (participants.length > 0) rows.push({ key: "Participants", value: <SlugRow slugs={participants} render={slugPill} /> });
    const causes = stringArr(fm.causes);
    if (causes.length > 0) rows.push({ key: "Causes", value: <SlugRow slugs={causes} render={slugPill} /> });
    const effects = stringArr(fm.effects);
    if (effects.length > 0) rows.push({ key: "Effects", value: <SlugRow slugs={effects} render={slugPill} /> });
  } else if (page.type === "relationship") {
    const from = typeof fm.from === "string" ? fm.from : null;
    const to = typeof fm.to === "string" ? fm.to : null;
    const kind = typeof fm.kind === "string" ? fm.kind : null;
    if (from) rows.push({ key: "From", value: slugPill(from) });
    if (to) rows.push({ key: "To", value: slugPill(to) });
    if (kind) rows.push({ key: "Kind", value: <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.fg }}>{kind}</span> });
    const evolution = stringArr(fm.evolution);
    if (evolution.length > 0) rows.push({ key: "Evolution", value: <SlugRow slugs={evolution} render={slugPill} /> });
  } else if (page.type === "concept") {
    const aliases = stringArr(fm.aliases);
    if (aliases.length > 0) rows.push({ key: "Aliases", value: <TagRow items={aliases} /> });
    const instances = stringArr(fm.instances);
    if (instances.length > 0) rows.push({ key: "Instances", value: <SlugRow slugs={instances} render={slugPill} /> });
    const related = stringArr(fm.relatedConcepts);
    if (related.length > 0) rows.push({ key: "Related concepts", value: <SlugRow slugs={related} render={slugPill} /> });
  } else if (page.type === "voice_identity") {
    for (const k of ["speechPatterns", "idioms", "beliefs", "emotionalRange", "taboos"]) {
      const v = stringArr(fm[k]);
      if (v.length > 0) {
        rows.push({
          key: k.replace(/([A-Z])/g, " $1").toLowerCase(),
          value: <TagRow items={v} danger={k === "taboos"} />,
        });
      }
    }
  }

  if (rows.length === 0) return null;
  return (
    <Section title="Frontmatter">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <div key={r.key} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{
              width: 116, flexShrink: 0, fontFamily: T.fontMono, fontSize: 10, color: T.muted,
              letterSpacing: "0.06em", textTransform: "uppercase", paddingTop: 2,
            }}>
              {r.key}
            </span>
            <div style={{ flex: 1 }}>{r.value}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function SlugRow({ slugs, render }: { slugs: string[]; render: (slug: string) => React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {slugs.map((s) => render(s))}
    </div>
  );
}

function TagRow({ items, danger }: { items: string[]; danger?: boolean }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {items.map((v, i) => (
        <span key={i} style={{
          padding: "2px 8px", borderRadius: 4,
          background: danger ? "rgba(232,144,144,0.08)" : T.cardHover,
          fontFamily: T.fontMono, fontSize: 10,
          color: danger ? "#E89090" : T.muted,
        }}>
          {v}
        </span>
      ))}
    </div>
  );
}

/* ── Sources ───────────────────────────────────────────────────── */

function SourcesBlock({
  sourceRefs, sourceById,
}: {
  sourceRefs: WikiSourceRefRecord[];
  sourceById: Map<string, WikiSourceRecord>;
}) {
  if (sourceRefs.length === 0) return null;
  return (
    <Section title={`Sources · ${sourceRefs.length}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sourceRefs.map((ref) => {
          const source = sourceById.get(ref.sourceId);
          return (
            <div key={ref.id} style={{
              display: "flex", flexDirection: "column", gap: 4,
              padding: "10px 12px", borderRadius: 10,
              background: "var(--card-hover)", border: `1px solid ${T.border}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontFamily: T.fontBody, fontSize: 12, fontWeight: 500, color: T.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {source?.title ?? "(deleted source)"}
                </span>
                {ref.passage && (
                  <span style={{ fontFamily: T.fontMono, fontSize: 10, color: T.muted, flexShrink: 0 }}>{ref.passage}</span>
                )}
              </div>
              {ref.quote && (
                <span style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted, fontStyle: "italic", lineHeight: "17px" }}>
                  &ldquo;{ref.quote}&rdquo;
                </span>
              )}
              {ref.relevanceNote && (
                <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted, lineHeight: "15px" }}>
                  {ref.relevanceNote}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ── Links ─────────────────────────────────────────────────────── */

function LinksBlock({
  outbound, inbound, pageById, onNavigate,
}: {
  outbound: WikiEdgeRecord[]; inbound: WikiEdgeRecord[];
  pageById: Map<string, WikiPageRecord>;
  onNavigate: (slug: string) => void;
}) {
  if (outbound.length === 0 && inbound.length === 0) return null;
  return (
    <Section title={`Links · ${outbound.length + inbound.length}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {outbound.length > 0 && (
          <LinkGroup title={`→ Outbound · ${outbound.length}`} edges={outbound} direction="out" pageById={pageById} onNavigate={onNavigate} />
        )}
        {inbound.length > 0 && (
          <LinkGroup title={`← Inbound · ${inbound.length}`} edges={inbound} direction="in" pageById={pageById} onNavigate={onNavigate} />
        )}
      </div>
    </Section>
  );
}

function LinkGroup({
  title, edges, direction, pageById, onNavigate,
}: {
  title: string; edges: WikiEdgeRecord[]; direction: "in" | "out";
  pageById: Map<string, WikiPageRecord>; onNavigate: (slug: string) => void;
}) {
  return (
    <div>
      <div style={{ fontFamily: T.fontMono, fontSize: 9, color: T.muted, marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {title}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {edges.map((e) => {
          const target = pageById.get(direction === "out" ? e.toPageId : e.fromPageId);
          if (!target) return null;
          const typeColor = TYPE_COLORS[target.type];
          return (
            <button
              key={e.id} type="button" onClick={() => onNavigate(target.slug)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "3px 8px 3px 10px", borderRadius: 999,
                background: T.cardHover, border: `1px solid ${T.border}`,
                fontFamily: T.fontBody, fontSize: 11, color: T.fg, cursor: "pointer",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: typeColor.dot }} />
              {target.title}
              <span style={{ fontFamily: T.fontMono, fontSize: 9, color: T.muted, letterSpacing: "0.05em" }}>
                {e.kind.replace(/_/g, " ")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Contradictions ────────────────────────────────────────────── */

function ContradictionsBlock({
  page, pageById, onNavigate,
}: { page: WikiPageRecord; pageById: Map<string, WikiPageRecord>; onNavigate: (slug: string) => void }) {
  if (page.contradictions.length === 0) return null;
  return (
    <Section title={`Contradictions · ${page.contradictions.length}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {page.contradictions.map((c, i) => {
          const target = pageById.get(c.otherPageId);
          return (
            <div key={i} style={{
              padding: "10px 12px", borderRadius: 10,
              background: "rgba(232,144,144,0.06)", border: "1px solid rgba(232,144,144,0.2)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#E89090" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                {target ? (
                  <button type="button" onClick={() => onNavigate(target.slug)}
                    style={{ border: "none", background: "transparent", padding: 0, color: "#E89090", fontFamily: T.fontBody, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
                    Conflicts with {target.title}
                  </button>
                ) : (
                  <span style={{ color: "#E89090", fontFamily: T.fontBody, fontSize: 12, fontWeight: 500 }}>Conflicts with (unknown page)</span>
                )}
              </div>
              <span style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted, lineHeight: "17px" }}>{c.note}</span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ── Empty / prompt states ─────────────────────────────────────── */

function EmptyWiki({ characterSlug }: { characterSlug: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "5rem 2rem", gap: 14, textAlign: "center",
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: "50%",
        background: T.panel, border: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
      </div>
      <h2 style={{ fontFamily: T.fontHeading, fontSize: 20, fontWeight: 600, margin: 0, color: T.fg }}>
        Wiki is empty
      </h2>
      <p style={{ fontFamily: T.fontBody, fontSize: 13, color: T.muted, margin: 0, maxWidth: 420, lineHeight: 1.55 }}>
        Ingest a source to populate the wiki. The LLM will generate pages, edges, and perspective blocks you can browse here.
      </p>
      <a
        href={`/characters/${characterSlug}/ingestion`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "9px 18px", borderRadius: 10, border: "none",
          background: T.accent, color: "var(--background)",
          fontSize: 13, fontWeight: 600, fontFamily: T.fontBody, textDecoration: "none",
        }}
      >
        Go to Ingestion →
      </a>
    </div>
  );
}

function SelectPrompt() {
  return (
    <div style={{
      ...cardShell, minHeight: 400,
      display: "flex", alignItems: "center", justifyContent: "center",
      borderStyle: "dashed", textAlign: "center", padding: "3rem 2rem",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", maxWidth: 260 }}>
        <div style={{
          width: 48, height: 48, borderRadius: "50%", background: T.cardHover,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
        <span style={{ fontFamily: T.fontBody, fontSize: 13, fontWeight: 500, color: T.fg }}>
          Select a page
        </span>
        <span style={{ fontFamily: T.fontBody, fontSize: 12, color: T.muted, lineHeight: 1.55 }}>
          Pick any row from the browser to read its body, perspective, source refs, and outbound / inbound links.
        </span>
      </div>
    </div>
  );
}

/* ── Shared styles ─────────────────────────────────────────────── */

const cardShell: React.CSSProperties = {
  display: "flex", flexDirection: "column",
  background: T.panel, border: `1px solid ${T.border}`,
  borderRadius: 14, overflow: "hidden",
};

const colHeader: React.CSSProperties = {
  fontFamily: T.fontMono, fontSize: 9, fontWeight: 500, color: T.muted,
  letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0,
};

