"use client";

import Link from "next/link";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  Contradiction,
  EraConfig,
  Frontmatter,
  Perspective,
  PerspectiveKnowsHow,
  TimeIndex,
  WikiEdgeRecord,
  WikiPageRecord,
  WikiPageType,
  WikiSourceRecord,
  WikiSourceRefRecord,
} from "@odyssey/db";
import { updateWikiPage as updateCharacterWikiPage } from "@/app/(authenticated)/characters/actions";
import { updateWikiPage as updateScopedWikiPage } from "@/app/(authenticated)/wikis/actions";

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
const INPUT_BG = "rgba(255, 255, 255, 0.02)";

const ACCENT = "#8CE7D2";
const ACCENT_SOFT = "rgba(140, 231, 210, 0.06)";
const ACCENT_RING = "rgba(140, 231, 210, 0.3)";

const DANGER = "#f87171";
const DANGER_SOFT = "rgba(248, 113, 113, 0.06)";
const DANGER_RING = "rgba(248, 113, 113, 0.36)";

const TYPE_COLOR: Record<WikiPageType, string> = {
  entity: "#8CE7D2",
  event: "#60A5FA",
  concept: "#A78BFA",
  relationship: "#FACC15",
  timeline: "#2DD4BF",
  voice_identity: "#F472B6",
};

/* ── Props ─────────────────────────────────────────────────────── */

type Props = {
  wikiId?: string;
  characterId: string;
  characterSlug: string;
  characterTitle: string;
  eras: EraConfig[];
  page: WikiPageRecord;
  pages: WikiPageRecord[];
  edges: WikiEdgeRecord[];
  sources: WikiSourceRecord[];
  sourceRefs: WikiSourceRefRecord[];
  initialEditing?: boolean;
  routeBase?: string;
  breadcrumbLabel?: string;
  /**
   * URL segment under `routeBase` where the page list and individual pages
   * live. Defaults to `"wiki"` for character-context routes; the wiki-context
   * routes pass `"pages"`.
   */
  pageRouteSegment?: string;
};

/* ── Component ─────────────────────────────────────────────────── */

export function WikiPageView({
  wikiId,
  characterId,
  characterSlug,
  characterTitle: _characterTitle,
  eras,
  page,
  pages,
  edges,
  sources,
  sourceRefs,
  initialEditing,
  routeBase,
  breadcrumbLabel,
  pageRouteSegment = "wiki",
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(!!initialEditing);
  const base = routeBase ?? `/characters/${characterSlug}`;
  const segment = pageRouteSegment;
  const parentLabel = breadcrumbLabel ?? "Pages";

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

  // Strip `?edit=1` once consumed so a refresh lands in read mode.
  useEffect(() => {
    if (!initialEditing) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("edit")) {
      url.searchParams.delete("edit");
      window.history.replaceState({}, "", url.toString());
    }
  }, [initialEditing]);

  function navigateToSlug(slug: string) {
    if (slug === page.slug) return;
    router.push(`${base}/${segment}/${slug}`);
  }

  function handleSaved(savedSlug: string) {
    setEditing(false);
    if (savedSlug !== page.slug) {
      router.replace(`${base}/${segment}/${savedSlug}`);
    } else {
      router.refresh();
    }
  }

  if (editing) {
    return (
      <EditView
        characterId={characterId}
        wikiId={wikiId}
        page={page}
        eras={eras}
        pageBySlug={pageBySlug}
        base={base}
        segment={segment}
        parentLabel={parentLabel}
        onCancel={() => setEditing(false)}
        onSaved={handleSaved}
      />
    );
  }

  return (
    <ReadView
      page={page}
      edges={edges}
      pageById={pageById}
      pageBySlug={pageBySlug}
      sourceById={sourceById}
      sourceRefs={sourceRefs}
      base={base}
      segment={segment}
      parentLabel={parentLabel}
      onEdit={() => setEditing(true)}
      onNavigate={navigateToSlug}
    />
  );
}

/* ── Read view ─────────────────────────────────────────────────── */

type ReadViewProps = {
  page: WikiPageRecord;
  edges: WikiEdgeRecord[];
  pageById: Map<string, WikiPageRecord>;
  pageBySlug: Map<string, WikiPageRecord>;
  sourceById: Map<string, WikiSourceRecord>;
  sourceRefs: WikiSourceRefRecord[];
  base: string;
  segment: string;
  parentLabel: string;
  onEdit: () => void;
  onNavigate: (slug: string) => void;
};

function ReadView({
  page,
  edges,
  pageById,
  pageBySlug,
  sourceById,
  sourceRefs,
  base,
  segment,
  parentLabel,
  onEdit,
  onNavigate,
}: ReadViewProps) {
  // Keyboard: ⌘E to edit, ⌘← to go back
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "e") {
        e.preventDefault();
        onEdit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEdit]);

  const links = useMemo(() => {
    const seen = new Map<
      string,
      { page: WikiPageRecord; strength: number; relation: string | null }
    >();
    for (const e of edges) {
      let other: string | null = null;
      if (e.fromPageId === page.id) other = e.toPageId;
      else if (e.toPageId === page.id) other = e.fromPageId;
      if (!other) continue;
      const target = pageById.get(other);
      if (!target) continue;
      const relation = e.kind ?? null;
      const prev = seen.get(other);
      if (!prev || e.strength > prev.strength) {
        seen.set(other, { page: target, strength: e.strength, relation });
      }
    }
    return Array.from(seen.values()).sort((a, b) => b.strength - a.strength);
  }, [edges, page.id, pageById]);

  const confidencePct = Math.round((page.confidence ?? 0) * 100);
  const fm = page.frontmatter as Record<string, unknown>;
  const kind = typeof fm.kind === "string" ? (fm.kind as string) : null;
  const aliases = Array.isArray(fm.aliases) ? (fm.aliases as string[]) : [];

  const frontmatterRows = useMemo(
    () => buildFrontmatterRows(page),
    [page],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        padding: "8px 32px 80px",
      }}
    >
      <TopEyebrow
        base={base}
        segment={segment}
        parentLabel={parentLabel}
        pageTitle={page.title}
        hint="⌘E to edit · ⌘← back"
      />

      <HeaderBar
        page={page}
        kind={kind}
        segment={segment}
        base={base}
        onEdit={onEdit}
      />

      {/* Title block — flows freely, no card */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: "24px 8px 8px 8px",
        }}
      >
        <h1
          style={{
            margin: 0,
            color: FG,
            fontFamily: DISPLAY,
            fontSize: 52,
            fontWeight: 500,
            lineHeight: "60px",
            letterSpacing: "-0.014em",
          }}
        >
          {page.title}
        </h1>
        {page.summary && (
          <p
            style={{
              margin: 0,
              color: TEXT_SECONDARY,
              fontFamily: BODY,
              fontSize: 16,
              lineHeight: "26px",
              maxWidth: 760,
            }}
          >
            {page.summary}
          </p>
        )}
        <MetaStrip
          page={page}
          confidencePct={confidencePct}
          linkCount={links.length}
          sourceCount={sourceRefs.length}
        />
      </div>

      {/* Two-column body */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 360px",
          gap: 32,
          alignItems: "flex-start",
          paddingTop: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            minWidth: 0,
          }}
        >
          {frontmatterRows.length > 0 && (
            <FrontmatterCard rows={frontmatterRows} aliases={aliases} />
          )}
          {page.body.trim().length > 0 && (
            <BodyCard
              body={page.body}
              pageBySlug={pageBySlug}
              onNavigate={onNavigate}
            />
          )}
          {sourceRefs.length > 0 && (
            <SourcesCard
              sourceRefs={sourceRefs}
              sourceById={sourceById}
            />
          )}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            position: "sticky",
            top: 24,
          }}
        >
          <PerspectiveCard perspective={page.perspective} />
          {links.length > 0 && <LinksCard links={links} onNavigate={onNavigate} />}
          {page.contradictions.length > 0 && (
            <ContradictionsCard
              contradictions={page.contradictions}
              pageById={pageById}
              onNavigate={onNavigate}
            />
          )}
          <StatsCard page={page} kind={kind} />
        </div>
      </div>
    </div>
  );
}

