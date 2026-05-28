"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import type {
  WikiIngestionLogRecord,
  WikiPageRecord,
  WikiPageType,
  WikiSourceRecord,
  WikiSourceRefRecord,
} from "@odyssey/db";
import {
  deleteSource,
  previewPurgeSource,
} from "@/app/(authenticated)/characters/actions";
import { PurgeConfirmModal, type PurgePreview } from "./purge-confirm-modal";

/* ── Tokens ────────────────────────────────────────────────────── */

const T = {
  fg: "var(--foreground)",
  muted: "var(--text-tertiary)",
  panel: "var(--surface-1)",
  border: "var(--border)",
  cardHover: "var(--surface-hover)",
  accent: "var(--accent-strong)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

const TYPE_DOT: Record<WikiPageType, string> = {
  entity:         "var(--event-violet)",
  event:          "var(--status-draft)",
  concept:        "var(--signal-blue)",
  relationship:   "var(--accent-strong)",
  timeline:       "var(--status-archived)",
  voice_identity: "var(--status-error)",
};

const KIND_COLORS: Record<string, string> = {
  primary: "var(--accent-strong)",
  commentary: "var(--event-violet)",
  annotation: "var(--status-error)",
  transcript: "var(--signal-blue)",
  reference: "var(--status-live)",
};

/* ── Props ─────────────────────────────────────────────────────── */

type Props = {
  characterId: string;
  characterSlug: string;
  sources: WikiSourceRecord[];
  pages: WikiPageRecord[];
  refs: WikiSourceRefRecord[];
  runs: WikiIngestionLogRecord[];
  initialSourceId: string | null;
  routeBase?: string;
};

export function CharacterSources(props: Props) {
  const { sources, pages, refs, runs, characterId, characterSlug } = props;
  const router = useRouter();
  const routeBase = props.routeBase ?? `/characters/${characterSlug}`;

  const [selectedId, setSelectedId] = useState<string | null>(props.initialSourceId);
  const [kindFilter, setKindFilter] = useState<"all" | string>("all");
  const [search, setSearch] = useState("");

  /* ── Derived indices ─────────────────────────────────────────── */

  const pageById = useMemo(
    () => new Map(pages.map((p) => [p.id, p] as const)),
    [pages],
  );

  const refsBySource = useMemo(() => {
    const m = new Map<string, WikiSourceRefRecord[]>();
    for (const r of refs) {
      if (!m.has(r.sourceId)) m.set(r.sourceId, []);
      m.get(r.sourceId)!.push(r);
    }
    return m;
  }, [refs]);

  const runsBySource = useMemo(() => {
    const m = new Map<string, WikiIngestionLogRecord[]>();
    for (const r of runs) {
      if (!r.sourceId) continue;
      if (!m.has(r.sourceId)) m.set(r.sourceId, []);
      m.get(r.sourceId)!.push(r);
    }
    return m;
  }, [runs]);

  const kindCounts = useMemo(() => {
    const m: Record<string, number> = { all: sources.length };
    for (const s of sources) m[s.kind] = (m[s.kind] ?? 0) + 1;
    return m;
  }, [sources]);

  const kindsPresent = useMemo(
    () => Array.from(new Set(sources.map((s) => s.kind))),
    [sources],
  );

  const filtered = useMemo(() => {
    let result = sources;
    if (kindFilter !== "all") result = result.filter((s) => s.kind === kindFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((s) => {
        if (s.title.toLowerCase().includes(q)) return true;
        const tags = getTags(s);
        if (tags.some((t) => t.toLowerCase().includes(q))) return true;
        return false;
      });
    }
    return [...result].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [sources, kindFilter, search]);

  const selectedSource = useMemo(
    () => sources.find((s) => s.id === selectedId) ?? null,
    [sources, selectedId],
  );

  /* ── Selection + URL sync ────────────────────────────────────── */

  const selectSource = useCallback((id: string) => {
    setSelectedId(id);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("source", id);
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  /* ── Empty state ─────────────────────────────────────────────── */

  if (sources.length === 0) {
    return <EmptySources routeBase={routeBase} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "row", gap: "var(--space-20)", minHeight: 0 }}>
      <div style={{ flex: "1 1 0", minWidth: 0 }}>
        <SourceBrowser
          sources={filtered}
          totalCount={sources.length}
          kindFilter={kindFilter}
          setKindFilter={setKindFilter}
          kindCounts={kindCounts}
          kindsPresent={kindsPresent}
          search={search}
          setSearch={setSearch}
          selectedId={selectedId}
          onSelect={selectSource}
          refsBySource={refsBySource}
          runsBySource={runsBySource}
        />
      </div>

      <div style={{ width: 600, flexShrink: 0 }}>
        {selectedSource ? (
          <SourceDetail
            source={selectedSource}
            characterId={characterId}
            characterSlug={characterSlug}
            refs={refsBySource.get(selectedSource.id) ?? []}
            runs={runsBySource.get(selectedSource.id) ?? []}
            pageById={pageById}
            onNavigatePage={(slug) => router.push(`${routeBase}/wiki?page=${slug}`)}
            onAfterDelete={() => {
              setSelectedId(null);
              router.refresh();
            }}
          />
        ) : (
          <SelectPrompt />
        )}
      </div>
    </div>
  );
}

/* ── Source browser ────────────────────────────────────────────── */

function SourceBrowser(p: {
  sources: WikiSourceRecord[];
  totalCount: number;
  kindFilter: "all" | string;
  setKindFilter: (k: "all" | string) => void;
  kindCounts: Record<string, number>;
  kindsPresent: string[];
  search: string;
  setSearch: (s: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  refsBySource: Map<string, WikiSourceRefRecord[]>;
  runsBySource: Map<string, WikiIngestionLogRecord[]>;
}) {
  return (
    <div style={cardShell}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "var(--space-16)", padding: "12px 20px", borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Sources
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted }}>
            {p.sources.length} of {p.totalCount}
          </span>
        </div>
        <div className="odyssey-search" style={{
          display: "flex", alignItems: "center", gap: "var(--space-8)",
          padding: "5px 10px", borderRadius: "var(--radius-md)",
          background: "var(--background)", border: `1px solid ${T.border}`, width: 240,
        }}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="var(--text-tertiary)" strokeWidth="1.5" />
            <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text" value={p.search}
            onChange={(e) => p.setSearch(e.target.value)}
            placeholder="Filter sources…"
            style={{ flex: 1, border: "none", background: "transparent", outline: "none", fontSize: "var(--font-size-base)", color: T.fg, fontFamily: T.fontBody }}
          />
        </div>
      </div>

      {/* Kind filter pills */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: "var(--space-6)", padding: "10px 20px",
        borderBottom: `1px solid ${T.border}`,
      }}>
        <FilterPill
          active={p.kindFilter === "all"}
          onClick={() => p.setKindFilter("all")}
          label="All"
          count={p.kindCounts.all}
        />
        {p.kindsPresent.map((k) => (
          <FilterPill
            key={k}
            active={p.kindFilter === k}
            onClick={() => p.setKindFilter(k)}
            label={k}
            count={p.kindCounts[k] ?? 0}
            dot={KIND_COLORS[k] ?? "var(--status-archived)"}
          />
        ))}
      </div>

      {/* Column headers */}
      <div style={{
        display: "flex", alignItems: "center", gap: "var(--space-14)", padding: "8px 20px",
        borderBottom: `1px solid ${T.border}`, background: T.cardHover,
      }}>
        <span style={{ ...colHeader, flex: 1 }}>Source</span>
        <span style={{ ...colHeader, width: 86 }}>Kind</span>
        <span style={{ ...colHeader, width: 64, textAlign: "right" }}>Pages</span>
        <span style={{ ...colHeader, width: 56, textAlign: "right" }}>Size</span>
        <span style={{ ...colHeader, width: 80 }}>Added</span>
      </div>

      {p.sources.length === 0 ? (
        <div style={{ padding: "3rem 1rem", textAlign: "center", color: T.muted, fontSize: "var(--font-size-md)", fontFamily: T.fontBody }}>
          No sources match your filters.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", overflow: "auto", maxHeight: "70vh" }}>
          {p.sources.map((s) => {
            const refs = p.refsBySource.get(s.id) ?? [];
            const pageIds = new Set(refs.map((r) => r.pageId));
            const tags = getTags(s);
            return (
              <SourceRow
                key={s.id} source={s} tags={tags}
                pageCount={pageIds.size}
                selected={s.id === p.selectedId}
                onSelect={() => p.onSelect(s.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function SourceRow({
  source, tags, pageCount, selected, onSelect,
}: {
  source: WikiSourceRecord; tags: string[]; pageCount: number;
  selected: boolean; onSelect: () => void;
}) {
  const kindColor = KIND_COLORS[source.kind] ?? "var(--status-archived)";
  return (
    <button
      type="button" onClick={onSelect}
      style={{
        display: "flex", alignItems: "center", gap: "var(--space-14)",
        padding: "12px 20px", border: "none", cursor: "pointer",
        textAlign: "left", width: "100%",
        borderBottom: `1px solid ${T.border}`,
        background: selected ? "var(--accent-soft)" : "transparent",
        borderLeft: selected ? "2px solid var(--accent-strong)" : "2px solid transparent",
        fontFamily: "inherit",
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = T.cardHover; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flexWrap: "wrap" }}>
          <span style={{
            fontFamily: T.fontHeading, fontSize: "var(--font-size-md)", fontWeight: selected ? 600 : 500, color: T.fg,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 520,
          }}>
            {source.title}
          </span>
          {tags.slice(0, 3).map((t) => (
            <span key={t} style={{
              padding: "1px 7px", borderRadius: "var(--radius-xs)",
              background: "color-mix(in srgb, var(--event-violet) 8%, transparent)",
              fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: "var(--event-violet)",
              letterSpacing: "0.05em", textTransform: "lowercase",
            }}>
              {t}
            </span>
          ))}
          {tags.length > 3 && (
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: T.muted }}>
              +{tags.length - 3}
            </span>
          )}
        </div>
        <span style={{
          fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted, lineHeight: "15px",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 640,
        }}>
          {truncate(source.content, 140)}
        </span>
      </div>

      <span style={{
        width: 86, flexShrink: 0,
        fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: kindColor,
      }}>
        {source.kind}
      </span>
      <span style={{
        width: 64, flexShrink: 0, textAlign: "right",
        fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", fontWeight: 500,
        color: pageCount > 0 ? T.fg : T.muted,
      }}>
        {pageCount}
      </span>
      <span style={{
        width: 56, flexShrink: 0, textAlign: "right",
        fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted,
      }}>
        {formatSize(source.content.length)}
      </span>
      <span style={{ width: 80, flexShrink: 0, fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted }}>
        {relative(source.createdAt)}
      </span>
    </button>
  );
}

function FilterPill({
  active, onClick, label, count, dot,
}: { active: boolean; onClick: () => void; label: string; count: number; dot?: string }) {
  return (
    <button
      className="odyssey-filter-pill"
      data-active={active}
      type="button" onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: "var(--space-5)",
        padding: "3px 10px", borderRadius: "var(--radius-button, 12px)",
        border: active ? "none" : `1px solid ${T.border}`,
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent-strong)" : T.muted,
        fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", fontWeight: active ? 500 : 400,
        cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {dot && (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} />
      )}
      {label}
      <span style={{ opacity: 0.6 }}>{count}</span>
    </button>
  );
}

/* ── Source detail ─────────────────────────────────────────────── */

function SourceDetail(p: {
  source: WikiSourceRecord;
  characterId: string;
  characterSlug: string;
  refs: WikiSourceRefRecord[];
  runs: WikiIngestionLogRecord[];
  pageById: Map<string, WikiPageRecord>;
  onNavigatePage: (slug: string) => void;
  onAfterDelete: () => void;
}) {
  const tags = getTags(p.source);
  const metadata = getMeta(p.source);

  // Group refs by page so each page appears once with its refs.
  const refsByPage = useMemo(() => {
    const m = new Map<string, WikiSourceRefRecord[]>();
    for (const r of p.refs) {
      if (!m.has(r.pageId)) m.set(r.pageId, []);
      m.get(r.pageId)!.push(r);
    }
    return m;
  }, [p.refs]);

  return (
    <div style={{ ...cardShell, maxHeight: "82vh", overflow: "auto" }}>
      <TopBar source={p.source} />
      <TitleBlock source={p.source} tags={tags} />
      {metadata.length > 0 && <MetadataBlock entries={metadata} />}
      <ContentBlock content={p.source.content} />
      <PagesBackedBlock
        refsByPage={refsByPage}
        pageById={p.pageById}
        onNavigatePage={p.onNavigatePage}
      />
      <RunsBlock runs={p.runs} />
      <DangerBlock
        source={p.source}
        characterId={p.characterId}
        pageCount={refsByPage.size}
        onDeleted={p.onAfterDelete}
      />
    </div>
  );
}

function TopBar({ source }: { source: WikiSourceRecord }) {
  const kindColor = KIND_COLORS[source.kind] ?? "var(--status-archived)";
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 20px", borderBottom: `1px solid ${T.border}`, background: "var(--surface-hover)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: "var(--space-6)",
          padding: "3px 9px", borderRadius: "var(--radius-button, 12px)",
          background: `color-mix(in srgb, ${kindColor} 12%, transparent)`,
          border: `1px solid color-mix(in srgb, ${kindColor} 22%, transparent)`,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: kindColor }} />
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 600, color: kindColor, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {source.kind}
          </span>
        </span>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: T.muted }}>
          id: {source.id.slice(0, 8)}…
        </span>
      </div>
      <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}>
        {relative(source.createdAt)}
      </span>
    </div>
  );
}

