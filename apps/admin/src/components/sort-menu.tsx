"use client";

import { useEffect, useRef, useState } from "react";

const FONT_HEAD = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const ACCENT = "var(--accent-strong)";

export type SortOption<K extends string> = { key: K; label: string };

type Props<K extends string> = {
  options: ReadonlyArray<SortOption<K>>;
  sort: K;
  onChange: (next: K) => void;
};

/* Shared sort menu used by /voices and /characters. Pill-shaped
 * trigger with a translucent dropdown panel; active option gets the
 * accent-tinted highlight. Behavior — outside-click close, Escape
 * close, focus return — is handled here so page-level components
 * don't reimplement it. */
export function SortMenu<K extends string>({
  options,
  sort,
  onChange,
}: Props<K>) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const current = options.find((o) => o.key === sort) ?? options[0];

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-8)",
          padding: "8px 16px",
          border: "1px solid var(--input-border)",
          borderRadius: "var(--radius-pill)",
          background: "var(--input-bg)",
          color: "var(--text-primary)",
          cursor: "pointer",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-sm)",
          letterSpacing: "0.10em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ color: "var(--text-tertiary)" }}>sort</span>
        <span style={{ color: "var(--text-primary)" }}>{current.label}</span>
        <span
          style={{
            color: "var(--text-tertiary)",
            fontSize: "var(--font-size-2xs)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 120ms",
          }}
        >
          ▾
        </span>
      </button>

      {open && (
        <SortMenuPanel
          options={options}
          sort={sort}
          onChange={onChange}
          setOpen={setOpen}
        />
      )}
    </div>
  );
}

/* Dropdown panel — extracted so the styling stays readable. Matches
 * the toolbar pill language: translucent dark surface + soft
 * white-tinted border + rounded corners + roomy padding. Items get
 * an 8px-radius highlight so the active selection reads as a pill
 * nested inside the panel rather than a flat full-bleed band. */
function SortMenuPanel<K extends string>({
  options,
  sort,
  onChange,
  setOpen,
}: Props<K> & { setOpen: (open: boolean) => void }) {
  return (
    <div
      role="listbox"
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        right: 0,
        minWidth: 240,
        padding: "var(--space-6)",
        /* One solid global token — `--background`. Dark `#07090B` /
         * light `#F5F6F4`. Solid, theme-flipping, no gradients. */
        backgroundColor: "var(--background)",
        backgroundImage: "none",
        border: "1px solid var(--card-border)",
        borderRadius: "var(--radius-2xl)",
        /* Theme-aware shadow — `--shadow` is a soft rgba in light mode
         * and a deep one in dark mode. */
        boxShadow: "0 18px 50px var(--shadow)",
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <div
        style={{
          padding: "8px 10px 4px",
          fontFamily: FONT_MONO,
          fontSize: "var(--font-size-2xs)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        Sort by
      </div>
      {options.map((opt) => (
        <SortMenuOption
          key={opt.key}
          opt={opt}
          active={opt.key === sort}
          onSelect={() => {
            onChange(opt.key);
            setOpen(false);
          }}
        />
      ))}
    </div>
  );
}

function SortMenuOption<K extends string>({
  opt,
  active,
  onSelect,
}: {
  opt: SortOption<K>;
  active: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  // Active wins over hover; otherwise hover is a subtle text-tinted band.
  const background = active
    ? "color-mix(in srgb, var(--accent-strong) 12%, transparent)"
    : hovered
      ? "color-mix(in srgb, var(--text-primary) 5%, transparent)"
      : "transparent";
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        textAlign: "left",
        padding: "9px 12px",
        border: "none",
        borderRadius: "var(--radius-md)",
        background,
        color: active ? ACCENT : "var(--text-primary)",
        fontFamily: FONT_HEAD,
        fontSize: "var(--font-size-md)",
        fontWeight: active ? 500 : 400,
        cursor: "pointer",
        transition: "background 120ms ease, color 120ms ease",
      }}
    >
      <span>{opt.label}</span>
      {active && (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M5 12l5 5L20 7" />
        </svg>
      )}
    </button>
  );
}
