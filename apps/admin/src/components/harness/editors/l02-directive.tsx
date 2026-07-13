"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CharacterDirective } from "@odyssey/db";
import { compileDirectiveXml } from "@/lib/character-prompt-builders";
import type { HarnessCharacter } from "../harness-types";
import { AdvisoryStack, type Advisory } from "../shared/advisory";
import { formatRelative } from "../shared/format-relative";

/**
 * L02 Directive editor — Frontier Playbook XML inputs.
 *
 *   - Scope: refuse chip list (free text, add via Enter). Engage chips were
 *     retired — positive topic scope emerges from exemplar tags.
 *   - Exemplars: ordered USER/YOU pairs, max 5
 *   - Never: anti-pattern bullets
 *   - Framing & Guidance: free-form textareas
 *
 * Save flow: builds the directive object client-side, POSTs to
 * /api/characters/:id/directive, fires a `directive:saved` window event so
 * the right-rail preview picks up the new compiled prompt without coupling
 * the panes via props/context.
 */

const T = {
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; at: number }
  | { status: "error"; message: string };

type Props = {
  character: HarnessCharacter;
  /**
   * Which tab the LayerHeader has selected. L02 declares "configure",
   * "exemplars", "never", "history" but only "configure" is implemented
   * today — the editor itself already surfaces exemplars + never inline.
   * Non-configure tabs render a "not yet wired" notice so the strip stops
   * lying. Splitting them out into per-tab surfaces is a follow-up audit.
   */
  activeTab?: string;
};

export function L02Directive({ character, activeTab = "configure" }: Props) {
  if (activeTab === "history") return <L02History character={character} />;
  if (activeTab === "exemplars") return <L02Exemplars character={character} />;
  if (activeTab === "never") return <L02Never character={character} />;
  return <L02Configure character={character} />;
}

