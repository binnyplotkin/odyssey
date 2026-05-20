"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { diffWordsWithSpace, type Change } from "diff";
import type {
  WikiPageRecord,
  WikiPageType,
  WikiPageVersionRecord,
} from "@odyssey/db";

/* ── Tokens ────────────────────────────────────────────────────── */

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

const PANEL_BG = "#0A0A0A";
const BORDER = "rgba(255, 255, 255, 0.08)";
const BORDER_STRONG = "rgba(255, 255, 255, 0.12)";
const DIVIDER = "rgba(255, 255, 255, 0.06)";

const ACCENT = "#8CE7D2";
const ACCENT_SOFT = "rgba(140, 231, 210, 0.06)";
const ACCENT_RING = "rgba(140, 231, 210, 0.3)";

const ADD = "#4ADE80";
const ADD_SOFT = "rgba(74, 222, 128, 0.04)";
const ADD_RING = "rgba(74, 222, 128, 0.3)";

const WARN = "#FACC15";
const WARN_SOFT = "rgba(250, 204, 21, 0.04)";
const WARN_RING = "rgba(250, 204, 21, 0.3)";

const TYPE_COLOR: Record<WikiPageType, string> = {
  entity: "#8CE7D2",
  event: "#60A5FA",
  concept: "#A78BFA",
  relationship: "#FACC15",
  timeline: "#2DD4BF",
  voice_identity: "#F472B6",
};

const BACKDROP_BG = "rgba(0, 0, 0, 0.6)";

/* ── Props ─────────────────────────────────────────────────────── */

export type RunEffectDiffDrawerProps = {
  wikiId: string;
  runId: string;
  /**
   * Ordered list of pageIds touched by this run, used for prev/next nav
   * within the drawer footer. Order matches the Effects pane.
   */
  effectPageIds: string[];
};

type DiffPayload = {
  page: WikiPageRecord | null;
  current: WikiPageVersionRecord;
  prior: WikiPageVersionRecord | null;
  isNew: boolean;
};

/* ── Root ──────────────────────────────────────────────────────── */

export function RunEffectDiffDrawer({
  wikiId,
  runId,
  effectPageIds,
}: RunEffectDiffDrawerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pageId = searchParams.get("diff");

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [data, setData] = useState<DiffPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pageId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/wiki/${wikiId}/run-diff?run=${runId}&page=${pageId}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? `HTTP ${res.status}`);
          setData(null);
          return;
        }
        const json = (await res.json()) as DiffPayload;
        setData(json);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "fetch failed");
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wikiId, runId, pageId]);

  // Close on Esc
  useEffect(() => {
    if (!pageId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  const { prevId, nextId } = useMemo(() => {
    if (!pageId) return { prevId: null as string | null, nextId: null as string | null };
    const i = effectPageIds.indexOf(pageId);
    if (i === -1) return { prevId: null, nextId: null };
    return {
      prevId: i > 0 ? effectPageIds[i - 1]! : null,
      nextId: i < effectPageIds.length - 1 ? effectPageIds[i + 1]! : null,
    };
  }, [effectPageIds, pageId]);

  function close() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("diff");
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }

  function navigate(toId: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("diff", toId);
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  if (!mounted || !pageId) return null;

  return createPortal(
    <>
      <div
        onClick={close}
        style={{
          position: "fixed",
          inset: 0,
          background: BACKDROP_BG,
          zIndex: 80,
        }}
      />
      <aside
        role="dialog"
        aria-label="Run effect diff"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: 640,
          maxWidth: "100vw",
          height: "100vh",
          background: PANEL_BG,
          borderLeft: `1px solid ${BORDER}`,
          zIndex: 81,
          display: "flex",
          flexDirection: "column",
          boxShadow: "-24px 0 64px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        <DrawerHeader
          isNew={data?.isNew ?? false}
          loading={loading}
          onClose={close}
        />
        <div
          style={{
            flex: 1,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            paddingBottom: 80,
          }}
        >
          {loading && <StatusBlock>Loading diff…</StatusBlock>}
          {error && <StatusBlock tone="error">{error}</StatusBlock>}
          {data && <DrawerBody data={data} />}
        </div>
        <DrawerFooter
          page={data?.page ?? null}
          wikiId={wikiId}
          prevId={prevId}
          nextId={nextId}
          onNavigate={navigate}
        />
      </aside>
    </>,
    document.body,
  );
}

/* ── Header ────────────────────────────────────────────────────── */

function DrawerHeader({
  isNew,
  loading,
  onClose,
}: {
  isNew: boolean;
  loading: boolean;
  onClose: () => void;
}) {
  const chipColor = isNew ? ADD : WARN;
  const chipBg = isNew ? ADD_SOFT : WARN_SOFT;
  const chipRing = isNew ? ADD_RING : WARN_RING;
  const chipLabel = loading ? "LOADING" : isNew ? "+ NEW PAGE" : "~ UPDATED";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "18px 24px",
        borderTop: 0,
        borderRight: 0,
        borderBottom: `1px solid ${DIVIDER}`,
        borderLeft: 0,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: TEXT_FADED,
          }}
        >
          DIFF
        </span>
        <span style={{ color: TEXT_QUIET }}>·</span>
        <div
          style={{
            display: "inline-flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            padding: "3px 8px",
            background: loading ? "transparent" : chipBg,
            borderTop: `1px solid ${loading ? BORDER_STRONG : chipRing}`,
            borderRight: `1px solid ${loading ? BORDER_STRONG : chipRing}`,
            borderBottom: `1px solid ${loading ? BORDER_STRONG : chipRing}`,
            borderLeft: `1px solid ${loading ? BORDER_STRONG : chipRing}`,
          }}
        >
          {!loading && (
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                background: chipColor,
              }}
            />
          )}
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: loading ? TEXT_MUTED : chipColor,
            }}
          >
            {chipLabel}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close diff"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 30,
          background: "transparent",
          borderTop: `1px solid ${BORDER_STRONG}`,
          borderRight: `1px solid ${BORDER_STRONG}`,
          borderBottom: `1px solid ${BORDER_STRONG}`,
          borderLeft: `1px solid ${BORDER_STRONG}`,
          fontFamily: MONO,
          fontSize: 13,
          fontWeight: 600,
          color: TEXT_MUTED,
          cursor: "pointer",
        }}
      >
        ✕
      </button>
    </div>
  );
}

