"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  WikiIngestionLogRecord,
  WikiPageRecord,
  WikiSourceKind,
  WikiSourceRecord,
  WikiSourceRefRecord,
} from "@odyssey/db";

/* ── Tokens ────────────────────────────────────────────────────── */

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const DISPLAY = '"Space Grotesk", system-ui, sans-serif';
const BODY = '"Geist", "Inter", system-ui, sans-serif';

const FG = "var(--foreground)";
const TEXT_PRIMARY = "var(--text-primary)";
const TEXT_SECONDARY = "var(--text-secondary)";
const TEXT_MUTED = "var(--text-tertiary)";
const TEXT_FADED = "var(--text-placeholder)";
const TEXT_GHOST = "var(--text-quaternary)";
const TEXT_QUIET = "color-mix(in srgb, var(--text-primary) 14%, transparent)";

const PANEL_BG = "var(--material-card)";
const BORDER = "var(--border-medium)";
const BORDER_STRONG = "var(--ink-edge)";
const DIVIDER = "var(--border-subtle)";
const INPUT_BG = "var(--control-bg)";

const ACCENT = "var(--accent-strong)";
const ACCENT_SOFT = "var(--accent-wash)";
const DANGER = "var(--status-error)";

/* ── Buckets ───────────────────────────────────────────────────── */

type Bucket = "primary" | "annotation" | "transcript" | "reference";
type BucketFilter = "all" | Bucket;

const KIND_TO_BUCKET: Record<WikiSourceKind, Bucket> = {
  bible: "primary",
  primary: "primary",
  commentary: "annotation",
  midrash: "annotation",
  annotation: "annotation",
  note: "reference",
  reference: "reference",
  transcript: "transcript",
};

const BUCKET_COLOR: Record<Bucket, string> = {
  primary: "#8FD1CB",
  annotation: "#F4A3B8",
  transcript: "#A8C4E8",
  reference: "#9AA4B2",
};

const BUCKET_LABEL: Record<Bucket, string> = {
  primary: "PRIMARY",
  annotation: "ANNOTATION",
  transcript: "TRANSCRIPT",
  reference: "REFERENCE",
};

const FILTER_ORDER: BucketFilter[] = [
  "all",
  "primary",
  "annotation",
  "transcript",
  "reference",
];

const BUCKET_ORDER: Bucket[] = [
  "primary",
  "annotation",
  "transcript",
  "reference",
];

