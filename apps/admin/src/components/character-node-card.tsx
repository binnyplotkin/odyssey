"use client";

import type { ReactNode } from "react";
import type { CharacterIdentity } from "@odyssey/db";
import { resolveAvatarGradient } from "@/lib/avatar-gradients";

/**
 * CharacterNodeCard — the canonical 440px character node that sits on the
 * sandbox canvas (and, eventually, on the world editor). Renders the
 * character's identity + traits + essence + three connection slots
 * (Brain / Wikis / Voice) in five canonical states (Paper artboard
 * "Character Node — States"):
 *
 *   ready    · all slots bound, mint accents, baseline
 *   empty    · new character with nothing wired — dashed border, gray
 *              slot icons, "+ connect" CTAs, essence placeholder
 *   selected · canvas selection — mint 1.5px border + soft halo
 *   live     · in-session right now — mint solid border + wide halo +
 *              outer glow, identity slug becomes `● in session`
 *   error    · one slot's binding failed — only the broken slot recolors
 *              coral, identity slug becomes `● <slot> failed`
 *
 * Composition rules so adding new states later stays predictable:
 *   - All state differences are border + box-shadow + targeted recolor
 *     of one element. Layout never changes between states.
 *   - Per-slot error state is self-contained — only the failing slot
 *     turns coral; the others stay mint.
 *   - Empty state is the only one that changes content (CTAs +
 *     placeholder text). Every other state shows the same data.
 */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

/* Brand mint, used for the accent surface throughout the node. Pulled
 * from the brand guidelines (`--active-teal`); we use literal rgba in
 * `color-mix` substrates because the node is canvas-positioned and the
 * `var(--accent-strong)` token reads slightly differently on the dark
 * forest canvas background than against the page surface. */
const MINT_HEX = "#8FD1CB";
const CORAL_HEX = "#FCA5A5";

/* ── Public types ─────────────────────────────────────────────── */

export type CharacterNodeState =
  | "ready"
  | "empty"
  | "selected"
  | "live"
  | { kind: "error"; slot: "brain" | "wikis" | "voice"; message?: string };

/* Slim character shape — accepts any record that has at least these
 * fields. Both `SandboxCharacter` and `CharacterRecord` satisfy this
 * structurally, so the node can be used from the sandbox + the
 * character-config canvas without a casting layer. */
export type CharacterNodeCharacter = {
  slug: string;
  title: string;
  summary?: string | null;
  image?: string | null;
  thumbnailColor?: string | null;
  identity?: CharacterIdentity | null;
};

/* Slim binding shape — any object with at least `id`, `slug`, `title`.
 * The card only reads `title` (and the array length) so callers can
 * pass either `SandboxBinding[]` or `ConfigBinding[]['wiki']` records. */
export type CharacterNodeBinding = {
  id: string;
  slug: string;
  title: string;
};

export type CharacterNodeCardProps = {
  character: CharacterNodeCharacter;
  bindings: CharacterNodeBinding[];
  /** Active brain model id (e.g. "gpt-4o"). Pass the resolved default
   * when `character.brainModel` is null so the slot reads correctly. */
  activeModel: string;
  /** Currently-bound voice slug, or null when no voice is attached. */
  voiceSlug?: string | null;
  /** Provider key for the bound voice (`pocket`, `eleven`, …). Surfaced
   * as the second clause on the voice slot value. */
  voiceProvider?: string | null;
  /** Visual state. Defaults to `ready` for fully-configured characters,
   * `empty` when no brain / no bindings / no voice. Callers should pass
   * `live` while a session is running and the error variant when a
   * binding has failed (e.g. voice extraction returned an error). */
  state?: CharacterNodeState;
  /** Optional click handler — the whole card is interactive. */
  onClick?: () => void;
};

/* ── Component ────────────────────────────────────────────────── */