/* ── Body ──────────────────────────────────────────────────────── */

function DrawerBody({ data }: { data: DiffPayload }) {
  const { current, prior, isNew, page } = data;
  const typeColor = page ? TYPE_COLOR[page.type] : ACCENT;
  const type = page?.type ?? "—";
  const slug = page?.slug ?? "—";

  return (
    <>
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "24px 28px 8px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: typeColor,
            }}
          />
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              fontWeight: 500,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: TEXT_MUTED,
            }}
          >
            {String(type).toUpperCase()}
          </span>
          <span style={{ color: TEXT_QUIET }}>·</span>
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: TEXT_MUTED }}>
            {slug}
          </span>
        </div>
        <h2
          style={{
            margin: 0,
            fontFamily: DISPLAY,
            fontSize: 32,
            fontWeight: 500,
            lineHeight: "36px",
            letterSpacing: "-0.012em",
            color: FG,
          }}
        >
          {current.title}
        </h2>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "baseline",
            gap: 10,
            fontFamily: MONO,
            fontSize: 11,
            color: TEXT_MUTED,
          }}
        >
          <span style={{ color: TEXT_FADED }}>VERSION</span>
          <span style={{ color: isNew ? ADD : WARN, fontWeight: 600 }}>
            #{current.version}
          </span>
          {prior && (
            <>
              <span style={{ color: TEXT_FADED }}>←</span>
              <span>#{prior.version}</span>
            </>
          )}
          <span style={{ color: TEXT_QUIET }}>·</span>
          <span>
            {isNew ? "created" : "written"} by run · {relative(current.createdAt)}
          </span>
        </div>
      </section>

      <DiffBanner isNew={isNew} current={current} prior={prior} />

      <TextField
        label="TITLE"
        current={current.title}
        prior={prior?.title ?? null}
        isNew={isNew}
        displayFont={DISPLAY}
        displaySize={16}
      />

      <TextField
        label="SUMMARY"
        current={current.summary ?? ""}
        prior={prior?.summary ?? null}
        isNew={isNew}
        displayFont={BODY}
        displaySize={14}
        lineHeight="22px"
      />

      <TextField
        label="BODY"
        current={current.body}
        prior={prior?.body ?? null}
        isNew={isNew}
        displayFont={BODY}
        displaySize={14}
        lineHeight="24px"
        scroll
      />

      <FrontmatterField
        label="FRONTMATTER"
        current={current.frontmatter as Record<string, unknown>}
        prior={prior ? (prior.frontmatter as Record<string, unknown>) : null}
        isNew={isNew}
      />

      <ScalarsField
        label="SCALARS"
        current={current}
        prior={prior}
        pageType={page?.type ?? null}
        isNew={isNew}
      />
    </>
  );
}

