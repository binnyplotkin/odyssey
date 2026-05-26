"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useHeaderContent } from "@/components/header-context";
import { SortMenu } from "@/components/sort-menu";
import { resolveAvatarGradient } from "@/lib/avatar-gradients";
import { DEFAULT_CHAT_MODEL } from "@/lib/model-registry";
import type { CharacterSummary } from "@/app/(authenticated)/characters/page";
import {
  createUnnamedCharacter,
  deleteCharacter,
  resetCharacterData,
} from "@/app/(authenticated)/characters/actions";
import {
  ConfirmModal,
  ContextMenu,
  ContextMenuTriggerButton,
  type ContextMenuItem,
} from "@odyssey/ui";

/* ── Theme tokens ─────────────────────────────────────────────── */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";

/* ── Sort ─────────────────────────────────────────────────────── */

type SortKey = "recent" | "title";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently ingested" },
  { key: "title", label: "Title A–Z" },
];

function applySort(list: CharacterSummary[], sort: SortKey): CharacterSummary[] {
  const base = [...list];
  if (sort === "title") {
    return base.sort((a, b) => a.title.localeCompare(b.title));
  }
  return base.sort((a, b) => {
    const at = a.lastIngestAt ? new Date(a.lastIngestAt).getTime() : 0;
    const bt = b.lastIngestAt ? new Date(b.lastIngestAt).getTime() : 0;
    return bt - at;
  });
}

function initial(c: CharacterSummary): string {
  return (c.title.trim() || c.slug).charAt(0).toUpperCase();
}

/* ── Component ────────────────────────────────────────────────── */

type Props = { characters: CharacterSummary[] };

