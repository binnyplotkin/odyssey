"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

/**
 * EnumMenu — reusable enum picker for the admin.
 *
 * Closed trigger reuses our input chrome (sharp corners, leading mint dot,
 * trailing chevron). Opening reveals a sharp-cornered popup list of options,
 * each with a configurable dot color. The selected option carries a soft
 * mint fill + trailing ✓; the keyboard / pointer cursor lands on rows via a
 * 2px mint left-border.
 *
 * Keyboard:
 *   Enter / Space / ↓ / ↑   — open (or commit hovered option when open)
 *   ↑ / ↓                   — move highlight while open
 *   Esc                     — close + return focus to the trigger
 *   Tab                     — close (browser moves focus naturally)
 *
 * Dismissal: Esc, click-outside, or selecting a row.
 */

const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";
const ACCENT_LINE = "color-mix(in srgb, var(--accent-strong) 50%, transparent)";
const ACCENT_FILL = "var(--accent-soft)";
const ACCENT_TOP = "color-mix(in srgb, var(--accent-strong) 20%, transparent)";
const HOVER_BG = "var(--card-hover)";

export type EnumMenuOption<K extends string> = {
  value: K;
  label: string;
  /** CSS color for the leading dot. Defaults to the mint accent. */
  dot?: string;
};

export type EnumMenuProps<K extends string> = {
  value: K;
  onChange: (next: K) => void;
  options: EnumMenuOption<K>[];
  ariaLabel?: string;
  disabled?: boolean;
};

export function EnumMenu<K extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  disabled = false,
}: EnumMenuProps<K>) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const reactId = useId();
  const listboxId = `${reactId}-list`;

  const currentIndex = options.findIndex((o) => o.value === value);
  const current = currentIndex === -1 ? options[0] : options[currentIndex];

  // When opening, place the highlight on the currently-selected option so
  // keyboard navigation continues from the user's last commit.
  useEffect(() => {
    if (open) {
      setActiveIndex(currentIndex === -1 ? 0 : currentIndex);
    }
  }, [open, currentIndex]);

  // Close on click-outside. `pointerdown` fires before `click`, so the menu
  // disappears before the underlying element receives the press.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function commit(opt: EnumMenuOption<K>) {
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;

    if (!open) {
      if (
        e.key === "Enter" ||
        e.key === " " ||
        e.key === "ArrowDown" ||
        e.key === "ArrowUp"
      ) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % options.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + options.length) % options.length);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = options[activeIndex];
      if (opt) commit(opt);
      return;
    }
    if (e.key === "Tab") {
      // Let the browser move focus; just close the menu.
      setOpen(false);
    }
  }

  const showAccent = open || focused;

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      style={{ position: "relative", width: "100%" }}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((p) => !p);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={triggerStyle(showAccent, open, disabled)}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <Dot color={current?.dot ?? ACCENT} glow={showAccent} />
          {current?.label ?? value}
        </span>
        <Chevron open={open} accent={showAccent} />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          style={menuStyle()}
        >
          {options.map((opt, i) => {
            const isSelected = opt.value === value;
            const isActive = i === activeIndex;
            return (
              <div
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => commit(opt)}
                style={optionStyle(isSelected, isActive)}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <Dot color={opt.dot ?? ACCENT} />
                  {opt.label}
                </span>
                {isSelected && (
                  <span style={{ fontSize: 12, color: ACCENT }}>✓</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Styles ───────────────────────────────────────────────────── */

function triggerStyle(
  accent: boolean,
  open: boolean,
  disabled: boolean,
): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    padding: "8px 12px",
    border: `1px solid ${accent ? ACCENT_LINE : "var(--border)"}`,
    background: accent ? ACCENT_FILL : "var(--card)",
    color: accent ? "var(--text-primary)" : "var(--text-secondary)",
    fontFamily: FONT_MONO,
    fontSize: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    outline: "none",
    // Bottom border merges with the menu's top, matching the Paper open state.
    borderBottomColor: open
      ? "transparent"
      : accent
        ? ACCENT_LINE
        : "var(--border)",
  };
}

function menuStyle(): CSSProperties {
  return {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    zIndex: 50,
    display: "flex",
    flexDirection: "column",
    border: `1px solid ${ACCENT_LINE}`,
    borderTop: `1px solid ${ACCENT_TOP}`,
    background: "var(--background)",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
  };
}

function optionStyle(isSelected: boolean, isActive: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    paddingLeft: isActive ? 10 : 12,
    borderLeft: isActive ? `2px solid ${ACCENT}` : "2px solid transparent",
    background: isSelected ? ACCENT_FILL : isActive ? HOVER_BG : "transparent",
    color: isSelected
      ? ACCENT
      : isActive
        ? "var(--text-primary)"
        : "var(--text-secondary)",
    fontFamily: FONT_MONO,
    fontSize: 12,
    cursor: "pointer",
  };
}

/* ── Atoms ────────────────────────────────────────────────────── */

function Dot({ color, glow = false }: { color: string; glow?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: 999,
        background: color,
        boxShadow: glow ? `0 0 6px ${color}` : undefined,
        flexShrink: 0,
      }}
    />
  );
}

function Chevron({ open, accent }: { open: boolean; accent: boolean }) {
  return (
    <svg
      width="9"
      height="6"
      viewBox="0 0 9 6"
      fill="none"
      aria-hidden
      style={{
        color: accent ? ACCENT : "var(--text-placeholder)",
        transform: open ? "rotate(180deg)" : "none",
        transition: "transform 120ms ease",
      }}
    >
      <path
        d="M1 1l3.5 3.5L8 1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
