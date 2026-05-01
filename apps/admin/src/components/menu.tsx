"use client";

/**
 * A small single-select dropdown shaped to the project's design system —
 * fixed-position popover, panel + border + drop shadow, mono meta line per
 * item. Use this in place of native `<select>` when you want consistent
 * styling and basic keyboard support across browsers.
 *
 * Keyboard: ArrowDown/Up navigate, Home/End jump, Enter picks, Escape closes,
 * Tab moves focus on. Outside-click and viewport scroll/resize also close.
 */

import {
  CSSProperties,
  ReactNode,
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

export type MenuItem<V extends string> = {
  value: V;
  label: string;
  /** Right-aligned secondary text (e.g. provider name). */
  meta?: string;
  disabled?: boolean;
};

type MenuProps<V extends string> = {
  value: V;
  onChange: (value: V) => void;
  items: MenuItem<V>[];
  /** Required for screen readers. */
  ariaLabel: string;
  /** Override or extend the trigger's container styles. */
  triggerStyle?: CSSProperties;
  /** Custom trigger label renderer (defaults to the matching item's label). */
  renderTrigger?: (current: MenuItem<V> | undefined) => ReactNode;
  /** Show the chevron icon on the trigger. Default true. */
  showChevron?: boolean;
  /** Min width of the popover. Default: matches the trigger's measured width. */
  minWidth?: number;
  /** Which edge of the popover should align with the trigger. Default: left. */
  align?: "left" | "right";
  disabled?: boolean;
};

export function Menu<V extends string>({
  value,
  onChange,
  items,
  ariaLabel,
  triggerStyle,
  renderTrigger,
  showChevron = true,
  minWidth,
  align = "left",
  disabled,
}: MenuProps<V>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const current = useMemo(() => items.find((i) => i.value === value), [items, value]);

  // Highlight follows current selection while open; resets on each open.
  const initialHighlight = useMemo(() => {
    const i = items.findIndex((it) => it.value === value);
    return i >= 0 ? i : items.findIndex((it) => !it.disabled);
  }, [items, value]);
  const [highlightIdx, setHighlightIdx] = useState(initialHighlight);

  useEffect(() => {
    if (open) setHighlightIdx(initialHighlight);
  }, [open, initialHighlight]);

  /* ── Position the popover ─────────────────────────────────────── */

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    const width = Math.max(rect.width, minWidth ?? rect.width);
    // Estimate popover height — refined post-paint, but good enough to decide
    // initial above/below placement without a flash.
    const estHeight = Math.min(items.length * 34 + 8, 320);
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const placeBelow = spaceBelow >= estHeight || spaceBelow >= spaceAbove;
    const top = placeBelow ? rect.bottom + 4 : Math.max(margin, rect.top - 4 - estHeight);

    let left = align === "right" ? rect.right - width : rect.left;
    if (left + width > window.innerWidth - margin) {
      left = window.innerWidth - width - margin;
    }
    if (left < margin) left = margin;
    setPos({ top, left, width });
  }, [open, items.length, minWidth, align]);

  /* ── Outside click / scroll / resize / keyboard ─────────────────── */

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((h) => {
          const dir = e.key === "ArrowDown" ? 1 : -1;
          let next = h;
          for (let step = 0; step < items.length; step += 1) {
            next = (next + dir + items.length) % items.length;
            if (!items[next].disabled) return next;
          }
          return h;
        });
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const it = items[highlightIdx];
        if (it && !it.disabled) {
          onChange(it.value);
          setOpen(false);
          triggerRef.current?.focus();
        }
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        const i = items.findIndex((it) => !it.disabled);
        if (i >= 0) setHighlightIdx(i);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        for (let i = items.length - 1; i >= 0; i -= 1) {
          if (!items[i].disabled) {
            setHighlightIdx(i);
            return;
          }
        }
        return;
      }
      if (e.key === "Tab") {
        // Let Tab move focus naturally — but close so the popover doesn't
        // linger after focus has gone elsewhere.
        setOpen(false);
      }
    }

    function onMouseDown(e: MouseEvent) {
      const tgt = e.target as Node;
      if (listRef.current?.contains(tgt)) return;
      if (triggerRef.current?.contains(tgt)) return;
      setOpen(false);
    }

    function onResize() {
      setOpen(false);
    }
    function onScroll(e: Event) {
      // Ignore scrolls that originate inside the popover (its own list).
      const tgt = e.target as Node | null;
      if (tgt && listRef.current?.contains(tgt)) return;
      setOpen(false);
    }

    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("resize", onResize);
    // capture: catch scroll on any ancestor, not just window
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, items, highlightIdx, onChange]);

  /* ── Auto-scroll the highlighted item into view ───────────────── */

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const node = list.querySelector<HTMLElement>(`[data-idx="${highlightIdx}"]`);
    if (node) node.scrollIntoView({ block: "nearest" });
  }, [open, highlightIdx]);

  function pick(idx: number) {
    const it = items[idx];
    if (!it || it.disabled) return;
    onChange(it.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  const triggerLabel = renderTrigger ? renderTrigger(current) : current?.label ?? value;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 10px", borderRadius: 8,
          border: `1px solid ${T.border}`, background: "transparent",
          color: T.fg, fontFamily: T.fontBody, fontSize: 11, outline: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          ...triggerStyle,
        }}
      >
        {triggerLabel}
        {showChevron && (
          <svg
            width="9"
            height="9"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              opacity: 0.55,
              transition: "transform 120ms",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              flexShrink: 0,
            }}
            aria-hidden
          >
            <polyline points="3 4.5 6 7.5 9 4.5" />
          </svg>
        )}
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            minWidth: pos.width,
            zIndex: 900,
            display: "flex", flexDirection: "column",
            padding: 4,
            background: T.background,
            borderRadius: 12,
            border: `1px solid ${T.border}`,
            boxShadow: "0 24px 48px -12px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.4)",
            maxHeight: "60vh", overflowY: "auto",
          }}
        >
          {items.map((it, idx) => {
            const selected = it.value === value;
            const highlighted = idx === highlightIdx;
            return (
              <button
                key={it.value}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={it.disabled}
                data-idx={idx}
                onMouseEnter={() => setHighlightIdx(idx)}
                onClick={() => pick(idx)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", textAlign: "left",
                  padding: "7px 10px", borderRadius: 8, border: "none",
                  background: highlighted ? T.cardHover : "transparent",
                  color: it.disabled ? T.muted : selected ? T.accent : T.fg,
                  fontFamily: T.fontBody, fontSize: 12,
                  fontWeight: selected ? 600 : 400,
                  cursor: it.disabled ? "not-allowed" : "pointer",
                  gap: 12,
                  outline: "none",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                    flex: "1 1 auto",
                  }}
                >
                  {selected && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  <span
                    style={{
                      paddingLeft: selected ? 0 : 18,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {it.label}
                  </span>
                </span>
                {it.meta && (
                  <span style={{
                    fontFamily: T.fontMono, fontSize: 9, fontWeight: 500,
                    color: T.muted, letterSpacing: "0.06em", textTransform: "uppercase",
                    flexShrink: 0,
                  }}>
                    {it.meta}
                  </span>
                )}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