function L02Configure({ character }: { character: HarnessCharacter }) {
  const initial = useMemo<DirectiveDraft>(
    () => toDraft(character.directive),
    [character.directive],
  );

  const [refuse, setRefuse] = useState<string[]>(initial.refuse);
  const [exemplars, setExemplars] = useState(initial.exemplars);
  const [never, setNever] = useState<string[]>(initial.never);
  const [framing, setFraming] = useState(initial.framing);
  const [guidance, setGuidance] = useState(initial.guidance);
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  const isDirty = useMemo(() => {
    const current = JSON.stringify({ refuse, exemplars, never, framing, guidance });
    const base = JSON.stringify(initial);
    return current !== base;
  }, [refuse, exemplars, never, framing, guidance, initial]);

  // Authoring advisories — antipatterns common in L02 drafts. Soft
  // warnings, not save-blockers. Each one explains the *why* (citation,
  // mechanism, or risk) so authors learn the model, not just the lint.
  // Severity:
  //   warn — likely behavioural regression / safety risk if shipped
  //   info — best-practice nudge or balance reminder
  // Order intentional below: structural absences first (empty
  // exemplars/never), then per-item phrasing/contradiction checks.
  const advisories = useMemo<Advisory[]>(() => {
    const out: Advisory[] = [];
    const cleanExemplars = exemplars.filter((e) => e.user.trim() && e.you.trim());
    const halfEmptyExemplars = exemplars.filter(
      (e) => (e.user.trim() && !e.you.trim()) || (!e.user.trim() && e.you.trim()),
    );
    const cleanNever = never.filter((r) => r.trim());

    // ── Structural absences (warn) ─────────────────────────
    if (refuse.length === 0) {
      out.push({
        severity: "warn",
        title: "no refuse scope",
        body: "Add refuse entries (modern politics, medical advice, post-canon events) so deflection has explicit anchors — refusal-shaped negative space helps the model hold scope. Positive scope comes from exemplar tags, so refuse chips are the only <scope> input.",
      });
    }

    if (cleanExemplars.length === 0) {
      out.push({
        severity: "warn",
        title: "no exemplars authored",
        body: "Exemplars are the highest-leverage section — show-don't-tell lands harder than any adjective list. Empty exemplars is the biggest single behavioural risk in L02. At minimum, write one identity intro and one deflection.",
      });
    }

    if (cleanNever.length === 0) {
      out.push({
        severity: "warn",
        title: "no never-rules authored",
        body: "Anti-pattern rules ('Do not break character to discuss being an AI', 'Do not issue blessings') are an explicit refusal vocabulary. Without them you depend on the model's general training to hold the line. Add 2-3 hard rules at minimum.",
      });
    }

    // ── Per-item shape checks (warn) ──────────────────────
    if (halfEmptyExemplars.length > 0) {
      out.push({
        severity: "warn",
        title: `${halfEmptyExemplars.length} exemplar${halfEmptyExemplars.length === 1 ? " is" : "s are"} half-empty`,
        body: "Exemplars with one side filled and the other empty are silently dropped at save (the API filters them out). Either complete both sides or remove the row so what you see matches what you ship.",
      });
    }

    // ── Phrasing nudges (info) ────────────────────────────
    // Refuse chips phrased as positive statements ("medical advice")
    // are correct in the refuse list — these compile into
    // <refuse>medical advice</refuse>, which the model reads as a topic
    // to deflect. So this isn't actually wrong — but a refuse chip
    // phrased imperatively ("Do not give medical advice") doubles the
    // negation and lands awkwardly.
    const negatedRefuse = refuse.filter((c) => /^(do not|don't|never|avoid)\s+/i.test(c.trim()));
    if (negatedRefuse.length > 0) {
      out.push({
        severity: "info",
        title: `${negatedRefuse.length} refuse chip${negatedRefuse.length === 1 ? " is" : "s are"} double-negated`,
        body: `The refuse list is already negative by position. A chip like "Do not give medical advice" compiles as <refuse>Do not give medical advice</refuse> — the model reads "don't don't give medical advice". Drop the leading "Do not" / "Never" from these chips: ${negatedRefuse.slice(0, 2).map((c) => `"${c}"`).join(", ")}${negatedRefuse.length > 2 ? ", …" : ""}`,
      });
    }

    // ── Cross-section contradiction (warn) ─────────────────
    // If a never-rule names something an exemplar reply does. Heuristic
    // — pull keywords from each never-rule, check whether any exemplar
    // YOU line matches. False positives possible but the chip explains
    // the check so authors can dismiss when wrong.
    if (cleanExemplars.length > 0 && cleanNever.length > 0) {
      const contradictions: Array<{ rule: string; exemplarIdx: number }> = [];
      for (const rule of cleanNever) {
        const ruleKey = rule
          .toLowerCase()
          .replace(/^do not\s+/, "")
          .split(/\W+/)
          .filter((w) => w.length >= 4)
          .slice(0, 3)
          .join(" ");
        if (!ruleKey) continue;
        cleanExemplars.forEach((ex, i) => {
          const youLower = ex.you.toLowerCase();
          // Match if 2+ of the 3 keywords appear in the YOU reply.
          const keywords = ruleKey.split(" ");
          const hits = keywords.filter((k) => youLower.includes(k)).length;
          if (hits >= 2) {
            contradictions.push({ rule, exemplarIdx: i });
          }
        });
      }
      if (contradictions.length > 0) {
        const first = contradictions[0];
        out.push({
          severity: "warn",
          title: `possible contradiction · exemplar #${first.exemplarIdx + 1} vs never-rule`,
          body: `Exemplar #${first.exemplarIdx + 1}'s reply looks like it does what "Do not ${first.rule.replace(/^do not\s+/i, "")}" forbids. The model would receive contradictory signal. Heuristic check — review and dismiss if false. ${contradictions.length > 1 ? `(${contradictions.length - 1} more possible contradiction${contradictions.length === 2 ? "" : "s"} elsewhere.)` : ""}`,
        });
      }
    }

    // ── Balance / coverage (info) ──────────────────────────
    if (cleanExemplars.length > 0 && cleanExemplars.length < 3) {
      out.push({
        severity: "info",
        title: "thin exemplar coverage",
        body: `You have ${cleanExemplars.length} exemplar${cleanExemplars.length === 1 ? "" : "s"} — typical production directives carry 5-8 covering identity, deflection, edge cases, and at least one safety case (crisis / frame challenge). Add coverage for the categories that matter most for this character.`,
      });
    }

    return out;
  }, [refuse, exemplars, never]);

  // Live preview of the compiled directive XML. Same compiler the chat
  // route uses (packages/engine/src/directive-xml.ts), so what authors
  // see here is byte-identical to what the model receives after save.
  //
  // For L02 specifically the preview matters more than L01: the directive
  // dominates the cached-envelope token budget (~3k for Abraham) and
  // small wording changes (refuse-chip phrasing, exemplar ordering) can
  // shift behavior measurably — authors need to verify the compiled
  // shape before they ship.
  const previewXml = useMemo(() => {
    const draftDirective: CharacterDirective = {};
    if (refuse.length) draftDirective.scope = { refuse };
    const cleanExemplars = exemplars.filter((e) => e.user.trim() && e.you.trim());
    if (cleanExemplars.length) draftDirective.exemplars = cleanExemplars;
    const cleanNever = never.filter(Boolean);
    if (cleanNever.length) draftDirective.never = cleanNever;
    if (framing.trim()) draftDirective.framing = framing.trim();
    if (guidance.trim()) draftDirective.guidance = guidance.trim();

    const xml = compileDirectiveXml(draftDirective);
    // Compiler returns "" when every section is empty. Mirror that
    // explicitly so authors see "no directive will be emitted — the
    // legacy single-paragraph template will be used instead."
    return xml || "(no directive — legacy single-paragraph template will be used)";
  }, [refuse, exemplars, never, framing, guidance]);

  const onSave = useCallback(async () => {
    setSave({ status: "saving" });
    try {
      const directive: CharacterDirective = {};
      if (refuse.length) directive.scope = { refuse };
      const cleanExemplars = exemplars.filter(
        (e) => e.user.trim() && e.you.trim(),
      );
      if (cleanExemplars.length) directive.exemplars = cleanExemplars;
      const cleanNever = never.filter(Boolean);
      if (cleanNever.length) directive.never = cleanNever;
      if (framing.trim()) directive.framing = framing.trim();
      if (guidance.trim()) directive.guidance = guidance.trim();

      const res = await fetch(`/api/characters/${character.id}/directive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directive }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body.slice(0, 200)}`);
      }
      setSave({ status: "saved", at: Date.now() });
      // Cross-pane signal — preview rail listens and refetches the compiled
      // prompt. Avoids dragging a shared store into the harness for one event.
      window.dispatchEvent(new CustomEvent("harness:directive-saved"));
    } catch (err) {
      setSave({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [character.id, refuse, exemplars, never, framing, guidance]);

  return (
    <div
      style={{
        padding: "var(--space-32)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-24)",
        maxWidth: 920,
      }}
    >
      <SaveBar isDirty={isDirty} save={save} onSave={onSave} />

      <DirectiveTemplatesCard
        characterId={character.id}
        onApply={(directive) => {
          // Replace the full draft from the template. Templates are
          // meant to be complete starting points — authors can clear
          // individual sections after if they want a partial seed.
          setRefuse(directive.scope?.refuse ?? []);
          setExemplars(directive.exemplars ?? []);
          setNever(directive.never ?? []);
          setFraming(directive.framing ?? "");
          setGuidance(directive.guidance ?? "");
        }}
      />

      <PromoteCandidatesCard
        characterId={character.id}
        existingExemplars={exemplars}
        onPromote={(input, response) => {
          // Append the promoted exchange as a new exemplar. Append, not
          // prepend, so authors can drag it to the desired position (the
          // L02-6 work). Skip if the user side is already an exemplar
          // input — defensive de-dup; the UI also greys out the button
          // when that's the case.
          setExemplars((list) => {
            if (list.some((e) => e.user.trim() === input.trim())) return list;
            return [...list, { user: input, you: response }];
          });
        }}
      />

      <Card
        accent="phosphor"
        eyebrow="scope · <refuse>"
        title="What this character deflects"
      >
        <p
          style={{
            margin: 0,
            fontFamily: T.fontBody,
            fontSize: 11.5,
            color: "var(--text-tertiary)",
            lineHeight: 1.5,
          }}
        >
          Positive topic scope emerges from exemplar tags — the refuse list is
          the only authored half of <code style={{ fontFamily: T.fontMono }}>{`<scope>`}</code>.
        </p>
        <ChipList
          variant="refuse"
          label="refuse"
          placeholder="Add an out-of-scope request (contemporary politics …)"
          items={refuse}
          onChange={setRefuse}
        />
      </Card>

      <Card
        accent="phosphor"
        eyebrow="exemplars · <example>"
        title="Canonical exchanges"
        action={
          <ExemplarCount count={exemplars.length} />
        }
      >
        <p
          style={{
            margin: 0,
            fontFamily: T.fontBody,
            fontSize: 11.5,
            color: "var(--text-tertiary)",
            lineHeight: 1.5,
          }}
        >
          Order matters — models attend most to the last exemplar (recency bias).
          Drag the index handle on the left to reorder; put the exemplars you want
          the model to weight hardest at the bottom.
        </p>
        <ExemplarList
          exemplars={exemplars}
          onChange={setExemplars}
        />
      </Card>

      <Card
        accent="danger"
        eyebrow="never · <never>"
        title="Hard rules"
      >
        <NeverList items={never} onChange={setNever} />
      </Card>

      <Card
        accent="muted"
        eyebrow="framing · <framing>"
        title="Disclosure framing"
      >
        <TextArea
          value={framing}
          onChange={setFraming}
          placeholder="When pressed on whether you're 'real', acknowledge the frame plainly. e.g. 'This is a dramatized educational portrayal.'"
          rows={3}
        />
      </Card>

      <Card
        accent="muted"
        eyebrow="guidance · <guidance>"
        title="Free-form guidance"
      >
        <TextArea
          value={guidance}
          onChange={setGuidance}
          placeholder="When uncertain, pause. Silence and a follow-up question is more in-character than a confident fabrication."
          rows={3}
        />
      </Card>

      {advisories.length > 0 && <AdvisoryStack advisories={advisories} />}

      <Card
        accent="muted"
        eyebrow="live preview · what the model will see"
        title="Compiled directive block"
        action={
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              padding: "4px 8px",
              borderRadius: "var(--radius-xs)",
              background: "rgba(255,255,255,0.04)",
              color: "var(--text-tertiary)",
              letterSpacing: "0.06em",
            }}
          >
            {previewXml.length} chars
          </span>
        }
      >
        <p
          style={{
            margin: "0 0 8px 0",
            fontFamily: T.fontBody,
            fontSize: 12.5,
            color: "var(--text-tertiary)",
            lineHeight: 1.55,
          }}
        >
          Re-rendered live from the same compiler the chat route uses. The full
          envelope wraps this in <code style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)" }}>{`<scope>`}</code>
          {" / "}<code style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)" }}>{`<exemplars>`}</code> /
          etc. — what you save is what the model receives.
        </p>
        <pre
          style={{
            margin: 0,
            padding: "14px 16px",
            background: "rgba(0,0,0,0.25)",
            border: "1px solid var(--control-border)",
            borderRadius: "var(--radius-sm)",
            fontFamily: T.fontMono,
            fontSize: 11.5,
            lineHeight: 1.6,
            color: "var(--text-secondary)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflow: "auto",
            // L02 is bigger than L01 — give it room. ~600px holds about
            // 30 lines, which is enough for Abraham's ~70-line directive
            // without losing context to scrolling.
            maxHeight: 600,
          }}
        >
          {previewXml}
        </pre>
      </Card>
    </div>
  );
}

/* ── Templates / starter directives ────────────────────────── */

type DirectiveTemplate = {
  id: string;
  label: string;
  description: string;
  signal?: string;
  directive: CharacterDirective;
};

type DirectiveSuggestResponse = {
  templates: DirectiveTemplate[];
};

/**
 * Collapsible "start from a template" surface above the editor. Fetches
 * the suggestion endpoint on first expand (lazy — first-time authors
 * pay nothing on render). Each row shows label / description / a
 * preview of the first exemplar's user line and apply button.
 *
 * Apply REPLACES the draft (not merges) — templates are meant to be
 * complete starting points. The author then tweaks per-section. Same
 * convention as the L01 templates card.
 */
function DirectiveTemplatesCard({
  characterId,
  onApply,
}: {
  characterId: string;
  onApply: (directive: CharacterDirective) => void;
}) {
  const [data, setData] = useState<DirectiveSuggestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/characters/${characterId}/directive/suggest`);
        if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
        const body = (await res.json()) as DirectiveSuggestResponse;
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [open, data, characterId]);

  return (
    <section
      style={{
        padding: "12px 16px 16px",
        background: "var(--material-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.14em",
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
            }}
          >
            start from a template · optional
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
            Pre-vetted archetype directives — scope + exemplars + never-rules + framing + guidance, sized to ship.
            Applying populates the form — review, tweak, then save.
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            padding: "6px 12px",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            background: open ? "rgba(140,231,210,0.1)" : "var(--control-bg)",
            border: `1px solid ${open ? "rgba(140,231,210,0.3)" : "var(--control-border)"}`,
            color: open ? "var(--accent-strong)" : "var(--text-secondary)",
            borderRadius: "var(--radius-xs)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {open ? "hide" : "browse templates"}
        </button>
      </header>

      {open && error && (
        <div
          style={{
            padding: "10px 14px",
            background: "rgba(255,122,155,0.06)",
            border: "1px solid rgba(255,122,155,0.25)",
            borderRadius: "var(--radius-sm)",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: "rgba(255,122,155,0.95)",
          }}
        >
          template fetch failed · {error}
        </div>
      )}

      {open && data === null && !error && (
        <div style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--text-tertiary)" }}>
          loading templates…
        </div>
      )}

      {open && data && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          {data.templates.map((tpl) => (
            <DirectiveTemplateRow key={tpl.id} template={tpl} onApply={onApply} />
          ))}
        </div>
      )}
    </section>
  );
}

function DirectiveTemplateRow({
  template,
  onApply,
}: {
  template: DirectiveTemplate;
  onApply: (directive: CharacterDirective) => void;
}) {
  const firstExemplar = template.directive.exemplars?.[0];
  const counts = {
    refuse: template.directive.scope?.refuse?.length ?? 0,
    exemplars: template.directive.exemplars?.length ?? 0,
    never: template.directive.never?.length ?? 0,
  };

  return (
    <div
      style={{
        padding: "12px 14px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid var(--control-border)",
        borderRadius: "var(--radius-sm)",
        display: "flex",
        gap: "var(--space-12)",
        alignItems: "flex-start",
      }}
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-5)", minWidth: 0 }}>
        <span style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--text-secondary)" }}>
          {template.label}
        </span>
        <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: "var(--text-tertiary)", lineHeight: 1.5 }}>
          {template.description}
        </span>
        {template.signal && (
          <span style={{ fontFamily: T.fontMono, fontSize: 10.5, color: "var(--accent-strong)" }}>
            {template.signal}
          </span>
        )}
        {firstExemplar && (
          <span
            style={{
              fontFamily: T.fontBody,
              fontSize: "var(--font-size-base)",
              fontStyle: "italic",
              color: "var(--text-secondary)",
              lineHeight: 1.55,
              marginTop: "var(--space-2)",
              paddingLeft: "var(--space-10)",
              borderLeft: "2px solid var(--control-border)",
            }}
          >
            “{firstExemplar.user}” → “{firstExemplar.you.slice(0, 120)}{firstExemplar.you.length > 120 ? "…" : ""}”
          </span>
        )}
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--text-quaternary)" }}>
          scope {counts.refuse}↓ · {counts.exemplars} exemplar{counts.exemplars === 1 ? "" : "s"} · {counts.never} never-rule{counts.never === 1 ? "" : "s"}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onApply(template.directive)}
        style={{
          padding: "7px 14px",
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          background: "rgba(140,231,210,0.1)",
          border: "1px solid rgba(140,231,210,0.3)",
          color: "var(--accent-strong)",
          borderRadius: "var(--radius-xs)",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        apply
      </button>
    </div>
  );
}

/* ── Promote-from-eval-results card ────────────────────────── */

type PromoteCandidate = {
  probeId: string;
  probeCategory: string;
  input: string;
  response: string;
  overall: number;
  rationale: string;
  modelId: string | null;
  runId: string;
  startedAt: string;
  runCount: number;
};

/**
 * Surfaces high-scoring eval probe responses as one-click exemplar
 * promotions. Authors press "promote" → the input/response pair becomes
 * a new exemplar at the bottom of the list (where authors can drag it
 * via L02-6 if they want a specific weight).
 *
 * Greys out the button when the input is already an exemplar so the
 * author doesn't accidentally double-add.
 */
function PromoteCandidatesCard({
  characterId,
  existingExemplars,
  onPromote,
}: {
  characterId: string;
  existingExemplars: Array<{ user: string; you: string }>;
  onPromote: (input: string, response: string) => void;
}) {
  const [data, setData] = useState<PromoteCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/characters/${characterId}/directive/promote-candidates`);
        if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
        const body = (await res.json()) as { candidates: PromoteCandidate[] };
        if (!cancelled) setData(body.candidates);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [open, data, characterId]);

  const existingInputs = new Set(existingExemplars.map((e) => e.user.trim()));

  return (
    <section
      style={{
        padding: "12px 16px 16px",
        background: "var(--material-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.14em",
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
            }}
          >
            promote from eval results · battle-tested exchanges
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
            High-scoring (≥4.0) probe responses from this character&apos;s eval
            runs. Already judged in-voice and on-point — promote any to make
            it a canonical exemplar.
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            padding: "6px 12px",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            background: open ? "rgba(140,231,210,0.1)" : "var(--control-bg)",
            border: `1px solid ${open ? "rgba(140,231,210,0.3)" : "var(--control-border)"}`,
            color: open ? "var(--accent-strong)" : "var(--text-secondary)",
            borderRadius: "var(--radius-xs)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {open ? "hide" : "browse candidates"}
        </button>
      </header>

      {open && error && (
        <div
          style={{
            padding: "10px 14px",
            background: "rgba(255,122,155,0.06)",
            border: "1px solid rgba(255,122,155,0.25)",
            borderRadius: "var(--radius-sm)",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: "rgba(255,122,155,0.95)",
          }}
        >
          candidate fetch failed · {error}
        </div>
      )}

      {open && data === null && !error && (
        <div style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--text-tertiary)" }}>
          loading candidates…
        </div>
      )}

      {open && data && data.length === 0 && (
        <div
          style={{
            padding: "12px 14px",
            background: "rgba(255,255,255,0.02)",
            border: "1px dashed var(--control-border)",
            borderRadius: "var(--radius-sm)",
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-base)",
            color: "var(--text-tertiary)",
            fontStyle: "italic",
          }}
        >
          No high-scoring probes found yet. Run a sweep (any of the L04 presets work);
          probe responses that score ≥4.0 will appear here as promotion candidates.
        </div>
      )}

      {open && data && data.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          {data.map((c) => {
            const alreadyExists = existingInputs.has(c.input);
            return (
              <PromoteCandidateRow
                key={`${c.probeId}-${c.runId}`}
                candidate={c}
                alreadyExists={alreadyExists}
                onPromote={() => onPromote(c.input, c.response)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function PromoteCandidateRow({
  candidate,
  alreadyExists,
  onPromote,
}: {
  candidate: PromoteCandidate;
  alreadyExists: boolean;
  onPromote: () => void;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid var(--control-border)",
        borderRadius: "var(--radius-sm)",
        display: "flex",
        gap: "var(--space-12)",
        alignItems: "flex-start",
      }}
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-6)", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-8)", flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 9.5,
              letterSpacing: "0.12em",
              color: "var(--accent-strong)",
              textTransform: "uppercase",
            }}
          >
            {candidate.probeCategory} · {candidate.probeId}
          </span>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 9.5,
              padding: "1px 6px",
              borderRadius: "var(--radius-xs)",
              background: "rgba(140,231,210,0.10)",
              color: "var(--accent-strong)",
              letterSpacing: "0.08em",
            }}
          >
            {candidate.overall.toFixed(1)}/5
          </span>
          {candidate.runCount > 1 && (
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 9.5,
                color: "var(--text-tertiary)",
              }}
            >
              · {candidate.runCount} runs
            </span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.12em",
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
            }}
          >
            user
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            {candidate.input}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.12em",
              color: "rgba(255,184,112,0.95)",
              textTransform: "uppercase",
            }}
          >
            you
          </span>
          <span
            style={{
              fontFamily: T.fontBody,
              fontSize: 12.5,
              fontStyle: "italic",
              color: "var(--text-secondary)",
              lineHeight: 1.55,
            }}
          >
            {candidate.response}
          </span>
        </div>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--text-quaternary)" }}>
          judge · {candidate.rationale.slice(0, 200)}
          {candidate.rationale.length > 200 ? "…" : ""}
        </span>
      </div>
      <button
        type="button"
        onClick={onPromote}
        disabled={alreadyExists}
        title={alreadyExists ? "Already an exemplar — this user line is in the list" : "Add as exemplar"}
        style={{
          padding: "7px 14px",
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          background: alreadyExists ? "transparent" : "rgba(140,231,210,0.1)",
          border: `1px solid ${alreadyExists ? "var(--control-border)" : "rgba(140,231,210,0.3)"}`,
          color: alreadyExists ? "var(--text-quaternary)" : "var(--accent-strong)",
          borderRadius: "var(--radius-xs)",
          cursor: alreadyExists ? "default" : "pointer",
          flexShrink: 0,
        }}
      >
        {alreadyExists ? "added" : "promote"}
      </button>
    </div>
  );
}