/* ── Read view: sub-components ────────────────────────────────── */

function HeaderBar({
  page,
  kind,
  segment,
  base,
  onEdit,
}: {
  page: WikiPageRecord;
  kind: string | null;
  segment: string;
  base: string;
  onEdit: () => void;
}) {
  const color = TYPE_COLOR[page.type];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 44,
        padding: "0 18px",
        background: PANEL_BG,
        border: `1px solid ${BORDER}`,
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 10px",
          border: `1px solid ${color}4D`,
          background: `${color}14`,
          color,
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ width: 5, height: 5, background: color }} />
        <span>
          {page.type === "voice_identity" ? "voice" : page.type}
          {kind && <span style={{ opacity: 0.75 }}> · {kind}</span>}
        </span>
      </span>
      <span
        style={{
          color: TEXT_MUTED,
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: "0.06em",
        }}
      >
        /{segment}/{page.slug}
      </span>
      <span style={{ flex: 1 }} />
      <GhostLink onClick={onEdit} label="EDIT ↗" />
      <Link
        href={`${base}/knowledge?page=${page.slug}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 12px",
          height: 28,
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
        FOCUS IN GRAPH ↻
      </Link>
      <span
        style={{ width: 1, height: 20, background: BORDER, margin: "0 2px" }}
      />
      <button
        type="button"
        aria-label="More"
        style={{
          width: 28,
          height: 28,
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
  );
}

function MetaStrip({
  page,
  confidencePct,
  linkCount,
  sourceCount,
}: {
  page: WikiPageRecord;
  confidencePct: number;
  linkCount: number;
  sourceCount: number;
}) {
  const color = TYPE_COLOR[page.type];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 14,
        paddingTop: 4,
      }}
    >
      {page.timeIndex && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: TEXT_MUTED,
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: "0.04em",
          }}
        >
          <span style={{ width: 5, height: 5, background: color }} />
          <span>
            {page.timeIndex.era} · t={pad2(page.timeIndex.index)}
          </span>
        </span>
      )}
      {page.timeIndex && <span style={{ color: TEXT_QUIET }}>·</span>}
      <span
        style={{
          color: TEXT_SECONDARY,
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: "0.04em",
        }}
      >
        {pad2(linkCount)} link{linkCount === 1 ? "" : "s"}
      </span>
      <span style={{ color: TEXT_QUIET }}>·</span>
      <span
        style={{
          color: TEXT_SECONDARY,
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: "0.04em",
        }}
      >
        {pad2(sourceCount)} source{sourceCount === 1 ? "" : "s"}
      </span>
      <span style={{ color: TEXT_QUIET }}>·</span>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: TEXT_SECONDARY,
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: "0.04em",
        }}
      >
        <span
          style={{
            width: 56,
            height: 3,
            background: "rgba(255, 255, 255, 0.06)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${confidencePct}%`,
              background: page.confidence < 0.5 ? DANGER : ACCENT,
            }}
          />
        </span>
        <span>conf {(page.confidence ?? 0).toFixed(2)}</span>
      </span>
      <span style={{ color: TEXT_QUIET }}>·</span>
      <span style={{ color: TEXT_FADED, fontFamily: MONO, fontSize: 11 }}>
        updated {relative(page.updatedAt)}
      </span>
    </div>
  );
}

function FrontmatterCard({
  rows,
  aliases,
}: {
  rows: Array<{ label: string; value: string | string[] }>;
  aliases: string[];
}) {
  void aliases;
  return (
    <Card>
      <CardHeader label="Frontmatter" trailing={`${pad2(rows.length)} fields`} />
      {rows.map((r, i) => (
        <KvRow
          key={r.label}
          label={r.label}
          value={
            Array.isArray(r.value) ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {r.value.map((v) => (
                  <span
                    key={v}
                    style={{
                      padding: "2px 8px",
                      border: `1px solid ${BORDER_STRONG}`,
                      color: TEXT_PRIMARY,
                      fontFamily: MONO,
                      fontSize: 11,
                    }}
                  >
                    {v}
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ color: TEXT_PRIMARY, fontFamily: MONO, fontSize: 12 }}>
                {r.value}
              </span>
            )
          }
          last={i === rows.length - 1}
        />
      ))}
    </Card>
  );
}

function BodyCard({
  body,
  pageBySlug,
  onNavigate,
}: {
  body: string;
  pageBySlug: Map<string, WikiPageRecord>;
  onNavigate: (slug: string) => void;
}) {
  const wikilinkCount = useMemo(
    () => (body.match(/\[\[[^\]]+\]\]/g) ?? []).length,
    [body],
  );
  const wordCount = useMemo(
    () => body.trim().split(/\s+/).filter(Boolean).length,
    [body],
  );

  return (
    <Card>
      <CardHeader
        label="Body"
        trailing={`${wordCount.toLocaleString()} word${wordCount === 1 ? "" : "s"} · markdown · wikilinks`}
      />
      <div
        style={{
          padding: "24px 32px 28px",
          maxWidth: 760,
        }}
      >
        <MarkdownBody
          body={body}
          pageBySlug={pageBySlug}
          onNavigate={onNavigate}
        />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 20px",
          borderTop: `1px solid ${DIVIDER}`,
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
            {wikilinkCount} wikilink{wikilinkCount === 1 ? "" : "s"} resolved
          </span>
        </span>
        <span style={{ color: TEXT_QUIET }}>·</span>
        <span>{body.length.toLocaleString()} chars</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: TEXT_GHOST }}>⌘E to edit body</span>
      </div>
    </Card>
  );
}

function SourcesCard({
  sourceRefs,
  sourceById,
}: {
  sourceRefs: WikiSourceRefRecord[];
  sourceById: Map<string, WikiSourceRecord>;
}) {
  return (
    <Card>
      <CardHeader
        label="Sources"
        trailing={`${pad2(sourceRefs.length)} cited`}
      />
      <div style={{ display: "flex", flexDirection: "column" }}>
        {sourceRefs.map((ref, i) => {
          const src = sourceById.get(ref.sourceId);
          if (!src) return null;
          return (
            <SourceBlock
              key={ref.id}
              src={src}
              ref_={ref}
              last={i === sourceRefs.length - 1}
            />
          );
        })}
      </div>
    </Card>
  );
}