/* ── TextField (word diff for title/summary/body) ──────────────── */

function TextField({
  label,
  current,
  prior,
  isNew,
  displayFont,
  displaySize,
  lineHeight,
  scroll,
}: {
  label: string;
  current: string;
  prior: string | null;
  isNew: boolean;
  displayFont: string;
  displaySize: number;
  lineHeight?: string;
  scroll?: boolean;
}) {
  const trimmed = current.trim();
  const priorTrimmed = (prior ?? "").trim();
  const unchanged = !isNew && trimmed === priorTrimmed;
  const tone: FieldTone = isNew ? "add" : unchanged ? "neutral" : "warn";

  let tag: string;
  if (isNew) tag = "+ new";
  else if (unchanged) tag = "unchanged";
  else {
    const stats = countDiffStats(prior ?? "", current);
    tag = `~ +${stats.added} / −${stats.removed} ${label === "BODY" ? "WORDS" : ""}`.trim();
  }

  return (
    <FieldSection label={label} tag={tag} tone={tone} scroll={scroll}>
      {isNew ? (
        <PlainText font={displayFont} size={displaySize} lineHeight={lineHeight}>
          {current || <Empty />}
        </PlainText>
      ) : unchanged ? (
        <PlainText font={displayFont} size={displaySize} lineHeight={lineHeight}>
          {current || <Empty />}
        </PlainText>
      ) : (
        <WordDiff
          left={prior ?? ""}
          right={current}
          font={displayFont}
          size={displaySize}
          lineHeight={lineHeight}
        />
      )}
    </FieldSection>
  );
}

function PlainText({
  font,
  size,
  lineHeight,
  children,
}: {
  font: string;
  size: number;
  lineHeight?: string;
  children: React.ReactNode;
}) {
  return (
    <pre
      style={{
        margin: 0,
        fontFamily: font,
        fontSize: size,
        lineHeight: lineHeight ?? "24px",
        color: TEXT_PRIMARY,
        whiteSpace: "pre-wrap",
      }}
    >
      {children}
    </pre>
  );
}

function WordDiff({
  left,
  right,
  font,
  size,
  lineHeight,
}: {
  left: string;
  right: string;
  font: string;
  size: number;
  lineHeight?: string;
}) {
  const parts = useMemo(() => diffWordsWithSpace(left, right), [left, right]);

  return (
    <pre
      style={{
        margin: 0,
        fontFamily: font,
        fontSize: size,
        lineHeight: lineHeight ?? "24px",
        color: TEXT_PRIMARY,
        whiteSpace: "pre-wrap",
      }}
    >
      {parts.map((part: Change, i: number) => {
        if (part.added) {
          return (
            <span
              key={i}
              style={{
                background: "rgba(74,222,128,0.16)",
                color: ADD,
                padding: "1px 3px",
              }}
            >
              {part.value}
            </span>
          );
        }
        if (part.removed) {
          return (
            <span
              key={i}
              style={{
                background: "rgba(248,113,113,0.16)",
                color: "#F87171",
                textDecoration: "line-through",
                padding: "1px 3px",
              }}
            >
              {part.value}
            </span>
          );
        }
        return <Fragment key={i}>{part.value}</Fragment>;
      })}
    </pre>
  );
}

function Empty() {
  return <em style={{ color: TEXT_FADED }}>(empty)</em>;
}

/* ── FrontmatterField (key-by-key diff) ────────────────────────── */

function FrontmatterField({
  label,
  current,
  prior,
  isNew,
}: {
  label: string;
  current: Record<string, unknown>;
  prior: Record<string, unknown> | null;
  isNew: boolean;
}) {
  const rows = useMemo(() => buildFrontmatterDiff(current, prior, isNew), [
    current,
    prior,
    isNew,
  ]);

  const changedCount = rows.filter((r) => r.tone !== "neutral").length;
  const addedCount = rows.filter((r) => r.tone === "add").length;

  let tag: string;
  if (isNew) tag = `+ ${rows.length} added`;
  else if (changedCount === 0) tag = "unchanged";
  else tag = `~ ${changedCount} changed${addedCount > 0 ? ` · +${addedCount} added` : ""}`;

  const tone: FieldTone = isNew ? "add" : changedCount === 0 ? "neutral" : "warn";

  return (
    <FieldSection label={label} tag={tag} tone={tone}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0,
          margin: -14,
          marginTop: -14,
          marginBottom: -14,
        }}
      >
        {rows.length === 0 ? (
          <div style={{ padding: 14, fontFamily: MONO, fontSize: 11, color: TEXT_FADED }}>
            (empty)
          </div>
        ) : (
          rows.map((row, i) => <FmRow key={row.key + i} row={row} last={i === rows.length - 1} />)
        )}
      </div>
    </FieldSection>
  );
}