/* ── EXEMPLARS tab ─────────────────────────────────────────── */

/**
 * Per-exemplar test-run + diff surface. For each saved exemplar, the
 * author can press "test live" — the editor calls the chat route with
 * the exemplar's user line, streams the response, and diffs it against
 * the canonical YOU reply.
 *
 * The point isn't a perfect match (the canonical exemplar is one of
 * many valid in-voice responses, not the only one). The point is to
 * surface drift: if the live character's reply for an identity probe
 * now ends with a stage-direction or breaks frame, the author sees
 * that here before a sweep catches it.
 *
 * Why not just run an eval? Evals are heavy — judge calls, snapshot
 * captures, persistence. This tab is for the 15-second "did my last
 * directive change break my baseline exemplars" loop.
 */
function L02Exemplars({ character }: { character: HarnessCharacter }) {
  const exemplars = character.directive?.exemplars ?? [];

  if (exemplars.length === 0) {
    return (
      <div style={{ padding: "var(--space-32)", width: "100%" }}>
        <div
          style={{
            padding: "var(--space-24)",
            background: "var(--material-card)",
            border: "1px dashed var(--border-subtle)",
            borderRadius: "var(--radius-md)",
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-md)",
            color: "var(--text-tertiary)",
            lineHeight: 1.55,
          }}
        >
          No exemplars authored yet. Add a few via the CONFIGURE tab (or pull
          high-scoring exchanges from the promote-from-eval-results card) and
          this surface will let you test each one live.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "var(--space-32)", display: "flex", flexDirection: "column", gap: "var(--space-16)", width: "100%" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            color: "var(--text-tertiary)",
            textTransform: "uppercase",
          }}
        >
          per-exemplar test runs · {exemplars.length} exemplar{exemplars.length === 1 ? "" : "s"}
        </span>
        <p style={{ margin: 0, fontFamily: T.fontBody, fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.55 }}>
          Run each canonical exchange against the live character. The reply
          won&apos;t (and shouldn&apos;t) match the exemplar verbatim — that&apos;s the
          point of variance. Use this surface to catch drift: tone breaks,
          frame leaks, scope creep that would slip past a quick chat check.
        </p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
        {exemplars.map((ex, i) => (
          <ExemplarTestRow key={i} index={i} characterId={character.id} exemplar={ex} />
        ))}
      </div>
    </div>
  );
}