function SourceBlock({
  src,
  ref_,
  last,
}: {
  src: WikiSourceRecord;
  ref_: WikiSourceRefRecord;
  last?: boolean;
}) {
  const isPrimary = src.kind === "bible";
  const isCommentary = src.kind === "commentary" || src.kind === "midrash";
  const dotColor = isPrimary ? ACCENT : isCommentary ? "#B79EFF" : TEXT_MUTED;
  const kindColor = isPrimary
    ? ACCENT
    : isCommentary
      ? "#B79EFF"
      : TEXT_SECONDARY;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "16px 20px",
        borderBottom: last ? "none" : `1px solid ${DIVIDER}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 6, height: 6, background: dotColor }} />
        <span
          style={{
            color: FG,
            fontFamily: BODY,
            fontSize: 14,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
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
            textTransform: "uppercase",
          }}
        >
          {src.kind}
        </span>
      </div>
      {ref_.passage && (
        <div
          style={{
            paddingLeft: 16,
            color: TEXT_FADED,
            fontFamily: MONO,
            fontSize: 11,
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
            paddingLeft: 26,
            borderLeft: `2px solid ${ACCENT_RING}`,
            marginLeft: 16,
            color: TEXT_SECONDARY,
            fontFamily: BODY,
            fontSize: 14,
            fontStyle: "italic",
            lineHeight: "22px",
            maxWidth: 720,
          }}
        >
          {ref_.quote}
        </blockquote>
      )}
      {ref_.relevanceNote && (
        <div
          style={{
            paddingLeft: 16,
            color: TEXT_SECONDARY,
            fontFamily: BODY,
            fontSize: 13,
            lineHeight: "20px",
            maxWidth: 720,
          }}
        >
          {ref_.relevanceNote}
        </div>
      )}
    </div>
  );
}

function PerspectiveCard({
  perspective,
}: {
  perspective: WikiPageRecord["perspective"];
}) {
  const knowsHow = perspective.knowsHow;
  const feels = (perspective.feels ?? []).filter(Boolean);
  const stake = perspective.stake;
  if (!knowsHow && feels.length === 0 && !stake) {
    return (
      <Card>
        <CardHeader label="Perspective" />
        <EmptyRow>No perspective set.</EmptyRow>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader label="Perspective" />
      {knowsHow && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "14px 16px",
            borderBottom: `1px solid ${DIVIDER}`,
          }}
        >
          <span
            style={{
              color: TEXT_FADED,
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Knows how
          </span>
          <span
            style={{
              color: TEXT_PRIMARY,
              fontFamily: BODY,
              fontSize: 13,
              lineHeight: "20px",
            }}
          >
            {knowsHowLabel(knowsHow)}
          </span>
        </div>
      )}
      {feels.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "14px 16px",
            borderBottom: `1px solid ${DIVIDER}`,
          }}
        >
          <span
            style={{
              color: TEXT_FADED,
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Feels
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {feels.map((f) => (
              <span
                key={f}
                style={{
                  padding: "3px 9px",
                  border: `1px solid ${BORDER_STRONG}`,
                  color: TEXT_PRIMARY,
                  fontFamily: MONO,
                  fontSize: 11,
                }}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}
      {stake && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "14px 16px",
          }}
        >
          <span
            style={{
              color: TEXT_FADED,
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Stake
          </span>
          <span
            style={{
              color: TEXT_PRIMARY,
              fontFamily: BODY,
              fontSize: 13,
              lineHeight: "20px",
            }}
          >
            {stake}
          </span>
        </div>
      )}
    </Card>
  );
}

function LinksCard({
  links,
  onNavigate,
}: {
  links: Array<{ page: WikiPageRecord; strength: number; relation: string | null }>;
  onNavigate: (slug: string) => void;
}) {
  return (
    <Card>
      <CardHeader
        label="Links"
        trailing={`${pad2(links.length)} connected`}
      />
      {links.slice(0, 12).map((link, i) => (
        <button
          key={link.page.id}
          type="button"
          onClick={() => onNavigate(link.page.slug)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 36,
            padding: "0 16px",
            borderTop: "none",
            borderRight: "none",
            borderBottom:
              i === Math.min(links.length, 12) - 1 ? "none" : `1px solid ${DIVIDER}`,
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
              background: TYPE_COLOR[link.page.type],
              flexShrink: 0,
            }}
          />
          <span
            style={{
              flex: 1,
              color: TEXT_PRIMARY,
              fontFamily: BODY,
              fontSize: 12,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {link.page.title}
          </span>
          <span
            style={{
              color: TEXT_MUTED,
              fontFamily: MONO,
              fontSize: 10,
            }}
          >
            {link.relation ? `${link.relation} · ` : ""}
            {link.strength.toFixed(2)}
          </span>
        </button>
      ))}
    </Card>
  );
}

function ContradictionsCard({
  contradictions,
  pageById,
  onNavigate,
}: {
  contradictions: Contradiction[];
  pageById: Map<string, WikiPageRecord>;
  onNavigate: (slug: string) => void;
}) {
  return (
    <Card>
      <CardHeader
        label="Contradictions"
        trailing={
          <span style={{ color: DANGER }}>
            {pad2(contradictions.length)} open
          </span>
        }
      />
      {contradictions.map((c, i) => {
        const other = pageById.get(c.otherPageId);
        return (
          <div
            key={`${c.otherPageId}-${i}`}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: "12px 14px",
              borderLeft: `2px solid ${DANGER}`,
              background: "rgba(248, 113, 113, 0.04)",
              borderBottom:
                i === contradictions.length - 1
                  ? "none"
                  : `1px solid ${DIVIDER}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: DANGER,
                }}
              />
              {other ? (
                <button
                  type="button"
                  onClick={() => onNavigate(other.slug)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: DANGER,
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  VS · {other.title}
                </button>
              ) : (
                <span
                  style={{
                    color: DANGER,
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  VS · {c.otherPageId.slice(0, 8)}…
                </span>
              )}
            </div>
            <div
              style={{
                paddingLeft: 13,
                color: TEXT_PRIMARY,
                fontFamily: BODY,
                fontSize: 13,
                lineHeight: "20px",
              }}
            >
              {c.note}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function StatsCard({
  page,
  kind,
}: {
  page: WikiPageRecord;
  kind: string | null;
}) {
  const rows: Array<{ label: string; value: ReactNode }> = [
    {
      label: "type",
      value: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 5, height: 5, background: TYPE_COLOR[page.type] }} />
          <span style={{ color: FG, fontFamily: MONO, fontSize: 12 }}>
            {page.type === "voice_identity" ? "voice" : page.type}
            {kind ? ` · ${kind}` : ""}
          </span>
        </span>
      ),
    },
    {
      label: "embedded",
      value: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: ACCENT,
            }}
          />
          <span style={{ color: FG, fontFamily: MONO, fontSize: 12 }}>yes</span>
        </span>
      ),
    },
  ];
  if (page.timeIndex) {
    rows.push({
      label: "era",
      value: (
        <span style={{ color: FG, fontFamily: MONO, fontSize: 12 }}>
          {page.timeIndex.era} · t={pad2(page.timeIndex.index)}
        </span>
      ),
    });
  }
  rows.push({
    label: "updated",
    value: (
      <span style={{ color: FG, fontFamily: MONO, fontSize: 12 }}>
        {relative(page.updatedAt)}
      </span>
    ),
  });

  return (
    <Card>
      <CardHeader label="Stats" />
      {rows.map((r, i) => (
        <div
          key={r.label}
          style={{
            display: "flex",
            alignItems: "center",
            height: 32,
            padding: "0 16px",
            borderBottom: i === rows.length - 1 ? "none" : `1px solid ${DIVIDER}`,
          }}
        >
          <span
            style={{
              flex: 1,
              color: TEXT_MUTED,
              fontFamily: MONO,
              fontSize: 11,
            }}
          >
            {r.label}
          </span>
          {r.value}
        </div>
      ))}
    </Card>
  );
}

/* ── Markdown body with wikilink resolution ────────────────────── */

