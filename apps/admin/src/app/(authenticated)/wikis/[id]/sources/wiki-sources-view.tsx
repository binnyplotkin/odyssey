"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  WikiIngestionLogRecord,
  WikiPageRecord,
  WikiSourceKind,
  WikiSourceRecord,
  WikiSourceRefRecord,
} from "@odyssey/db";
import {
  previewPurgeWikiSource,
  purgeWikiSource,
} from "@/app/(authenticated)/wikis/actions";
import {
  PurgeConfirmModal,
  type PurgePreview,
} from "@/components/purge-confirm-modal";

const FG = "#F1F5F9";
const TEXT_DIM = "#FFFFFFD9";
const TEXT_MUTED = "#FFFFFF8C";
const TEXT_FADED = "#FFFFFF73";
const TEXT_GHOST = "#FFFFFF66";
const BORDER = "#FFFFFF14";
const BORDER_STRONG = "#FFFFFF1A";
const ROW_BG = "#FFFFFF05";
const ROW_BORDER = "#FFFFFF0F";
const ROW_BG_ACTIVE = "#8CE7D20D";
const ROW_BORDER_ACTIVE = "#8CE7D24D";
const ACCENT = "#8CE7D2";
const OK = "#4ADE80";
const BAD = "#E89090";
const HEAD = '"Space Grotesk", system-ui, sans-serif';
const MONO = '"JetBrains Mono", system-ui, sans-serif';

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
  primary: "#8CE7D2",
  annotation: "#F4A3B8",
  transcript: "#A8C4E8",
  reference: "#9AA4B2",
};

const BUCKET_PLURAL: Record<Bucket, string> = {
  primary: "primary",
  annotation: "annotations",
  transcript: "transcripts",
  reference: "references",
};

const FILTER_ORDER: BucketFilter[] = [
  "all",
  "primary",
  "annotation",
  "transcript",
  "reference",
];

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

