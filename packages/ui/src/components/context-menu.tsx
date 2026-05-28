"use client";

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/* ── Types ──────────────────────────────────────────────────── */

export type ContextMenuItem =
  | {
      kind: "item";
      id: string;
      label: string;
      icon?: ReactNode;
      /** Keyboard hint rendered right-aligned (e.g. "⌘E"). Display-only. */
      shortcut?: string;
      onSelect: () => void;
      tone?: "default" | "destructive";
      disabled?: boolean;
    }
  | { kind: "divider"; id: string };

export type ContextMenuAnchor =
  /** Float at the cursor (used for right-click). */
  | { kind: "point"; x: number; y: number }
  /** Float aligned to a trigger element's bottom-right corner. */
  | { kind: "element"; element: HTMLElement };

export type ContextMenuProps = {
  items: ContextMenuItem[];
  /**
   * The "trigger surface" — anything inside `children` becomes a right-click
   * target that opens the menu at the cursor. If `renderTrigger` is also
   * provided, that gets a ⋮ button you can click to open the menu anchored
   * to it.
   */
  children?: ReactNode;
  /**
   * Optional render-prop for an explicit trigger (e.g. a ⋮ button). The
   * returned element gets `onClick` wired automatically.
   *
   * `renderTrigger` and `children` can coexist — both will open the same
   * menu against different anchors.
   */
  renderTrigger?: (handlers: { onClick: (e: ReactMouseEvent) => void; open: boolean }) => ReactNode;
  /** Optional fixed width override; defaults to 240px. */
  width?: number;
};

/* ── Tokens ─────────────────────────────────────────────────── */

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const VIEWPORT_PADDING = 8;

/* ── Component ──────────────────────────────────────────────── */

export function ContextMenu({
  items,
  children,
  renderTrigger,
  width = 240,
}: ContextMenuProps) {
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  const open = anchor !== null;

  const openAtPoint = useCallback((x: number, y: number) => {
    setAnchor({ kind: "point", x, y });
  }, []);
  const openAtElement = useCallback((el: HTMLElement) => {
    setAnchor({ kind: "element", element: el });
  }, []);
  const close = useCallback(() => setAnchor(null), []);

  const onContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      if (items.length === 0) return;
      e.preventDefault();
      openAtPoint(e.clientX, e.clientY);
    },
    [items.length, openAtPoint],
  );

  const onTriggerClick = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      if (open) {
        close();
        return;
      }
      const target = e.currentTarget as HTMLElement;
      openAtElement(target);
    },
    [open, close, openAtElement],
  );

  return (
    <>
      {children !== undefined && (
        <div onContextMenu={onContextMenu} style={{ display: "contents" }}>
          {children}
        </div>
      )}
      {renderTrigger?.({ onClick: onTriggerClick, open })}
      {open && anchor && (
        <ContextMenuFloatingPanel
          anchor={anchor}
          items={items}
          width={width}
          onClose={close}
        />
      )}
    </>
  );
}

/* ── Three-dot trigger button (optional helper) ─────────────── */

export function ContextMenuTriggerButton({
  onClick,
  open,
  ariaLabel = "Open menu",
}: {
  onClick: (e: ReactMouseEvent) => void;
  open: boolean;
  ariaLabel?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const active = hovered || open;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={ariaLabel}
      aria-haspopup="menu"
      aria-expanded={open}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 999,
        border: `1px solid ${active ? "color-mix(in srgb, var(--accent-strong) 30%, transparent)" : "transparent"}`,
        background: active
          ? "color-mix(in srgb, var(--accent-strong) 14%, transparent)"
          : "transparent",
        color: active ? "var(--accent-strong)" : "var(--text-tertiary)",
        cursor: "pointer",
        transition: "background 120ms, color 120ms, border-color 120ms",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <circle cx="7" cy="2.5" r="1.2" fill="currentColor" />
        <circle cx="7" cy="7" r="1.2" fill="currentColor" />
        <circle cx="7" cy="11.5" r="1.2" fill="currentColor" />
      </svg>
    </button>
  );
}

/* ── Floating panel (portal) ────────────────────────────────── */