function MarkdownBody({
  body,
  pageBySlug,
  onNavigate,
}: {
  body: string;
  pageBySlug: Map<string, WikiPageRecord>;
  onNavigate: (slug: string) => void;
}) {
  const transformed = useMemo(() => preprocessWikilinks(body), [body]);

  return (
    <div
      style={{
        fontFamily: BODY,
        fontSize: 15,
        color: TEXT_PRIMARY,
        lineHeight: "26px",
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
                    if (target) onNavigate(wiki.slug);
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    cursor: target ? "pointer" : "not-allowed",
                    color: target ? ACCENT : DANGER,
                    fontFamily: "inherit",
                    fontSize: "inherit",
                    borderBottom: `1px dashed ${target ? "rgba(140, 231, 210, 0.5)" : "rgba(248, 113, 113, 0.5)"}`,
                  }}
                  title={target ? `→ ${target.title}` : `broken wikilink: ${wiki.slug}`}
                >
                  {props.children}
                  {!target && " ?"}
                </button>
              );
            }
            return (
              <a
                href={href}
                style={{ color: ACCENT }}
                target="_blank"
                rel="noreferrer"
              >
                {props.children}
              </a>
            );
          },
          p: (p) => (
            <p style={{ margin: "0 0 18px 0", lineHeight: "26px" }}>
              {p.children}
            </p>
          ),
          h1: (p) => (
            <h1
              style={{
                margin: "8px 0 12px 0",
                fontFamily: DISPLAY,
                fontSize: 18,
                fontWeight: 500,
                color: FG,
                lineHeight: "26px",
              }}
            >
              {p.children}
            </h1>
          ),
          h2: (p) => (
            <h2
              style={{
                margin: "20px 0 6px 0",
                fontFamily: DISPLAY,
                fontSize: 16,
                fontWeight: 500,
                color: FG,
              }}
            >
              {p.children}
            </h2>
          ),
          h3: (p) => (
            <h3
              style={{
                margin: "16px 0 4px 0",
                fontFamily: DISPLAY,
                fontSize: 14,
                fontWeight: 500,
                color: FG,
              }}
            >
              {p.children}
            </h3>
          ),
          ul: (p) => (
            <ul style={{ margin: "0 0 18px 0", paddingLeft: 22 }}>
              {p.children}
            </ul>
          ),
          ol: (p) => (
            <ol style={{ margin: "0 0 18px 0", paddingLeft: 22 }}>
              {p.children}
            </ol>
          ),
          li: (p) => <li style={{ marginBottom: 4 }}>{p.children}</li>,
          em: (p) => <em style={{ color: TEXT_SECONDARY }}>{p.children}</em>,
          strong: (p) => <strong style={{ color: FG }}>{p.children}</strong>,
          code: (p) => (
            <code
              style={{
                fontFamily: MONO,
                fontSize: 13,
                background: "rgba(255, 255, 255, 0.04)",
                padding: "1px 6px",
              }}
            >
              {p.children}
            </code>
          ),
          blockquote: (p) => (
            <blockquote
              style={{
                margin: "16px 0",
                paddingLeft: 14,
                borderLeft: `2px solid ${ACCENT_RING}`,
                color: TEXT_SECONDARY,
                fontStyle: "italic",
              }}
            >
              {p.children}
            </blockquote>
          ),
        }}
      >
        {transformed}
      </ReactMarkdown>
    </div>
  );
}

function preprocessWikilinks(body: string): string {
  if (!body) return body;
  return body.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
    (_, rawSlug: string, rawDisplay?: string) => {
      const slug = rawSlug.trim();
      const display = (rawDisplay?.trim() || slug);
      return `[${display}](wiki://${encodeURIComponent(slug)})`;
    },
  );
}

function parseWikiLink(href: string): { slug: string } | null {
  if (!href.startsWith("wiki://")) return null;
  return { slug: decodeURIComponent(href.slice("wiki://".length)) };
}

/* ── Edit view ─────────────────────────────────────────────────── */

type EditViewProps = {
  characterId: string;
  wikiId?: string;
  page: WikiPageRecord;
  eras: EraConfig[];
  pageBySlug: Map<string, WikiPageRecord>;
  base: string;
  segment: string;
  parentLabel: string;
  onCancel: () => void;
  onSaved: (slug: string) => void;
};

function EditView({
  characterId,
  wikiId,
  page,
  eras,
  pageBySlug,
  base,
  segment,
  parentLabel,
  onCancel,
  onSaved,
}: EditViewProps) {
  const [title, setTitle] = useState(page.title);
  const [summary, setSummary] = useState(page.summary ?? "");
  const [body, setBody] = useState(page.body);
  const [confidence, setConfidence] = useState(page.confidence);
  const [knowsFuture, setKnowsFuture] = useState(page.knowsFuture);
  const [timeIndex, setTimeIndex] = useState<TimeIndex | null>(page.timeIndex);
  const [perspective, setPerspective] = useState<Perspective>(
    page.perspective ?? {},
  );
  const initialFmString = useMemo(() => {
    try {
      return JSON.stringify(page.frontmatter ?? {}, null, 2);
    } catch {
      return "{}";
    }
  }, [page.frontmatter]);
  const [frontmatterDraft, setFrontmatterDraft] = useState(initialFmString);
  const [frontmatterError, setFrontmatterError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const dirty =
    title !== page.title ||
    summary !== (page.summary ?? "") ||
    body !== page.body ||
    confidence !== page.confidence ||
    knowsFuture !== page.knowsFuture ||
    !timeIndexEq(timeIndex, page.timeIndex) ||
    !perspectiveEq(perspective, page.perspective ?? {}) ||
    frontmatterDraft !== initialFmString;

  const sortedEras = useMemo(
    () => [...eras].sort((a, b) => a.order - b.order),
    [eras],
  );

  function handleSave() {
    setError(null);
    setFrontmatterError(null);

    let parsedFm: Frontmatter;
    try {
      const v = JSON.parse(frontmatterDraft);
      if (!v || typeof v !== "object" || Array.isArray(v)) {
        throw new Error("Must be an object");
      }
      parsedFm = v as Frontmatter;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFrontmatterError(`Invalid JSON: ${msg}`);
      return;
    }

    start(async () => {
      const res = wikiId
        ? await updateScopedWikiPage(wikiId, page.id, {
            type: page.type,
            slug: page.slug,
            title,
            summary: summary.trim() || null,
            body,
            frontmatter: parsedFm,
            perspective: {
              ...(perspective.knowsHow ? { knowsHow: perspective.knowsHow } : {}),
              ...(perspective.feels?.length ? { feels: perspective.feels } : {}),
              ...(perspective.stake?.trim()
                ? { stake: perspective.stake.trim() }
                : {}),
            },
            confidence,
            timeIndex,
            knowsFuture,
            contradictions: page.contradictions as Contradiction[],
          })
        : await updateCharacterWikiPage(characterId, page.id, {
        type: page.type,
        slug: page.slug,
        title,
        summary: summary.trim() || null,
        body,
        frontmatter: parsedFm,
        perspective: {
          ...(perspective.knowsHow ? { knowsHow: perspective.knowsHow } : {}),
          ...(perspective.feels?.length ? { feels: perspective.feels } : {}),
          ...(perspective.stake?.trim()
            ? { stake: perspective.stake.trim() }
            : {}),
        },
        confidence,
        timeIndex,
        knowsFuture,
        contradictions: page.contradictions as Contradiction[],
      });
      if (!res.ok) {
        setError(res.error);
      } else {
        onSaved(res.data?.slug ?? page.slug);
      }
    });
  }

  // ⌘S to save, Esc to cancel
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !pending) handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (!pending) onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const wikilinks = useMemo(() => extractWikilinks(body), [body]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        padding: "8px 0 80px",
      }}
    >
      <TopEyebrow
        base={base}
        segment={segment}
        parentLabel={parentLabel}
        pageTitle={page.title}
        editing
        hint="⌘S to save · Esc to cancel"
      />

      <SaveBar
        dirty={dirty}
        pending={pending}
        title={title}
        slug={page.slug}
        segment={segment}
        onSave={handleSave}
        onCancel={onCancel}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 360px",
          gap: 32,
          alignItems: "flex-start",
          paddingTop: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
            minWidth: 0,
          }}
        >
          <IdentitySection
            title={title}
            setTitle={setTitle}
            summary={summary}
            setSummary={setSummary}
            page={page}
            segment={segment}
            initialTitle={page.title}
            initialSummary={page.summary ?? ""}
          />
          <BodyEditorSection
            body={body}
            setBody={setBody}
            initialBody={page.body}
            wikilinkCount={wikilinks.length}
          />
          <TimelineSection
            timeIndex={timeIndex}
            setTimeIndex={setTimeIndex}
            eras={sortedEras}
            knowsFuture={knowsFuture}
            setKnowsFuture={setKnowsFuture}
            confidence={confidence}
            setConfidence={setConfidence}
          />
          <PerspectiveSection
            perspective={perspective}
            setPerspective={setPerspective}
          />
          <FrontmatterSection
            value={frontmatterDraft}
            onChange={(v) => {
              setFrontmatterDraft(v);
              if (frontmatterError) setFrontmatterError(null);
            }}
            error={frontmatterError}
          />
          {error && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                border: `1px solid ${DANGER_RING}`,
                background: DANGER_SOFT,
                color: DANGER,
                fontFamily: MONO,
                fontSize: 11,
                letterSpacing: "0.04em",
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: DANGER,
                }}
              />
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            position: "sticky",
            top: 24,
          }}
        >
          <SaveStateCard
            dirty={dirty}
            pending={pending}
            page={page}
            currentTitle={title}
            currentBody={body}
            currentSummary={summary}
            currentFeels={perspective.feels ?? []}
          />
          {wikilinks.length > 0 && (
            <WikilinksDetectedCard
              wikilinks={wikilinks}
              pageBySlug={pageBySlug}
              currentSlug={page.slug}
            />
          )}
          {page.contradictions.length > 0 && (
            <ReadOnlyContradictionsCard contradictions={page.contradictions} />
          )}
          <DangerZoneCard />
        </div>
      </div>
    </div>
  );
}