/* ── Helpers ───────────────────────────────────────────────────── */

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

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function byteSize(s: string): string {
  const n = new Blob([s]).size;
  if (n < 1024) return `${n} b`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kb`;
  return `${(n / (1024 * 1024)).toFixed(1)} mb`;
}

/* ── Props ─────────────────────────────────────────────────────── */

export type WikiSourcesViewProps = {
  wikiId: string;
  wikiTitle: string;
  sources: WikiSourceRecord[];
  pages: WikiPageRecord[];
  refs: WikiSourceRefRecord[];
  runs: WikiIngestionLogRecord[];
  routeBase: string;
};

type SortKey = "added" | "title" | "size";

/* ── Root ──────────────────────────────────────────────────────── */

export function WikiSourcesView({
  wikiId,
  wikiTitle,
  sources,
  pages,
  refs,
  runs,
  routeBase,
}: WikiSourcesViewProps) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BucketFilter>("all");
  const [sort, setSort] = useState<SortKey>("added");

  // Focus search on Cmd+K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const refsBySource = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of refs) m.set(r.sourceId, (m.get(r.sourceId) ?? 0) + 1);
    return m;
  }, [refs]);

  const runsBySource = useMemo(() => {
    const m = new Map<string, WikiIngestionLogRecord[]>();
    for (const r of runs) {
      if (!r.sourceId) continue;
      const list = m.get(r.sourceId) ?? [];
      list.push(r);
      m.set(r.sourceId, list);
    }
    return m;
  }, [runs]);

  const bucketCounts = useMemo(() => {
    const c: Record<BucketFilter, number> = {
      all: sources.length,
      primary: 0,
      annotation: 0,
      transcript: 0,
      reference: 0,
    };
    for (const s of sources) c[KIND_TO_BUCKET[s.kind]] += 1;
    return c;
  }, [sources]);

  const lastIngestedOverall = useMemo(() => {
    const latest = runs.reduce<WikiIngestionLogRecord | null>((acc, r) => {
      const t = new Date(r.finishedAt ?? r.startedAt).getTime();
      if (!acc) return r;
      const accT = new Date(acc.finishedAt ?? acc.startedAt).getTime();
      return t > accT ? r : acc;
    }, null);
    return latest;
  }, [runs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = sources.filter((s) => {
      if (filter !== "all" && KIND_TO_BUCKET[s.kind] !== filter) return false;
      if (!q) return true;
      const meta = s.metadata as Record<string, unknown>;
      const tags = Array.isArray(meta.tags) ? (meta.tags as string[]) : [];
      const summary = typeof meta.summary === "string" ? (meta.summary as string) : "";
      return (
        s.title.toLowerCase().includes(q) ||
        s.kind.toLowerCase().includes(q) ||
        summary.toLowerCase().includes(q) ||
        tags.some((t) => t.toLowerCase().includes(q))
      );
    });
    const sortFn = (a: WikiSourceRecord, b: WikiSourceRecord) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "size") return b.content.length - a.content.length;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    };
    return list.sort(sortFn);
  }, [sources, query, filter, sort]);

  const grouped = useMemo(() => {
    const byBucket = new Map<Bucket, WikiSourceRecord[]>();
    for (const s of filtered) {
      const b = KIND_TO_BUCKET[s.kind];
      const list = byBucket.get(b) ?? [];
      list.push(s);
      byBucket.set(b, list);
    }
    const order: Array<{ bucket: Bucket; sources: WikiSourceRecord[] }> = [];
    for (const b of BUCKET_ORDER) {
      const list = byBucket.get(b);
      if (list && list.length > 0) order.push({ bucket: b, sources: list });
    }
    return order;
  }, [filtered]);

  function handleOpen(s: WikiSourceRecord) {
    router.push(`${routeBase}/sources/${s.id}`);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: PANEL_BG,
        minHeight: "calc(100vh - 67px)",
        paddingBottom: 80,
      }}
    >
      <TopEyebrow wikiId={wikiId} wikiTitle={wikiTitle} />
      <HeroBlock />
      <MetaStrip
        sources={sources}
        bucketCounts={bucketCounts}
        pages={pages}
        lastRun={lastIngestedOverall}
      />
      <FilterStrip
        searchRef={searchRef}
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
        bucketCounts={bucketCounts}
        sort={sort}
        onSort={setSort}
        ingestHref={`${routeBase}/ingestion`}
      />
      <ListHeader />
      <div style={{ padding: "0 32px" }}>
        {filtered.length === 0 ? (
          <Empty>
            {query.trim()
              ? `No sources match "${query}"`
              : "No sources yet — open the Ingestion tab to add one."}
          </Empty>
        ) : (
          grouped.map((group) => (
            <BucketGroup
              key={group.bucket}
              bucket={group.bucket}
              sources={group.sources}
              refsBySource={refsBySource}
              runsBySource={runsBySource}
              onOpen={handleOpen}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ── TopEyebrow ────────────────────────────────────────────────── */

function TopEyebrow({
  wikiId,
  wikiTitle,
}: {
  wikiId: string;
  wikiTitle: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "18px 32px",
        borderTop: 0,
        borderRight: 0,
        borderBottom: `1px solid ${DIVIDER}`,
        borderLeft: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "var(--space-14)",
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          fontWeight: 500,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        <Link href="/wikis" style={{ color: TEXT_GHOST, textDecoration: "none" }}>
          wikis
        </Link>
        <span style={{ color: TEXT_QUIET }}>/</span>
        <Link
          href={`/wikis/${wikiId}`}
          style={{ color: TEXT_MUTED, textDecoration: "none" }}
        >
          {wikiTitle}
        </Link>
        <span style={{ color: TEXT_QUIET }}>/</span>
        <span style={{ color: ACCENT }}>sources</span>
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 10.5,
          fontWeight: 500,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: TEXT_FADED,
        }}
      >
        ⌘K to search
      </div>
    </div>
  );
}

/* ── HeroBlock ─────────────────────────────────────────────────── */

function HeroBlock() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-14)",
        padding: "36px 40px 12px",
      }}
    >
      <h1
        style={{
          margin: 0,
          fontFamily: DISPLAY,
          fontSize: 52,
          fontWeight: 500,
          lineHeight: "60px",
          letterSpacing: "-0.014em",
          color: FG,
        }}
      >
        Sources
      </h1>
      <p
        style={{
          margin: 0,
          maxWidth: 760,
          fontFamily: BODY,
          fontSize: "var(--font-size-xl)",
          fontWeight: 400,
          lineHeight: "26px",
          color: TEXT_SECONDARY,
        }}
      >
        Every canonical document attached to this wiki — bibles, commentaries,
        midrash, transcripts, notes. Each row links to its full ingestion record
        (input · prompt · output · effects).
      </p>
    </div>
  );
}

/* ── MetaStrip ─────────────────────────────────────────────────── */

function MetaStrip({
  sources,
  bucketCounts,
  pages,
  lastRun,
}: {
  sources: WikiSourceRecord[];
  bucketCounts: Record<BucketFilter, number>;
  pages: WikiPageRecord[];
  lastRun: WikiIngestionLogRecord | null;
}) {
  const totalWords = useMemo(
    () => sources.reduce((acc, s) => acc + wordCount(s.content), 0),
    [sources],
  );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "var(--space-32)",
        padding: "8px 40px 0",
        flexWrap: "wrap",
      }}
    >
      <MetaCell label="TOTAL" value={String(sources.length)} accent />
      <MetaDivider />
      <MetaCell label="PRIMARY" value={String(bucketCounts.primary)} swatch={BUCKET_COLOR.primary} />
      <MetaDivider />
      <MetaCell
        label="ANNOTATION"
        value={String(bucketCounts.annotation)}
        swatch={BUCKET_COLOR.annotation}
      />
      <MetaDivider />
      <MetaCell
        label="TRANSCRIPT"
        value={String(bucketCounts.transcript)}
        swatch={BUCKET_COLOR.transcript}
      />
      <MetaDivider />
      <MetaCell
        label="REFERENCE"
        value={String(bucketCounts.reference)}
        swatch={BUCKET_COLOR.reference}
      />
      <MetaDivider />
      <MetaCell
        label="TOTAL WORDS"
        value={totalWords.toLocaleString()}
      />
      <MetaDivider />
      <MetaCell
        label="PAGES IN GRAPH"
        value={String(pages.length)}
      />
      <MetaDivider />
      <MetaCell
        label="LAST INGESTED"
        value={lastRun ? relative(lastRun.finishedAt ?? lastRun.startedAt) : "never"}
      />
    </div>
  );
}

function MetaCell({
  label,
  value,
  accent = false,
  swatch,
}: {
  label: string;
  value: string;
  accent?: boolean;
  swatch?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "var(--space-6)",
        }}
      >
        {swatch && (
          <span
            style={{
              display: "inline-block",
              width: 7,
              height: 7,
              background: swatch,
            }}
          />
        )}
        <span
          style={{
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: TEXT_FADED,
          }}
        >
          {label}
        </span>
      </div>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 12.5,
          fontWeight: accent ? 600 : 500,
          color: accent ? ACCENT : TEXT_PRIMARY,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function MetaDivider() {
  return <div style={{ width: 1, height: 32, background: DIVIDER }} />;
}

/* ── FilterStrip ───────────────────────────────────────────────── */

function FilterStrip({
  searchRef,
  query,
  onQuery,
  filter,
  onFilter,
  bucketCounts,
  sort,
  onSort,
  ingestHref,
}: {
  searchRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (v: string) => void;
  filter: BucketFilter;
  onFilter: (b: BucketFilter) => void;
  bucketCounts: Record<BucketFilter, number>;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  ingestHref: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "var(--space-14)",
        padding: "32px 40px 0",
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "var(--space-8)",
          flex: 1,
          minWidth: 280,
          maxWidth: 520,
          padding: "9px 14px",
          background: INPUT_BG,
          borderTop: `1px solid ${BORDER}`,
          borderRight: `1px solid ${BORDER}`,
          borderBottom: `1px solid ${BORDER}`,
          borderLeft: `1px solid ${BORDER}`,
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: "var(--font-size-md)", color: TEXT_FADED }}>⌕</span>
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search title, kind, summary, tags…"
          style={{
            flex: 1,
            background: "transparent",
            border: 0,
            outline: "none",
            color: FG,
            fontFamily: MONO,
            fontSize: 12.5,
          }}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery("")}
            aria-label="Clear search"
            style={{
              background: "transparent",
              border: 0,
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              color: TEXT_FADED,
              cursor: "pointer",
              padding: 0,
            }}
          >
            ✕
          </button>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "var(--space-6)",
        }}
      >
        {FILTER_ORDER.map((b) => (
          <FilterPill
            key={b}
            bucket={b}
            count={bucketCounts[b]}
            active={filter === b}
            onClick={() => onFilter(b)}
          />
        ))}
      </div>

      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "var(--space-8)",
        }}
      >
        <SortToggle sort={sort} onSort={onSort} />
        <Link
          href={ingestHref}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-8)",
            padding: "9px 14px",
            background: ACCENT,
            borderTop: `1px solid ${ACCENT}`,
            borderRight: `1px solid ${ACCENT}`,
            borderBottom: `1px solid ${ACCENT}`,
            borderLeft: `1px solid ${ACCENT}`,
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--accent-on)",
            textDecoration: "none",
          }}
        >
          + INGEST
        </Link>
      </div>
    </div>
  );
}

function FilterPill({
  bucket,
  count,
  active,
  onClick,
}: {
  bucket: BucketFilter;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const color = bucket === "all" ? ACCENT : BUCKET_COLOR[bucket];
  const label = bucket === "all" ? "ALL" : BUCKET_LABEL[bucket];
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-8)",
        padding: "9px 14px",
        background: active ? ACCENT_SOFT : "transparent",
        borderTop: `1px solid ${active ? color : BORDER_STRONG}`,
        borderRight: `1px solid ${active ? color : BORDER_STRONG}`,
        borderBottom: `1px solid ${active ? color : BORDER_STRONG}`,
        borderLeft: `1px solid ${active ? color : BORDER_STRONG}`,
        fontFamily: MONO,
        fontSize: "var(--font-size-sm)",
        fontWeight: active ? 600 : 500,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: active ? color : TEXT_SECONDARY,
        cursor: "pointer",
      }}
    >
      {bucket !== "all" && (
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            background: color,
          }}
        />
      )}
      <span>{label}</span>
      <span style={{ color: TEXT_FADED, fontWeight: 400 }}>{count}</span>
    </button>
  );
}

function SortToggle({
  sort,
  onSort,
}: {
  sort: SortKey;
  onSort: (s: SortKey) => void;
}) {
  const options: Array<{ key: SortKey; label: string }> = [
    { key: "added", label: "ADDED" },
    { key: "title", label: "TITLE" },
    { key: "size", label: "SIZE" },
  ];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 0,
        borderTop: `1px solid ${BORDER_STRONG}`,
        borderRight: `1px solid ${BORDER_STRONG}`,
        borderBottom: `1px solid ${BORDER_STRONG}`,
        borderLeft: `1px solid ${BORDER_STRONG}`,
      }}
    >
      <span
        style={{
          padding: "9px 12px",
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
          fontWeight: 500,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: TEXT_FADED,
          borderRight: `1px solid ${BORDER_STRONG}`,
        }}
      >
        SORT
      </span>
      {options.map((opt, i) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onSort(opt.key)}
          style={{
            padding: "9px 12px",
            background: sort === opt.key ? ACCENT_SOFT : "transparent",
            border: 0,
            borderRight: i < options.length - 1 ? `1px solid ${BORDER_STRONG}` : 0,
            fontFamily: MONO,
            fontSize: 10.5,
            fontWeight: sort === opt.key ? 600 : 500,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: sort === opt.key ? ACCENT : TEXT_SECONDARY,
            cursor: "pointer",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ── List header ───────────────────────────────────────────────── */

function ListHeader() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 0,
        margin: "28px 40px 0",
        padding: "10px 18px",
        background: INPUT_BG,
        borderTop: `1px solid ${BORDER}`,
        borderRight: `1px solid ${BORDER}`,
        borderBottom: `1px solid ${DIVIDER}`,
        borderLeft: `1px solid ${BORDER}`,
      }}
    >
      <ColHead width={14} />
      <ColHead width={100}>KIND</ColHead>
      <ColHead flex>TITLE</ColHead>
      <ColHead width={120} alignRight>PAGES BACKED</ColHead>
      <ColHead width={100} alignRight>RUNS</ColHead>
      <ColHead width={120} alignRight>SIZE</ColHead>
      <ColHead width={130} alignRight>ADDED</ColHead>
      <ColHead width={32} />
    </div>
  );
}

function ColHead({
  width,
  flex,
  alignRight,
  children,
}: {
  width?: number;
  flex?: boolean;
  alignRight?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        ...(flex ? { flex: 1, minWidth: 0 } : { width, flexShrink: 0 }),
        fontFamily: MONO,
        fontSize: "var(--font-size-xs)",
        fontWeight: 500,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: TEXT_FADED,
        textAlign: alignRight ? "right" : "left",
      }}
    >
      {children}
    </div>
  );
}

/* ── BucketGroup ───────────────────────────────────────────────── */

function BucketGroup({
  bucket,
  sources,
  refsBySource,
  runsBySource,
  onOpen,
}: {
  bucket: Bucket;
  sources: WikiSourceRecord[];
  refsBySource: Map<string, number>;
  runsBySource: Map<string, WikiIngestionLogRecord[]>;
  onOpen: (s: WikiSourceRecord) => void;
}) {
  const color = BUCKET_COLOR[bucket];
  const totalWords = sources.reduce((acc, s) => acc + wordCount(s.content), 0);

  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "var(--space-14)",
          padding: "18px 18px 8px",
          margin: "0 8px",
          borderTop: 0,
          borderRight: `1px solid ${BORDER}`,
          borderBottom: `1px solid ${DIVIDER}`,
          borderLeft: `1px solid ${BORDER}`,
          background: PANEL_BG,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            background: color,
          }}
        />
        <span
          style={{
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            fontWeight: 600,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color,
          }}
        >
          {BUCKET_LABEL[bucket]}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            fontWeight: 400,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: TEXT_FADED,
          }}
        >
          {sources.length} {sources.length === 1 ? "SOURCE" : "SOURCES"}
        </span>
        <div style={{ flex: 1, height: 1, background: DIVIDER }} />
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            fontWeight: 500,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: TEXT_MUTED,
          }}
        >
          {totalWords.toLocaleString()} WORDS
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0,
          margin: "0 8px",
          borderTop: 0,
          borderRight: `1px solid ${BORDER}`,
          borderBottom: `1px solid ${BORDER}`,
          borderLeft: `1px solid ${BORDER}`,
        }}
      >
        {sources.map((s) => (
          <SourceRow
            key={s.id}
            source={s}
            refs={refsBySource.get(s.id) ?? 0}
            runs={runsBySource.get(s.id) ?? []}
            onOpen={() => onOpen(s)}
          />
        ))}
      </div>
    </>
  );
}

/* ── SourceRow ─────────────────────────────────────────────────── */

function SourceRow({
  source,
  refs,
  runs,
  onOpen,
}: {
  source: WikiSourceRecord;
  refs: number;
  runs: WikiIngestionLogRecord[];
  onOpen: () => void;
}) {
  const bucket = KIND_TO_BUCKET[source.kind];
  const color = BUCKET_COLOR[bucket];
  const meta = source.metadata as Record<string, unknown>;
  const summary =
    typeof meta.summary === "string" ? (meta.summary as string) : null;
  const lastRun = runs[0] ?? null;
  const failedCount = runs.filter((r) => r.status === "failed").length;

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 0,
        padding: "14px 18px",
        background: "transparent",
        borderTop: 0,
        borderRight: 0,
        borderBottom: `1px solid ${DIVIDER}`,
        borderLeft: `2px solid ${color}`,
        textAlign: "left",
        cursor: "pointer",
        color: "inherit",
        width: "calc(100% - 0px)",
      }}
    >
      <div style={{ width: 14, flexShrink: 0 }} />
      <div
        style={{
          width: 100,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "var(--space-8)",
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            fontWeight: 500,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: TEXT_SECONDARY,
          }}
        >
          {source.kind}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          paddingRight: "var(--space-14)",
        }}
      >
        <span
          style={{
            fontFamily: DISPLAY,
            fontSize: 15,
            fontWeight: 500,
            color: FG,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {source.title}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            fontWeight: 400,
            color: TEXT_MUTED,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary ?? <span style={{ color: TEXT_GHOST }}>no summary</span>}
        </span>
      </div>
      <div
        style={{
          width: 120,
          flexShrink: 0,
          textAlign: "right",
          fontFamily: MONO,
          fontSize: "var(--font-size-base)",
          color: refs > 0 ? TEXT_PRIMARY : TEXT_GHOST,
        }}
      >
        {refs} {refs === 1 ? "ref" : "refs"}
      </div>
      <div
        style={{
          width: 100,
          flexShrink: 0,
          textAlign: "right",
          fontFamily: MONO,
          fontSize: "var(--font-size-base)",
          color: runs.length > 0 ? TEXT_PRIMARY : TEXT_GHOST,
        }}
      >
        {runs.length}
        {failedCount > 0 && (
          <span style={{ color: DANGER, marginLeft: "var(--space-6)" }}>· {failedCount} ✗</span>
        )}
      </div>
      <div
        style={{
          width: 120,
          flexShrink: 0,
          textAlign: "right",
          fontFamily: MONO,
          fontSize: "var(--font-size-base)",
          color: TEXT_MUTED,
        }}
      >
        {byteSize(source.content)}
      </div>
      <div
        style={{
          width: 130,
          flexShrink: 0,
          textAlign: "right",
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          color: TEXT_MUTED,
        }}
      >
        {lastRun
          ? relative(lastRun.finishedAt ?? lastRun.startedAt)
          : relative(source.createdAt)}
      </div>
      <div
        style={{
          width: 32,
          flexShrink: 0,
          textAlign: "right",
          fontFamily: MONO,
          fontSize: "var(--font-size-md)",
          color: TEXT_FADED,
        }}
      >
        ↗
      </div>
    </button>
  );
}

/* ── Empty ─────────────────────────────────────────────────────── */

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        margin: "32px 8px 0",
        padding: "48px 24px",
        borderTop: `1px dashed ${BORDER_STRONG}`,
        borderRight: `1px dashed ${BORDER_STRONG}`,
        borderBottom: `1px dashed ${BORDER_STRONG}`,
        borderLeft: `1px dashed ${BORDER_STRONG}`,
        fontFamily: MONO,
        fontSize: "var(--font-size-base)",
        color: TEXT_MUTED,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}