function ExemplarTestRow({
  index,
  characterId,
  exemplar,
}: {
  index: number;
  characterId: string;
  exemplar: { user: string; you: string };
}) {
  const [liveResponse, setLiveResponse] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setStatus("running");
    setLiveResponse("");
    setError(null);
    try {
      const res = await fetch(`/api/characters/${characterId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: exemplar.user }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      // Streaming SSE parse. The chat route emits "event: token" + "data: {delta}".
      // Reuse a small buffer-walking parser inline rather than pulling
      // EventSource (which is GET-only).
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // Events are separated by blank lines. Parse complete events from buf.
        for (;;) {
          const sep = buf.indexOf("\n\n");
          if (sep < 0) break;
          const raw = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const lines = raw.split("\n");
          let event = "message";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (event === "token" && data) {
            try {
              const parsed = JSON.parse(data) as { delta: string };
              setLiveResponse((r) => r + parsed.delta);
            } catch {
              // skip malformed delta
            }
          } else if (event === "error" && data) {
            try {
              const parsed = JSON.parse(data) as { message: string };
              throw new Error(parsed.message);
            } catch {
              throw new Error(data);
            }
          }
        }
      }
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [characterId, exemplar.user]);

  return (
    <div
      style={{
        padding: "16px 18px",
        background: "var(--material-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.12em",
            color: "var(--text-tertiary)",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          exemplar · {String(index + 1).padStart(2, "0")}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={run}
          disabled={status === "running"}
          style={{
            padding: "6px 14px",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            background: status === "running" ? "rgba(140,231,210,0.06)" : "rgba(140,231,210,0.14)",
            border: "1px solid rgba(140,231,210,0.4)",
            color: "var(--accent-strong)",
            borderRadius: "var(--radius-xs)",
            cursor: status === "running" ? "default" : "pointer",
          }}
        >
          {status === "running" ? "running…" : status === "done" || status === "error" ? "re-run live" : "test live"}
        </button>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "var(--space-12)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", letterSpacing: "0.12em", color: "var(--accent-strong)", textTransform: "uppercase" }}>
            user
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-md)", color: "var(--text-secondary)", lineHeight: 1.55 }}>
            {exemplar.user}
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-16)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", letterSpacing: "0.12em", color: "rgba(255,184,112,0.95)", textTransform: "uppercase" }}>
            canonical you
          </span>
          <div
            style={{
              padding: "10px 12px",
              background: "rgba(0,0,0,0.18)",
              border: "1px solid var(--control-border)",
              borderRadius: "var(--radius-sm)",
              fontFamily: T.fontBody,
              fontSize: 12.5,
              fontStyle: "italic",
              color: "var(--text-secondary)",
              lineHeight: 1.55,
              minHeight: 60,
            }}
          >
            {exemplar.you}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", letterSpacing: "0.12em", color: "var(--accent-strong)", textTransform: "uppercase" }}>
            live response
            {status === "running" && " · streaming"}
          </span>
          <div
            style={{
              padding: "10px 12px",
              background: status === "idle" ? "transparent" : "rgba(0,0,0,0.18)",
              border: `1px solid ${status === "idle" ? "var(--control-border)" : "rgba(140,231,210,0.2)"}`,
              borderRadius: "var(--radius-sm)",
              fontFamily: T.fontBody,
              fontSize: 12.5,
              color: status === "error" ? "rgba(255,122,155,0.95)" : "var(--text-secondary)",
              lineHeight: 1.55,
              minHeight: 60,
              fontStyle: liveResponse ? "italic" : "normal",
            }}
          >
            {error
              ? `error · ${error}`
              : liveResponse
                ? liveResponse
                : status === "idle"
                  ? <span style={{ color: "var(--text-quaternary)" }}>Press &quot;test live&quot; to run this exemplar through the chat route now.</span>
                  : "(streaming…)"}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── NEVER tab ─────────────────────────────────────────────── */

/**
 * Per-never-rule compliance scan. For each saved never-rule, we walk
 * recent eval probes (using the same data the promote-candidates
 * endpoint pulls — `getRunWithProbes` across the last N runs) and use
 * the same keyword-overlap heuristic as the advisory contradiction
 * check to flag probes whose responses look like they violate the rule.
 *
 * Heuristic, not authoritative. False positives possible. Each flagged
 * probe ships with its rationale and a link to the run so the author
 * can verify and decide.
 *
 * Server-side endpoint does the heavy lifting (`/never-compliance`);
 * this is just the client-side renderer.
 */
type NeverComplianceRule = {
  rule: string;
  // Probes that matched the heuristic. Each one is a suspected violation.
  matches: Array<{
    probeId: string;
    probeCategory: string;
    input: string;
    response: string;
    overall: number;
    runId: string;
    startedAt: string;
  }>;
};

function L02Never({ character }: { character: HarnessCharacter }) {
  const never = character.directive?.never ?? [];
  const [data, setData] = useState<NeverComplianceRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (never.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/characters/${character.id}/directive/never-compliance`);
        if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
        const body = (await res.json()) as { rules: NeverComplianceRule[] };
        if (!cancelled) setData(body.rules);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [character.id, never.length]);

  if (never.length === 0) {
    return (
      <div style={{ padding: "var(--space-32)", width: "100%" }}>
        <div
          style={{
            padding: "var(--space-24)",
            background: "var(--material-card)",
            border: "1px dashed var(--border-subtle)",
            borderRadius: "var(--radius-md)",
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-md)",
            color: "var(--text-tertiary)",
            lineHeight: 1.55,
          }}
        >
          No never-rules authored yet. Add some via the CONFIGURE tab and this
          surface will scan recent eval probes for evidence of violation.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "var(--space-32)", width: "100%", fontFamily: T.fontMono, fontSize: "var(--font-size-base)", color: "rgba(255,122,155,0.9)" }}>
        compliance scan failed · {error}
      </div>
    );
  }
  if (data === null) {
    return (
      <div style={{ padding: "var(--space-32)", width: "100%", fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--text-tertiary)" }}>
        scanning recent probes…
      </div>
    );
  }

  const totalViolations = data.reduce((acc, r) => acc + r.matches.length, 0);

  return (
    <div style={{ padding: "var(--space-32)", display: "flex", flexDirection: "column", gap: "var(--space-16)", width: "100%" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            color: totalViolations > 0 ? "rgba(255,184,112,0.95)" : "var(--text-tertiary)",
            textTransform: "uppercase",
          }}
        >
          never-rule compliance scan · {data.length} rule{data.length === 1 ? "" : "s"} · {totalViolations} possible violation{totalViolations === 1 ? "" : "s"}
        </span>
        <p style={{ margin: 0, fontFamily: T.fontBody, fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.55 }}>
          Heuristic scan over recent eval probes. Each match is a probe whose
          response contains keywords from the rule — review and dismiss if
          false. A truly enforced rule shows zero matches across all runs.
        </p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        {data.map((rule) => (
          <NeverRuleCard key={rule.rule} rule={rule} />
        ))}
      </div>
    </div>
  );
}