/* ── Edit view: sub-components ────────────────────────────────── */

function SaveBar({
  dirty,
  pending,
  title,
  slug,
  segment,
  onSave,
  onCancel,
}: {
  dirty: boolean;
  pending: boolean;
  title: string;
  slug: string;
  segment: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  const status = pending ? "Saving…" : dirty ? "Editing · unsaved" : "Saved";
  const statusColor = pending || dirty ? ACCENT : TEXT_SECONDARY;
  const statusDot = pending || dirty ? ACCENT : TEXT_FADED;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 48,
        padding: "0 18px",
        background: PANEL_BG,
        border: `1px solid ${ACCENT_RING}`,
        boxShadow: "inset 0 -2px 0 rgba(140, 231, 210, 0.18)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 10px",
          border: `1px solid ${ACCENT_RING}`,
          background: ACCENT_SOFT,
          color: statusColor,
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: statusDot,
          }}
        />
        {status}
      </div>
      <span
        style={{
          color: TEXT_SECONDARY,
          fontFamily: DISPLAY,
          fontSize: 14,
          fontWeight: 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: 320,
        }}
      >
        {title || "(untitled)"}
      </span>
      <span
        style={{
          color: TEXT_GHOST,
          fontFamily: MONO,
          fontSize: 11,
        }}
      >
        /{segment}/{slug}
      </span>
      <span style={{ flex: 1 }} />
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: TEXT_MUTED,
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: "0.06em",
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: TEXT_FADED,
          }}
        />
        re-embeds on save
      </span>
      <span
        style={{ width: 1, height: 22, background: BORDER, margin: "0 4px" }}
      />
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 14px",
          height: 30,
          border: `1px solid rgba(255, 255, 255, 0.16)`,
          background: "transparent",
          color: TEXT_PRIMARY,
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          cursor: pending ? "not-allowed" : "pointer",
          opacity: pending ? 0.5 : 1,
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || pending}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 18px",
          height: 30,
          background: dirty && !pending ? ACCENT : ACCENT_SOFT,
          color: dirty && !pending ? "#050505" : ACCENT,
          border: dirty && !pending ? "none" : `1px solid ${ACCENT_RING}`,
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          cursor: dirty && !pending ? "pointer" : "not-allowed",
          opacity: !dirty || pending ? 0.7 : 1,
        }}
      >
        {pending ? "Saving…" : "Save page"}
      </button>
    </div>
  );
}

function IdentitySection({
  title,
  setTitle,
  summary,
  setSummary,
  page,
  segment,
  initialTitle,
  initialSummary,
}: {
  title: string;
  setTitle: (v: string) => void;
  summary: string;
  setSummary: (v: string) => void;
  page: WikiPageRecord;
  segment: string;
  initialTitle: string;
  initialSummary: string;
}) {
  const summaryMax = 240;
  const color = TYPE_COLOR[page.type];
  return (
    <Card>
      <CardHeader
        label="Identity"
        trailing="title · summary · type"
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "18px 24px 0",
        }}
      >
        <FieldEyebrow
          label="Title"
          trailing={
            title !== initialTitle ? (
              <span style={{ color: ACCENT }}>● edited</span>
            ) : undefined
          }
        />
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{
            ...editInput,
            border: `1px solid ${title !== initialTitle ? ACCENT_RING : BORDER_STRONG}`,
            height: 44,
            fontFamily: DISPLAY,
            fontSize: 18,
            fontWeight: 500,
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "12px 24px 0",
        }}
      >
        <FieldEyebrow
          label="Summary"
          trailing={
            <span style={{ color: TEXT_GHOST }}>
              {summary.length} / {summaryMax} chars
            </span>
          }
        />
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          maxLength={summaryMax}
          placeholder="(no summary)"
          style={{
            ...editInput,
            minHeight: 64,
            fontFamily: BODY,
            fontSize: 14,
            lineHeight: "22px",
            resize: "vertical",
            border: `1px solid ${summary !== initialSummary ? ACCENT_RING : BORDER_STRONG}`,
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: 12,
          padding: "12px 24px 18px",
        }}
      >
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <FieldEyebrow
            label="Type"
            trailing={
              <span style={{ color: TEXT_GHOST }}>locked · type can't change</span>
            }
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 36,
              padding: "0 12px",
              border: `1px solid ${BORDER}`,
              background: "rgba(255, 255, 255, 0.014)",
              opacity: 0.7,
            }}
          >
            <span style={{ width: 6, height: 6, background: color }} />
            <span style={{ color: TEXT_SECONDARY, fontFamily: MONO, fontSize: 12 }}>
              {page.type === "voice_identity" ? "voice" : page.type}
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ color: TEXT_GHOST, fontFamily: MONO, fontSize: 11 }}>
              🔒
            </span>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <FieldEyebrow label="Slug" />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 36,
              padding: "0 12px",
              border: `1px solid ${BORDER_STRONG}`,
              background: INPUT_BG,
              color: TEXT_PRIMARY,
              fontFamily: MONO,
              fontSize: 12,
            }}
          >
            <span style={{ color: TEXT_FADED }}>/{segment}/</span>
            <span>{page.slug}</span>
            <span style={{ flex: 1 }} />
            <span
              style={{
                color: TEXT_GHOST,
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: "0.06em",
              }}
            >
              rename ↗
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function BodyEditorSection({
  body,
  setBody,
  initialBody,
  wikilinkCount,
}: {
  body: string;
  setBody: (v: string) => void;
  initialBody: string;
  wikilinkCount: number;
}) {
  const tokenCount = Math.max(1, Math.round(body.length / 4));
  const initialTokens = Math.max(1, Math.round(initialBody.length / 4));
  const diff = tokenCount - initialTokens;
  const dirty = body !== initialBody;
  const sectionCount = (body.match(/^##\s/gm) ?? []).length;

  return (
    <Card>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "12px 18px",
          borderBottom: `1px solid ${DIVIDER}`,
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ color: FG, fontWeight: 500 }}>Body</span>
        <span style={{ color: TEXT_QUIET }}>·</span>
        <span style={{ color: TEXT_MUTED }}>Markdown</span>
        <span style={{ color: TEXT_QUIET }}>·</span>
        <span style={{ color: TEXT_MUTED }}>Wikilinks</span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            display: "flex",
            gap: 14,
            color: TEXT_GHOST,
            letterSpacing: "0.06em",
            textTransform: "none",
          }}
        >
          <span>⌘[ wikilink</span>
          <span style={{ color: TEXT_QUIET }}>|</span>
          <span>⌘B bold</span>
          <span style={{ color: TEXT_QUIET }}>|</span>
          <span>⌘/ section</span>
        </span>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        spellCheck={false}
        style={{
          width: "100%",
          minHeight: 360,
          padding: "16px 22px",
          border: "none",
          outline: "none",
          background: "transparent",
          color: TEXT_PRIMARY,
          fontFamily: MONO,
          fontSize: 13,
          lineHeight: "22px",
          resize: "vertical",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "10px 18px",
          borderTop: `1px solid ${DIVIDER}`,
          fontFamily: MONO,
          fontSize: 11,
          color: TEXT_MUTED,
        }}
      >
        <span>
          <span style={{ color: TEXT_PRIMARY }}>{tokenCount}</span> tokens
          {diff !== 0 && (
            <>
              {" · diff "}
              <span style={{ color: ACCENT }}>
                {diff > 0 ? "+" : ""}
                {diff}
              </span>
              {" from saved"}
            </>
          )}
        </span>
        <span style={{ color: TEXT_QUIET }}>·</span>
        <span>
          {sectionCount} section{sectionCount === 1 ? "" : "s"} ·{" "}
          {wikilinkCount} wikilink{wikilinkCount === 1 ? "" : "s"} ·{" "}
          {body.length.toLocaleString()} chars
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: dirty ? ACCENT : TEXT_MUTED,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: dirty ? ACCENT : TEXT_FADED,
            }}
          />
          {dirty ? "unsaved" : "in sync"}
        </span>
      </div>
    </Card>
  );
}

