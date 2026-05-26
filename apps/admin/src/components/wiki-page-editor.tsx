"use client";

import { useMemo, useState, useTransition } from "react";
import type {
  Contradiction,
  EraConfig,
  Frontmatter,
  Perspective,
  PerspectiveKnowsHow,
  TimeIndex,
  WikiPageRecord,
  WikiPageType,
} from "@odyssey/db";
import { updateWikiPage } from "@/app/(authenticated)/characters/actions";

/* ── Tokens ────────────────────────────────────────────────────── */

const T = {
  fg: "var(--foreground)",
  muted: "var(--muted)",
  panel: "var(--panel)",
  border: "var(--border)",
  cardHover: "var(--card-hover)",
  accent: "var(--accent-strong)",
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

/* ── Props ─────────────────────────────────────────────────────── */

type Props = {
  characterId: string;
  page: WikiPageRecord;
  eras: EraConfig[];
  onSaved: (slug: string) => void;
  onCancel: () => void;
};

/* ── Component ─────────────────────────────────────────────────── */

export function WikiPageEditor({ characterId, page, eras, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(page.title);
  const [summary, setSummary] = useState(page.summary ?? "");
  const [body, setBody] = useState(page.body);
  const [confidence, setConfidence] = useState(page.confidence);
  const [knowsFuture, setKnowsFuture] = useState(page.knowsFuture);

  const [timeIndex, setTimeIndex] = useState<TimeIndex | null>(page.timeIndex);

  const [perspective, setPerspective] = useState<Perspective>(page.perspective ?? {});

  // Frontmatter edited as raw JSON — covers every page type without needing
  // type-specific form builders for MVP. Invalid JSON is surfaced on save.
  const [frontmatterDraft, setFrontmatterDraft] = useState<string>(() => {
    try {
      return JSON.stringify(page.frontmatter ?? {}, null, 2);
    } catch {
      return "{}";
    }
  });
  const [frontmatterError, setFrontmatterError] = useState<string | null>(null);

  // Contradictions kept read-only in MVP — they're ingestion-managed.
  const contradictions = page.contradictions;

  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Dirty detection — for the unsaved indicator.
  const dirty =
    title !== page.title ||
    summary !== (page.summary ?? "") ||
    body !== page.body ||
    confidence !== page.confidence ||
    knowsFuture !== page.knowsFuture ||
    !timeIndexEq(timeIndex, page.timeIndex) ||
    !perspectiveEq(perspective, page.perspective ?? {}) ||
    frontmatterDraft !== JSON.stringify(page.frontmatter ?? {}, null, 2);

  const sortedEras = useMemo(
    () => [...eras].sort((a, b) => a.order - b.order),
    [eras],
  );

  function handleSave() {
    setError(null);
    setFrontmatterError(null);

    // Parse frontmatter JSON up-front.
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
      const res = await updateWikiPage(characterId, page.id, {
        type: page.type,
        slug: page.slug,
        title,
        summary: summary.trim() || null,
        body,
        frontmatter: parsedFm,
        perspective: {
          ...(perspective.knowsHow ? { knowsHow: perspective.knowsHow } : {}),
          ...(perspective.feels?.length ? { feels: perspective.feels } : {}),
          ...(perspective.stake?.trim() ? { stake: perspective.stake.trim() } : {}),
        },
        confidence,
        timeIndex,
        knowsFuture,
        contradictions: contradictions as Contradiction[],
      });
      if (!res.ok) {
        setError(res.error);
      } else {
        onSaved(res.data?.slug ?? page.slug);
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", maxHeight: "82vh", overflow: "auto" }}>
      {/* Header — type badge + slug + version + Cancel/Save */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "var(--space-10)", padding: "12px 20px",
        borderBottom: `1px solid ${T.border}`, background: "var(--card-hover)",
        flexShrink: 0, position: "sticky", top: 0, zIndex: 2,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)", minWidth: 0 }}>
          <TypeBadge type={page.type} />
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: T.muted, whiteSpace: "nowrap" }}>
            {page.slug}
          </span>
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: T.muted }}>
            v{page.version}
          </span>
          {dirty && (
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--status-draft)" }}>
              unsaved
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "var(--space-8)", flexShrink: 0 }}>
          <button type="button" onClick={onCancel} style={btnGhost} disabled={pending}>
            Cancel
          </button>
          <button
            type="button" onClick={handleSave}
            disabled={pending || !dirty}
            style={{
              ...btnPrimary,
              opacity: pending || !dirty ? 0.5 : 1,
              cursor: pending || !dirty ? "not-allowed" : "pointer",
            }}
          >
            {pending ? "Saving…" : "Save page"}
          </button>
        </div>
      </div>

      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "var(--space-18)" }}>

        {/* Title + summary */}
        <FieldGroup label="Identity">
          <Field label="Title">
            <input
              type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              style={textInput}
            />
          </Field>
          <Field label="Summary" help="1–2 sentence synopsis — what the curator shows when budget is tight.">
            <input
              type="text" value={summary} onChange={(e) => setSummary(e.target.value)}
              placeholder="(no summary)"
              style={textInput}
            />
          </Field>
        </FieldGroup>

        {/* Body */}
        <FieldGroup label="Body" help="Markdown. Use [[slug|Display]] for wikilinks.">
          <textarea
            value={body} onChange={(e) => setBody(e.target.value)}
            rows={14}
            style={{
              ...textInput,
              resize: "vertical",
              minHeight: 240,
              fontFamily: T.fontMono, fontSize: "var(--font-size-base)", lineHeight: "20px",
            }}
          />
        </FieldGroup>

        {/* Time + confidence + knowsFuture */}
        <FieldGroup label="Timeline & confidence">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-12)" }}>
            <Field label="Era">
              {sortedEras.length === 0 ? (
                <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted }}>
                  No eras configured for this character.
                </span>
              ) : (
                <select
                  value={timeIndex?.era ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) setTimeIndex(null);
                    else setTimeIndex({ era: v, index: timeIndex?.index ?? 0 });
                  }}
                  style={textInput}
                >
                  <option value="">(timeless)</option>
                  {sortedEras.map((era) => (
                    <option key={era.key} value={era.key} style={{ background: "var(--background)", color: T.fg }}>
                      {era.title} · {era.key}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Index in era" help="0-based. Events are sorted low → high within an era.">
              <input
                type="number"
                value={timeIndex?.index ?? ""}
                disabled={!timeIndex}
                min={0} max={999}
                onChange={(e) => {
                  if (!timeIndex) return;
                  setTimeIndex({ ...timeIndex, index: Number(e.target.value) || 0 });
                }}
                placeholder="—"
                style={textInput}
              />
            </Field>
          </div>
          <Field label="Knows future" help="True if the character was promised this but hasn't lived it yet.">
            <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-8)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={knowsFuture}
                onChange={(e) => setKnowsFuture(e.target.checked)}
                style={{ accentColor: "var(--accent-strong)" }}
              />
              <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.fg }}>
                {knowsFuture ? "yes — bleeds through the timeline filter" : "no"}
              </span>
            </label>
          </Field>
          <Field label="Confidence" help={`Synthesis certainty. Current: ${confidence.toFixed(2)}.`}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
              <input
                type="range" min={0} max={1} step={0.01}
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
                style={{ flex: 1, accentColor: "var(--accent-strong)" }}
              />
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--accent-strong)", width: 40, textAlign: "right" }}>
                {confidence.toFixed(2)}
              </span>
            </div>
          </Field>
        </FieldGroup>

        {/* Perspective */}
        <FieldGroup label="Perspective" help="The character's relationship to this page.">
          <Field label="Knows how">
            <select
              value={perspective.knowsHow ?? ""}
              onChange={(e) => {
                const v = e.target.value as PerspectiveKnowsHow | "";
                setPerspective({ ...perspective, knowsHow: v || undefined });
              }}
              style={textInput}
            >
              <option value="">(unset)</option>
              <option value="firsthand">firsthand — lived it</option>
              <option value="heard">heard — from others</option>
              <option value="inferred">inferred — from clues</option>
              <option value="unknown">unknown — uncertain</option>
            </select>
          </Field>
          <Field label="Feels" help="Short emotional tags. Comma or Enter to add.">
            <TagInput
              values={perspective.feels ?? []}
              onChange={(feels) => setPerspective({ ...perspective, feels })}
              placeholder="conflicted, reverent…"
              color="var(--status-error)"
            />
          </Field>
          <Field label="Stake" help="One phrase — why does this matter to the character?">
            <input
              type="text"
              value={perspective.stake ?? ""}
              onChange={(e) => setPerspective({ ...perspective, stake: e.target.value })}
              placeholder="(unset)"
              style={textInput}
            />
          </Field>
        </FieldGroup>

        {/* Frontmatter — JSON */}
        <FieldGroup
          label="Frontmatter"
          help={`Type-specific structured fields (${page.type}). Edited as JSON — must stay an object.`}
        >
          <textarea
            value={frontmatterDraft}
            onChange={(e) => { setFrontmatterDraft(e.target.value); setFrontmatterError(null); }}
            rows={10}
            spellCheck={false}
            style={{
              ...textInput,
              resize: "vertical",
              minHeight: 160,
              fontFamily: T.fontMono, fontSize: "var(--font-size-base)", lineHeight: "19px",
              color: frontmatterError ? "var(--status-error)" : T.fg,
            }}
          />
          {frontmatterError && (
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--status-error)" }}>
              {frontmatterError}
            </span>
          )}
        </FieldGroup>

        {/* Read-only side (contradictions, sourceRefs) — reminder they're managed by ingest */}
        {contradictions.length > 0 && (
          <FieldGroup label={`Contradictions · ${contradictions.length}`} help="Managed by ingestion — not editable here.">
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
              {contradictions.map((c, i) => (
                <div key={i} style={{
                  padding: "6px 10px", borderRadius: "var(--radius-md)",
                  background: "var(--critical-wash)",
                  border: "1px solid color-mix(in srgb, var(--status-error) 20%, transparent)",
                }}>
                  <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--status-error)" }}>
                    vs {c.otherPageId.slice(0, 8)}…
                  </span>
                  <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: T.muted, marginLeft: "var(--space-8)" }}>
                    {c.note}
                  </span>
                </div>
              ))}
            </div>
          </FieldGroup>
        )}

        {error && (
          <div style={{
            padding: "10px 14px", borderRadius: "var(--radius-lg)",
            background: "color-mix(in srgb, var(--status-error) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--status-error) 25%, transparent)",
            color: "var(--status-error)", fontFamily: T.fontBody, fontSize: "var(--font-size-md)",
          }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────── */

function TypeBadge({ type }: { type: WikiPageType }) {
  const color = TYPE_COLOR[type];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "var(--space-6)",
      padding: "3px 9px", borderRadius: "var(--radius-button, 12px)",
      background: `color-mix(in srgb, ${color} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      <span style={{
        fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 600, color,
        letterSpacing: "0.06em", textTransform: "uppercase",
      }}>
        {type}
      </span>
    </span>
  );
}

function FieldGroup({
  label, help, children,
}: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-8)" }}>
        <span style={{
          fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", fontWeight: 500, color: T.muted,
          letterSpacing: "0.1em", textTransform: "uppercase",
        }}>
          {label}
        </span>
        {help && (
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color: T.muted, textAlign: "right" }}>
            {help}
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        {children}
      </div>
    </section>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-8)" }}>
        <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", fontWeight: 500, color: T.fg }}>
          {label}
        </span>
        {help && (
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-xs)", color: T.muted }}>{help}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function TagInput({
  values, onChange, placeholder, color,
}: { values: string[]; onChange: (v: string[]) => void; placeholder: string; color: string }) {
  const [draft, setDraft] = useState("");
  function add() {
    const t = draft.trim();
    if (!t) return;
    if (values.includes(t)) { setDraft(""); return; }
    onChange([...values, t]);
    setDraft("");
  }
  function remove(t: string) {
    onChange(values.filter((v) => v !== t));
  }
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-6)",
      padding: "6px 10px", borderRadius: "var(--radius-md)",
      background: "var(--background)", border: `1px solid ${T.border}`,
      minHeight: 36,
    }}>
      {values.map((t) => (
        <span key={t} style={{
          display: "inline-flex", alignItems: "center", gap: "var(--space-5)",
          padding: "2px 7px 2px 9px", borderRadius: "var(--radius-button, 12px)",
          background: `color-mix(in srgb, ${color} 8%, transparent)`,
          border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
          fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", color,
        }}>
          {t}
          <button type="button" onClick={() => remove(t)}
            style={{ border: "none", background: "transparent", color, cursor: "pointer", padding: 0, display: "flex" }}>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </span>
      ))}
      <input
        type="text" value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
          else if (e.key === "Backspace" && !draft && values.length > 0) {
            remove(values[values.length - 1]);
          }
        }}
        onBlur={add}
        placeholder={values.length === 0 ? placeholder : "+ add"}
        style={{
          flex: 1, minWidth: 80, border: "none", outline: "none",
          background: "transparent", color: T.fg,
          fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", padding: "2px 4px",
        }}
      />
    </div>
  );
}

/* ── Utils ─────────────────────────────────────────────────────── */

const TYPE_COLOR: Record<WikiPageType, string> = {
  entity:         "var(--event-violet)",
  event:          "var(--status-draft)",
  concept:        "var(--signal-blue)",
  relationship:   "var(--accent-strong)",
  timeline:       "var(--status-archived)",
  voice_identity: "var(--status-error)",
};

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

/* ── Styles ────────────────────────────────────────────────────── */

const textInput: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: "var(--radius-button, 12px)",
  background: "var(--input-bg)", border: "1px solid var(--input-border)",
  color: T.fg, outline: "none",
  fontFamily: T.fontBody, fontSize: "var(--font-size-base)", boxSizing: "border-box",
};

const btnGhost: React.CSSProperties = {
  padding: "5px 12px", borderRadius: "var(--radius-button, 12px)",
  border: "1px solid var(--input-border)", background: "var(--input-bg)",
  color: T.fg, fontFamily: T.fontBody, fontSize: "var(--font-size-sm)", cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  padding: "6px 14px", borderRadius: "var(--radius-button, 12px)", border: "none",
  background: "var(--emissive-mint)", color: "#07100E",
  fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontWeight: 600, cursor: "pointer",
};
