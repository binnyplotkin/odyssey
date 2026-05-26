"use client";

import Link from "next/link";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { KnowledgeGraphIcon } from "@/components/knowledge-graph-icon";
import type {
  CharacterKnowledgeBindingRecord,
  KnowledgeGraphData,
  WikiRecord,
} from "@odyssey/db";
import { updateWikiMeta } from "../actions";

/* ── Tokens (phosphor / terminal) ──────────────────────────────── */

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const DISPLAY = '"Space Grotesk", system-ui, sans-serif';
const BODY = '"Geist", "Inter", system-ui, sans-serif';

const FG = "rgba(255, 255, 255, 0.95)";
const TEXT_PRIMARY = "rgba(255, 255, 255, 0.88)";
const TEXT_SECONDARY = "rgba(255, 255, 255, 0.7)";
const TEXT_MUTED = "rgba(255, 255, 255, 0.5)";
const TEXT_FADED = "rgba(255, 255, 255, 0.4)";
const TEXT_GHOST = "rgba(255, 255, 255, 0.32)";
const TEXT_QUIET = "rgba(255, 255, 255, 0.2)";

const GROUND = "#0A0A0A";
const BORDER = "rgba(255, 255, 255, 0.08)";
const DIVIDER = "rgba(255, 255, 255, 0.06)";
const INPUT_BG = "rgba(255, 255, 255, 0.02)";

const ACCENT = "#8FD1CB";
const ACCENT_SOFT = "rgba(140, 231, 210, 0.06)";
const ACCENT_RING = "rgba(140, 231, 210, 0.3)";

const SECONDARY = "#B79EFF";
const SECONDARY_SOFT = "rgba(183, 158, 255, 0.08)";
const SECONDARY_RING = "rgba(183, 158, 255, 0.3)";

const DANGER = "#f87171";
const DANGER_SOFT = "rgba(248, 113, 113, 0.06)";
const DANGER_RING = "rgba(248, 113, 113, 0.36)";

const PRIORITY_STYLE: Record<
  string,
  { dot: string; chipBorder: string; chipBg: string; chipText: string }
> = {
  primary: {
    dot: ACCENT,
    chipBorder: ACCENT_RING,
    chipBg: ACCENT_SOFT,
    chipText: ACCENT,
  },
  secondary: {
    dot: SECONDARY,
    chipBorder: SECONDARY_RING,
    chipBg: SECONDARY_SOFT,
    chipText: SECONDARY,
  },
  reference: {
    dot: TEXT_MUTED,
    chipBorder: BORDER,
    chipBg: "rgba(255, 255, 255, 0.03)",
    chipText: TEXT_SECONDARY,
  },
};

/* ── Props ─────────────────────────────────────────────────────── */

export type WikiDetailProps = {
  wiki: WikiRecord;
  boundCharacters: Array<{
    binding: CharacterKnowledgeBindingRecord;
    character: {
      id: string;
      slug: string;
      title: string;
      image: string | null;
    } | null;
  }>;
  pageCount: number;
  sourceCount: number;
  edgeCount: number;
  iconData: KnowledgeGraphData;
  recentRuns: Array<{
    id: string;
    status: "queued" | "running" | "succeeded" | "failed" | "canceled";
    startedAt: string;
    finishedAt: string | null;
    pagesCreated: number;
    pagesUpdated: number;
    edgesAdded: number;
    tokensUsed: number;
    model: string | null;
    errorMessage: string | null;
  }>;
};

/* ── Helpers ───────────────────────────────────────────────────── */