function TimelineSection({
  timeIndex,
  setTimeIndex,
  eras,
  knowsFuture,
  setKnowsFuture,
  confidence,
  setConfidence,
}: {
  timeIndex: TimeIndex | null;
  setTimeIndex: (t: TimeIndex | null) => void;
  eras: EraConfig[];
  knowsFuture: boolean;
  setKnowsFuture: (v: boolean) => void;
  confidence: number;
  setConfidence: (v: number) => void;
}) {
  return (
    <Card>
      <CardHeader
        label="Timeline & confidence"
        trailing="era · t-index · knows-future · confidence"
      />
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: 14,
          padding: "18px 24px",
        }}
      >
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <FieldEyebrow label="Era" />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 36,
              padding: "0 12px",
              border: `1px solid ${BORDER_STRONG}`,
              background: INPUT_BG,
              position: "relative",
            }}
          >
            {timeIndex?.era && (
              <span
                style={{
                  width: 5,
                  height: 5,
                  background: ACCENT,
                }}
              />
            )}
            <select
              value={timeIndex?.era ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) setTimeIndex(null);
                else setTimeIndex({ era: v, index: timeIndex?.index ?? 0 });
              }}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                color: TEXT_PRIMARY,
                fontFamily: MONO,
                fontSize: 12,
                appearance: "none",
                cursor: "pointer",
              }}
            >
              <option value="" style={{ background: "#050505", color: FG }}>
                (timeless)
              </option>
              {eras.map((era) => (
                <option
                  key={era.key}
                  value={era.key}
                  style={{ background: "#050505", color: FG }}
                >
                  {era.title} · {era.key}
                </option>
              ))}
            </select>
            <span style={{ color: TEXT_FADED, fontFamily: MONO, fontSize: 12 }}>▾</span>
          </div>
        </div>
        <div style={{ width: 120, display: "flex", flexDirection: "column", gap: 6 }}>
          <FieldEyebrow label="T-index" />
          <input
            type="number"
            value={timeIndex?.index ?? ""}
            disabled={!timeIndex}
            min={0}
            max={999}
            placeholder="—"
            onChange={(e) => {
              if (!timeIndex) return;
              setTimeIndex({ ...timeIndex, index: Number(e.target.value) || 0 });
            }}
            style={{
              ...editInput,
              height: 36,
              fontFamily: MONO,
              fontSize: 12,
              opacity: timeIndex ? 1 : 0.5,
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <FieldEyebrow label="Knows future" />
          <button
            type="button"
            onClick={() => setKnowsFuture(!knowsFuture)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 36,
              padding: "0 14px",
              border: `1px solid ${knowsFuture ? ACCENT_RING : BORDER_STRONG}`,
              background: knowsFuture ? ACCENT_SOFT : INPUT_BG,
              color: knowsFuture ? ACCENT : TEXT_MUTED,
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                border: `1.5px solid ${knowsFuture ? ACCENT : TEXT_MUTED}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {knowsFuture && (
                <span style={{ width: 6, height: 6, background: ACCENT }} />
              )}
            </span>
            {knowsFuture ? "On" : "Off"}
          </button>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "0 24px 18px",
        }}
      >
        <FieldEyebrow
          label="Confidence"
          trailing={<span style={{ color: ACCENT }}>{confidence.toFixed(2)}</span>}
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={confidence}
          onChange={(e) => setConfidence(Number(e.target.value))}
          style={{
            width: "100%",
            accentColor: ACCENT,
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            color: TEXT_GHOST,
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: "0.06em",
          }}
        >
          <span>0.00 unset</span>
          <span style={{ flex: 1 }} />
          <span>0.50 partial</span>
          <span style={{ flex: 1 }} />
          <span>1.00 canon</span>
        </div>
      </div>
    </Card>
  );
}

function PerspectiveSection({
  perspective,
  setPerspective,
}: {
  perspective: Perspective;
  setPerspective: (p: Perspective) => void;
}) {
  const feels = perspective.feels ?? [];
  return (
    <Card>
      <CardHeader
        label="Perspective"
        trailing="knows how · feels · stake"
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "16px 24px 14px",
          borderBottom: `1px solid ${DIVIDER}`,
        }}
      >
        <FieldEyebrow label="Knows how" />
        <select
          value={perspective.knowsHow ?? ""}
          onChange={(e) => {
            const v = e.target.value as PerspectiveKnowsHow | "";
            setPerspective({ ...perspective, knowsHow: v || undefined });
          }}
          style={{
            ...editInput,
            height: 40,
            fontFamily: BODY,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <option value="" style={{ background: "#050505", color: FG }}>
            (unset)
          </option>
          <option value="firsthand" style={{ background: "#050505", color: FG }}>
            firsthand — lived it
          </option>
          <option value="heard" style={{ background: "#050505", color: FG }}>
            heard — from others
          </option>
          <option value="inferred" style={{ background: "#050505", color: FG }}>
            inferred — from clues
          </option>
          <option value="unknown" style={{ background: "#050505", color: FG }}>
            unknown — uncertain
          </option>
        </select>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "14px 24px 14px",
          borderBottom: `1px solid ${DIVIDER}`,
        }}
      >
        <FieldEyebrow
          label="Feels"
          trailing={
            <span style={{ color: TEXT_GHOST }}>
              enter to add · backspace to remove
            </span>
          }
        />
        <TagInput
          values={feels}
          onChange={(v) => setPerspective({ ...perspective, feels: v })}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "14px 24px 18px",
        }}
      >
        <FieldEyebrow label="Stake" />
        <textarea
          value={perspective.stake ?? ""}
          onChange={(e) =>
            setPerspective({ ...perspective, stake: e.target.value })
          }
          rows={2}
          placeholder="One phrase — why does this matter?"
          style={{
            ...editInput,
            minHeight: 56,
            fontFamily: BODY,
            fontSize: 13,
            lineHeight: "20px",
            resize: "vertical",
          }}
        />
      </div>
    </Card>
  );
}

function TagInput({
  values,
  onChange,
}: {
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  function add() {
    const t = draft.trim();
    if (!t) return;
    if (values.includes(t)) {
      setDraft("");
      return;
    }
    onChange([...values, t]);
    setDraft("");
  }
  function remove(t: string) {
    onChange(values.filter((v) => v !== t));
  }
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        border: `1px solid ${BORDER_STRONG}`,
        background: INPUT_BG,
        minHeight: 36,
      }}
    >
      {values.map((t) => (
        <span
          key={t}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 9px",
            border: `1px solid ${ACCENT_RING}`,
            background: ACCENT_SOFT,
            color: ACCENT,
            fontFamily: MONO,
            fontSize: 11,
          }}
        >
          <span>{t}</span>
          <button
            type="button"
            onClick={() => remove(t)}
            style={{
              border: "none",
              background: "transparent",
              color: "rgba(140, 231, 210, 0.55)",
              cursor: "pointer",
              padding: 0,
              fontSize: 12,
              fontFamily: MONO,
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (
            e.key === "Backspace" &&
            !draft &&
            values.length > 0
          ) {
            remove(values[values.length - 1]);
          }
        }}
        onBlur={add}
        placeholder={values.length === 0 ? "add a tag…" : "add…"}
        style={{
          flex: 1,
          minWidth: 80,
          border: "none",
          outline: "none",
          background: "transparent",
          color: TEXT_PRIMARY,
          fontFamily: MONO,
          fontSize: 11,
          padding: "3px 6px",
        }}
      />
    </div>
  );
}

function FrontmatterSection({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  return (
    <Card>
      <CardHeader label="Frontmatter" trailing="JSON · must be an object" />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        spellCheck={false}
        style={{
          width: "100%",
          padding: "14px 22px",
          border: "none",
          outline: "none",
          background: "transparent",
          color: error ? DANGER : TEXT_PRIMARY,
          fontFamily: MONO,
          fontSize: 12,
          lineHeight: "20px",
          resize: "vertical",
          minHeight: 200,
        }}
      />
      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 18px",
            borderTop: `1px solid ${DANGER_RING}`,
            background: DANGER_SOFT,
            color: DANGER,
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: "0.04em",
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: DANGER,
            }}
          />
          {error}
        </div>
      )}
    </Card>
  );
}

function SaveStateCard({
  dirty,
  pending,
  page,
  currentTitle,
  currentBody,
  currentSummary,
  currentFeels,
}: {
  dirty: boolean;
  pending: boolean;
  page: WikiPageRecord;
  currentTitle: string;
  currentBody: string;
  currentSummary: string;
  currentFeels: string[];
}) {
  const bodyTokens = Math.max(1, Math.round(currentBody.length / 4));
  const initialBodyTokens = Math.max(1, Math.round(page.body.length / 4));
  const bodyDiff = bodyTokens - initialBodyTokens;
  const bodyWikilinkCount = (currentBody.match(/\[\[[^\]]+\]\]/g) ?? []).length;
  const initialWikilinkCount = (page.body.match(/\[\[[^\]]+\]\]/g) ?? []).length;
  const newWikilinks = bodyWikilinkCount - initialWikilinkCount;

  const titleChanged = currentTitle !== page.title;
  const summaryChanged = currentSummary !== (page.summary ?? "");
  const initialFeels = page.perspective?.feels ?? [];
  const feelsDiff = currentFeels.length - initialFeels.length;

  const rows: Array<{ label: string; value: ReactNode }> = [];
  if (bodyDiff !== 0 || currentBody !== page.body) {
    rows.push({
      label: "Body",
      value: (
        <span>
          {bodyDiff !== 0 && (
            <>
              <span style={{ color: ACCENT }}>
                {bodyDiff > 0 ? "+" : ""}
                {bodyDiff}
              </span>
              {" tokens"}
            </>
          )}
          {newWikilinks > 0 && (
            <>
              {bodyDiff !== 0 ? " · " : ""}
              {newWikilinks} new wikilink{newWikilinks === 1 ? "" : "s"}
            </>
          )}
        </span>
      ),
    });
  }
  if (titleChanged) rows.push({ label: "Title", value: "renamed" });
  if (summaryChanged) rows.push({ label: "Summary", value: "updated" });
  if (feelsDiff !== 0) {
    rows.push({
      label: "Feels",
      value: (
        <span style={{ color: ACCENT }}>
          {feelsDiff > 0 ? "+" : ""}
          {feelsDiff}
        </span>
      ),
    });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: `1px solid ${ACCENT_RING}`,
        background: "rgba(140, 231, 210, 0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: `1px solid rgba(140, 231, 210, 0.18)`,
          color: FG,
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: ACCENT }} />
        <span>Save state</span>
        <span style={{ flex: 1, height: 1, background: "rgba(140, 231, 210, 0.14)" }} />
        <span style={{ color: ACCENT }}>
          {pending ? "SAVING" : dirty ? "UNSAVED" : "IN SYNC"}
        </span>
      </div>
      {rows.length === 0 ? (
        <div
          style={{
            padding: "14px 16px",
            color: TEXT_FADED,
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: "0.04em",
          }}
        >
          no changes to save yet
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "14px 16px",
          }}
        >
          {rows.map((r) => (
            <div
              key={r.label}
              style={{ display: "flex", alignItems: "baseline", gap: 8 }}
            >
              <span
                style={{
                  width: 80,
                  color: TEXT_FADED,
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                {r.label}
              </span>
              <span
                style={{
                  flex: 1,
                  color: TEXT_PRIMARY,
                  fontFamily: MONO,
                  fontSize: 11,
                }}
              >
                {r.value}
              </span>
            </div>
          ))}
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          borderTop: `1px solid rgba(140, 231, 210, 0.14)`,
          color: TEXT_MUTED,
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
              background: TEXT_FADED,
            }}
          />
          autosave on save
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ color: TEXT_GHOST }}>⌘S commits</span>
      </div>
    </div>
  );
}

function WikilinksDetectedCard({
  wikilinks,
  pageBySlug,
  currentSlug,
}: {
  wikilinks: Array<{ slug: string; display: string }>;
  pageBySlug: Map<string, WikiPageRecord>;
  currentSlug: string;
}) {
  const unique = useMemo(() => {
    const seen = new Set<string>();
    return wikilinks.filter((w) => {
      if (seen.has(w.slug)) return false;
      seen.add(w.slug);
      return true;
    });
  }, [wikilinks]);

  return (
    <Card>
      <CardHeader
        label="Wikilinks · detected"
        trailing={`${pad2(unique.length)} unique`}
      />
      {unique.slice(0, 12).map((w, i) => {
        const target = pageBySlug.get(w.slug);
        const isSelf = w.slug === currentSlug;
        const isBroken = !target && !isSelf;
        const dotColor = isBroken
          ? DANGER
          : target
            ? TYPE_COLOR[target.type]
            : TEXT_MUTED;
        const status = isSelf
          ? "self"
          : isBroken
            ? "broken"
            : "resolved";
        const statusColor = isSelf
          ? TEXT_GHOST
          : isBroken
            ? DANGER
            : TEXT_MUTED;
        return (
          <div
            key={w.slug}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 36,
              padding: "0 16px",
              borderBottom:
                i === Math.min(unique.length, 12) - 1
                  ? "none"
                  : `1px solid ${DIVIDER}`,
            }}
          >
            <span style={{ width: 6, height: 6, background: dotColor }} />
            <span
              style={{
                flex: 1,
                color: TEXT_PRIMARY,
                fontFamily: MONO,
                fontSize: 11,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              [[{w.slug}]]
            </span>
            <span style={{ color: statusColor, fontFamily: MONO, fontSize: 10 }}>
              {status}
            </span>
          </div>
        );
      })}
    </Card>
  );
}

function ReadOnlyContradictionsCard({
  contradictions,
}: {
  contradictions: Contradiction[];
}) {
  return (
    <Card>
      <CardHeader
        label="Contradictions"
        trailing={`read-only · ${pad2(contradictions.length)}`}
      />
      {contradictions.map((c, i) => (
        <div
          key={`${c.otherPageId}-${i}`}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "12px 14px",
            borderLeft: `2px solid ${DANGER}`,
            background: "rgba(248, 113, 113, 0.04)",
            borderBottom:
              i === contradictions.length - 1 ? "none" : `1px solid ${DIVIDER}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: DANGER,
              }}
            />
            <span
              style={{
                color: DANGER,
                fontFamily: MONO,
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              VS · {c.otherPageId.slice(0, 8)}…
            </span>
          </div>
          <div
            style={{
              paddingLeft: 13,
              color: TEXT_PRIMARY,
              fontFamily: BODY,
              fontSize: 12,
              lineHeight: "18px",
            }}
          >
            {c.note}
          </div>
        </div>
      ))}
    </Card>
  );
}