function ContextMenuFloatingPanel({
  anchor,
  items,
  width,
  onClose,
}: {
  anchor: ContextMenuAnchor;
  items: ContextMenuItem[];
  width: number;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Selectable items (skip dividers) for keyboard nav.
  const selectable = useMemo(
    () =>
      items
        .map((it, idx) => ({ it, idx }))
        .filter(({ it }) => it.kind === "item" && !it.disabled),
    [items],
  );

  // Active item index inside `selectable` (-1 = nothing focused).
  const [activeIdx, setActiveIdx] = useState(-1);

  /* ── Position ───────────────────────────────────────────── */
  const [pos, setPos] = usePanelPosition(anchor, panelRef);

  /* ── Outside click + Esc + scroll closes ───────────────── */
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % Math.max(selectable.length, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) =>
          i <= 0 ? selectable.length - 1 : i - 1,
        );
      } else if (e.key === "Enter") {
        if (activeIdx >= 0 && activeIdx < selectable.length) {
          const target = selectable[activeIdx].it;
          if (target.kind === "item") {
            e.preventDefault();
            target.onSelect();
            onClose();
          }
        }
      }
    };
    const handleScroll = () => onClose();
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [activeIdx, onClose, selectable]);

  /* ── Focus panel on mount so key events land here ──────── */
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Force the body to ignore the cursor flash for non-button rows.
  void setPos;

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      tabIndex={-1}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width,
        display: "flex",
        flexDirection: "column",
        padding: 6,
        background: "var(--background)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
        zIndex: 1000,
        outline: "none",
        // Subtle opacity-in transition to soften the open.
        opacity: pos.ready ? 1 : 0,
        transition: "opacity 80ms ease",
      }}
    >
      {items.map((item, idx) => {
        if (item.kind === "divider") {
          return (
            <div
              key={item.id}
              role="separator"
              aria-hidden
              style={{
                height: 1,
                background: "var(--border-subtle)",
                margin: "4px 0",
              }}
            />
          );
        }
        const selectableIdx = selectable.findIndex((s) => s.idx === idx);
        const isActive = selectableIdx === activeIdx;
        return (
          <ContextMenuRow
            key={item.id}
            item={item}
            active={isActive}
            onHover={() => setActiveIdx(selectableIdx)}
            onSelect={() => {
              item.onSelect();
              onClose();
            }}
          />
        );
      })}
    </div>,
    document.body,
  );
}

/* ── Row ────────────────────────────────────────────────────── */

function ContextMenuRow({
  item,
  active,
  onHover,
  onSelect,
}: {
  item: Extract<ContextMenuItem, { kind: "item" }>;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  const destructive = item.tone === "destructive";
  const disabled = item.disabled;

  const styles = useMemo<{ bg: string; label: string; icon: string; hint: string }>(() => {
    if (disabled) {
      return {
        bg: "transparent",
        label: "var(--text-quaternary)",
        icon: "var(--text-quaternary)",
        hint: "var(--text-quaternary)",
      };
    }
    if (destructive) {
      return {
        bg: active ? "rgba(232,160,160,0.10)" : "transparent",
        label: "#E8A0A0",
        icon: "#E8A0A0",
        hint: active ? "#E8A0A0" : "rgba(232,160,160,0.55)",
      };
    }
    return {
      bg: active
        ? "color-mix(in srgb, var(--accent-strong) 14%, transparent)"
        : "transparent",
      label: active ? "var(--text-primary)" : "var(--text-secondary)",
      icon: active ? "var(--accent-strong)" : "var(--text-tertiary)",
      hint: active ? "var(--accent-strong)" : "var(--text-quaternary)",
    };
  }, [active, destructive, disabled]);

  return (
    <button
      type="button"
      role="menuitem"
      onMouseEnter={onHover}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onSelect();
      }}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 12px",
        height: 32,
        border: "none",
        borderRadius: 6,
        background: styles.bg,
        color: styles.label,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: FONT_HEAD,
        fontSize: 13,
        textAlign: "left",
        opacity: disabled ? 0.6 : 1,
        transition: "background 80ms ease",
      } satisfies CSSProperties}
    >
      {item.icon !== undefined && (
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 14,
            height: 14,
            flexShrink: 0,
            color: styles.icon,
          }}
        >
          {item.icon}
        </span>
      )}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontWeight: active && !destructive ? 500 : 400,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {item.label}
      </span>
      {item.shortcut && (
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: "0.08em",
            color: styles.hint,
            flexShrink: 0,
          }}
        >
          {item.shortcut}
        </span>
      )}
    </button>
  );
}

/* ── Positioning hook ──────────────────────────────────────── */

type PanelPos = { top: number; left: number; ready: boolean };

function usePanelPosition(
  anchor: ContextMenuAnchor,
  panelRef: RefObject<HTMLDivElement | null>,
): [PanelPos, (next: PanelPos) => void] {
  const [pos, setPos] = useState<PanelPos>({ top: 0, left: 0, ready: false });

  // Measure after mount so we can clamp into the viewport.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = 0;
    let left = 0;
    if (anchor.kind === "point") {
      top = anchor.y + 4;
      left = anchor.x + 2;
    } else {
      const r = anchor.element.getBoundingClientRect();
      top = r.bottom + 4;
      left = r.right - rect.width;
    }

    // Clamp inside viewport with a small padding.
    if (left + rect.width > vw - VIEWPORT_PADDING) {
      left = vw - rect.width - VIEWPORT_PADDING;
    }
    if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;
    if (top + rect.height > vh - VIEWPORT_PADDING) {
      // Flip above the anchor if there's no room below.
      if (anchor.kind === "point") {
        top = Math.max(VIEWPORT_PADDING, anchor.y - rect.height - 4);
      } else {
        const r = anchor.element.getBoundingClientRect();
        top = Math.max(VIEWPORT_PADDING, r.top - rect.height - 4);
      }
    }

    setPos({ top, left, ready: true });
  }, [anchor, panelRef]);

  return [pos, setPos];
}

/* ── Empty no-op to silence unused warnings for keyboard handlers ── */
void (null as unknown as ReactKeyboardEvent);