function relative(iso: string | null): string {
  if (!iso) return "—";
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

function formatTokens(n: number): string {
  if (n < 1000) return `${n} tok`;
  return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k tok`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function runDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return "—";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/* ── Component ─────────────────────────────────────────────────── */

export function WikiDetail({
  wiki,
  boundCharacters,
  pageCount,
  sourceCount,
  edgeCount,
  iconData,
  recentRuns,
}: WikiDetailProps) {
  const visibleRuns = recentRuns.slice(0, 4);

  // Optimistic local copies for the inline-edited fields. Reset whenever the
  // server-side record changes (e.g. after revalidation lands).
  const [localTitle, setLocalTitle] = useState(wiki.title);
  const [localSummary, setLocalSummary] = useState<string | null>(wiki.summary);
  useEffect(() => {
    setLocalTitle(wiki.title);
  }, [wiki.id, wiki.title]);
  useEffect(() => {
    setLocalSummary(wiki.summary);
  }, [wiki.id, wiki.summary]);

  const promptName = wiki.ingestionPromptName?.trim();
  const hasPrompt = Boolean(wiki.ingestionPrompt?.trim());

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-32)",
        padding: "32px 32px 80px",
      }}
    >
      <TopEyebrow slug={wiki.slug} title={localTitle} />

      {/* Hero band */}
      <div style={{ display: "flex", gap: "var(--space-32)", alignItems: "stretch" }}>
        <FingerprintTile iconData={iconData} />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-14)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-12)",
              color: TEXT_GHOST,
              fontFamily: MONO,
              fontSize: "var(--font-size-sm)",
              letterSpacing: "0.06em",
            }}
          >
            <span>/wikis/{wiki.slug}</span>
            <span style={{ color: TEXT_QUIET }}>·</span>
            <span>updated {relative(wiki.updatedAt)}</span>
          </div>
          <EditableTitle
            wikiId={wiki.id}
            title={localTitle}
            onTitleChange={setLocalTitle}
          />
          <EditableSummary
            wikiId={wiki.id}
            summary={localSummary}
            onSummaryChange={setLocalSummary}
          />
          <ErasRow eras={wiki.eras} />
        </div>
        <StatsPillar
          pageCount={pageCount}
          sourceCount={sourceCount}
          edgeCount={edgeCount}
        />
      </div>

      {/* Configuration */}
      <ConfigurationCard
        wikiId={wiki.id}
        ingestionPrompt={wiki.ingestionPrompt}
        promptName={promptName ?? null}
        hasPrompt={hasPrompt}
        updatedAt={wiki.updatedAt}
      />

      {/* Eras + Bound Characters */}
      <div style={{ display: "flex", gap: "var(--space-32)", alignItems: "flex-start" }}>
        <ErasCard eras={wiki.eras} />
        <BoundCharactersCard bindings={boundCharacters} />
      </div>

      {/* Recent ingestion */}
      <RecentIngestionCard wikiId={wiki.id} runs={visibleRuns} />
    </div>
  );
}

/* ── Top eyebrow ─────────────────────────────────────────────── */

function TopEyebrow({ slug: _slug, title }: { slug: string; title: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-14)",
        color: TEXT_FADED,
        fontFamily: MONO,
        fontSize: "var(--font-size-sm)",
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
      <span style={{ color: TEXT_SECONDARY }}>{title}</span>
      <span
        style={{
          flex: 1,
          height: 1,
          background: DIVIDER,
        }}
      />
      <span style={{ color: TEXT_GHOST, letterSpacing: "0.1em" }}>⌘K</span>
    </div>
  );
}

/* ── Fingerprint tile ─────────────────────────────────────────── */

function FingerprintTile({ iconData }: { iconData: KnowledgeGraphData }) {
  return (
    <div
      style={{
        width: 200,
        height: 200,
        flexShrink: 0,
        border: `1px solid ${BORDER}`,
        background: GROUND,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <KnowledgeGraphIcon data={iconData} size={140} density="spacious" />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-8)",
          padding: "8px 12px",
          borderTop: `1px solid ${DIVIDER}`,
          color: TEXT_FADED,
          fontFamily: MONO,
          fontSize: "var(--font-size-2xs)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: ACCENT,
          }}
        />
        <span>
          GRAPH · {iconData.nodes.length} NODE
          {iconData.nodes.length === 1 ? "" : "S"}
        </span>
      </div>
    </div>
  );
}

/* ── Era chips (inline in the hero) ─────────────────────────── */

function ErasRow({ eras }: { eras: WikiRecord["eras"] }) {
  if (eras.length === 0) return null;
  const sorted = eras.slice().sort((a, b) => a.order - b.order);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "var(--space-8)",
        paddingTop: "var(--space-4)",
      }}
    >
      <span
        style={{
          color: TEXT_FADED,
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        ERAS
      </span>
      <span
        style={{
          height: 1,
          width: 18,
          background: BORDER,
          margin: "0 4px",
        }}
      />
      {sorted.map((era, i) => (
        <span
          key={era.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-8)",
            padding: "4px 10px",
            border: `1px solid ${BORDER}`,
            color: TEXT_PRIMARY,
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background:
                i === 0 ? ACCENT : i === 1 ? SECONDARY : TEXT_MUTED,
            }}
          />
          <span>
            {pad2(i + 1)} · {era.title.toLowerCase()}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ── Stats pillar ─────────────────────────────────────────────── */

function StatsPillar({
  pageCount,
  sourceCount,
  edgeCount,
}: {
  pageCount: number;
  sourceCount: number;
  edgeCount: number;
}) {
  return (
    <div
      style={{
        width: 380,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        border: `1px solid ${BORDER}`,
        background: GROUND,
      }}
    >
      <StatRow
        label="Pages"
        value={pageCount}
        caption="written"
        meta="markdown · linked"
      />
      <StatRow
        label="Sources"
        value={sourceCount}
        caption="ingested"
        meta="primary · annotation"
      />
      <StatRow
        label="Edges"
        value={edgeCount}
        caption="links across pages"
        meta="derived"
        last
      />
    </div>
  );
}

function StatRow({
  label,
  value,
  caption,
  meta,
  last,
}: {
  label: string;
  value: number;
  caption: string;
  meta: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        padding: "18px 20px",
        borderBottom: last ? "none" : `1px solid ${DIVIDER}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-10)",
          color: TEXT_FADED,
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        <span>{label}</span>
        <span style={{ flex: 1, height: 1, background: DIVIDER }} />
        <span style={{ color: TEXT_GHOST }}>{meta}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-8)" }}>
        <span
          style={{
            color: FG,
            fontFamily: MONO,
            fontSize: 28,
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          {value.toLocaleString()}
        </span>
        <span style={{ color: TEXT_GHOST, fontFamily: MONO, fontSize: "var(--font-size-sm)" }}>
          {caption}
        </span>
      </div>
    </div>
  );
}