export function CharacterNodeCard({
  character,
  bindings,
  activeModel,
  voiceSlug = null,
  voiceProvider = null,
  state = "ready",
  onClick,
}: CharacterNodeCardProps) {
  const initial =
    (character.title.trim() || character.slug).charAt(0).toUpperCase() || "?";
  const portraitBg = character.image
    ? `center/cover no-repeat url("${character.image}"), var(--card-hover)`
    : resolveAvatarGradient(character.thumbnailColor, character.slug);
  const essence = character.identity?.essence?.trim() || character.summary || "";

  /* Traits cap at 2 — the rest are surfaced via the persona sidebar.
   * Names are trimmed and capitalized so the visual tags read as labels
   * rather than free-form metadata. */
  const traits = (character.identity?.traits ?? [])
    .map((t) => t.name?.trim())
    .filter((n): n is string => Boolean(n))
    .slice(0, 2);

  const wikiSummary =
    bindings.length === 0
      ? null
      : bindings.length === 1
        ? bindings[0].title
        : `${bindings.length} wikis`;

  const voiceSummary =
    voiceSlug && voiceProvider
      ? `${voiceSlug} · ${voiceProvider}`
      : voiceSlug ?? null;

  /* ── State resolution ─────────────────────────────────────────
   * Derive the visible flags from the union `state` once so the JSX
   * below doesn't repeat type guards. */
  const isError = typeof state === "object" && state.kind === "error";
  const errorSlot = isError ? state.slot : null;
  const isLive = state === "live";
  const isSelected = state === "selected";
  const isEmpty = state === "empty";

  /* Outer chrome — border + box-shadow does all the heavy lifting per
   * state. The card layout itself never changes. */
  const outerBorder = isEmpty
    ? "1.5px dashed var(--ink-line)"
    : isLive
      ? `1.5px solid ${MINT_HEX}`
      : isSelected
        ? `1.5px solid color-mix(in srgb, ${MINT_HEX} 55%, transparent)`
        : isError
          ? `1px solid color-mix(in srgb, ${CORAL_HEX} 45%, transparent)`
          : "1px solid var(--card-border)";

  const outerShadow = isLive
    ? `0 0 0 5px color-mix(in srgb, ${MINT_HEX} 14%, transparent), 0 0 48px color-mix(in srgb, ${MINT_HEX} 18%, transparent)`
    : isSelected
      ? `0 0 0 3px color-mix(in srgb, ${MINT_HEX} 12%, transparent), 0 14px 36px color-mix(in srgb, ${MINT_HEX} 8%, transparent)`
      : "none";

  /* Identity-bar trailing text. Carries either the slug, a session
   * indicator, or an error message depending on state. */
  const trailingText = isLive
    ? "● in session"
    : isError
      ? `● ${state.slot} failed`
      : isEmpty
        ? "draft"
        : character.slug;
  const trailingColor = isLive
    ? MINT_HEX
    : isError
      ? CORAL_HEX
      : "var(--text-tertiary)";

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        width: 440,
        maxWidth: "100%",
        padding: "var(--space-18)",
        gap: "var(--space-14)",
        borderRadius: "var(--radius-2xl)",
        /* Own stacking context — `position: relative` + non-auto
         * `z-index` guarantees the node paints above the site-wide
         * `body::before` grid pattern from ocean.css (which uses
         * `position: fixed` and would otherwise share the auto
         * stacking level). Belt for any environment where the
         * `backgroundColor` below doesn't render as 100% opaque. */
        position: "relative",
        zIndex: 1,
        isolation: "isolate",
        /* `backgroundColor` (longhand) + explicit `backgroundImage:
         * none` so the value resolves as one solid color, never a
         * layered gradient. `--background` is the global page-surface
         * token — solid `#F5F6F4` light / `#07090B` dark — and is the
         * same token the React Flow viewport itself is painted with,
         * so the node merges with the canvas surface and the grid
         * (drawn inside React Flow's background pane at `z-index: -1`)
         * cannot bleed through. Visual separation between node and
         * canvas comes from the border + box-shadow, not surface tone. */
        backgroundColor: "var(--background)",
        backgroundImage: "none",
        border: outerBorder,
        boxShadow: outerShadow,
        cursor: onClick ? "pointer" : "default",
        transition: "border-color 140ms ease, box-shadow 220ms ease",
        boxSizing: "border-box",
      }}
    >
      {/* ── Identity bar ──────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-12)",
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-10)" }}>
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "var(--radius-pill)",
              flexShrink: 0,
              background: isEmpty
                ? "color-mix(in srgb, var(--text-primary) 30%, transparent)"
                : MINT_HEX,
              boxShadow: isEmpty ? "none" : `0 0 8px ${MINT_HEX}`,
            }}
          />
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--text-primary)",
            }}
          >
            CHARACTER
          </span>
        </div>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.04em",
            color: trailingColor,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {trailingText}
        </span>
      </div>

      {/* ── Portrait row ──────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)" }}>
        <div
          style={{
            width: 64,
            height: 64,
            flexShrink: 0,
            borderRadius: "var(--radius-2xl)",
            background: portraitBg,
            border: isEmpty
              ? "1px solid var(--card-border)"
              : `1px solid color-mix(in srgb, ${MINT_HEX} 18%, transparent)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {!character.image && (
            <span
              style={{
                fontFamily: FONT_HEAD,
                fontSize: 26,
                fontWeight: 600,
                color: "color-mix(in srgb, white 82%, transparent)",
                lineHeight: 1,
              }}
            >
              {initial}
            </span>
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-6)",
            flex: 1,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontFamily: FONT_HEAD,
              fontSize: "var(--font-size-3xl)",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              lineHeight: 1.15,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {character.title || "Untitled character"}
          </span>
          {/* Trait tags — hidden in the empty state since brand-new
           * characters have no curated traits yet. Capped at 2 above. */}
          {!isEmpty && traits.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
              {traits.map((trait) => (
                <TraitTag key={trait} label={trait} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Essence ───────────────────────────────────────────── */}
      <p
        style={{
          margin: 0,
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-md)",
          lineHeight: "20px",
          color: isEmpty
            ? "var(--text-quaternary)"
            : "var(--text-secondary)",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
        }}
      >
        {isEmpty
          ? "Describe this character…"
          : essence || "No essence written."}
      </p>

      {/* ── Slots panel ───────────────────────────────────────── */}
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
        <SlotCell
          label="brain"
          value={isEmpty || !activeModel ? null : activeModel}
          icon={<BrainGlyph />}
          first
          empty={isEmpty || !activeModel}
          errored={errorSlot === "brain"}
        />
        <SlotCell
          label="wikis"
          value={isEmpty ? null : wikiSummary}
          icon={<WikisGlyph />}
          empty={isEmpty || !wikiSummary}
          errored={errorSlot === "wikis"}
        />
        <SlotCell
          label="voice"
          value={isEmpty ? null : voiceSummary}
          icon={<VoiceGlyph />}
          last
          empty={isEmpty || !voiceSummary}
          errored={errorSlot === "voice"}
        />
      </div>
    </div>
  );
}

