"use client";

import { useCallback } from "react";
import type { EraConfig } from "@odyssey/db";

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  border: "var(--border)",
  cardHover: "var(--card-hover)",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
  fontBody: "'Inter', sans-serif",
  fontHeading: "'Space Grotesk', sans-serif",
};

/**
 * Controlled editor for a character's era list. Callers own the state; this
 * component just handles the mechanics of adding / editing / reordering /
 * removing rows. Used by both the New Character form and the Overview tab.
 */

type Props = {
  eras: EraConfig[];
  onChange: (eras: EraConfig[]) => void;
  /** Pass a per-era event count map to surface usage alongside each row. */
  eventCountByEra?: Record<string, number>;
  /** Tight layout (smaller rows) for forms; false = roomy like Overview. */
  dense?: boolean;
};

function slugifyEraKey(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function EraEditor({ eras, onChange, eventCountByEra, dense }: Props) {
  const update = useCallback(
    (idx: number, patch: Partial<EraConfig>) => {
      const next = eras.map((e, i) => (i === idx ? { ...e, ...patch } : e));
      onChange(next);
    },
    [eras, onChange],
  );

  const remove = useCallback(
    (idx: number) => {
      const next = eras.filter((_, i) => i !== idx).map((e, i) => ({ ...e, order: i }));
      onChange(next);
    },
    [eras, onChange],
  );

  const move = useCallback(
    (idx: number, dir: -1 | 1) => {
      const target = idx + dir;
      if (target < 0 || target >= eras.length) return;
      const next = [...eras];
      [next[idx], next[target]] = [next[target], next[idx]];
      onChange(next.map((e, i) => ({ ...e, order: i })));
    },
    [eras, onChange],
  );

  const add = useCallback(() => {
    // Auto-key from a placeholder title; user can rename.
    const i = eras.length;
    const title = `Era ${i + 1}`;
    const baseKey = slugifyEraKey(title);
    let key = baseKey;
    let suffix = 1;
    while (eras.some((e) => e.key === key)) {
      key = `${baseKey}-${++suffix}`;
    }
    onChange([...eras, { key, title, order: eras.length }]);
  }, [eras, onChange]);

  if (eras.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button type="button" onClick={add} style={dashedAdd}>
          + Add first era
        </button>
        <span style={{ fontFamily: T.fontBody, fontSize: 11, color: T.muted, lineHeight: "16px" }}>
          Eras are named periods in the character's life (e.g. <em>pre-covenant / covenant / post-binding</em>). Useful if you want the runtime to time-gate what the character knows. Leave empty for a timeless character.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: dense ? 6 : 10 }}>
      {eras.map((e, i) => {
        const eventCount = eventCountByEra?.[e.key] ?? 0;
        const canUp = i > 0;
        const canDown = i < eras.length - 1;
        return (
          <div
            key={`${e.key}-${i}`}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: dense ? "6px 8px" : "10px 12px",
              borderRadius: 10, border: `1px solid ${T.border}`,
              background: "var(--background)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 1, flexShrink: 0 }}>
              <button
                type="button" onClick={() => move(i, -1)} disabled={!canUp}
                aria-label="Move up"
                style={{
                  ...iconBtn,
                  opacity: canUp ? 0.8 : 0.2,
                  cursor: canUp ? "pointer" : "default",
                }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
              </button>
              <button
                type="button" onClick={() => move(i, 1)} disabled={!canDown}
                aria-label="Move down"
                style={{
                  ...iconBtn,
                  opacity: canDown ? 0.8 : 0.2,
                  cursor: canDown ? "pointer" : "default",
                }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
            </div>

            <span style={{
              width: 22, flexShrink: 0, textAlign: "center",
              fontFamily: T.fontMono, fontSize: 10, color: T.muted,
            }}>
              {i}
            </span>

            <input
              type="text"
              value={e.title}
              onChange={(ev) => update(i, { title: ev.target.value })}
              placeholder="Display title"
              style={{
                ...textInput,
                fontFamily: T.fontHeading, fontWeight: 500,
                flex: "2 1 0", minWidth: 0,
              }}
            />

            <input
              type="text"
              value={e.key}
              onChange={(ev) => update(i, { key: slugifyEraKey(ev.target.value) })}
              placeholder="era-key"
              style={{
                ...textInput,
                fontFamily: T.fontMono, color: "#8CE7D2",
                flex: "1 1 0", minWidth: 0,
              }}
            />

            {eventCount > 0 && (
              <span style={{
                fontFamily: T.fontMono, fontSize: 10, color: T.muted, flexShrink: 0,
                width: 60, textAlign: "right",
              }}>
                {eventCount} event{eventCount === 1 ? "" : "s"}
              </span>
            )}

            <button
              type="button" onClick={() => remove(i)}
              aria-label="Remove era"
              style={{
                ...iconBtn,
                color: "#E89090",
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        );
      })}
      <button type="button" onClick={add} style={dashedAdd}>
        + Add era
      </button>
    </div>
  );
}

const textInput: React.CSSProperties = {
  padding: "5px 8px", borderRadius: 6,
  border: `1px solid ${T.border}`, background: "transparent",
  color: T.fg, outline: "none", fontSize: 12, boxSizing: "border-box",
};

const iconBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center",
  width: 20, height: 20, border: "none", background: "transparent",
  color: "var(--foreground)", cursor: "pointer", padding: 0, borderRadius: 4,
};

const dashedAdd: React.CSSProperties = {
  display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 6,
  padding: "7px 14px", borderRadius: 8,
  border: "1px dashed var(--border)", background: "transparent",
  color: "var(--muted)", fontFamily: T.fontBody, fontSize: 12, cursor: "pointer",
};