type FmDiffRow = {
  key: string;
  tone: "add" | "warn" | "remove" | "neutral";
  oldValue: string | null;
  newValue: string | null;
};

function buildFrontmatterDiff(
  current: Record<string, unknown>,
  prior: Record<string, unknown> | null,
  isNew: boolean,
): FmDiffRow[] {
  const keys = new Set<string>([
    ...Object.keys(current ?? {}),
    ...Object.keys(prior ?? {}),
  ]);
  const rows: FmDiffRow[] = [];
  for (const key of Array.from(keys).sort()) {
    const newVal = current[key];
    const oldVal = prior?.[key];
    const newStr = newVal === undefined ? null : stringifyValue(newVal);
    const oldStr = oldVal === undefined ? null : stringifyValue(oldVal);
    if (isNew || oldStr === null) {
      rows.push({ key, tone: "add", oldValue: null, newValue: newStr });
    } else if (newStr === null) {
      rows.push({ key, tone: "remove", oldValue: oldStr, newValue: null });
    } else if (newStr !== oldStr) {
      rows.push({ key, tone: "warn", oldValue: oldStr, newValue: newStr });
    } else {
      rows.push({ key, tone: "neutral", oldValue: oldStr, newValue: newStr });
    }
  }
  return rows;
}

function stringifyValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function FmRow({ row, last }: { row: FmDiffRow; last: boolean }) {
  const { tone, key, oldValue, newValue } = row;
  const accent =
    tone === "add" ? ADD : tone === "warn" ? WARN : tone === "remove" ? "#F87171" : null;
  const bg =
    tone === "add"
      ? ADD_SOFT
      : tone === "warn"
        ? WARN_SOFT
        : tone === "remove"
          ? "rgba(248,113,113,0.04)"
          : "transparent";
  const keyColor = tone === "neutral" ? TEXT_MUTED : TEXT_PRIMARY;
  const tagText =
    tone === "add"
      ? "+ added"
      : tone === "remove"
        ? "− removed"
        : tone === "warn"
          ? "~ changed"
          : "unchanged";
  const tagColor =
    tone === "add"
      ? ADD
      : tone === "remove"
        ? "#F87171"
        : tone === "warn"
          ? WARN
          : TEXT_GHOST;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 14,
        padding: "10px 14px",
        background: bg,
        borderTop: 0,
        borderRight: 0,
        borderBottom: last ? 0 : `1px solid ${DIVIDER}`,
        borderLeft: accent ? `2px solid ${accent}` : `2px solid transparent`,
      }}
    >
      <span
        style={{
          width: 110,
          flexShrink: 0,
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 500,
          color: keyColor,
        }}
      >
        {key}
      </span>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontFamily: MONO,
          fontSize: 11,
          wordBreak: "break-word",
        }}
      >
        {tone === "warn" ? (
          <>
            {oldValue !== null && (
              <span style={{ color: "#F87171", textDecoration: "line-through" }}>
                − {oldValue}
              </span>
            )}
            {newValue !== null && (
              <span style={{ color: ADD }}>+ {newValue}</span>
            )}
          </>
        ) : tone === "remove" ? (
          <span style={{ color: "#F87171", textDecoration: "line-through" }}>
            {oldValue ?? ""}
          </span>
        ) : tone === "add" ? (
          <span style={{ color: ADD }}>{newValue ?? ""}</span>
        ) : (
          <span style={{ color: TEXT_MUTED }}>{newValue ?? oldValue ?? ""}</span>
        )}
      </div>
      <span
        style={{
          flexShrink: 0,
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: tagColor,
        }}
      >
        {tagText}
      </span>
    </div>
  );
}

/* ── ScalarsField (arrow notation) ─────────────────────────────── */