function DangerZoneCard() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: `1px solid rgba(248, 113, 113, 0.18)`,
        background: PANEL_BG,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: `1px solid rgba(248, 113, 113, 0.12)`,
          color: DANGER,
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        Danger zone
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "14px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            <span
              style={{
                color: TEXT_PRIMARY,
                fontFamily: BODY,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Rename slug
            </span>
            <span
              style={{
                color: TEXT_FADED,
                fontFamily: MONO,
                fontSize: 10,
              }}
            >
              wikilinks redirect; back-compat one revision
            </span>
          </div>
          <button
            type="button"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 12px",
              height: 28,
              border: `1px solid rgba(255, 255, 255, 0.16)`,
              background: "transparent",
              color: TEXT_PRIMARY,
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Rename
          </button>
        </div>
        <span style={{ height: 1, background: DIVIDER }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            <span
              style={{
                color: TEXT_PRIMARY,
                fontFamily: BODY,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Delete page
            </span>
            <span
              style={{
                color: TEXT_FADED,
                fontFamily: MONO,
                fontSize: 10,
              }}
            >
              drops inbound edges · cannot undo
            </span>
          </div>
          <button
            type="button"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 12px",
              height: 28,
              border: `1px solid ${DANGER_RING}`,
              background: "transparent",
              color: DANGER,
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Delete…
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Shared primitives ────────────────────────────────────────── */

function TopEyebrow({
  base,
  segment,
  parentLabel,
  pageTitle,
  editing,
  hint,
}: {
  base: string;
  segment: string;
  parentLabel: string;
  pageTitle: string;
  editing?: boolean;
  hint?: string;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
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
        href={`${base}/${segment}`}
        style={{ color: TEXT_FADED, textDecoration: "none" }}
      >
        {parentLabel}
      </Link>
      <span style={{ color: TEXT_QUIET }}>/</span>
      <span style={{ color: editing ? TEXT_SECONDARY : ACCENT }}>
        {pageTitle}
      </span>
      {editing && (
        <>
          <span style={{ color: TEXT_QUIET }}>/</span>
          <span style={{ color: ACCENT, letterSpacing: "0.14em" }}>EDIT</span>
        </>
      )}
      <span style={{ flex: 1, height: 1, background: DIVIDER }} />
      {hint && <span style={{ color: TEXT_GHOST }}>{hint}</span>}
    </nav>
  );
}

function GhostLink({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 12px",
        height: 28,
        border: `1px solid rgba(255, 255, 255, 0.16)`,
        background: "transparent",
        color: TEXT_PRIMARY,
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: `1px solid ${BORDER}`,
        background: PANEL_BG,
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({
  label,
  trailing,
}: {
  label: string;
  trailing?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "14px 20px 8px 20px",
        borderBottom: `1px solid ${DIVIDER}`,
        color: FG,
        fontFamily: MONO,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
      }}
    >
      <span>{label}</span>
      <span style={{ flex: 1, height: 1, background: DIVIDER }} />
      {trailing && (
        <span
          style={{
            color: TEXT_GHOST,
            letterSpacing: "0.06em",
            textTransform: "none",
          }}
        >
          {trailing}
        </span>
      )}
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
        minHeight: 44,
        padding: "10px 20px",
        gap: 16,
        borderBottom: last ? "none" : `1px solid ${DIVIDER}`,
      }}
    >
      <span
        style={{
          width: 140,
          flexShrink: 0,
          color: TEXT_FADED,
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1 }}>{value}</div>
    </div>
  );
}

function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "20px 16px",
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

function FieldEyebrow({
  label,
  trailing,
}: {
  label: string;
  trailing?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        color: TEXT_FADED,
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
      }}
    >
      <span>{label}</span>
      <span style={{ flex: 1, height: 1, background: DIVIDER }} />
      {trailing}
    </div>
  );
}

const editInput: CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  border: `1px solid ${BORDER_STRONG}`,
  background: INPUT_BG,
  color: TEXT_PRIMARY,
  fontFamily: BODY,
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
};