function bytes(s: string): string {
  const n = new Blob([s]).size;
  if (n < 1024) return `${n} b`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kb`;
  return `${(n / (1024 * 1024)).toFixed(1)} mb`;
}

export type WikiSourcesViewProps = {
  wikiId: string;
  sources: WikiSourceRecord[];
  pages: WikiPageRecord[];
  refs: WikiSourceRefRecord[];
  runs: WikiIngestionLogRecord[];
  initialSourceId: string | null;
  routeBase: string;
};

export function WikiSourcesView({
  wikiId,
  sources,
  pages,
  refs,
  runs,
  initialSourceId,
  routeBase,
}: WikiSourcesViewProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSourceId ?? (sources[0]?.id ?? null),
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BucketFilter>("all");
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgePreview, setPurgePreview] = useState<PurgePreview | null>(null);
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [purgePending, startPurge] = useTransition();

  const pageById = useMemo(
    () => new Map(pages.map((p) => [p.id, p])),
    [pages],
  );

  const refsBySource = useMemo(() => {
    const m = new Map<string, WikiSourceRefRecord[]>();
    for (const r of refs) {
      const list = m.get(r.sourceId) ?? [];
      list.push(r);
      m.set(r.sourceId, list);
    }
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
    const c: Record<string, number> = { all: sources.length };
    for (const s of sources) {
      const b = KIND_TO_BUCKET[s.kind];
      c[b] = (c[b] ?? 0) + 1;
    }
    return c;
  }, [sources]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sources
      .filter((s) =>
        filter === "all" ? true : KIND_TO_BUCKET[s.kind] === filter,
      )
      .filter((s) => {
        if (!q) return true;
        return (
          s.title.toLowerCase().includes(q) ||
          s.kind.toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }, [sources, query, filter]);

  /* Group by bucket. */
  const grouped = useMemo(() => {
    const order: Array<{ bucket: Bucket; sources: WikiSourceRecord[] }> = [];
    const byBucket = new Map<Bucket, WikiSourceRecord[]>();
    for (const s of filtered) {
      const b = KIND_TO_BUCKET[s.kind];
      const list = byBucket.get(b) ?? [];
      list.push(s);
      byBucket.set(b, list);
    }
    const allBuckets: Bucket[] = ["primary", "annotation", "transcript", "reference"];
    for (const b of allBuckets) {
      const list = byBucket.get(b);
      if (list && list.length > 0) {
        order.push({ bucket: b, sources: list });
      }
    }
    return order;
  }, [filtered]);

  const selected = selectedId ? sources.find((s) => s.id === selectedId) ?? null : null;

  function handleSelect(s: WikiSourceRecord) {
    router.push(`${routeBase}/sources/${s.id}`);
  }

  function openPurge() {
    if (!selected) return;
    setPurgeOpen(true);
    setPurgePreview(null);
    setPurgeError(null);
    setPurgeLoading(true);
    void previewPurgeWikiSource(wikiId, selected.id).then((res) => {
      setPurgeLoading(false);
      if (res.ok) setPurgePreview(res.data ?? null);
      else setPurgeError(res.error);
    });
  }

  function confirmPurge() {
    if (!selected) return;
    setPurgeError(null);
    startPurge(async () => {
      const res = await purgeWikiSource(wikiId, selected.id);
      if (!res.ok) {
        setPurgeError(res.error);
        return;
      }
      setPurgeOpen(false);
      setPurgePreview(null);
      const next = sources.find((s) => s.id !== selected.id) ?? null;
      setSelectedId(next?.id ?? null);
      router.refresh();
    });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 67px)",
      }}
    >
      {/* Filter strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "18px 32px",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1 }}>
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Search sources, tags, passages…"
          />
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {FILTER_ORDER.map((b) => {
              const isActive = filter === b;
              const color = b === "all" ? FG : BUCKET_COLOR[b];
              const label = b === "all" ? "all" : BUCKET_PLURAL[b];
              const n = bucketCounts[b] ?? 0;
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setFilter(b)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: b === "all" ? "4px 10px" : "4px 0",
                    borderRadius: b === "all" ? 999 : 0,
                    border:
                      b === "all"
                        ? `1px solid ${isActive ? color : BORDER_STRONG}`
                        : "none",
                    background:
                      b === "all" && isActive ? "#FFFFFF0F" : "transparent",
                    color: isActive ? FG : TEXT_MUTED,
                    fontFamily: MONO,
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  {b !== "all" && (
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: color,
                      }}
                    />
                  )}
                  {label}
                  <span style={{ color: TEXT_FADED }}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 8,
              border: `1px solid ${BORDER_STRONG}`,
              background: "transparent",
              color: TEXT_DIM,
              fontFamily: MONO,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            added ↓
          </button>
          <button
            type="button"
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              background: ACCENT,
              color: "#0C0E14",
              fontWeight: 600,
              fontSize: 12,
              border: "none",
              cursor: "pointer",
            }}
          >
            + add source
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr",
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* List */}
        <div
          style={{
            borderRight: `1px solid ${BORDER}`,
            overflow: "auto",
            padding: "16px 24px 32px",
          }}
        >
          {grouped.length === 0 ? (
            <Empty>No sources match this filter.</Empty>
          ) : (
            grouped.map((group, idx) => (
              <div key={group.bucket} style={{ marginTop: idx === 0 ? 0 : 20 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    padding: "6px 4px 10px",
                    fontFamily: MONO,
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: TEXT_FADED,
                  }}
                >
                  <span>
                    {BUCKET_PLURAL[group.bucket]} · {group.sources.length}
                  </span>
                  {idx === 0 && <span>grouped by kind</span>}
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  {group.sources.map((s) => (
                    <SourceRow
                      key={s.id}
                      source={s}
                      active={s.id === selectedId}
                      refs={refsBySource.get(s.id)?.length ?? 0}
                      onSelect={() => handleSelect(s)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Detail */}
        <div style={{ overflow: "auto", padding: "20px 28px 40px" }}>
          {selected ? (
            <SourceDetail
              source={selected}
              refs={refsBySource.get(selected.id) ?? []}
              runs={runsBySource.get(selected.id) ?? []}
              pageById={pageById}
              onOpenPurge={openPurge}
              purgeOpen={purgeOpen}
              purgePreview={purgePreview}
              purgeLoading={purgeLoading}
              purgePending={purgePending}
              purgeError={purgeError}
              onCancelPurge={() => {
                if (purgePending) return;
                setPurgeOpen(false);
                setPurgePreview(null);
                setPurgeError(null);
              }}
              onConfirmPurge={confirmPurge}
            />
          ) : (
            <Empty>Select a source to inspect.</Empty>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Row ────────────────────────────────────────────────────────── */

function SourceRow({
  source,
  active,
  refs,
  onSelect,
}: {
  source: WikiSourceRecord;
  active: boolean;
  refs: number;
  onSelect: () => void;
}) {
  const bucket = KIND_TO_BUCKET[source.kind];
  const color = BUCKET_COLOR[bucket];
  const summary =
    typeof source.metadata.summary === "string"
      ? (source.metadata.summary as string)
      : null;
  const tags =
    Array.isArray(source.metadata.tags) && (source.metadata.tags as unknown[]).every((t) => typeof t === "string")
      ? (source.metadata.tags as string[])
      : [];
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 14,
        padding: "14px 16px",
        borderRadius: 12,
        border: `1px solid ${active ? ROW_BORDER_ACTIVE : ROW_BORDER}`,
        background: active ? ROW_BG_ACTIVE : ROW_BG,
        textAlign: "left",
        cursor: "pointer",
        color: "inherit",
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          marginTop: 6,
          borderRadius: "50%",
          background: color,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <div
          style={{
            fontFamily: HEAD,
            fontSize: 14,
            fontWeight: 600,
            color: FG,
          }}
        >
          {source.title}
        </div>
        {summary && (
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              color: TEXT_MUTED,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
            }}
          >
            {summary}
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: "0.02em",
            color: TEXT_FADED,
          }}
        >
          <span style={{ color, textTransform: "uppercase" }}>{bucket}</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{source.kind}</span>
          {tags.length > 0 && (
            <>
              <span style={{ opacity: 0.4 }}>tags:</span>
              {tags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  style={{
                    padding: "1px 6px",
                    borderRadius: 4,
                    border: `1px solid ${ROW_BORDER}`,
                    color: TEXT_MUTED,
                  }}
                >
                  {t}
                </span>
              ))}
            </>
          )}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 4,
          fontFamily: MONO,
          fontSize: 10,
          color: TEXT_FADED,
          whiteSpace: "nowrap",
        }}
      >
        <span>
          {refs} ref{refs === 1 ? "" : "s"}
        </span>
        <span>{relative(source.createdAt)}</span>
      </div>
    </button>
  );
}

/* ── Detail ─────────────────────────────────────────────────────── */

function SourceDetail({
  source,
  refs,
  runs,
  pageById,
  onOpenPurge,
  purgeOpen,
  purgePreview,
  purgeLoading,
  purgePending,
  purgeError,
  onCancelPurge,
  onConfirmPurge,
}: {
  source: WikiSourceRecord;
  refs: WikiSourceRefRecord[];
  runs: WikiIngestionLogRecord[];
  pageById: Map<string, WikiPageRecord>;
  onOpenPurge: () => void;
  purgeOpen: boolean;
  purgePreview: PurgePreview | null;
  purgeLoading: boolean;
  purgePending: boolean;
  purgeError: string | null;
  onCancelPurge: () => void;
  onConfirmPurge: () => void;
}) {
  const bucket = KIND_TO_BUCKET[source.kind];
  const color = BUCKET_COLOR[bucket];
  const meta = source.metadata as Record<string, unknown>;
  const tags = Array.isArray(meta.tags) ? (meta.tags as string[]) : [];
  const sourceUrl = typeof meta.sourceUrl === "string" ? (meta.sourceUrl as string) : null;
  const edition = typeof meta.edition === "string" ? (meta.edition as string) : null;
  const language = typeof meta.language === "string" ? (meta.language as string) : null;

  /* Count refs per backing page. */
  const refsByPage = new Map<string, number>();
  for (const r of refs) {
    refsByPage.set(r.pageId, (refsByPage.get(r.pageId) ?? 0) + 1);
  }
  const backedPages = Array.from(refsByPage.entries())
    .map(([pageId, n]) => ({ page: pageById.get(pageId), n }))
    .filter((x): x is { page: WikiPageRecord; n: number } => Boolean(x.page))
    .sort((a, b) => b.n - a.n);

  const excerpt =
    source.content.length > 600 ? source.content.slice(0, 600) + "…" : source.content;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 10px",
              borderRadius: 999,
              background: `${color}1F`,
              border: `1px solid ${color}4D`,
              color,
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: color,
              }}
            />
            {bucket}
            <span style={{ opacity: 0.7 }}>· {source.kind}</span>
          </span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 11,
              color: TEXT_GHOST,
            }}
          >
            id: {source.id.slice(0, 10)}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            style={{
              padding: "5px 12px",
              borderRadius: 8,
              border: `1px solid ${BORDER_STRONG}`,
              background: "transparent",
              fontFamily: HEAD,
              fontSize: 12,
              fontWeight: 500,
              color: FG,
              cursor: "pointer",
            }}
          >
            Edit
          </button>
          <button
            type="button"
            style={{
              width: 30,
              height: 28,
              borderRadius: 8,
              border: `1px solid ${BORDER_STRONG}`,
              background: "transparent",
              color: TEXT_MUTED,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            …
          </button>
        </div>
      </div>

      <div>
        <h1
          style={{
            margin: 0,
            fontFamily: HEAD,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: FG,
          }}
        >
          {source.title}
        </h1>
        <div
          style={{
            marginTop: 6,
            fontFamily: MONO,
            fontSize: 11,
            color: TEXT_GHOST,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span>{wordCount(source.content).toLocaleString()} words</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>{bytes(source.content)}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>added {relative(source.createdAt)}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>hash {source.contentHash.slice(0, 8)}</span>
        </div>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionLabel>metadata</SectionLabel>
        <table
          style={{
            borderCollapse: "collapse",
            fontFamily: MONO,
            fontSize: 12,
          }}
        >
          <tbody>
            {edition && <FmRow label="edition" value={edition} />}
            {language && <FmRow label="language" value={language} />}
            {tags.length > 0 && (
              <tr>
                <td
                  style={{
                    padding: "4px 18px 4px 0",
                    color: TEXT_FADED,
                    verticalAlign: "top",
                  }}
                >
                  tags
                </td>
                <td style={{ padding: "4px 0" }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {tags.map((t) => (
                      <span
                        key={t}
                        style={{
                          padding: "1px 8px",
                          borderRadius: 4,
                          border: `1px solid ${ROW_BORDER}`,
                          color: TEXT_DIM,
                          fontSize: 11,
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            )}
            {sourceUrl && (
              <tr>
                <td
                  style={{
                    padding: "4px 18px 4px 0",
                    color: TEXT_FADED,
                    verticalAlign: "top",
                    whiteSpace: "nowrap",
                  }}
                >
                  source url
                </td>
                <td style={{ padding: "4px 0" }}>
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: ACCENT, fontSize: 11 }}
                  >
                    {sourceUrl}
                  </a>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {source.content && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
            }}
          >
            <SectionLabel>content · excerpt</SectionLabel>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 10,
                color: TEXT_FADED,
              }}
            >
              show all {wordCount(source.content).toLocaleString()} words
            </span>
          </div>
          <div
            style={{
              padding: "14px 16px",
              borderRadius: 10,
              border: `1px solid ${ROW_BORDER}`,
              background: "#0000004D",
              fontFamily: MONO,
              fontSize: 12,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              color: FG,
              maxHeight: 240,
              overflow: "auto",
            }}
          >
            {excerpt}
          </div>
        </section>
      )}

      {backedPages.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
            }}
          >
            <SectionLabel>
              backs {refs.length} ref{refs.length === 1 ? "" : "s"} · top{" "}
              {Math.min(6, backedPages.length)}
            </SectionLabel>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 10,
                color: TEXT_FADED,
              }}
            >
              view all ↗
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {backedPages.slice(0, 6).map(({ page, n }) => (
              <div
                key={page.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: `1px solid ${ROW_BORDER}`,
                  background: ROW_BG,
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontFamily: HEAD,
                    fontSize: 13,
                    color: FG,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: BUCKET_COLOR.primary,
                    }}
                  />
                  {page.title}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    color: TEXT_FADED,
                  }}
                >
                  {n} ref{n === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {runs.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionLabel>ingestion runs · {runs.length}</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {runs.slice(0, 4).map((r) => {
              const ok = r.status === "succeeded";
              const failed = r.status === "failed";
              return (
                <div
                  key={r.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: `1px solid ${ROW_BORDER}`,
                    background: ROW_BG,
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: ok ? `${OK}1F` : failed ? `${BAD}1A` : "#FACC151F",
                      color: ok ? OK : failed ? BAD : "#FACC15",
                      fontSize: 9,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {ok ? "✓" : failed ? "×" : "·"}
                  </span>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      color: TEXT_DIM,
                    }}
                  >
                    {r.model ?? "unknown"} · +{r.pagesCreated} pages · +
                    {r.edgesAdded} edges
                  </span>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      color: TEXT_FADED,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {relative(r.finishedAt ?? r.startedAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section
        style={{
          padding: "14px 16px",
          borderRadius: 10,
          border: `1px solid ${BORDER_STRONG}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontFamily: HEAD, fontSize: 14, color: FG }}>
            Purge source
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 11,
              color: TEXT_FADED,
            }}
          >
            Removes this source + any pages whose only provenance was this source.
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenPurge}
          style={{
            padding: "6px 14px",
            borderRadius: 8,
            border: `1px solid ${BAD}4D`,
            background: `${BAD}14`,
            color: BAD,
            fontFamily: HEAD,
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Purge…
        </button>
      </section>
      <PurgeConfirmModal
        open={purgeOpen}
        kind="source"
        preview={purgePreview}
        loading={purgeLoading}
        pending={purgePending}
        error={purgeError}
        onCancel={onCancelPurge}
        onConfirm={onConfirmPurge}
      />
    </div>
  );
}

/* ── Atoms ──────────────────────────────────────────────────────── */

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        maxWidth: 420,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 10,
        border: `1px solid ${BORDER_STRONG}`,
        background: ROW_BG,
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke={TEXT_FADED}
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          color: FG,
          fontSize: 12,
          outline: "none",
        }}
      />
      <span
        style={{
          fontFamily: MONO,
          fontSize: 10,
          color: TEXT_GHOST,
          padding: "1px 6px",
          borderRadius: 4,
          border: `1px solid ${ROW_BORDER}`,
        }}
      >
        ⌘ K
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: TEXT_FADED,
      }}
    >
      {children}
    </div>
  );
}

function FmRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td
        style={{
          padding: "4px 18px 4px 0",
          color: TEXT_FADED,
          verticalAlign: "top",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </td>
      <td style={{ padding: "4px 0", color: FG }}>{value}</td>
    </tr>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 28,
        border: `1px dashed ${BORDER_STRONG}`,
        borderRadius: 12,
        textAlign: "center",
        fontFamily: MONO,
        fontSize: 11,
        color: TEXT_FADED,
      }}
    >
      {children}
    </div>
  );
}