function TitleBlock({ source, tags }: { source: WikiSourceRecord; tags: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)", padding: "18px 20px", borderBottom: `1px solid ${T.border}` }}>
      <h1 style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-3xl)", fontWeight: 700, color: T.fg, margin: 0, lineHeight: "28px" }}>
        {source.title}
      </h1>
      {tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)" }}>
          {tags.map((t) => (
            <span key={t} style={{
              display: "inline-flex", alignItems: "center",
              padding: "2px 8px", borderRadius: "var(--radius-button, 12px)",
              background: "color-mix(in srgb, var(--event-violet) 8%, transparent)",
              border: "1px solid color-mix(in srgb, var(--event-violet) 24%, transparent)",
              fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: "var(--event-violet)",
            }}>
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MetadataBlock({ entries }: { entries: Array<[string, string]> }) {
  return (
    <Section title="Metadata">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ display: "flex", alignItems: "baseline", gap: "var(--space-10)" }}>
            <span style={{
              width: 116, flexShrink: 0, fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted,
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}>
              {k}
            </span>
            <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.fg, wordBreak: "break-word" }}>
              {v}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ContentBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const wordCount = useMemo(() => (content.trim() ? content.trim().split(/\s+/).length : 0), [content]);
  const size = formatSize(content.length);
  const preview = expanded ? content : truncate(content, 1400);
  const canExpand = content.length > preview.length;

  return (
    <Section
      title="Content"
      trailing={<span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}>
        {wordCount.toLocaleString()} words · {size}
      </span>}
    >
      <pre style={{
        margin: 0, padding: "12px 14px", borderRadius: "var(--radius-lg)",
        background: "var(--background)", border: `1px solid ${T.border}`,
        fontFamily: T.fontMono, fontSize: "var(--font-size-base)", color: T.fg, lineHeight: "19px",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
        maxHeight: expanded ? undefined : 340, overflow: "auto",
      }}>
        {preview}
      </pre>
      {canExpand && (
        <button type="button" onClick={() => setExpanded(true)}
          style={{
            marginTop: "var(--space-8)", padding: "5px 12px", borderRadius: "var(--radius-md)",
            border: `1px solid ${T.border}`, background: "transparent",
            fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.fg, cursor: "pointer",
          }}>
          Show all {wordCount.toLocaleString()} words
        </button>
      )}
    </Section>
  );
}