/* ── Visual trait tag ─────────────────────────────────────────── */

function TraitTag({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-8)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "var(--radius-pill)",
          background: MINT_HEX,
          boxShadow: `0 0 8px ${MINT_HEX}`,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-base)",
          fontWeight: 600,
          letterSpacing: "-0.005em",
          color: MINT_HEX,
          textTransform: "capitalize",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </span>
  );
}

/* ── Slot cell ────────────────────────────────────────────────── */

/* One of the three columns in the slots panel. `first` drops the left
 * padding so the column sits flush against the panel's left gutter;
 * `last` drops the right border so the divider doesn't double up against
 * the panel edge. Empty + error states only retint — layout stays
 * identical so the row maintains rhythm across states. */
function SlotCell({
  label,
  value,
  icon,
  first,
  last,
  empty,
  errored,
}: {
  label: string;
  value: string | null;
  icon: ReactNode;
  first?: boolean;
  last?: boolean;
  empty?: boolean;
  errored?: boolean;
}) {
  const accent = errored ? CORAL_HEX : MINT_HEX;
  const iconBg = empty
    ? "color-mix(in srgb, var(--text-primary) 5%, transparent)"
    : `color-mix(in srgb, ${accent} 10%, transparent)`;
  const iconBorder = empty
    ? "color-mix(in srgb, var(--text-primary) 8%, transparent)"
    : `color-mix(in srgb, ${accent} 28%, transparent)`;
  const dotBg = empty
    ? "color-mix(in srgb, var(--text-primary) 20%, transparent)"
    : accent;
  const dotShadow = empty ? "none" : `0 0 6px ${accent}`;
  const valueColor = errored
    ? CORAL_HEX
    : empty
      ? "var(--text-tertiary)"
      : "var(--text-primary)";
  const iconStrokeColor = empty
    ? "color-mix(in srgb, var(--text-primary) 45%, transparent)"
    : accent;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
        flex: 1,
        minWidth: 0,
        paddingLeft: first ? 0 : 14,
        paddingRight: last ? 0 : 14,
        borderRight: last
          ? "none"
          : "1px solid color-mix(in srgb, var(--text-primary) 5%, transparent)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-8)",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            flexShrink: 0,
            borderRadius: "var(--radius-md)",
            background: iconBg,
            border: `1px solid ${iconBorder}`,
            color: iconStrokeColor,
          }}
        >
          {icon}
        </span>
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            flexShrink: 0,
            borderRadius: "var(--radius-pill)",
            background: dotBg,
            boxShadow: dotShadow,
          }}
        />
      </div>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-2xs)",
          fontWeight: 500,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: FONT_HEAD,
          fontSize: "var(--font-size-base)",
          fontWeight: empty ? 400 : 500,
          color: valueColor,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value ?? "+ connect"}
      </span>
    </div>
  );
}

/* ── Slot glyphs ──────────────────────────────────────────────── */

/* Tiny iconography for the slot tiles. SVG uses `currentColor` so the
 * tile's `color` style cascades through — keeps the empty/error retint
 * automatic, no per-glyph variant prop needed. */

function BrainGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M5 2.5a2.5 2.5 0 0 0-2.5 2.5v3.5A2.5 2.5 0 0 0 5 11M9 2.5a2.5 2.5 0 0 1 2.5 2.5v3.5A2.5 2.5 0 0 1 9 11"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M5 6.5h4 M5 9h2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WikisGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M2 3.5A1.5 1.5 0 0 1 3.5 2H7v10H3.5A1.5 1.5 0 0 1 2 10.5V3.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M12 3.5A1.5 1.5 0 0 0 10.5 2H7v10h3.5A1.5 1.5 0 0 0 12 10.5V3.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function VoiceGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="2" y="5" width="1.4" height="4" rx="0.5" fill="currentColor" />
      <rect x="4.5" y="3.5" width="1.4" height="7" rx="0.5" fill="currentColor" />
      <rect x="7" y="2" width="1.4" height="10" rx="0.5" fill="currentColor" />
      <rect x="9.5" y="4.5" width="1.4" height="5" rx="0.5" fill="currentColor" />
    </svg>
  );
}
