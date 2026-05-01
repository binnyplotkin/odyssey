"use client";

/**
 * Multi-select popover for picking wiki entities into a scene. Same visual
 * language as the `Menu` primitive — fixed-position panel, design tokens,
 * keyboard navigation — but for an array selection with a search box.
 *
 * Click a row toggles add/remove without closing. Escape, outside click,
 * resize, and ancestor scroll all close.
 */

import {
  KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  border: "var(--border)",
  background: "var(--background)",
  cardHover: "var(--card-hover)",
  accent: "var(--accent-strong)",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

export type EntityKind = "person" | "place" | "object" | "group";

export type EntityOption = {
  slug: string;
  title: string;
  summary?: string | null;
  /** Soft sub-type from EntityFrontmatter.kind. May be undefined. */
  kind?: EntityKind;
};

type KindFilterValue = "all" | EntityKind;

const KIND_COLORS: Record<EntityKind, string> = {
  person: "#FBA7C0",
  place: "#7AB0E8",
  object: "#FACC15",
  group: "#A88CFF",
};

const KIND_LABELS: Record<EntityKind, string> = {
  person: "People",
  place: "Places",
  object: "Objects",
  group: "Groups",
};

type Props = {
  /** Currently selected entity slugs. */
  active: string[];
  /** Toggle add/remove for a given slug. */
  onToggle: (slug: string) => void;
  /** Full set of entities the user can pick from. */
  entities: EntityOption[];
  /** Trigger button label. Default "+ add". */
  triggerLabel?: string;
  /** Override or extend the trigger's container styles. */
  triggerStyle?: React.CSSProperties;
  /**
   * Lock the popover to entities of this kind only. When set, the kind
   * filter pill row is hidden and only matching entities are listed.
   */
  kindFilter?: EntityKind;
  /** Close the popover after each toggle. Default false (multi-select). */
  closeOnSelect?: boolean;
};

export function EntityPicker({
  active,
  onToggle,
  entities,
  triggerLabel = "+ add",
  triggerStyle,
  kindFilter,
  closeOnSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [kindPill, setKindPill] = useState<KindFilterValue>("all");

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Counts by kind across the full entity set — used in pill labels. Kept
  // independent of search so the user always sees the available totals.
  const kindCounts = useMemo(() => {
    const c = { all: entities.length, person: 0, place: 0, object: 0, group: 0 };
    for (const e of entities) {
      if (e.kind) c[e.kind] += 1;
    }
    return c;
  }, [entities]);

  // The active filter is `kindFilter` if locked, otherwise the pill state.
  const effectiveKind = kindFilter ?? (kindPill === "all" ? null : kindPill);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entities.filter((e) => {
      if (effectiveKind && e.kind !== effectiveKind) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.slug.toLowerCase().includes(q)
      );
    });
  }, [entities, query, effectiveKind]);

  /* ── Position the popover ─────────────────────────────────────── */

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    const width = 320;
    const estHeight = 360;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const placeBelow = spaceBelow >= estHeight || spaceBelow >= spaceAbove;
    const top = placeBelow
      ? rect.bottom + 4
      : Math.max(margin, rect.top - 4 - estHeight);
    let left = rect.left;
    if (left + width > window.innerWidth - margin) {
      left = window.innerWidth - width - margin;
    }
    if (left < margin) left = margin;
    setPos({ top, left, width });
  }, [open]);

  /* ── Reset state on open + focus the search box ───────────────── */

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlightIdx(0);
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  /* ── Outside click / ESC / scroll / resize ────────────────────── */

  useEffect(() => {
    if (!open) return;

    function onMouseDown(e: MouseEvent) {
      const tgt = e.target as Node;
      if (popoverRef.current?.contains(tgt)) return;
      if (triggerRef.current?.contains(tgt)) return;
      setOpen(false);
    }

    function onResize() {
      setOpen(false);
    }
    function onScroll(e: Event) {
      // Ignore scrolls that originate inside the popover (its own list).
      const tgt = e.target as Node | null;
      if (tgt && popoverRef.current?.contains(tgt)) return;
      setOpen(false);
    }

    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  /* ── Keyboard navigation ──────────────────────────────────────── */

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((h) => Math.min(h + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const it = filtered[highlightIdx];
      if (it) {
        onToggle(it.slug);
        if (closeOnSelect) {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
      return;
    }
  }

  function pickRow(slug: string) {
    onToggle(slug);
    if (closeOnSelect) {
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  /* ── Auto-scroll the highlighted row into view ────────────────── */

  useEffect(() => {
    if (!open || !popoverRef.current) return;
    const node = popoverRef.current.querySelector<HTMLElement>(
      `[data-idx="${highlightIdx}"]`,
    );
    if (node) node.scrollIntoView({ block: "nearest" });
  }, [open, highlightIdx]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "2px 6px", borderRadius: 6, border: "none",
          background: "transparent", color: T.muted,
          fontFamily: T.fontBody, fontSize: 11,
          cursor: "pointer", outline: "none",
          ...triggerStyle,
        }}
      >
        {triggerLabel}
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Add entities"
          onKeyDown={onKey}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: pos.width,
            zIndex: 900,
            display: "flex", flexDirection: "column",
            background: T.background,
            borderRadius: 12,
            border: `1px solid ${T.border}`,
            boxShadow: "0 24px 48px -12px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.4)",
            maxHeight: "60vh",
            overflow: "hidden",
          }}
        >
          {/* Search */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 12px", borderBottom: `1px solid ${T.border}`,
            flexShrink: 0,
          }}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
              <circle cx="6" cy="6" r="4.5" stroke={T.muted} strokeWidth="1.5" />
              <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke={T.muted} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlightIdx(0);
              }}
              placeholder="Search entities…"
              style={{
                flex: 1, border: "none", outline: "none", background: "transparent",
                color: T.fg, fontFamily: T.fontBody, fontSize: 12,
              }}
            />
            <span style={{
              fontFamily: T.fontMono, fontSize: 9, color: T.muted,
              letterSpacing: "0.06em", textTransform: "uppercase",
              flexShrink: 0,
            }}>
              {active.length}/{entities.length}
            </span>
          </div>

          {/* Kind filter pills (hidden when locked via prop) */}
          {!kindFilter && (
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 4,
              padding: "8px 10px", borderBottom: `1px solid ${T.border}`,
              flexShrink: 0,
            }}>
              <KindPill
                active={kindPill === "all"}
                color={null}
                label="All"
                count={kindCounts.all}
                onClick={() => { setKindPill("all"); setHighlightIdx(0); }}
              />
              {(["person", "place", "object", "group"] as EntityKind[]).map((k) => (
                <KindPill
                  key={k}
                  active={kindPill === k}
                  color={KIND_COLORS[k]}
                  label={KIND_LABELS[k]}
                  count={kindCounts[k]}
                  onClick={() => { setKindPill(k); setHighlightIdx(0); }}
                />
              ))}
            </div>
          )}

          {/* List */}
          <div style={{ flex: 1, overflowY: "auto", padding: 4 }}>
            {filtered.length === 0 ? (
              <div style={{
                padding: "24px 12px", textAlign: "center",
                fontFamily: T.fontBody, fontSize: 12, color: T.muted,
              }}>
                {entities.length === 0
                  ? "No entities yet — ingest some sources first."
                  : "No entities match."}
              </div>
            ) : (
              filtered.map((e, idx) => {
                const selected = active.includes(e.slug);
                const highlighted = idx === highlightIdx;
                return (
                  <button
                    key={e.slug}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-idx={idx}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    onClick={() => pickRow(e.slug)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      width: "100%", textAlign: "left",
                      padding: "8px 10px", borderRadius: 8, border: "none",
                      background: highlighted ? T.cardHover : "transparent",
                      cursor: "pointer", outline: "none",
                    }}
                  >
                    <Checkbox checked={selected} />
                    <div style={{
                      display: "flex", flexDirection: "column",
                      gap: 2, flex: 1, minWidth: 0,
                    }}>
                      <span style={{
                        fontFamily: T.fontBody, fontSize: 12, fontWeight: 500,
                        color: selected ? T.accent : T.fg,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {e.title}
                      </span>
                      <span style={{
                        fontFamily: T.fontMono, fontSize: 9.5,
                        color: T.muted, letterSpacing: "0.04em",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {e.slug}
                      </span>
                    </div>
                    {e.kind && <KindBadge kind={e.kind} />}
                  </button>
                );
              })
            )}
          </div>

          {/* Hint footer */}
          <div style={{
            padding: "8px 12px", borderTop: `1px solid ${T.border}`,
            fontFamily: T.fontMono, fontSize: 9, color: T.muted,
            letterSpacing: "0.06em", textTransform: "uppercase",
            flexShrink: 0,
          }}>
            ↑↓ navigate · enter toggle · esc close
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function KindPill({
  active, color, label, count, onClick,
}: {
  active: boolean;
  color: string | null;
  label: string;
  count: number;
  onClick: () => void;
}) {
  const tint = color ?? "rgba(255,255,255,0.6)";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "3px 9px", borderRadius: 999,
        border: active
          ? `1px solid ${tint}55`
          : `1px solid ${T.border}`,
        background: active ? `${tint}1F` : "transparent",
        color: active ? tint : T.muted,
        fontFamily: T.fontMono, fontSize: 9.5, fontWeight: 600,
        letterSpacing: "0.06em", textTransform: "uppercase",
        cursor: "pointer", outline: "none",
        opacity: count === 0 ? 0.45 : 1,
      }}
      aria-pressed={active}
    >
      {color && (
        <span aria-hidden style={{
          width: 6, height: 6, borderRadius: "50%", background: color,
        }} />
      )}
      <span>{label}</span>
      <span style={{ opacity: 0.7 }}>{count}</span>
    </button>
  );
}

function KindBadge({ kind }: { kind: EntityKind }) {
  const color = KIND_COLORS[kind];
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center",
        padding: "1px 7px", borderRadius: 4,
        background: `${color}1F`, border: `1px solid ${color}33`,
        color, fontFamily: T.fontMono, fontSize: 9, fontWeight: 600,
        letterSpacing: "0.06em", textTransform: "uppercase",
        flexShrink: 0,
      }}
    >
      {kind}
    </span>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 14, height: 14, borderRadius: 4,
        border: `1px solid ${checked ? T.accent : T.border}`,
        background: checked ? T.accent : "transparent",
        flexShrink: 0,
        transition: "background 100ms, border-color 100ms",
      }}
    >
      {checked && (
        <svg
          width="9" height="9" viewBox="0 0 24 24"
          fill="none" stroke="var(--background)"
          strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </span>
  );
}