function NeverRuleCard({ rule }: { rule: NeverComplianceRule }) {
  const [expanded, setExpanded] = useState(false);
  const violations = rule.matches.length;
  const accent = violations > 0 ? "rgba(255,184,112,0.95)" : "var(--accent-strong)";
  const bg = violations > 0 ? "rgba(255,184,112,0.04)" : "rgba(140,231,210,0.03)";
  const border = violations > 0 ? "rgba(255,184,112,0.18)" : "rgba(140,231,210,0.14)";

  return (
    <div
      style={{
        padding: "14px 18px",
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-10)",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-3)", minWidth: 0 }}>
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", letterSpacing: "0.12em", color: "var(--status-error)", textTransform: "uppercase" }}>
            do not
          </span>
          <span style={{ fontFamily: T.fontBody, fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            {rule.rule.replace(/^do not\s+/i, "")}
          </span>
        </div>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            padding: "5px 10px",
            borderRadius: "var(--radius-xs)",
            background: violations > 0 ? "rgba(255,184,112,0.10)" : "rgba(140,231,210,0.10)",
            border: `1px solid ${violations > 0 ? "rgba(255,184,112,0.3)" : "rgba(140,231,210,0.3)"}`,
            color: accent,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          {violations === 0 ? "clean" : `${violations} match${violations === 1 ? "" : "es"}`}
        </span>
        {violations > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              padding: "5px 10px",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              background: "transparent",
              border: "1px solid var(--control-border)",
              color: "var(--text-tertiary)",
              borderRadius: "var(--radius-xs)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {expanded ? "hide" : "review"}
          </button>
        )}
      </header>

      {expanded && violations > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)", marginTop: "var(--space-4)" }}>
          {rule.matches.map((m) => (
            <div
              key={`${m.probeId}-${m.runId}`}
              style={{
                padding: "10px 12px",
                background: "rgba(0,0,0,0.18)",
                border: "1px solid var(--control-border)",
                borderRadius: "var(--radius-sm)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-6)",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-8)", flexWrap: "wrap" }}>
                <span style={{ fontFamily: T.fontMono, fontSize: 9.5, letterSpacing: "0.12em", color: "var(--accent-strong)", textTransform: "uppercase" }}>
                  {m.probeCategory} · {m.probeId}
                </span>
                <span style={{ fontFamily: T.fontMono, fontSize: 9.5, color: "var(--text-tertiary)" }}>
                  · scored {m.overall.toFixed(1)}/5
                </span>
              </div>
              <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: "var(--text-tertiary)", lineHeight: 1.5 }}>
                <strong style={{ fontFamily: T.fontMono, color: "var(--accent-strong)" }}>user:</strong> {m.input}
              </span>
              <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", fontStyle: "italic", color: "var(--text-secondary)", lineHeight: 1.55 }}>
                <strong style={{ fontFamily: T.fontMono, fontStyle: "normal", color: "rgba(255,184,112,0.95)" }}>you:</strong> {m.response}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── HISTORY tab ───────────────────────────────────────────── */

/**
 * Timeline of distinct directive shapes seen across this character's
 * eval runs. Reconstructed from `eval_runs.characterSnapshot.directive`
 * + a stable hash that ignores irrelevant key-order differences.
 *
 * Same trade-off as L01-4 / L04 HISTORY: directives saved without a
 * subsequent eval run don't show up. Fine for L02 in practice — every
 * directive iteration we've made this session was immediately followed
 * by a sweep.
 *
 * Revert posts the snapshot's directive back through the existing
 * directive API and fires `harness:directive-saved` so the right rail +
 * CONFIGURE tab re-render against the rolled-back state.
 */
type DirectiveHistoryEntry = {
  directiveHash: string;
  directive: CharacterDirective | null;
  firstSeenAt: string;
  lastSeenAt: string;
  runCount: number;
  isCurrent: boolean;
};

function L02History({ character }: { character: HarnessCharacter }) {
  const [data, setData] = useState<DirectiveHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revertingHash, setRevertingHash] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${character.id}/directive/history`);
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { entries: DirectiveHistoryEntry[] };
      setData(body.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [character.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await reload();
    })();
    return () => { cancelled = true; };
  }, [reload]);

  const revert = useCallback(async (entry: DirectiveHistoryEntry) => {
    setRevertingHash(entry.directiveHash);
    setError(null);
    try {
      const res = await fetch(`/api/characters/${character.id}/directive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directive: entry.directive }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      window.dispatchEvent(new CustomEvent("harness:directive-saved"));
      window.dispatchEvent(new CustomEvent("harness:character-changed"));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevertingHash(null);
    }
  }, [character.id, reload]);

  if (error) {
    return (
      <div style={{ padding: "var(--space-32)", width: "100%", fontFamily: T.fontMono, fontSize: "var(--font-size-base)", color: "rgba(255,122,155,0.9)" }}>
        history query failed · {error}
      </div>
    );
  }
  if (data === null) {
    return (
      <div style={{ padding: "var(--space-32)", width: "100%", fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--text-tertiary)" }}>
        loading history…
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div style={{ padding: "var(--space-32)", width: "100%" }}>
        <div
          style={{
            padding: "var(--space-24)",
            background: "var(--material-card)",
            border: "1px dashed var(--border-subtle)",
            borderRadius: "var(--radius-md)",
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-md)",
            color: "var(--text-tertiary)",
            lineHeight: 1.55,
          }}
        >
          No directive snapshots recorded yet. History reconstructs from eval
          runs — once you run a sweep, each distinct L02 directive that was used
          appears here as a revertable checkpoint.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "var(--space-32)", display: "flex", flexDirection: "column", gap: "var(--space-16)", width: "100%" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            color: "var(--text-tertiary)",
            textTransform: "uppercase",
          }}
        >
          directive timeline · {data.length} distinct snapshot{data.length === 1 ? "" : "s"}
        </span>
        <p style={{ margin: 0, fontFamily: T.fontBody, fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.55 }}>
          Reconstructed from eval runs against this character. Directive edits
          made without running an eval aren&apos;t captured here — to get a clean
          checkpoint, save and run any eval. Revert rewrites the saved directive
          to the picked snapshot.
        </p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        {data.map((entry) => {
          const isReverting = revertingHash === entry.directiveHash;
          return (
            <div
              key={entry.directiveHash}
              style={{
                padding: "14px 18px",
                background: entry.isCurrent ? "rgba(140,231,210,0.04)" : "var(--material-card)",
                border: `1px solid ${entry.isCurrent ? "rgba(140,231,210,0.25)" : "var(--border-subtle)"}`,
                borderRadius: "var(--radius-md)",
                display: "flex",
                gap: "var(--space-16)",
                alignItems: "flex-start",
              }}
            >
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-6)", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-8)", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--foreground)" }}>
                    {summarizeDirective(entry.directive)}
                  </span>
                  {entry.isCurrent && (
                    <span
                      style={{
                        fontFamily: T.fontMono,
                        fontSize: "var(--font-size-2xs)",
                        padding: "1px 6px",
                        borderRadius: "var(--radius-xs)",
                        background: "rgba(140,231,210,0.12)",
                        color: "var(--accent-strong)",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      current
                    </span>
                  )}
                </div>
                <span style={{ fontFamily: T.fontMono, fontSize: 10.5, color: "var(--text-tertiary)" }}>
                  {entry.runCount} run{entry.runCount === 1 ? "" : "s"} · first {formatRelative(entry.firstSeenAt)} · last {formatRelative(entry.lastSeenAt)}
                </span>
                <span style={{ fontFamily: T.fontMono, fontSize: 9.5, color: "var(--text-quaternary)" }}>
                  hash {entry.directiveHash}
                </span>
              </div>
              <button
                type="button"
                onClick={() => !entry.isCurrent && !isReverting && revert(entry)}
                disabled={entry.isCurrent || isReverting}
                style={{
                  padding: "7px 14px",
                  fontFamily: T.fontMono,
                  fontSize: "var(--font-size-xs)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  background: entry.isCurrent ? "transparent" : "rgba(255,184,112,0.08)",
                  border: `1px solid ${entry.isCurrent ? "var(--control-border)" : "rgba(255,184,112,0.3)"}`,
                  color: entry.isCurrent ? "var(--text-quaternary)" : "rgba(255,184,112,0.95)",
                  borderRadius: "var(--radius-xs)",
                  cursor: entry.isCurrent || isReverting ? "default" : "pointer",
                  flexShrink: 0,
                }}
              >
                {entry.isCurrent ? "current" : isReverting ? "reverting…" : "revert"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Headline summary for a directive snapshot in the HISTORY card title.
 * Composition matters: directives can be huge (3k+ tokens) but the
 * scannable shape is a few numbers — exemplar count, never-rule count,
 * scope size. That's what an author wants to see when comparing.
 */
function summarizeDirective(d: CharacterDirective | null): string {
  if (!d) return "(unset — legacy single-paragraph template)";
  const bits: string[] = [];
  const refuse = d.scope?.refuse?.length ?? 0;
  if (refuse) bits.push(`scope ${refuse}↓`);
  const ex = d.exemplars?.length ?? 0;
  if (ex) bits.push(`${ex} exemplar${ex === 1 ? "" : "s"}`);
  const never = d.never?.length ?? 0;
  if (never) bits.push(`${never} never-rule${never === 1 ? "" : "s"}`);
  if (d.framing?.trim()) bits.push("framing");
  if (d.guidance?.trim()) bits.push("guidance");
  return bits.length > 0 ? bits.join(" · ") : "(empty directive)";
}

/* ── Draft conversion ──────────────────────────────────────── */

type DirectiveDraft = {
  refuse: string[];
  exemplars: Array<{ user: string; you: string }>;
  never: string[];
  framing: string;
  guidance: string;
};

function toDraft(directive: CharacterDirective | null): DirectiveDraft {
  return {
    refuse: directive?.scope?.refuse ?? [],
    exemplars: directive?.exemplars ?? [],
    never: directive?.never ?? [],
    framing: directive?.framing ?? "",
    guidance: directive?.guidance ?? "",
  };
}

/* ── Save bar ──────────────────────────────────────────────── */

function SaveBar({
  isDirty,
  save,
  onSave,
}: {
  isDirty: boolean;
  save: SaveState;
  onSave: () => void;
}) {
  let statusEl: React.ReactNode = null;
  if (save.status === "saving") {
    statusEl = <Status tone="muted">saving…</Status>;
  } else if (save.status === "saved") {
    statusEl = <Status tone="accent">saved · preview refreshed</Status>;
  } else if (save.status === "error") {
    statusEl = <Status tone="danger">save failed · {save.message}</Status>;
  } else if (isDirty) {
    statusEl = <Status tone="amber">unsaved changes</Status>;
  } else {
    statusEl = <Status tone="muted">in sync with compiled prompt</Status>;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-14)",
        padding: "12px 16px",
        background: "var(--material-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.14em",
          color: "var(--text-tertiary)",
          textTransform: "uppercase",
        }}
      >
        L02 · directive
      </span>
      <div style={{ flex: 1 }}>{statusEl}</div>
      <button
        type="button"
        onClick={onSave}
        disabled={!isDirty || save.status === "saving"}
        style={{
          padding: "7px 16px",
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          background: isDirty ? "rgba(140,231,210,0.14)" : "var(--control-bg)",
          border: `1px solid ${isDirty ? "rgba(140,231,210,0.4)" : "var(--control-border)"}`,
          color: isDirty ? "var(--accent-strong)" : "var(--text-tertiary)",
          borderRadius: "var(--radius-xs)",
          cursor: isDirty && save.status !== "saving" ? "pointer" : "default",
        }}
      >
        save directive
      </button>
    </div>
  );
}

function Status({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "accent" | "amber" | "danger" | "muted";
}) {
  const colorMap = {
    accent: "var(--accent-strong)",
    amber: "rgba(255,184,112,0.95)",
    danger: "var(--status-error)",
    muted: "var(--text-tertiary)",
  };
  return (
    <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: colorMap[tone] }}>
      {children}
    </span>
  );
}