function ScalarsField({
  label,
  current,
  prior,
  pageType,
  isNew,
}: {
  label: string;
  current: WikiPageVersionRecord;
  prior: WikiPageVersionRecord | null;
  pageType: WikiPageType | null;
  isNew: boolean;
}) {
  const rows = useMemo(
    () => [
      {
        key: "type",
        old: pageType ? String(pageType) : null,
        new: pageType ? String(pageType) : null,
      },
      {
        key: "confidence",
        old: prior ? formatPct(prior.confidence) : null,
        new: formatPct(current.confidence),
      },
      {
        key: "timeIndex",
        old: prior ? stringifyTimeIndex(prior.timeIndex) : null,
        new: stringifyTimeIndex(current.timeIndex),
      },
    ],
    [current, prior, pageType],
  );

  const changedCount = rows.filter((r) => !isNew && r.old !== r.new).length;
  const tone: FieldTone = isNew ? "add" : changedCount === 0 ? "neutral" : "warn";
  const tag = isNew
    ? "+ new"
    : changedCount === 0
      ? "unchanged"
      : `~ ${changedCount} changed`;

  return (
    <FieldSection label={label} tag={tag} tone={tone}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0,
          margin: -14,
        }}
      >
        {rows.map((row, i) => {
          const changed = !isNew && row.old !== row.new;
          const accent = isNew ? ADD : changed ? WARN : null;
          const bg = isNew ? ADD_SOFT : changed ? WARN_SOFT : "transparent";

          return (
            <div
              key={row.key}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 14,
                padding: "10px 14px",
                background: bg,
                borderTop: 0,
                borderRight: 0,
                borderBottom:
                  i === rows.length - 1 ? 0 : `1px solid ${DIVIDER}`,
                borderLeft: accent ? `2px solid ${accent}` : `2px solid transparent`,
              }}
            >
              <span
                style={{
                  width: 110,
                  flexShrink: 0,
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 500,
                  color: isNew || changed ? TEXT_PRIMARY : TEXT_MUTED,
                }}
              >
                {row.key}
              </span>
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  fontFamily: MONO,
                  fontSize: 11,
                }}
              >
                {isNew || row.old === null ? (
                  <span style={{ color: ADD }}>{row.new}</span>
                ) : changed ? (
                  <>
                    <span style={{ color: TEXT_MUTED }}>{row.old}</span>
                    <span style={{ color: TEXT_FADED }}>→</span>
                    <span style={{ color: ADD, fontWeight: 600 }}>{row.new}</span>
                  </>
                ) : (
                  <span style={{ color: TEXT_MUTED }}>{row.new}</span>
                )}
              </div>
              <span
                style={{
                  flexShrink: 0,
                  fontFamily: MONO,
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: isNew ? ADD : changed ? WARN : TEXT_GHOST,
                }}
              >
                {isNew ? "+ new" : changed ? "~ changed" : "unchanged"}
              </span>
            </div>
          );
        })}
      </div>
    </FieldSection>
  );
}

function stringifyTimeIndex(ti: WikiPageVersionRecord["timeIndex"]): string {
  if (ti === null || ti === undefined) return "—";
  if (typeof ti === "number") return String(ti);
  if (typeof ti === "object") {
    return JSON.stringify(ti);
  }
  return String(ti);
}

/* ── Stats helper ──────────────────────────────────────────────── */

function countDiffStats(left: string, right: string): { added: number; removed: number } {
  const parts = diffWordsWithSpace(left, right);
  let added = 0;
  let removed = 0;
  for (const p of parts) {
    if (!p.added && !p.removed) continue;
    const words = p.value.trim().split(/\s+/).filter(Boolean).length;
    if (p.added) added += words;
    else if (p.removed) removed += words;
  }
  return { added, removed };
}

/* ── DiffBanner ────────────────────────────────────────────────── */