/* ── Configuration card ──────────────────────────────────────── */

function ConfigurationCard({
  wikiId,
  ingestionPrompt,
  promptName,
  hasPrompt,
  updatedAt,
}: {
  wikiId: string;
  ingestionPrompt: string | null;
  promptName: string | null;
  hasPrompt: boolean;
  updatedAt: string;
}) {
  return (
    <Card>
      <CardHeader
        label="Configuration"
        trailing="ingestion lens · runtime defaults"
      />
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "stretch",
        }}
      >
        <PromptBlock
          wikiId={wikiId}
          ingestionPrompt={ingestionPrompt}
          promptName={promptName}
          hasPrompt={hasPrompt}
          updatedAt={updatedAt}
        />
        <RuntimeBlock />
      </div>
    </Card>
  );
}

function PromptBlock({
  wikiId,
  ingestionPrompt,
  promptName,
  hasPrompt,
  updatedAt,
}: {
  wikiId: string;
  ingestionPrompt: string | null;
  promptName: string | null;
  hasPrompt: boolean;
  updatedAt: string;
}) {
  const tokens = ingestionPrompt
    ? Math.max(1, Math.round(ingestionPrompt.length / 4))
    : 0;
  const sections = ingestionPrompt
    ? (ingestionPrompt.match(/^##\s/gm) ?? []).length
    : 0;
  const preview = ingestionPrompt
    ? ingestionPrompt.split("\n").slice(0, 8).join("\n")
    : null;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: `1px solid ${DIVIDER}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-12)",
          padding: "14px 18px",
        }}
      >
        <span
          style={{
            color: TEXT_FADED,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          PROMPT
        </span>
        {hasPrompt ? (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-8)",
              padding: "2px 8px",
              border: `1px solid ${ACCENT_RING}`,
              background: ACCENT_SOFT,
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: ACCENT,
              }}
            />
            <span
              style={{
                color: ACCENT,
                fontFamily: MONO,
                fontSize: "var(--font-size-2xs)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              {promptName ?? "Unnamed lens"}
            </span>
          </span>
        ) : (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-8)",
              padding: "2px 8px",
              border: `1px solid ${BORDER}`,
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
            <span
              style={{
                color: TEXT_MUTED,
                fontFamily: MONO,
                fontSize: "var(--font-size-2xs)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Unset
            </span>
          </span>
        )}
        <span style={{ flex: 1 }} />
        {hasPrompt && (
          <span
            style={{
              color: TEXT_GHOST,
              fontFamily: MONO,
              fontSize: "var(--font-size-xs)",
            }}
          >
            {tokens} tok · {sections} section{sections === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <pre
        style={{
          margin: 0,
          padding: "4px 18px 18px 18px",
          fontFamily: MONO,
          fontSize: "var(--font-size-base)",
          lineHeight: "20px",
          color: hasPrompt ? TEXT_PRIMARY : TEXT_FADED,
          fontStyle: hasPrompt ? "normal" : "italic",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 180,
          overflow: "hidden",
        }}
      >
        {preview ??
          "Domain knob — prepended to every ingestion run. Add a lens to guide how raw sources read into pages."}
      </pre>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-12)",
          padding: "12px 18px",
          borderTop: `1px solid ${DIVIDER}`,
          color: TEXT_FADED,
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.06em",
        }}
      >
        {hasPrompt ? (
          <>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-6)",
                color: TEXT_SECONDARY,
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: ACCENT,
                }}
              />
              <span>saved</span>
            </span>
            <span style={{ color: TEXT_QUIET }}>·</span>
            <span>last edited {relative(updatedAt)}</span>
          </>
        ) : (
          <span>no prompt set</span>
        )}
        <span style={{ flex: 1 }} />
        <Link
          href={`/wikis/${wikiId}/ingestion`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-6)",
            padding: "6px 14px",
            border: `1px solid rgba(255, 255, 255, 0.16)`,
            color: TEXT_PRIMARY,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            textDecoration: "none",
          }}
        >
          CONFIGURE ↗
        </Link>
      </div>
    </div>
  );
}

function RuntimeBlock() {
  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "14px 18px 8px 18px",
          color: TEXT_FADED,
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        RUNTIME
      </div>
      <RuntimeRow
        label="model"
        value={
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-8)",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: SECONDARY,
              }}
            />
            <span style={{ color: FG }}>claude-sonnet-4-5</span>
          </span>
        }
      />
      <RuntimeRow label="max output" value="4,096" />
      <RuntimeRow label="embeddings" value="text-embedding-3-large" last />
    </div>
  );
}

function RuntimeRow({
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
        height: 36,
        padding: "0 18px",
        borderTop: `1px solid ${DIVIDER}`,
        borderBottom: last ? `1px solid ${DIVIDER}` : "none",
      }}
    >
      <span
        style={{
          flex: 1,
          color: TEXT_SECONDARY,
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
        }}
      >
        {label}
      </span>
      <span style={{ color: FG, fontFamily: MONO, fontSize: "var(--font-size-base)" }}>{value}</span>
    </div>
  );
}

/* ── Eras card ───────────────────────────────────────────────── */

function ErasCard({ eras }: { eras: WikiRecord["eras"] }) {
  const sorted = eras.slice().sort((a, b) => a.order - b.order);
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <Card>
        <CardHeader
          label="Eras"
          trailing={`temporal frames · ${pad2(eras.length)} total`}
        />
        {sorted.length === 0 ? (
          <EmptyState>No eras defined yet.</EmptyState>
        ) : (
          sorted.map((era, i) => (
            <EraRow
              key={era.key}
              index={i + 1}
              title={era.title}
              keyName={era.key}
              active={i === 0}
              last={i === sorted.length - 1}
            />
          ))
        )}
        <AddRow label="add an era" hotkey="E" />
      </Card>
    </div>
  );
}

function EraRow({
  index,
  title,
  keyName,
  active,
  last,
}: {
  index: number;
  title: string;
  keyName: string;
  active?: boolean;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-12)",
        height: 48,
        padding: "0 18px 0 16px",
        borderLeft: `2px solid ${active ? ACCENT : "transparent"}`,
        background: active ? ACCENT_SOFT : "transparent",
        borderBottom: last ? "none" : `1px solid ${DIVIDER}`,
      }}
    >
      <span
        style={{
          width: 28,
          flexShrink: 0,
          color: active ? ACCENT : TEXT_GHOST,
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          fontWeight: active ? 500 : 400,
        }}
      >
        {pad2(index)}
      </span>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          flex: 1,
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: active ? FG : TEXT_SECONDARY,
            fontFamily: BODY,
            fontSize: "var(--font-size-md)",
            fontWeight: active ? 500 : 400,
          }}
        >
          {title}
        </span>
        <span
          style={{
            color: TEXT_FADED,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.04em",
          }}
        >
          key: {keyName}
        </span>
      </div>
    </div>
  );
}

/* ── Bound characters card ───────────────────────────────────── */

function BoundCharactersCard({
  bindings,
}: {
  bindings: WikiDetailProps["boundCharacters"];
}) {
  const visible = bindings.slice(0, 4);
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <Card>
        <CardHeader
          label="Bound Characters"
          trailing={`${pad2(bindings.length)} active binding${bindings.length === 1 ? "" : "s"}`}
        />
        {visible.length === 0 ? (
          <EmptyState>No characters bound yet.</EmptyState>
        ) : (
          visible.map((b, i) => (
            <CharacterRow
              key={b.binding.id}
              binding={b.binding}
              character={b.character}
              last={i === visible.length - 1}
            />
          ))
        )}
        <AddRow label="bind a character" hotkey="B" />
      </Card>
    </div>
  );
}

function CharacterRow({
  binding,
  character,
  last,
}: {
  binding: CharacterKnowledgeBindingRecord;
  character: WikiDetailProps["boundCharacters"][number]["character"];
  last?: boolean;
}) {
  const style =
    PRIORITY_STYLE[binding.priority] ?? PRIORITY_STYLE.reference;
  const initials = (character?.title ?? "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const active = binding.priority === "primary";

  const avatarStyle: CSSProperties = {
    width: 36,
    height: 36,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background:
      binding.priority === "primary"
        ? "rgba(140, 231, 210, 0.18)"
        : binding.priority === "secondary"
          ? "rgba(183, 158, 255, 0.16)"
          : "rgba(255, 255, 255, 0.06)",
    color: style.chipText,
    fontFamily: MONO,
    fontSize: "var(--font-size-base)",
    fontWeight: 600,
  };

  const content = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-12)",
        height: 56,
        padding: "0 16px 0 14px",
        borderLeft: `2px solid ${active ? ACCENT : "transparent"}`,
        background: active ? ACCENT_SOFT : "transparent",
        borderBottom: last ? "none" : `1px solid ${DIVIDER}`,
      }}
    >
      <div style={avatarStyle}>{initials}</div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          flex: 1,
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: active ? FG : TEXT_PRIMARY,
            fontFamily: BODY,
            fontSize: "var(--font-size-md)",
            fontWeight: active ? 500 : 400,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {character ? character.title : "(deleted character)"}
        </span>
        <span
          style={{
            color: TEXT_FADED,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {character
            ? `/characters/${character.slug}${binding.isActive ? "" : " · inactive"}`
            : "—"}
        </span>
      </div>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-8)",
          padding: "4px 10px",
          border: `1px solid ${style.chipBorder}`,
          background: style.chipBg,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: style.dot,
          }}
        />
        <span
          style={{
            color: style.chipText,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          {binding.priority}
        </span>
      </span>
    </div>
  );

  if (!character) return content;

  return (
    <Link
      href={`/characters/${character.slug}`}
      style={{ textDecoration: "none", color: "inherit", display: "block" }}
    >
      {content}
    </Link>
  );
}

/* ── Recent ingestion card ───────────────────────────────────── */

function RecentIngestionCard({
  wikiId,
  runs,
}: {
  wikiId: string;
  runs: WikiDetailProps["recentRuns"];
}) {
  return (
    <Card>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-12)",
          padding: "14px 18px",
          borderBottom: `1px solid ${DIVIDER}`,
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
            color: FG,
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            fontWeight: 500,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Recent Ingestion
        </span>
        <span style={{ flex: 1, height: 1, background: DIVIDER }} />
        <span
          style={{
            color: TEXT_FADED,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.06em",
          }}
        >
          {runs.length === 0
            ? "no runs yet"
            : `${runs.length} recent run${runs.length === 1 ? "" : "s"}`}
        </span>
        <Link
          href={`/wikis/${wikiId}/ingestion`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-6)",
            padding: "6px 12px",
            border: `1px solid rgba(255, 255, 255, 0.16)`,
            color: TEXT_PRIMARY,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            textDecoration: "none",
          }}
        >
          OPEN ENGINE ↗
        </Link>
        <Link
          href={`/wikis/${wikiId}/ingestion`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-6)",
            padding: "6px 12px",
            background: ACCENT,
            color: "#050505",
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            textDecoration: "none",
          }}
        >
          ▸ START INGESTION
        </Link>
      </div>

      {runs.length === 0 ? (
        <EmptyState>
          Nothing ingested yet. Start a run from the engine.
        </EmptyState>
      ) : (
        <>
          <RunTableHead />
          {runs.map((run, i) => (
            <RunRow
              key={run.id}
              index={runs.length - i}
              run={run}
              last={i === runs.length - 1}
            />
          ))}
        </>
      )}
    </Card>
  );
}

function RunTableHead() {
  const headStyle: CSSProperties = {
    color: TEXT_FADED,
    fontFamily: MONO,
    fontSize: "var(--font-size-xs)",
    fontWeight: 500,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-12)",
        padding: "8px 18px",
        borderBottom: `1px solid ${DIVIDER}`,
      }}
    >
      <span style={{ ...headStyle, width: 30 }}>#</span>
      <span style={{ ...headStyle, flex: 1.4 }}>STATUS</span>
      <span style={{ ...headStyle, flex: 1.2 }}>MODEL</span>
      <span style={{ ...headStyle, width: 200 }}>METRICS</span>
      <span style={{ ...headStyle, width: 100 }}>DURATION</span>
      <span style={{ ...headStyle, width: 110, textAlign: "right" }}>
        TOKENS
      </span>
    </div>
  );
}

function RunRow({
  index,
  run,
  last,
}: {
  index: number;
  run: WikiDetailProps["recentRuns"][number];
  last?: boolean;
}) {
  const ok = run.status === "succeeded";
  const failed = run.status === "failed";
  const running = run.status === "running";

  const dotColor = failed ? DANGER : ok || running ? ACCENT : TEXT_MUTED;
  const statusLabel = failed
    ? "FAILED"
    : ok
      ? "SUCCEEDED"
      : "RUNNING";
  const statusColor = failed ? DANGER : ok ? FG : ACCENT;
  const borderLeft = failed ? `2px solid ${DANGER}` : "2px solid transparent";
  const rowBg = failed ? DANGER_SOFT : "transparent";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-12)",
        minHeight: 56,
        padding: "8px 18px",
        borderBottom: last ? "none" : `1px solid ${DIVIDER}`,
        borderLeft,
        background: rowBg,
      }}
    >
      <span
        style={{
          width: 30,
          color: TEXT_GHOST,
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
        }}
      >
        {pad2(index)}
      </span>
      <div
        style={{
          flex: 1.4,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-10)",
          minWidth: 0,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: dotColor,
            flexShrink: 0,
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            minWidth: 0,
          }}
        >
          <span
            style={{
              color: statusColor,
              fontFamily: MONO,
              fontSize: "var(--font-size-base)",
              letterSpacing: "0.06em",
            }}
          >
            {statusLabel}
          </span>
          <span
            style={{
              color: TEXT_FADED,
              fontFamily: MONO,
              fontSize: "var(--font-size-xs)",
            }}
          >
            {relative(run.finishedAt ?? run.startedAt)}
          </span>
        </div>
      </div>
      <div
        style={{
          flex: 1.2,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-8)",
          minWidth: 0,
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: SECONDARY,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            color: TEXT_SECONDARY,
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {run.model ?? "unknown"}
        </span>
      </div>
      <div
        style={{
          width: 200,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          color: failed ? DANGER : TEXT_SECONDARY,
        }}
      >
        {failed && run.errorMessage ? (
          <>
            <span
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {run.errorMessage}
            </span>
            <span style={{ color: "rgba(248,113,113,0.55)", fontSize: "var(--font-size-xs)" }}>
              review run
            </span>
          </>
        ) : (
          <>
            <span>
              <span style={{ color: ACCENT }}>+{run.pagesCreated}</span> page
              {run.pagesCreated === 1 ? "" : "s"} ·{" "}
              <span style={{ color: ACCENT }}>+{run.edgesAdded}</span> edge
              {run.edgesAdded === 1 ? "" : "s"}
            </span>
            <span style={{ color: TEXT_FADED, fontSize: "var(--font-size-xs)" }}>
              {run.pagesUpdated > 0
                ? `${run.pagesUpdated} updated`
                : "no updates"}
            </span>
          </>
        )}
      </div>
      <span
        style={{
          width: 100,
          color: TEXT_SECONDARY,
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
        }}
      >
        {runDuration(run.startedAt, run.finishedAt)}
      </span>
      <span
        style={{
          width: 110,
          textAlign: "right",
          color: FG,
          fontFamily: MONO,
          fontSize: "var(--font-size-base)",
        }}
      >
        {formatTokens(run.tokensUsed)}
      </span>
    </div>
  );
}

/* ── Card primitives ─────────────────────────────────────────── */

function Card({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: `1px solid ${BORDER}`,
        background: GROUND,
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
  trailing?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-12)",
        padding: "14px 18px",
        borderBottom: `1px solid ${DIVIDER}`,
      }}
    >
      <span
        style={{
          color: FG,
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          fontWeight: 500,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, height: 1, background: DIVIDER }} />
      {trailing && (
        <span
          style={{
            color: TEXT_GHOST,
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.06em",
          }}
        >
          {trailing}
        </span>
      )}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "32px 20px",
        textAlign: "center",
        color: TEXT_FADED,
        fontFamily: MONO,
        fontSize: "var(--font-size-sm)",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </div>
  );
}

function AddRow({ label, hotkey }: { label: string; hotkey: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-12)",
        height: 44,
        padding: "0 16px 0 14px",
        borderTop: `1px dashed ${DIVIDER}`,
        cursor: "pointer",
      }}
    >
      <span
        style={{
          width: 28,
          flexShrink: 0,
          color: TEXT_FADED,
          fontFamily: MONO,
          fontSize: "var(--font-size-lg)",
          textAlign: "left",
        }}
      >
        +
      </span>
      <span
        style={{
          flex: 1,
          color: TEXT_MUTED,
          fontFamily: BODY,
          fontSize: "var(--font-size-md)",
          fontStyle: "italic",
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: TEXT_GHOST,
          fontFamily: MONO,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.06em",
        }}
      >
        {hotkey}
      </span>
    </div>
  );
}

/* ── Inline-editable fields ──────────────────────────────────── */

function EditableTitle({
  wikiId,
  title,
  onTitleChange,
}: {
  wikiId: string;
  title: string;
  onTitleChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraft(title);
  }, [title]);

  function commit() {
    const next = draft.trim();
    if (!next) {
      setError("Title cannot be empty");
      setDraft(title);
      return;
    }
    if (next === title) {
      setError(null);
      return;
    }
    const previous = title;
    onTitleChange(next);
    startTransition(async () => {
      const res = await updateWikiMeta(wikiId, { title: next });
      if (!res.ok) {
        onTitleChange(previous);
        setDraft(previous);
        setError(res.error);
        return;
      }
      onTitleChange(res.data?.title ?? next);
      setError(null);
    });
  }

  useLayoutEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    }
  }, [draft]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <textarea
        ref={inputRef}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onBlur={() => {
          if (!pending) commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            inputRef.current?.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(title);
            setError(null);
            inputRef.current?.blur();
          }
        }}
        disabled={pending}
        rows={1}
        spellCheck={false}
        style={{
          margin: 0,
          padding: 0,
          width: "100%",
          background: "transparent",
          border: "none",
          outline: "none",
          resize: "none",
          overflow: "hidden",
          fontFamily: DISPLAY,
          fontSize: 44,
          fontWeight: 500,
          lineHeight: "52px",
          letterSpacing: "-0.012em",
          color: FG,
        }}
      />
      {error && (
        <span
          style={{
            color: DANGER,
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.04em",
          }}
        >
          ● {error}
        </span>
      )}
    </div>
  );
}

function EditableSummary({
  wikiId,
  summary,
  onSummaryChange,
}: {
  wikiId: string;
  summary: string | null;
  onSummaryChange: (next: string | null) => void;
}) {
  const [draft, setDraft] = useState(summary ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraft(summary ?? "");
  }, [summary]);

  function commit() {
    const trimmed = draft.trim();
    const next: string | null = trimmed.length === 0 ? null : trimmed;
    if (next === summary) {
      setError(null);
      return;
    }
    const previous = summary;
    onSummaryChange(next);
    startTransition(async () => {
      const res = await updateWikiMeta(wikiId, { summary: next });
      if (!res.ok) {
        onSummaryChange(previous);
        setDraft(previous ?? "");
        setError(res.error);
        return;
      }
      onSummaryChange(res.data?.summary ?? null);
      setError(null);
    });
  }

  useLayoutEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    }
  }, [draft]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        maxWidth: 720,
      }}
    >
      <textarea
        ref={inputRef}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onBlur={() => {
          if (!pending) commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            inputRef.current?.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(summary ?? "");
            setError(null);
            inputRef.current?.blur();
          }
        }}
        disabled={pending}
        placeholder="+ add a description"
        rows={1}
        style={{
          margin: 0,
          padding: 0,
          width: "100%",
          background: "transparent",
          border: "none",
          outline: "none",
          resize: "none",
          overflow: "hidden",
          fontFamily: BODY,
          fontSize: "var(--font-size-lg)",
          lineHeight: "22px",
          color: draft ? TEXT_SECONDARY : TEXT_FADED,
          fontStyle: draft ? "normal" : "italic",
        }}
      />
      {error && (
        <span
          style={{
            color: DANGER,
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            letterSpacing: "0.04em",
          }}
        >
          ● {error}
        </span>
      )}
    </div>
  );
}