/* ── Card ──────────────────────────────────────────────────── */

function Card({
  accent,
  eyebrow,
  title,
  action,
  children,
}: {
  accent: "phosphor" | "danger" | "muted";
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const borderMap = {
    phosphor: "rgba(140,231,210,0.18)",
    danger: "rgba(248,113,113,0.20)",
    muted: "var(--border-subtle)",
  };
  const eyebrowMap = {
    phosphor: "var(--accent-strong)",
    danger: "rgba(248,113,113,0.85)",
    muted: "var(--text-tertiary)",
  };
  return (
    <section
      style={{
        padding: "var(--space-24)",
        background: "var(--material-card)",
        border: `1px solid ${borderMap[accent]}`,
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-16)",
      }}
    >
      <header style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-16)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", flex: 1 }}>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.14em",
              color: eyebrowMap[accent],
              textTransform: "uppercase",
            }}
          >
            {eyebrow}
          </span>
          <span
            style={{
              fontFamily: T.fontHeading,
              fontSize: "var(--font-size-2xl)",
              fontWeight: 600,
              color: "var(--foreground)",
            }}
          >
            {title}
          </span>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/* ── Chip list (refuse) ────────────────────────────────────── */

function ChipList({
  label,
  placeholder,
  items,
  onChange,
}: {
  /** Kept for call-site readability; only the refuse variant exists now. */
  variant: "refuse";
  label: string;
  placeholder: string;
  items: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const accent = "var(--status-error)";
  const chipBg = "rgba(248,113,113,0.06)";
  const chipBorder = "rgba(248,113,113,0.22)";

  const add = useCallback(() => {
    const v = draft.trim();
    if (!v) return;
    if (items.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...items, v]);
    setDraft("");
  }, [draft, items, onChange]);

  return (
    <div
      style={{
        padding: "var(--space-14)",
        background: "var(--control-bg)",
        border: "1px solid var(--control-border)",
        borderRadius: "var(--radius-sm)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: accent }} />
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.12em",
            color: accent,
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: "var(--text-quaternary)" }}>
          · {items.length}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
        {items.map((c, i) => (
          <span
            key={`${c}-${i}`}
            style={{
              padding: "5px 9px",
              background: chipBg,
              border: `1px solid ${chipBorder}`,
              borderRadius: "var(--radius-xs)",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-sm)",
              color: "var(--text-secondary)",
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-8)",
            }}
          >
            {c}
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-tertiary)",
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                cursor: "pointer",
                padding: 0,
                lineHeight: 1,
              }}
              aria-label={`remove ${c}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        style={{
          display: "flex",
          gap: "var(--space-6)",
          padding: "6px 8px",
          background: "rgba(0,0,0,0.20)",
          border: "1px solid var(--control-border)",
          borderRadius: "var(--radius-xs)",
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--foreground)",
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-base)",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "3px 8px",
            background: "transparent",
            border: `1px solid ${accent}`,
            borderRadius: "var(--radius-xs)",
            color: accent,
            fontFamily: T.fontMono,
            fontSize: 9.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          add
        </button>
      </form>
    </div>
  );
}

/* ── Exemplars ─────────────────────────────────────────────── */

function ExemplarCount({ count }: { count: number }) {
  const remaining = 8 - count;
  return (
    <span
      style={{
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-xs)",
        color:
          remaining === 0
            ? "rgba(255,184,112,0.95)"
            : "var(--accent-strong)",
        padding: "5px 10px",
        background:
          remaining === 0
            ? "rgba(255,184,112,0.08)"
            : "rgba(140,231,210,0.08)",
        border: `1px solid ${
          remaining === 0 ? "rgba(255,184,112,0.30)" : "rgba(140,231,210,0.22)"
        }`,
        borderRadius: "var(--radius-xs)",
      }}
    >
      {count} / 8 {remaining === 0 ? "full" : ""}
    </span>
  );
}

/**
 * Drag-to-reorder list of exemplars. Uses native HTML5 drag-and-drop —
 * no library. The drag handle is the index number on the left of each
 * row; the rest of the row remains click-to-edit so users don't
 * accidentally drag when reaching for the textarea.
 *
 * Why reorder matters: the model attends most to the last exemplar
 * (recency bias). The earlier GPT-OSS edge-crisis fix turned on moving
 * the crisis exemplar to last position. Authors need a way to express
 * "weight this one hardest" without clearing + re-adding.
 */
function ExemplarList({
  exemplars,
  onChange,
}: {
  exemplars: Array<{ user: string; you: string }>;
  onChange: (next: Array<{ user: string; you: string }>) => void;
}) {
  // Track the source index of an in-flight drag so the drop handler can
  // compute the reordering. Stored in state (not a ref) so React
  // re-renders the dragging row with reduced opacity.
  const [dragSrc, setDragSrc] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...exemplars];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
      {exemplars.map((ex, i) => (
        <ExemplarRow
          key={i}
          index={i}
          exemplar={ex}
          isDragging={dragSrc === i}
          isDragOver={dragOverIdx === i && dragSrc !== null && dragSrc !== i}
          onChange={(next) =>
            onChange(exemplars.map((x, j) => (j === i ? next : x)))
          }
          onRemove={() => onChange(exemplars.filter((_, j) => j !== i))}
          onDragStart={() => setDragSrc(i)}
          onDragEnter={() => setDragOverIdx(i)}
          onDragEnd={() => {
            setDragSrc(null);
            setDragOverIdx(null);
          }}
          onDrop={() => {
            if (dragSrc !== null) move(dragSrc, i);
            setDragSrc(null);
            setDragOverIdx(null);
          }}
        />
      ))}
      {exemplars.length < 8 && (
        <button
          type="button"
          onClick={() => onChange([...exemplars, { user: "", you: "" }])}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-14)",
            padding: "12px 16px",
            background: "transparent",
            border: "1px dashed var(--control-border)",
            borderRadius: "var(--radius-sm)",
            color: "inherit",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--accent-strong)" }}>+</span>
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: "var(--text-tertiary)" }}>
            Add a canonical exchange ({8 - exemplars.length} slot
            {8 - exemplars.length === 1 ? "" : "s"} left)
          </span>
        </button>
      )}
    </div>
  );
}

function ExemplarRow({
  index,
  exemplar,
  onChange,
  onRemove,
  isDragging,
  isDragOver,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
}: {
  index: number;
  exemplar: { user: string; you: string };
  onChange: (next: { user: string; you: string }) => void;
  onRemove: () => void;
  /** Drag state — wired from the parent ExemplarList. */
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: () => void;
  onDragEnter?: () => void;
  onDragEnd?: () => void;
  onDrop?: () => void;
}) {
  // The row itself is the drop target; the index handle on the left is
  // the drag handle (small enough not to interfere with textarea use).
  // dragOver gets a top accent line so users see the insertion point
  // before releasing.
  return (
    <div
      onDragEnter={(e) => {
        if (!onDragEnter) return;
        e.preventDefault();
        onDragEnter();
      }}
      onDragOver={(e) => {
        // Required to allow drop. Without preventDefault the onDrop
        // handler never fires (HTML5 D&D quirk).
        if (onDrop) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!onDrop) return;
        e.preventDefault();
        onDrop();
      }}
      style={{
        display: "flex",
        gap: "var(--space-14)",
        padding: "14px 16px",
        background: "var(--control-bg)",
        border: `1px solid ${isDragOver ? "rgba(140,231,210,0.5)" : "var(--control-border)"}`,
        borderTop: isDragOver
          ? "3px solid var(--accent-strong)"
          : "1px solid var(--control-border)",
        borderRadius: "var(--radius-sm)",
        opacity: isDragging ? 0.4 : 1,
        transition: "opacity 150ms, border-color 100ms",
      }}
    >
      <div
        draggable={!!onDragStart}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          color: "var(--text-tertiary)",
          paddingTop: "var(--space-2)",
          flexShrink: 0,
          width: 20,
          cursor: onDragStart ? "grab" : "default",
          userSelect: "none",
          // Make the handle a slightly larger touch target without
          // taking visible space — padding pushes the textareas right
          // less aggressively than width would.
          padding: "2px 4px",
          marginLeft: -4,
        }}
        // Hover hint: indicate the handle is draggable. Browser native
        // cursor switch covers most of the signal; title for the rest.
        title="Drag to reorder. Last exemplar attends hardest."
        aria-label={`drag handle for exemplar ${index + 1}`}
      >
        ⋮⋮ {String(index + 1).padStart(2, "0")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)", flex: 1 }}>
        <ExemplarField
          variant="user"
          value={exemplar.user}
          onChange={(v) => onChange({ ...exemplar, user: v })}
        />
        <ExemplarField
          variant="you"
          value={exemplar.you}
          onChange={(v) => onChange({ ...exemplar, you: v })}
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        style={{
          background: "transparent",
          border: "1px solid var(--control-border)",
          color: "var(--text-tertiary)",
          borderRadius: "var(--radius-xs)",
          padding: "3px 8px",
          fontFamily: T.fontMono,
          fontSize: 9.5,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: "pointer",
          alignSelf: "flex-start",
          flexShrink: 0,
        }}
        aria-label={`remove exemplar ${index + 1}`}
      >
        remove
      </button>
    </div>
  );
}

function ExemplarField({
  variant,
  value,
  onChange,
}: {
  variant: "user" | "you";
  value: string;
  onChange: (v: string) => void;
}) {
  const labelColor =
    variant === "user" ? "var(--accent-strong)" : "rgba(255,184,112,0.95)";
  return (
    <div style={{ display: "flex", gap: "var(--space-12)", alignItems: "flex-start" }}>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.12em",
          color: labelColor,
          textTransform: "uppercase",
          flexShrink: 0,
          width: 44,
          paddingTop: "var(--space-8)",
        }}
      >
        {variant}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={1}
        placeholder={
          variant === "user"
            ? "What the player might say…"
            : "How the character should reply…"
        }
        style={{
          flex: 1,
          minHeight: 34,
          padding: "7px 10px",
          background: "rgba(0,0,0,0.20)",
          border: "1px solid var(--control-border)",
          borderRadius: "var(--radius-xs)",
          color: "var(--foreground)",
          fontFamily: T.fontBody,
          fontSize: "var(--font-size-md)",
          lineHeight: 1.45,
          fontStyle: variant === "you" ? "italic" : "normal",
          outline: "none",
          resize: "vertical",
        }}
      />
    </div>
  );
}

/* ── Never list ────────────────────────────────────────────── */

function NeverList({
  items,
  onChange,
}: {
  items: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = useCallback(() => {
    const v = draft.trim();
    if (!v) return;
    if (items.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...items, v]);
    setDraft("");
  }, [draft, items, onChange]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
      {items.map((rule, i) => (
        <div
          key={`${rule}-${i}`}
          style={{
            display: "flex",
            gap: "var(--space-12)",
            padding: "10px 14px",
            background: "var(--control-bg)",
            border: "1px solid var(--control-border)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-sm)",
              color: "var(--status-error)",
              flexShrink: 0,
            }}
          >
            do not
          </span>
          <span
            style={{
              fontFamily: T.fontBody,
              fontSize: "var(--font-size-md)",
              color: "var(--text-secondary)",
              flex: 1,
            }}
          >
            {rule.replace(/^do not\s+/i, "")}
          </span>
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-tertiary)",
              cursor: "pointer",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-sm)",
              padding: 0,
            }}
            aria-label={`remove rule ${i + 1}`}
          >
            ×
          </button>
        </div>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        style={{
          display: "flex",
          gap: "var(--space-6)",
          padding: "8px 10px",
          background: "rgba(0,0,0,0.20)",
          border: "1px dashed var(--control-border)",
          borderRadius: "var(--radius-xs)",
        }}
      >
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: "var(--text-tertiary)",
            paddingTop: "var(--space-2)",
          }}
        >
          do not
        </span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="break character to discuss being an AI"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--foreground)",
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-base)",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "3px 8px",
            background: "transparent",
            border: "1px solid var(--status-error)",
            borderRadius: "var(--radius-xs)",
            color: "var(--status-error)",
            fontFamily: T.fontMono,
            fontSize: 9.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          add
        </button>
      </form>
    </div>
  );
}

/* ── Textarea ──────────────────────────────────────────────── */

function TextArea({
  value,
  onChange,
  placeholder,
  rows,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rows: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{
        width: "100%",
        padding: "12px 14px",
        background: "var(--control-bg)",
        border: "1px solid var(--control-border)",
        borderRadius: "var(--radius-sm)",
        color: "var(--foreground)",
        fontFamily: T.fontBody,
        fontSize: "var(--font-size-md)",
        lineHeight: 1.55,
        outline: "none",
        resize: "vertical",
      }}
    />
  );
}