function PagesBackedBlock({
  refsByPage, pageById, onNavigatePage,
}: {
  refsByPage: Map<string, WikiSourceRefRecord[]>;
  pageById: Map<string, WikiPageRecord>;
  onNavigatePage: (slug: string) => void;
}) {
  if (refsByPage.size === 0) {
    return (
      <Section title="Pages backed by this source">
        <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted }}>
          No page references yet. Did the ingestion succeed?
        </span>
      </Section>
    );
  }
  const entries = Array.from(refsByPage.entries())
    .map(([pageId, refs]) => ({ page: pageById.get(pageId), refs }))
    .filter((e): e is { page: WikiPageRecord; refs: WikiSourceRefRecord[] } => !!e.page)
    .sort((a, b) => a.page.title.localeCompare(b.page.title));

  return (
    <Section title={`Pages backed · ${entries.length}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        {entries.map(({ page, refs }) => (
          <div key={page.id} style={{
            padding: "10px 12px", borderRadius: "var(--radius-lg)",
            background: "var(--surface-hover)", border: `1px solid ${T.border}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-8)", marginBottom: "var(--space-6)" }}>
              <button
                type="button" onClick={() => onNavigatePage(page.slug)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "var(--space-8)",
                  padding: 0, border: "none", background: "transparent",
                  fontFamily: T.fontHeading, fontSize: "var(--font-size-md)", fontWeight: 500, color: "var(--accent-strong)",
                  cursor: "pointer", textAlign: "left",
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: TYPE_DOT[page.type] }} />
                {page.title}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}>
                conf {page.confidence.toFixed(2).replace(/^0/, "")}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
              {refs.map((ref) => (
                <div key={ref.id} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  {ref.passage && (
                    <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}>{ref.passage}</span>
                  )}
                  {ref.quote && (
                    <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted, fontStyle: "italic", lineHeight: "17px" }}>
                      &ldquo;{ref.quote}&rdquo;
                    </span>
                  )}
                  {ref.relevanceNote && (
                    <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted }}>{ref.relevanceNote}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function RunsBlock({ runs }: { runs: WikiIngestionLogRecord[] }) {
  if (runs.length === 0) return null;
  return (
    <Section title={`Ingestion runs · ${runs.length}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        {runs.map((r) => {
          const color =
            r.status === "succeeded" ? "var(--status-live)" :
            r.status === "failed" ? "var(--status-error)" : "var(--accent-strong)";
          return (
            <div key={r.id} style={{
              display: "flex", alignItems: "center", gap: "var(--space-10)",
              padding: "8px 12px", borderRadius: "var(--radius-lg)",
              border: `1px solid ${T.border}`,
            }}>
              <span style={{
                width: 14, height: 14, borderRadius: "50%",
                background: `color-mix(in srgb, ${color} 12%, transparent)`,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                {r.status === "succeeded" ? (
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                ) : r.status === "failed" ? (
                  <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                ) : (
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
                )}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color }}>{r.status}</span>
                  {r.model && (
                    <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}>{r.model}</span>
                  )}
                  <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}>
                    · {r.pagesCreated} created · {r.pagesUpdated} updated · {r.edgesAdded} edges
                  </span>
                </div>
                {r.errorMessage && (
                  <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: "var(--status-error)" }}>{r.errorMessage}</span>
                )}
              </div>
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted, flexShrink: 0 }}>
                {r.tokensUsed.toLocaleString()} tok
              </span>
              <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted, flexShrink: 0, width: 70, textAlign: "right" }}>
                {relative(r.startedAt)}
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function DangerBlock({
  source, characterId, onDeleted,
}: {
  source: WikiSourceRecord; characterId: string; pageCount: number; onDeleted: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  function openModal() {
    setError(null);
    setPreview(null);
    setOpen(true);
    setPreviewLoading(true);
    void previewPurgeSource(characterId, source.id).then((res) => {
      setPreviewLoading(false);
      if (res.ok && res.data) setPreview(res.data);
      else if (!res.ok) setError(res.error);
    });
  }

  function confirm() {
    setError(null);
    start(async () => {
      const res = await deleteSource(characterId, source.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      onDeleted();
    });
  }

  return (
    <>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-12)",
        padding: "14px 20px", borderTop: "1px solid color-mix(in srgb, var(--status-error) 15%, transparent)",
        background: "color-mix(in srgb, var(--status-error) 3%, transparent)",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 500, color: T.fg }}>
            Purge source
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted }}>
            Removes this source + any pages whose only provenance was this source.
          </span>
        </div>
        <button
          type="button" onClick={openModal} disabled={pending}
          style={{
            padding: "5px 12px", borderRadius: "var(--radius-button, 12px)",
            border: "1px solid var(--critical-border)",
            background: "color-mix(in srgb, var(--status-error) 4%, transparent)",
            color: "var(--status-error)",
            fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", cursor: pending ? "not-allowed" : "pointer",
            flexShrink: 0, opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "Purging…" : "Purge…"}
        </button>
      </div>
      <PurgeConfirmModal
        open={open}
        kind="source"
        preview={preview}
        loading={previewLoading}
        pending={pending}
        error={error}
        onCancel={() => { if (!pending) setOpen(false); }}
        onConfirm={confirm}
      />
    </>
  );
}

/* ── Section + utils ───────────────────────────────────────────── */

function Section({
  title, trailing, children,
}: { title: string; trailing?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ padding: "18px 20px", borderBottom: `1px solid ${T.border}` }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-8)", marginBottom: "var(--space-10)" }}>
        <span style={{
          fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500, color: T.muted,
          letterSpacing: "0.1em", textTransform: "uppercase",
        }}>
          {title}
        </span>
        {trailing}
      </div>
      {children}
    </section>
  );
}

function EmptySources({ routeBase }: { routeBase: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "5rem 2rem", gap: "var(--space-14)", textAlign: "center",
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: "50%",
        background: "var(--material-card, var(--surface-1))", border: "1px solid var(--border-subtle, var(--border))",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </div>
      <h2 style={{ fontFamily: T.fontHeading, fontSize: 20, fontWeight: 600, margin: 0, color: T.fg }}>
        No sources yet
      </h2>
      <p style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: T.muted, margin: 0, maxWidth: 420, lineHeight: 1.55 }}>
        Sources are the raw material — scripture, commentary, transcripts, worldbooks — that the LLM compiles into the wiki.
      </p>
      <Link
        href={`${routeBase}/ingestion`}
        style={{
          display: "inline-flex", alignItems: "center", gap: "var(--space-6)",
          padding: "9px 18px", borderRadius: "var(--radius-lg)", border: "none",
          background: "var(--emissive-mint)", color: "#07100E",
          fontSize: "var(--font-size-md)", fontWeight: 600, fontFamily: T.fontBody, textDecoration: "none",
        }}
      >
        + Ingest a source
      </Link>
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
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)", alignItems: "center", maxWidth: 260 }}>
        <div style={{
          width: 48, height: 48, borderRadius: "50%", background: T.cardHover,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
        <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-md)", fontWeight: 500, color: T.fg }}>
          Select a source
        </span>
        <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted, lineHeight: 1.55 }}>
          Pick a row to see content, metadata, backed pages, and ingestion runs.
        </span>
      </div>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */

function getTags(source: WikiSourceRecord): string[] {
  const raw = source.metadata?.tags;
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is string => typeof t === "string");
}

function getMeta(source: WikiSourceRecord): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(source.metadata ?? {})) {
    if (k === "tags") continue;
    if (typeof v === "string" && v) out.push([k, v]);
    else if (typeof v === "number") out.push([k, String(v)]);
    else if (typeof v === "boolean") out.push([k, v ? "true" : "false"]);
  }
  return out;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + "…";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 100) return `${kb.toFixed(1)} kb`;
  return `${Math.round(kb)} kb`;
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
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ── Shared styles ─────────────────────────────────────────────── */

const cardShell: React.CSSProperties = {
  display: "flex", flexDirection: "column",
  background: "var(--material-card, var(--surface-1))",
  border: "1px solid var(--border-subtle, var(--border))",
  borderRadius: "var(--radius-card, 18px)",
  boxShadow: "var(--elevation-card)",
  overflow: "hidden",
};

const colHeader: React.CSSProperties = {
  fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", fontWeight: 500, color: T.muted,
  letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0,
};