/* ── Helpers ───────────────────────────────────────────────────── */

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

function knowsHowLabel(kh: PerspectiveKnowsHow): string {
  switch (kh) {
    case "firsthand":
      return "firsthand — lived it";
    case "heard":
      return "heard — from others";
    case "inferred":
      return "inferred — from clues";
    case "unknown":
      return "unknown — uncertain";
    default:
      return kh;
  }
}

function timeIndexEq(a: TimeIndex | null, b: TimeIndex | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.era === b.era && a.index === b.index;
}

function perspectiveEq(a: Perspective, b: Perspective): boolean {
  if (a.knowsHow !== b.knowsHow) return false;
  if ((a.stake ?? "") !== (b.stake ?? "")) return false;
  const af = a.feels ?? [];
  const bf = b.feels ?? [];
  if (af.length !== bf.length) return false;
  for (let i = 0; i < af.length; i++) if (af[i] !== bf[i]) return false;
  return true;
}

function buildFrontmatterRows(
  page: WikiPageRecord,
): Array<{ label: string; value: string | string[] }> {
  const fm = page.frontmatter as Record<string, unknown>;
  const rows: Array<{ label: string; value: string | string[] }> = [];
  const aliases = Array.isArray(fm.aliases) ? (fm.aliases as string[]) : [];

  switch (page.type) {
    case "entity": {
      if (typeof fm.kind === "string")
        rows.push({ label: "Kind", value: fm.kind });
      if (aliases.length > 0)
        rows.push({ label: "Aliases", value: aliases });
      if (typeof fm.firstAppearance === "string")
        rows.push({ label: "First appears", value: fm.firstAppearance });
      if (typeof fm.lastAppearance === "string")
        rows.push({ label: "Last appears", value: fm.lastAppearance });
      break;
    }
    case "event": {
      if (typeof fm.where === "string")
        rows.push({ label: "Where", value: fm.where });
      if (Array.isArray(fm.participants) && fm.participants.length > 0)
        rows.push({
          label: "Participants",
          value: fm.participants as string[],
        });
      if (Array.isArray(fm.causes) && fm.causes.length > 0)
        rows.push({ label: "Causes", value: fm.causes as string[] });
      if (Array.isArray(fm.effects) && fm.effects.length > 0)
        rows.push({ label: "Effects", value: fm.effects as string[] });
      break;
    }
    case "concept": {
      if (aliases.length > 0)
        rows.push({ label: "Aliases", value: aliases });
      if (Array.isArray(fm.instances) && fm.instances.length > 0)
        rows.push({ label: "Instances", value: fm.instances as string[] });
      if (Array.isArray(fm.relatedConcepts) && fm.relatedConcepts.length > 0)
        rows.push({
          label: "Related",
          value: fm.relatedConcepts as string[],
        });
      break;
    }
    case "relationship": {
      if (typeof fm.kind === "string")
        rows.push({ label: "Kind", value: fm.kind });
      if (typeof fm.from === "string")
        rows.push({ label: "From", value: fm.from });
      if (typeof fm.to === "string")
        rows.push({ label: "To", value: fm.to });
      if (Array.isArray(fm.evolution) && fm.evolution.length > 0)
        rows.push({
          label: "Evolution",
          value: (fm.evolution as string[]).join(" → "),
        });
      break;
    }
    case "voice_identity": {
      const arrays: Array<[string, string]> = [
        ["Speech patterns", "speechPatterns"],
        ["Idioms", "idioms"],
        ["Beliefs", "beliefs"],
        ["Emotional range", "emotionalRange"],
        ["Taboos", "taboos"],
      ];
      for (const [label, key] of arrays) {
        const v = (fm as Record<string, unknown>)[key];
        if (Array.isArray(v) && v.length > 0) {
          rows.push({ label, value: v as string[] });
        }
      }
      break;
    }
    case "timeline":
      break;
  }
  return rows;
}

function extractWikilinks(
  body: string,
): Array<{ slug: string; display: string }> {
  const out: Array<{ slug: string; display: string }> = [];
  const re = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.push({
      slug: m[1].trim(),
      display: (m[2] ?? m[1]).trim(),
    });
  }
  return out;
}