export function CharactersGrid({ characters }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");

  /* Track the character queued for delete / reset. Modals open when
   * the corresponding state is non-null; we keep the full row in state
   * so the confirmation body can render the title + counts without an
   * extra fetch. Mirrors the voices-grid pattern. */
  const [pendingDelete, setPendingDelete] = useState<CharacterSummary | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [pendingReset, setPendingReset] = useState<CharacterSummary | null>(
    null,
  );
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const onConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await deleteCharacter(pendingDelete.id);
      // deleteCharacter redirects on success — if we get here, it's an error.
      if (!res.ok) throw new Error(res.error);
      setPendingDelete(null);
      router.refresh();
    } catch (err) {
      // Next.js redirect() throws a special signal; surface a friendly message
      // and let the redirect proceed. Real errors fall through.
      const msg = (err as Error).message ?? "";
      if (msg.includes("NEXT_REDIRECT")) {
        setPendingDelete(null);
        return;
      }
      setDeleteError(msg);
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, router]);

  const onConfirmReset = useCallback(async () => {
    if (!pendingReset) return;
    setResetting(true);
    setResetError(null);
    try {
      const res = await resetCharacterData(pendingReset.id);
      if (!res.ok) throw new Error(res.error);
      setPendingReset(null);
      router.refresh();
    } catch (err) {
      setResetError((err as Error).message);
    } finally {
      setResetting(false);
    }
  }, [pendingReset, router]);

  const filtered = useMemo(() => {
    const base = !search.trim()
      ? characters
      : (() => {
          const q = search.trim().toLowerCase();
          return characters.filter(
            (c) =>
              c.title.toLowerCase().includes(q) ||
              c.slug.toLowerCase().includes(q) ||
              (c.summary ?? "").toLowerCase().includes(q),
          );
        })();
    return applySort(base, sort);
  }, [characters, search, sort]);

  /* ── Header injection ───────────────────────────────────────── */

  /* Header reads "CHARACTERS" + actions, matching the voice-library
   * design. The page-level total count is no longer displayed in the
   * shell header — the toolbar's "showing N of M" already speaks for
   * the populated set, and the per-state counts (live/draft) were
   * removed alongside the status pills on the cards. */
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
          CHARACTERS
        </span>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-8)" }}>
          <RefreshButton />
          <CreateCharacterButton />
        </div>
      </div>,
    );
    return () => {
      setContent(null);
      setFlush(false);
    };
  }, [setContent, setFlush]);

  /* ── Empty state ────────────────────────────────────────────── */

  if (characters.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "5rem 2rem",
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
          characters · empty
        </span>
        <h2
          style={{
            fontFamily: FONT_HEAD,
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: 0,
            color: "var(--text-primary)",
          }}
        >
          No characters yet
        </h2>
        <p
          style={{
            fontFamily: FONT_HEAD,
            fontSize: "var(--font-size-lg)",
            lineHeight: "22px",
            color: "var(--text-secondary)",
            margin: 0,
            maxWidth: 480,
            textAlign: "center",
          }}
        >
          A character is a simulated AI persona grounded in source material.
          Create one to open a wiki + ingestion surface.
        </p>
        <CreateCharacterButton size="large" label="+ create your first character" />
      </div>
    );
  }

  /* ── Populated state ────────────────────────────────────────── */

  return (
    <div
      style={{
        minHeight: "100%",
        background: "var(--background)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Toolbar — search + count + sort. 40px horizontal gutters
       * match the voice library so list pages share one rhythm. Page
       * is flush (`setFlush(true)` above) so this padding is the only
       * horizontal indent. */}
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
              background: "var(--input-bg)",
              border: "1px solid var(--input-border)",
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
              placeholder="search characters…"
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
            showing {filtered.length} of {characters.length}
          </span>
        </div>

        <SortMenu options={SORT_OPTIONS} sort={sort} onChange={setSort} />
      </div>

      {/* Grid — auto-fill columns at a 360px minimum track so the
       * grid produces 4 columns at the 1800w design width and reflows
       * down to 1 col on narrow viewports. Matches the voice library
       * exactly. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: "var(--space-16)",
          width: "100%",
          padding: "0 40px 56px",
        }}
      >
        {filtered.map((c) => (
          <CharacterCard
            key={c.id}
            character={c}
            onRequestDelete={() => setPendingDelete(c)}
            onRequestReset={() => setPendingReset(c)}
          />
        ))}
      </div>

      <ConfirmModal
        open={pendingDelete !== null}
        onClose={() => {
          if (!deleting) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        }}
        onConfirm={onConfirmDelete}
        title="Delete character?"
        subtitle="cannot be undone"
        tone="destructive"
        pending={deleting}
        confirmLabel="delete character"
        description={
          pendingDelete ? (
            <>
              You&rsquo;re about to delete{" "}
              <strong style={{ color: "var(--text-primary)" }}>
                {pendingDelete.title}
              </strong>{" "}
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "var(--font-size-sm)",
                  color: "var(--text-tertiary)",
                }}
              >
                /{pendingDelete.slug}
              </span>
              .
            </>
          ) : null
        }
        bullets={
          pendingDelete
            ? [
                <>
                  <strong style={{ color: "var(--text-primary)" }}>
                    {pendingDelete.pageCount} wiki page
                    {pendingDelete.pageCount === 1 ? "" : "s"}
                  </strong>{" "}
                  and their edges will be removed.
                </>,
                <>
                  <strong style={{ color: "var(--text-primary)" }}>
                    {pendingDelete.sourceCount} source
                    {pendingDelete.sourceCount === 1 ? "" : "s"}
                  </strong>{" "}
                  plus every ingestion run will be purged.
                </>,
                <>
                  The slug{" "}
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      color: "var(--text-primary)",
                    }}
                  >
                    {pendingDelete.slug}
                  </span>{" "}
                  becomes available for reuse.
                </>,
              ]
            : []
        }
        hint={
          <>
            Prefer{" "}
            <strong style={{ color: "var(--accent-strong)" }}>Reset data</strong>{" "}
            — wipes wiki content but keeps the character row + slug intact.
          </>
        }
      />

      <ConfirmModal
        open={pendingReset !== null}
        onClose={() => {
          if (!resetting) {
            setPendingReset(null);
            setResetError(null);
          }
        }}
        onConfirm={onConfirmReset}
        title="Reset ingested data?"
        subtitle="character row kept"
        tone="destructive"
        pending={resetting}
        confirmLabel="reset data"
        description={
          pendingReset ? (
            <>
              About to clear every wiki page, edge, source, and ingestion run
              for{" "}
              <strong style={{ color: "var(--text-primary)" }}>
                {pendingReset.title}
              </strong>
              .
            </>
          ) : null
        }
        bullets={
          pendingReset
            ? [
                <>
                  <strong style={{ color: "var(--text-primary)" }}>
                    {pendingReset.pageCount} wiki page
                    {pendingReset.pageCount === 1 ? "" : "s"}
                  </strong>{" "}
                  removed.
                </>,
                <>
                  <strong style={{ color: "var(--text-primary)" }}>
                    {pendingReset.sourceCount} source
                    {pendingReset.sourceCount === 1 ? "" : "s"}
                  </strong>{" "}
                  and all ingestion runs removed.
                </>,
                <>
                  Character row, slug, voice binding, and worlds are kept.
                </>,
              ]
            : []
        }
      />

      {(deleteError || resetError) && (
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
          {deleteError ?? resetError}
        </div>
      )}
    </div>
  );
}

/* ── Card ─────────────────────────────────────────────────────── */

function CharacterCard({
  character,
  onRequestDelete,
  onRequestReset,
}: {
  character: CharacterSummary;
  onRequestDelete: () => void;
  onRequestReset: () => void;
}) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const isLive = character.status === "live";
  const thumbnailBg = character.image
    ? `center/cover no-repeat url("${character.image}"), var(--card-hover)`
    : resolveAvatarGradient(character.thumbnailColor, character.slug);
  const activeModel = character.brainModel?.model ?? DEFAULT_CHAT_MODEL;
  const essence =
    character.identity?.essence ?? character.summary ?? "No essence written.";

  /* Meta line under the title. Slug always shown; era count appended
   * when non-zero so brand-new characters don't read "· 0 eras". */
  const metaParts: string[] = [character.slug];
  if (character.eraCount > 0) {
    metaParts.push(`${character.eraCount} era${character.eraCount === 1 ? "" : "s"}`);
  }

  const items: ContextMenuItem[] = useMemo(
    () => [
      {
        kind: "item",
        id: "open",
        label: "Open",
        icon: <CharIcon name="open" />,
        onSelect: () => router.push(`/characters/${character.slug}`),
      },
      {
        kind: "item",
        id: "wiki",
        label: "Open wiki",
        icon: <CharIcon name="edit" />,
        onSelect: () => router.push(`/characters/${character.slug}/wiki`),
      },
      {
        kind: "item",
        id: "copy-slug",
        label: "Copy slug",
        icon: <CharIcon name="copy" />,
        onSelect: () => {
          void navigator.clipboard?.writeText(character.slug).catch(() => null);
        },
      },
      {
        kind: "item",
        id: "open-tab",
        label: "Open in new tab",
        icon: <CharIcon name="external" />,
        onSelect: () =>
          window.open(
            `/characters/${character.slug}`,
            "_blank",
            "noopener,noreferrer",
          ),
      },
      { kind: "divider", id: "d1" },
      {
        kind: "item",
        id: "reset",
        label: "Reset data",
        icon: <CharIcon name="reset" />,
        tone: "destructive",
        onSelect: onRequestReset,
      },
      { kind: "divider", id: "d2" },
      {
        kind: "item",
        id: "delete",
        label: "Delete",
        icon: <CharIcon name="trash" />,
        shortcut: "⌫",
        tone: "destructive",
        onSelect: onRequestDelete,
      },
    ],
    [router, character.slug, onRequestDelete, onRequestReset],
  );

  return (
    <ContextMenu items={items}>
      <div
        onClick={(e) => {
          // Cmd/Ctrl-click → open in new tab (matches the menu item).
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            window.open(
              `/characters/${character.slug}`,
              "_blank",
              "noopener,noreferrer",
            );
            return;
          }
          router.push(`/characters/${character.slug}`);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        role="link"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") router.push(`/characters/${character.slug}`);
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 280,
          position: "relative",
          padding: "var(--space-18)",
          gap: "var(--space-14)",
          borderRadius: "var(--radius-2xl)",
          background: "var(--card)",
          border: `1px solid ${hovered ? "var(--accent-glow)" : "var(--card-border)"}`,
          textDecoration: "none",
          color: "inherit",
          cursor: "pointer",
          transition: "border-color 120ms ease, background 120ms ease",
        }}
      >
      {/* Top row — portrait + identity. Status pill removed; the
       * portrait's accent-tinted border carries the live/draft cue. */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
        <div
          style={{
            width: 48,
            height: 48,
            flexShrink: 0,
            borderRadius: "var(--radius-lg)",
            background: thumbnailBg,
            border: `1px solid ${isLive ? "color-mix(in srgb, var(--accent-strong) 18%, transparent)" : "var(--card-border)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {!character.image && (
            <span
              style={{
                fontFamily: FONT_HEAD,
                fontSize: "var(--font-size-3xl)",
                fontWeight: 600,
                color: "color-mix(in srgb, white 78%, transparent)",
                lineHeight: 1,
              }}
            >
              {initial(character)}
            </span>
          )}
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
            {character.title}
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
            {metaParts.join(" · ")}
          </span>
        </div>
      </div>

      {/* Essence — 2-line clamp */}
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
        {essence}
      </p>

      {/* Stats panel — rounded inner block, three cells (wikis /
       * pages / worlds). Model moved to the footer badge so each cell
       * has room to breathe. Pages get the typographic emphasis: 14px
       * Inter SemiBold accent for non-zero counts, demoted to mono
       * 11px secondary for zero. */}
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          padding: "var(--space-14)",
          background:
            "var(--ink-wash)",
          border:
            "1px solid var(--ink-soft)",
          borderRadius: "var(--radius-lg)",
        }}
      >
        <StatCell
          label="wikis"
          value={
            character.bindingCount === 0
              ? "none"
              : `${character.bindingCount} bound`
          }
          dim={character.bindingCount === 0}
          first
        />
        <StatCell
          label="pages"
          value={character.pageCount === 0 ? "—" : String(character.pageCount)}
          accent={character.pageCount > 0}
          dim={character.pageCount === 0}
        />
        <StatCell
          label="worlds"
          value={String(character.worldCount)}
          dim={character.worldCount === 0}
          last
        />
      </div>

      {/* Footer — model badge only. Hairline matches the voice card's
       * footer rhythm. `marginTop: auto` keeps the footer pinned to
       * the bottom when neighbor cards in the same grid row push this
       * card taller. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: "var(--space-10)",
          marginTop: "auto",
          borderTop:
            "1px solid var(--ink-soft)",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "2px 8px",
            borderRadius: "var(--radius-sm)",
            border:
              "1px solid var(--ink-line)",
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-2xs)",
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
            whiteSpace: "nowrap",
          }}
          title={`Brain model: ${activeModel}`}
        >
          {activeModel}
        </span>
        <div onClick={(e) => e.stopPropagation()}>
          <ContextMenu
            items={items}
            renderTrigger={({ onClick, open }) => (
              <ContextMenuTriggerButton
                onClick={onClick}
                open={open}
                ariaLabel={`${character.title} actions`}
              />
            )}
          />
        </div>
      </div>
      </div>
    </ContextMenu>
  );
}

/* ── Icons ────────────────────────────────────────────────────── */

function CharIcon({
  name,
}: {
  name: "open" | "edit" | "copy" | "external" | "reset" | "trash";
}) {
  const common = {
    width: 12,
    height: 12,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "open":
      return (
        <svg {...common}>
          <path d="M5 12h14" />
          <path d="M13 5l7 7-7 7" />
        </svg>
      );
    case "edit":
      return (
        <svg {...common}>
          <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11Z" />
          <path d="m14.5 6.5 3 3" />
        </svg>
      );
    case "copy":
      return (
        <svg {...common}>
          <rect x="9" y="9" width="13" height="13" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case "external":
      return (
        <svg {...common}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      );
    case "reset":
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      );
  }
}

/* ── Sub-components ───────────────────────────────────────────── */

/* Single stat cell used in the inner rounded panel. Cells share the
 * row via flex:1 and are separated by thin verticals. `first` cell
 * gets no left padding (it sits flush against the panel's left
 * gutter); `last` cell gets no right border. Middle cells get both
 * left + right padding so dividers land centered between cells. */
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

/* ── Create button ────────────────────────────────────────────── */

function CreateCharacterButton({
  label = "+ character",
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
            const res = await createUnnamedCharacter();
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
          color: "var(--background)",
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

/* ── Refresh button ───────────────────────────────────────────── */

function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <>
      <style>{`@keyframes chars-refresh-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
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
              ? "chars-refresh-spin 800ms linear infinite"
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