function DiffBanner({
  isNew,
  current,
  prior,
}: {
  isNew: boolean;
  current: WikiPageVersionRecord;
  prior: WikiPageVersionRecord | null;
}) {
  if (isNew) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          margin: "14px 28px 0",
          padding: "12px 16px",
          background: ADD_SOFT,
          borderTop: `1px solid ${ADD_RING}`,
          borderRight: `1px solid ${ADD_RING}`,
          borderBottom: `1px solid ${ADD_RING}`,
          borderLeft: `2px solid ${ADD}`,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: ADD,
          }}
        >
          NEW
        </span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT_SECONDARY }}>
          first version of this page · {wordCount(current.body)} words
        </span>
      </div>
    );
  }
  const added = Math.max(0, wordCount(current.body) - wordCount(prior?.body ?? ""));
  const removed = Math.max(0, wordCount(prior?.body ?? "") - wordCount(current.body));
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        margin: "14px 28px 0",
        padding: "12px 16px",
        background: WARN_SOFT,
        borderTop: `1px solid ${WARN_RING}`,
        borderRight: `1px solid ${WARN_RING}`,
        borderBottom: `1px solid ${WARN_RING}`,
        borderLeft: `2px solid ${WARN}`,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: WARN,
        }}
      >
        CHANGED
      </span>
      <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT_SECONDARY }}>
        +{added} / −{removed} words · field-level diff pending
      </span>
    </div>
  );
}

/* ── Field section shell ───────────────────────────────────────── */

type FieldTone = "add" | "warn" | "neutral";

function FieldSection({
  label,
  tag,
  tone,
  scroll,
  children,
}: {
  label: string;
  tag: string;
  tone: FieldTone;
  scroll?: boolean;
  children: React.ReactNode;
}) {
  const isAdd = tone === "add";
  const isWarn = tone === "warn";
  const accent = isAdd ? ADD : isWarn ? WARN : null;
  const ring = isAdd ? ADD_RING : isWarn ? WARN_RING : BORDER;
  const bg = isAdd ? ADD_SOFT : isWarn ? WARN_SOFT : "rgba(255,255,255,0.02)";

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "20px 28px 0",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: tone === "neutral" ? TEXT_FADED : TEXT_PRIMARY,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: accent ?? TEXT_GHOST,
          }}
        >
          {tag}
        </span>
      </div>
      <div
        style={{
          padding: "14px 16px",
          background: bg,
          borderTop: `1px solid ${ring}`,
          borderRight: `1px solid ${ring}`,
          borderBottom: `1px solid ${ring}`,
          borderLeft: accent ? `2px solid ${accent}` : `1px solid ${ring}`,
          maxHeight: scroll ? 360 : undefined,
          overflow: scroll ? "auto" : undefined,
        }}
      >
        {children}
      </div>
    </section>
  );
}

/* ── Footer ────────────────────────────────────────────────────── */

function DrawerFooter({
  page,
  wikiId,
  prevId,
  nextId,
  onNavigate,
}: {
  page: WikiPageRecord | null;
  wikiId: string;
  prevId: string | null;
  nextId: string | null;
  onNavigate: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        padding: "16px 24px",
        borderTop: `1px solid ${DIVIDER}`,
        borderRight: 0,
        borderBottom: 0,
        borderLeft: 0,
        background: PANEL_BG,
        flexShrink: 0,
      }}
    >
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
        <NavBtn
          dir="prev"
          disabled={!prevId}
          onClick={() => prevId && onNavigate(prevId)}
        />
        <div style={{ width: 1, height: 18, background: BORDER_STRONG }} />
        <NavBtn
          dir="next"
          disabled={!nextId}
          onClick={() => nextId && onNavigate(nextId)}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
        {page && (
          <Link
            href={`/wikis/${wikiId}/pages/${page.slug}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              background: ACCENT,
              borderTop: `1px solid ${ACCENT}`,
              borderRight: `1px solid ${ACCENT}`,
              borderBottom: `1px solid ${ACCENT}`,
              borderLeft: `1px solid ${ACCENT}`,
              fontFamily: MONO,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#0A0A0A",
              textDecoration: "none",
            }}
          >
            OPEN PAGE ↗
          </Link>
        )}
      </div>
    </div>
  );
}

function NavBtn({
  dir,
  disabled,
  onClick,
}: {
  dir: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        background: "transparent",
        border: 0,
        fontFamily: MONO,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: disabled ? TEXT_GHOST : TEXT_PRIMARY,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {dir === "prev" ? (
        <>
          <span style={{ color: TEXT_FADED }}>↑</span> PREV
        </>
      ) : (
        <>
          NEXT <span style={{ color: TEXT_FADED }}>↓</span>
        </>
      )}
    </button>
  );
}

/* ── Status block ──────────────────────────────────────────────── */

function StatusBlock({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <div
      style={{
        padding: "60px 24px",
        fontFamily: MONO,
        fontSize: 12,
        color: tone === "error" ? "#F87171" : TEXT_MUTED,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function formatPct(n: number): string {
  return `${Math.round((n ?? 0) * 100)}%`;
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
