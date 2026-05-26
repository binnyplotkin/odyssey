"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CharacterVoiceStyle } from "@odyssey/db";
import { compileVoiceXml } from "@/lib/character-prompt-builders";
import type { HarnessCharacter } from "../harness-types";
import { AdvisoryStack, type Advisory } from "../shared/advisory";
import { formatRelative } from "../shared/format-relative";

/**
 * L03 Voice & Style editor — four orthogonal personality axes plus the
 * audio voice prompt + prosody hints.
 *
 *   - Tone palette: multi-select chips, cap at 4
 *   - Decision: free-text descriptor (e.g. "deliberate · invokes precedent")
 *   - Brevity: 5-step segmented control
 *   - Register: 2D pad — formality (y) × warmth (x), both -1..1
 *   - Voice prompt: free-text for TTS (used in 1.3b)
 *   - Prosody: chips (slow, low-pitch, etc.) for TTS hints (used in 1.3b)
 *
 * Save flow mirrors L01/L02. Dispatches `harness:voice-style-saved`
 * so the right-rail preview re-fetches.
 */

const T = {
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

const TONE_PALETTE = [
  "warm", "weathered", "contemplative",
  "brisk", "severe", "playful",
  "stern", "gentle", "curious",
  "skeptical", "wry", "tender", "grave",
] as const;

const BREVITY_OPTIONS: Array<{ value: NonNullable<CharacterVoiceStyle["brevity"]>; label: string; sub: string }> = [
  { value: "terse",     label: "terse",     sub: "1 sentence" },
  { value: "short",     label: "short",     sub: "2–4 sentences" },
  { value: "medium",    label: "medium",    sub: "5–8 sentences" },
  { value: "long",      label: "long",      sub: "short paragraph" },
  { value: "paragraph", label: "paragraph", sub: "expansive" },
];

const PROSODY_PALETTE = [
  "slow", "low-pitch", "long-pauses", "soft-consonants",
  "measured", "breath-between-clauses",
] as const;

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; at: number }
  | { status: "error"; message: string };

type Props = {
  character: HarnessCharacter;
  /**
   * Which tab the LayerHeader has selected. L03 declares "configure",
   * "audio voice", "spoken preview", "history" — only "configure" is
   * wired today. Non-configure tabs render a "not yet wired" notice so
   * the strip stops lying. Splitting them into per-tab surfaces is a
   * follow-up audit.
   */
  activeTab?: string;
};

export function L03VoiceStyle({ character, activeTab = "configure" }: Props) {
  if (activeTab === "history") return <L03History character={character} />;
  if (activeTab === "audio voice") return <L03AudioVoice character={character} />;
  if (activeTab === "spoken preview") return <L03SpokenPreview character={character} />;
  if (activeTab && activeTab !== "configure") {
    return <L03TabPlaceholder tab={activeTab} />;
  }
  return <L03Configure character={character} />;
}

function L03TabPlaceholder({ tab }: { tab: string }) {
  return (
    <div style={{ padding: "var(--space-32)", width: "100%" }}>
      <div
        style={{
          padding: "var(--space-24)",
          background: "var(--card)",
          border: "1px dashed var(--card-border)",
          borderRadius: "var(--radius-md)",
          fontFamily: "'Inter', sans-serif",
          fontSize: "var(--font-size-md)",
          color: "var(--text-tertiary)",
          lineHeight: 1.55,
        }}
      >
        The <strong>{tab}</strong> tab is declared but not yet wired. The CONFIGURE
        tab already covers the four orthogonal voice axes + audio prompt; this
        surface will eventually carry the dedicated {tab} flow.
      </div>
    </div>
  );
}

function L03Configure({ character }: { character: HarnessCharacter }) {
  const initial = useMemo(() => toDraft(character.voiceStyle), [character.voiceStyle]);

  const [tone, setTone] = useState<string[]>(initial.tone);
  const [decision, setDecision] = useState(initial.decision);
  const [brevity, setBrevity] = useState<CharacterVoiceStyle["brevity"]>(initial.brevity);
  const [register, setRegister] = useState(initial.register);
  const [voicePrompt, setVoicePrompt] = useState(initial.voicePrompt);
  const [prosody, setProsody] = useState<string[]>(initial.prosody);
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  const isDirty = useMemo(() => {
    const current = JSON.stringify({ tone, decision, brevity, register, voicePrompt, prosody });
    return current !== JSON.stringify(initial);
  }, [tone, decision, brevity, register, voicePrompt, prosody, initial]);

  // Authoring advisories — antipatterns common in L03 drafts.
  //   warn — likely behavioural regression / mixed signal to the model
  //   info — best-practice nudge or "you could go further" reminder
  // Computed live so chips disappear as authors fix the underlying issue.
  // Two checks lean on character.identity to detect mismatches between
  // L01 essence and L03 voice prompt — only fire when both fields exist.
  const advisories = useMemo<Advisory[]>(() => {
    const out: Advisory[] = [];

    // ── Structural absences (warn) ─────────────────────────
    if (tone.length === 0) {
      out.push({
        severity: "warn",
        title: "no tone palette",
        body: "Without tone chips the model has no qualitative voice anchor. Pick 2–4 descriptors so the <voice> block has signal — even a generic combo (warm + measured) beats nothing.",
      });
    }

    if (!decision.trim()) {
      out.push({
        severity: "info",
        title: "no decision descriptor",
        body: "The decision axis says how the character commits to a position — \"deliberate · invokes precedent\", \"snap-judgment · revises on contact\". Optional, but a single phrase here lands measurably on argumentation/refusal probes.",
      });
    }

    if (!brevity) {
      out.push({
        severity: "info",
        title: "brevity unset",
        body: "Compiler skips the <brevity> sub-tag entirely when this is empty — runtime falls back to the global brevity guidance in <delivery>. Set it explicitly if your character has a distinctive resting length (tent-elder: long; soldier: terse).",
      });
    }

    // ── Contradictory tone chips (warn) ────────────────────
    // Heuristic: chips that imply opposite registers create mixed
    // signal. Pair table is intentionally small + conservative — false
    // positives are worse than false negatives here.
    const CONTRADICTION_PAIRS: Array<[string, string]> = [
      ["warm", "severe"],
      ["warm", "stern"],
      ["warm", "grave"],
      ["playful", "grave"],
      ["playful", "severe"],
      ["playful", "stern"],
      ["gentle", "severe"],
      ["gentle", "stern"],
      ["tender", "severe"],
      ["tender", "stern"],
    ];
    const contradictions = CONTRADICTION_PAIRS.filter(
      ([a, b]) => tone.includes(a) && tone.includes(b),
    );
    if (contradictions.length > 0) {
      const pairs = contradictions.map(([a, b]) => `"${a}" + "${b}"`).join(", ");
      out.push({
        severity: "warn",
        title: "contradictory tone chips",
        body: `${pairs} — these read as opposite registers. The model receives mixed signal and tends to oscillate. Either drop one, or move the tension into the L02 directive's guidance section where it can be framed in prose.`,
      });
    }

    // ── Register exactly neutral (info) ────────────────────
    if (register && Math.abs(register.formality) < 0.05 && Math.abs(register.warmth) < 0.05) {
      out.push({
        severity: "info",
        title: "register at exact neutral",
        body: "(0, 0) compiles to \"balanced\" — a weak signal that doesn't help the model differentiate. Either pick a quadrant intentionally or leave register unset (the compiler will skip the sub-tag).",
      });
    }

    // ── Voice prompt vs L01 essence mismatch (info) ────────
    // If L01 has an essence but L03 has no voicePrompt, the character
    // ships without a TTS bake brief — that's fine if you're text-only,
    // but voice-mode characters need both. Soft info, not warn.
    if (character.identity?.essence?.trim() && !voicePrompt.trim()) {
      out.push({
        severity: "info",
        title: "no voice prompt despite essence",
        body: "L01 has an essence but L03 voice prompt is empty. Fine if this character is text-only — if you plan to use voice mode, the prompt is what the offline bake step reads to produce the .safetensors clip.",
      });
    }

    return out;
  }, [tone, decision, brevity, register, voicePrompt, character.identity]);

  // Live preview of the compiled <voice> block. Same compiler the chat
  // route uses (packages/engine/src/voice-xml.ts), so what authors see
  // here is byte-identical to what the model receives after save.
  //
  // Audio-channel fields (voicePrompt, prosody) are intentionally not
  // emitted into <voice> — they're for the TTS bake pipeline. The
  // preview only shows the four LLM-facing axes (tone / decision /
  // brevity / register) which is exactly what compileVoiceXml emits.
  const previewXml = useMemo(() => {
    const draft: CharacterVoiceStyle = {};
    if (tone.length) draft.tone = tone;
    if (decision.trim()) draft.decision = decision.trim();
    if (brevity) draft.brevity = brevity;
    if (register) draft.register = register;
    // voicePrompt + prosody intentionally omitted — they don't compile
    // into the text envelope. Including them here would be misleading.

    const xml = compileVoiceXml(draft);
    return xml || "(no voice block — every axis is empty, the <voice> tag is skipped entirely)";
  }, [tone, decision, brevity, register]);

  const onSave = useCallback(async () => {
    setSave({ status: "saving" });
    try {
      const voiceStyle: CharacterVoiceStyle = {};
      if (tone.length) voiceStyle.tone = tone;
      if (decision.trim()) voiceStyle.decision = decision.trim();
      if (brevity) voiceStyle.brevity = brevity;
      if (register) voiceStyle.register = register;
      if (voicePrompt.trim()) voiceStyle.voicePrompt = voicePrompt.trim();
      if (prosody.length) voiceStyle.prosody = prosody;

      const res = await fetch(`/api/characters/${character.id}/voice-style`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceStyle }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body.slice(0, 200)}`);
      }
      setSave({ status: "saved", at: Date.now() });
      window.dispatchEvent(new CustomEvent("harness:voice-style-saved"));
    } catch (err) {
      setSave({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [character.id, tone, decision, brevity, register, voicePrompt, prosody]);

  return (
    <div style={{ padding: "var(--space-32)", display: "flex", flexDirection: "column", gap: "var(--space-24)", maxWidth: 920 }}>
      <SaveBar isDirty={isDirty} save={save} onSave={onSave} />

      <VoiceTemplatesCard
        characterId={character.id}
        onApply={(vs) => {
          // Replace the full draft — templates are complete starting
          // points, same convention as L01/L02.
          setTone(vs.tone ?? []);
          setDecision(vs.decision ?? "");
          setBrevity(vs.brevity);
          setRegister(vs.register);
          setVoicePrompt(vs.voicePrompt ?? "");
          setProsody(vs.prosody ?? []);
        }}
      />

      <Card
        accent="phosphor"
        eyebrow="axis 01 · tone → <tone>"
        title="The emotional palette"
        sub="Pick 2–4 descriptors. More than four dilutes — research shows top-2 traits recover >80% of personality fidelity."
        action={<TonePillCount count={tone.length} />}
      >
        <TonePalette selected={tone} onChange={setTone} />
      </Card>

      <Card
        accent="phosphor"
        eyebrow="axis 02 · decision → <decision>"
        title="How they commit"
        sub="Free-text descriptor on the spectrum from snap-judgment to weigh-every-precedent."
      >
        <TextField
          value={decision}
          onChange={setDecision}
          placeholder="deliberate · invokes precedent"
        />
        <DecisionSpectrum />
      </Card>

      <Card
        accent="phosphor"
        eyebrow="axis 03 · brevity → <brevity>"
        title="Default response length"
        sub="Soft default; the <delivery> block already enforces brevity globally. This dials in the character's resting length."
      >
        <BrevitySegmented value={brevity} onChange={setBrevity} />
      </Card>

      <Card
        accent="phosphor"
        eyebrow="axis 04 · register → <register>"
        title="Formality × warmth"
        sub="Most characters anchor in one quadrant. Click to set."
      >
        <RegisterPad value={register} onChange={setRegister} />
      </Card>

      {advisories.length > 0 && <AdvisoryStack advisories={advisories} />}

      <Card
        accent="phosphor"
        eyebrow="live preview · what the model will see"
        title="Compiled <voice> block"
        sub="Re-rendered live from the same compiler the chat route uses. The audio fields below (voice prompt, prosody) intentionally don't appear — they're for the TTS bake pipeline, not the text envelope."
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
        <pre
          style={{
            margin: 0,
            padding: "14px 16px",
            background: "rgba(0,0,0,0.25)",
            border: "1px solid var(--input-border)",
            borderRadius: "var(--radius-sm)",
            fontFamily: T.fontMono,
            fontSize: 11.5,
            lineHeight: 1.6,
            color: "var(--text-secondary)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflow: "auto",
            // L03 outputs are short by design (~200 chars) — no need
            // for the L02-style 600px ceiling.
            maxHeight: 240,
          }}
        >
          {previewXml}
        </pre>
      </Card>

      <SpokenPreviewCard
        characterId={character.id}
        characterSlug={character.slug}
        characterTitle={character.title}
        essence={character.identity?.essence ?? null}
      />

      <div
        style={{
          padding: "12px 16px",
          background: "var(--card)",
          border: "1px dashed var(--card-border)",
          borderRadius: "var(--radius-md)",
          fontFamily: T.fontBody,
          fontSize: "var(--font-size-base)",
          color: "var(--text-tertiary)",
          lineHeight: 1.55,
        }}
      >
        Audio bake fields (voice prompt + prosody) live on the <strong>AUDIO VOICE</strong> tab
        now — they don&apos;t affect the live preview above and grouping them apart
        keeps this tab focused on the four LLM-facing axes.
      </div>
    </div>
  );
}

/* ── Draft conversion ──────────────────────────────────────── */

type Draft = {
  tone: string[];
  decision: string;
  brevity: CharacterVoiceStyle["brevity"];
  register: { formality: number; warmth: number } | undefined;
  voicePrompt: string;
  prosody: string[];
};

function toDraft(v: CharacterVoiceStyle | null): Draft {
  return {
    tone: v?.tone ?? [],
    decision: v?.decision ?? "",
    brevity: v?.brevity,
    register: v?.register,
    voicePrompt: v?.voicePrompt ?? "",
    prosody: v?.prosody ?? [],
  };
}

/* ── Save bar (same shape as L01/L02) ──────────────────────── */

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
  if (save.status === "saving") statusEl = <Status tone="muted">saving…</Status>;
  else if (save.status === "saved") statusEl = <Status tone="accent">saved · preview refreshed</Status>;
  else if (save.status === "error") statusEl = <Status tone="danger">save failed · {save.message}</Status>;
  else if (isDirty) statusEl = <Status tone="amber">unsaved changes</Status>;
  else statusEl = <Status tone="muted">in sync with compiled prompt</Status>;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-14)",
        padding: "12px 16px",
        background: "var(--card)",
        border: "1px solid var(--card-border)",
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
        L03 · voice &amp; style
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
          background: isDirty ? "rgba(140,231,210,0.14)" : "var(--input-bg)",
          border: `1px solid ${isDirty ? "rgba(140,231,210,0.4)" : "var(--input-border)"}`,
          color: isDirty ? "var(--accent-strong)" : "var(--text-tertiary)",
          borderRadius: "var(--radius-xs)",
          cursor: isDirty && save.status !== "saving" ? "pointer" : "default",
        }}
      >
        save voice style
      </button>
    </div>
  );
}

function Status({ children, tone }: { children: React.ReactNode; tone: "accent" | "amber" | "danger" | "muted" }) {
  const colorMap = {
    accent: "var(--accent-strong)",
    amber: "rgba(255,184,112,0.95)",
    danger: "var(--danger)",
    muted: "var(--text-tertiary)",
  };
  return <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: colorMap[tone] }}>{children}</span>;
}

/* ── Card ──────────────────────────────────────────────────── */

function Card({
  accent,
  eyebrow,
  title,
  sub,
  action,
  children,
}: {
  accent: "phosphor" | "violet" | "muted";
  eyebrow: string;
  title: string;
  sub?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const borderMap = {
    phosphor: "rgba(140,231,210,0.18)",
    violet: "rgba(179,136,255,0.20)",
    muted: "var(--card-border)",
  };
  const eyebrowMap = {
    phosphor: "var(--accent-strong)",
    violet: "rgba(179,136,255,0.95)",
    muted: "var(--text-tertiary)",
  };
  return (
    <section
      style={{
        padding: "var(--space-24)",
        background: "var(--card)",
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
          {sub && (
            <span
              style={{
                fontFamily: T.fontBody,
                fontSize: "var(--font-size-base)",
                color: "var(--text-tertiary)",
                lineHeight: 1.5,
              }}
            >
              {sub}
            </span>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/* ── Tone palette ──────────────────────────────────────────── */

function TonePalette({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) {
  const [custom, setCustom] = useState("");
  const toggle = (t: string) => {
    if (selected.includes(t)) onChange(selected.filter((x) => x !== t));
    else if (selected.length < 4) onChange([...selected, t]);
  };
  const addCustom = () => {
    const v = custom.trim().toLowerCase();
    if (!v || selected.includes(v) || selected.length >= 4) return;
    onChange([...selected, v]);
    setCustom("");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
        {TONE_PALETTE.map((t) => {
          const active = selected.includes(t);
          const disabled = !active && selected.length >= 4;
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggle(t)}
              disabled={disabled}
              style={{
                padding: "6px 10px",
                background: active ? "rgba(140,231,210,0.12)" : "transparent",
                border: `1px solid ${active ? "rgba(140,231,210,0.4)" : "var(--input-border)"}`,
                borderRadius: "var(--radius-xs)",
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-sm)",
                color: active ? "var(--accent-strong)" : disabled ? "var(--text-quaternary)" : "var(--text-secondary)",
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              {t}
            </button>
          );
        })}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addCustom();
        }}
        style={{
          display: "flex",
          gap: "var(--space-6)",
          padding: "6px 8px",
          background: "rgba(0,0,0,0.20)",
          border: "1px solid var(--input-border)",
          borderRadius: "var(--radius-xs)",
        }}
      >
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={selected.length >= 4 ? "max 4 reached — remove one to add a custom" : "custom tone descriptor (one word)"}
          disabled={selected.length >= 4}
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
          disabled={selected.length >= 4 || !custom.trim()}
          style={{
            padding: "3px 8px",
            background: "transparent",
            border: "1px solid var(--accent-strong)",
            borderRadius: "var(--radius-xs)",
            color: "var(--accent-strong)",
            fontFamily: T.fontMono,
            fontSize: 9.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: selected.length >= 4 || !custom.trim() ? "not-allowed" : "pointer",
            opacity: selected.length >= 4 || !custom.trim() ? 0.4 : 1,
          }}
        >
          add
        </button>
      </form>
    </div>
  );
}

function TonePillCount({ count }: { count: number }) {
  return (
    <span
      style={{
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-xs)",
        padding: "5px 10px",
        background: count >= 4 ? "rgba(255,184,112,0.08)" : "rgba(140,231,210,0.06)",
        border: `1px solid ${count >= 4 ? "rgba(255,184,112,0.25)" : "rgba(140,231,210,0.20)"}`,
        borderRadius: "var(--radius-xs)",
        color: count >= 4 ? "rgba(255,184,112,0.95)" : "var(--accent-strong)",
      }}
    >
      {count} / 4
    </span>
  );
}

/* ── Decision spectrum (visual aid; the field is the input above) ── */

function DecisionSpectrum() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <div
        style={{
          height: 4,
          background:
            "linear-gradient(90deg, rgba(248,113,113,0.4), rgba(255,184,112,0.4), rgba(140,231,210,0.4), rgba(248,113,113,0.4))",
          borderRadius: "var(--radius-2xs)",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-2xs)",
          letterSpacing: "0.08em",
          color: "var(--text-quaternary)",
          textTransform: "uppercase",
        }}
      >
        <span>impulsive</span>
        <span>measured</span>
        <span>deliberate</span>
        <span>paralyzed</span>
      </div>
    </div>
  );
}

/* ── Brevity segmented control ─────────────────────────────── */

function BrevitySegmented({
  value,
  onChange,
}: {
  value: CharacterVoiceStyle["brevity"];
  onChange: (v: CharacterVoiceStyle["brevity"]) => void;
}) {
  return (
    <div style={{ display: "flex", gap: "var(--space-6)" }}>
      {BREVITY_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(active ? undefined : opt.value)}
            style={{
              flex: 1,
              padding: "12px 10px",
              background: active ? "rgba(140,231,210,0.1)" : "var(--input-bg)",
              border: `1px solid ${active ? "rgba(140,231,210,0.35)" : "var(--input-border)"}`,
              borderRadius: "var(--radius-sm)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
              cursor: "pointer",
              color: "inherit",
              fontFamily: "inherit",
              textAlign: "center",
            }}
          >
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.12em",
                color: active ? "var(--accent-strong)" : "var(--text-secondary)",
                textTransform: "uppercase",
              }}
            >
              {opt.label}
            </span>
            <span
              style={{
                fontFamily: T.fontBody,
                fontSize: 10.5,
                color: "var(--text-tertiary)",
              }}
            >
              {opt.sub}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Register pad (2D) ─────────────────────────────────────── */

function RegisterPad({
  value,
  onChange,
}: {
  value: { formality: number; warmth: number } | undefined;
  onChange: (v: { formality: number; warmth: number } | undefined) => void;
}) {
  const PAD = 280;
  const handle = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    // x → warmth (left=cool=-1, right=warm=+1)
    const warmth = clamp(x * 2 - 1, -1, 1);
    // y → formality (top=formal=+1, bottom=casual=-1)
    const formality = clamp(1 - y * 2, -1, 1);
    onChange({ formality, warmth });
  };

  // Project current value to pixel coords for the dot.
  const dotX = value ? ((value.warmth + 1) / 2) * PAD : null;
  const dotY = value ? ((1 - value.formality) / 2) * PAD : null;

  return (
    <div style={{ display: "flex", gap: "var(--space-24)", alignItems: "flex-start" }}>
      <div
        onClick={handle}
        style={{
          position: "relative",
          width: PAD,
          height: PAD,
          background: "rgba(0,0,0,0.2)",
          border: "1px solid var(--input-border)",
          borderRadius: "var(--radius-sm)",
          cursor: "crosshair",
          flexShrink: 0,
        }}
      >
        {/* Quadrant lines */}
        <div style={{ position: "absolute", left: PAD / 2, top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.06)" }} />
        <div style={{ position: "absolute", top: PAD / 2, left: 0, right: 0, height: 1, background: "rgba(255,255,255,0.06)" }} />
        {/* Quadrant labels */}
        <QuadrantLabel x={14} y={14} text="formal · cool" anchor="tl" />
        <QuadrantLabel x={PAD - 14} y={14} text="formal · warm" anchor="tr" />
        <QuadrantLabel x={14} y={PAD - 14} text="casual · cool" anchor="bl" />
        <QuadrantLabel x={PAD - 14} y={PAD - 14} text="casual · warm" anchor="br" />
        {/* Current dot */}
        {dotX !== null && dotY !== null && (
          <div
            style={{
              position: "absolute",
              left: dotX - 9,
              top: dotY - 9,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "var(--accent-strong)",
              boxShadow: "0 0 0 6px rgba(140,231,210,0.15), 0 0 24px rgba(140,231,210,0.4)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)", flex: 1 }}>
        <div
          style={{
            padding: "var(--space-14)",
            background: "var(--input-bg)",
            border: "1px solid var(--input-border)",
            borderRadius: "var(--radius-sm)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-8)",
          }}
        >
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 9.5,
              letterSpacing: "0.12em",
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
            }}
          >
            current
          </span>
          {value ? (
            <>
              <div style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-2xl)", color: "var(--foreground)" }}>
                {describe(value)}
              </div>
              <div
                style={{
                  fontFamily: T.fontMono,
                  fontSize: "var(--font-size-xs)",
                  color: "var(--text-tertiary)",
                }}
              >
                formality: {value.formality.toFixed(2)} · warmth: {value.warmth.toFixed(2)}
              </div>
              <button
                type="button"
                onClick={() => onChange(undefined)}
                style={{
                  alignSelf: "flex-start",
                  padding: "3px 8px",
                  background: "transparent",
                  border: "1px solid var(--input-border)",
                  color: "var(--text-tertiary)",
                  borderRadius: "var(--radius-xs)",
                  fontFamily: T.fontMono,
                  fontSize: 9.5,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  marginTop: "var(--space-6)",
                }}
              >
                clear
              </button>
            </>
          ) : (
            <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: "var(--text-tertiary)" }}>
              Click the pad to set.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function QuadrantLabel({
  x,
  y,
  text,
  anchor,
}: {
  x: number;
  y: number;
  text: string;
  anchor: "tl" | "tr" | "bl" | "br";
}) {
  const transform =
    anchor === "tl" ? "translate(0, 0)"
      : anchor === "tr" ? "translate(-100%, 0)"
        : anchor === "bl" ? "translate(0, -100%)"
          : "translate(-100%, -100%)";
  return (
    <span
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform,
        fontFamily: T.fontMono,
        fontSize: "var(--font-size-2xs)",
        letterSpacing: "0.08em",
        color: "var(--text-quaternary)",
        textTransform: "uppercase",
        pointerEvents: "none",
      }}
    >
      {text}
    </span>
  );
}

function describe(r: { formality: number; warmth: number }): string {
  const f = clamp(r.formality, -1, 1);
  const w = clamp(r.warmth, -1, 1);
  const fL = f >= 0.33 ? "formal" : f <= -0.33 ? "casual" : "balanced";
  const wL = w >= 0.33 ? "warm" : w <= -0.33 ? "cool" : "even";
  if (fL === "balanced" && wL === "even") return "balanced";
  return `${fL} · ${wL}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/* ── Prosody palette (same shape as tone palette, no cap) ── */

function ProsodyPalette({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [custom, setCustom] = useState("");
  const toggle = (t: string) => {
    if (selected.includes(t)) onChange(selected.filter((x) => x !== t));
    else onChange([...selected, t]);
  };
  const addCustom = () => {
    const v = custom.trim().toLowerCase();
    if (!v || selected.includes(v)) return;
    onChange([...selected, v]);
    setCustom("");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
        {PROSODY_PALETTE.map((t) => {
          const active = selected.includes(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggle(t)}
              style={{
                padding: "6px 10px",
                background: active ? "rgba(179,136,255,0.12)" : "transparent",
                border: `1px solid ${active ? "rgba(179,136,255,0.4)" : "var(--input-border)"}`,
                borderRadius: "var(--radius-xs)",
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-sm)",
                color: active ? "rgba(179,136,255,0.95)" : "var(--text-secondary)",
                cursor: "pointer",
              }}
            >
              {t}
            </button>
          );
        })}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addCustom();
        }}
        style={{
          display: "flex",
          gap: "var(--space-6)",
          padding: "6px 8px",
          background: "rgba(0,0,0,0.20)",
          border: "1px solid var(--input-border)",
          borderRadius: "var(--radius-xs)",
        }}
      >
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="custom prosody tag"
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
          disabled={!custom.trim()}
          style={{
            padding: "3px 8px",
            background: "transparent",
            border: "1px solid rgba(179,136,255,0.95)",
            borderRadius: "var(--radius-xs)",
            color: "rgba(179,136,255,0.95)",
            fontFamily: T.fontMono,
            fontSize: 9.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: !custom.trim() ? "not-allowed" : "pointer",
            opacity: !custom.trim() ? 0.4 : 1,
          }}
        >
          add
        </button>
      </form>
    </div>
  );
}

/* ── Templates / starter voice styles ──────────────────────── */

type VoiceTemplate = {
  id: string;
  label: string;
  description: string;
  voiceStyle: CharacterVoiceStyle;
};

type VoiceSuggestResponse = {
  templates: VoiceTemplate[];
};

/**
 * Collapsible "start from a template" surface above the editor. Same
 * pattern as L01/L02 templates cards — lazy fetch on first expand,
 * apply replaces the full draft. Six archetype starters, intentionally
 * matching the L01/L02 archetypes by id so authors building (say) a
 * tent-elder character can pull the same shape across all three layers.
 */
function VoiceTemplatesCard({
  characterId,
  onApply,
}: {
  characterId: string;
  onApply: (voiceStyle: CharacterVoiceStyle) => void;
}) {
  const [data, setData] = useState<VoiceSuggestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/characters/${characterId}/voice-style/suggest`);
        if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
        const body = (await res.json()) as VoiceSuggestResponse;
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
        background: "var(--card)",
        border: "1px solid var(--card-border)",
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
            Archetype voice styles — tone palette + decision + brevity + register
            + voice prompt + prosody, tuned to ship. Applying populates the form
            (replaces all six fields). Review, tweak, then save.
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
            background: open ? "rgba(140,231,210,0.1)" : "var(--input-bg)",
            border: `1px solid ${open ? "rgba(140,231,210,0.3)" : "var(--input-border)"}`,
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
            <VoiceTemplateRow key={tpl.id} template={tpl} onApply={onApply} />
          ))}
        </div>
      )}
    </section>
  );
}

function VoiceTemplateRow({
  template,
  onApply,
}: {
  template: VoiceTemplate;
  onApply: (voiceStyle: CharacterVoiceStyle) => void;
}) {
  const vs = template.voiceStyle;
  const tone = (vs.tone ?? []).join(" · ");
  const reg = vs.register
    ? `${vs.register.formality >= 0.33 ? "formal" : vs.register.formality <= -0.33 ? "casual" : "balanced"}/${vs.register.warmth >= 0.33 ? "warm" : vs.register.warmth <= -0.33 ? "cool" : "even"}`
    : "—";

  return (
    <div
      style={{
        padding: "12px 14px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid var(--input-border)",
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
        <span style={{ fontFamily: T.fontMono, fontSize: 10.5, color: "var(--text-quaternary)" }}>
          tone · {tone || "—"}
        </span>
        <span style={{ fontFamily: T.fontMono, fontSize: 10.5, color: "var(--text-quaternary)" }}>
          brevity={vs.brevity ?? "—"} · register={reg} · decision: {vs.decision ?? "—"}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onApply(vs)}
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

/* ── SPOKEN PREVIEW tab ────────────────────────────────────── */

/**
 * Multi-sample voice preview workspace. Authors verify the baked voice
 * across the kinds of lines this character will actually speak: a
 * one-sentence intro, a short deflection, a longer reflection. Lets
 * them catch tone drift (e.g. "the bake is great on greetings but the
 * grave-register lines feel off") that a single-sample preview misses.
 *
 * The CONFIGURE tab keeps the single-shot preview for the 90% case;
 * this surface is for when an author is actively tuning the bake.
 *
 * Each sample posts to the same `/api/characters/:id/probe/voice`
 * endpoint the configure-tab preview uses — no new API needed, just a
 * fan-out renderer.
 */
function L03SpokenPreview({ character }: { character: HarnessCharacter }) {
  const essence = character.identity?.essence?.trim();
  // Seed with three categories of sample so authors immediately have
  // diverse coverage. Each one is freely editable; authors can add more.
  const seeds = useMemo<SampleSeed[]>(() => {
    const titleAnchor = `I am ${character.title}.`;
    const intro = essence
      ? `${titleAnchor} ${capitalizeFirst(essence)}.`
      : `${titleAnchor} Sit awhile, my friend. Tell me what burdens you.`;
    return [
      {
        id: "intro",
        label: "intro · identity anchor",
        text: intro,
        note: essence
          ? "Uses your L01 essence verbatim — the most common opener the character will speak."
          : "Generic intro since L01 essence isn't authored. Replace with a real anchor for a tighter test.",
      },
      {
        id: "deflect",
        label: "deflect · soft refusal",
        text: "The blessing is not mine to give, friend. But sit awhile — tell me what burdens you.",
        note: "Mid-length deflection. Tests whether the bake holds frame on a softer register.",
      },
      {
        id: "grave",
        label: "grave · serious register",
        text: "Friend. Stay with me a moment. There are people trained for this weight — call 988 if you are in the United States. I will be here when you return.",
        note: "Crisis-shaped line. The bake's gravitas under hard content is the stress test that matters most.",
      },
    ];
  }, [character.title, essence]);

  const [samples, setSamples] = useState<SampleState[]>(() =>
    seeds.map((s) => ({ ...s, playback: { kind: "idle" } })),
  );

  const updateSample = (id: string, updater: (prev: SampleState) => SampleState) => {
    setSamples((list) => list.map((s) => (s.id === id ? updater(s) : s)));
  };

  const play = useCallback(
    async (id: string) => {
      const sample = samples.find((s) => s.id === id);
      if (!sample) return;
      const text = sample.text.trim();
      if (!text) return;
      updateSample(id, (s) => ({ ...s, playback: { kind: "loading" } }));
      try {
        const res = await fetch(`/api/characters/${character.id}/probe/voice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const body = await res.json();
        if (!res.ok) {
          throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
        }
        const src = `data:${body.mimeType};base64,${body.audioBase64}`;
        updateSample(id, (s) => ({
          ...s,
          playback: {
            kind: "ready",
            src,
            totalMs: body.totalMs ?? 0,
            firstAudioMs: body.firstAudioMs ?? null,
            durationMs: body.durationMs ?? 0,
            voice: body.voice ?? character.slug,
          },
        }));
      } catch (err) {
        updateSample(id, (s) => ({
          ...s,
          playback: { kind: "error", message: err instanceof Error ? err.message : String(err) },
        }));
      }
    },
    [character.id, character.slug, samples],
  );

  const playAll = useCallback(async () => {
    // Sequential rather than parallel — Pocket TTS handles one stream at
    // a time and parallel calls just queue. Sequential keeps the per-row
    // "loading" indicator honest.
    for (const s of samples) {
      // Skip rows the author has cleared. Avoid re-running already-loaded
      // rows; the row's own re-run button covers that case.
      if (!s.text.trim()) continue;
      if (s.playback.kind === "ready") continue;
      // eslint-disable-next-line no-await-in-loop
      await play(s.id);
    }
  }, [samples, play]);

  const addSample = () => {
    setSamples((list) => [
      ...list,
      {
        id: `sample-${Date.now()}`,
        label: `sample · ${String(list.length + 1).padStart(2, "0")}`,
        text: "",
        note: "Author-added sample.",
        playback: { kind: "idle" },
      },
    ]);
  };

  return (
    <div style={{ padding: "var(--space-32)", display: "flex", flexDirection: "column", gap: "var(--space-16)", width: "100%" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.14em",
              color: "var(--accent-strong)",
              textTransform: "uppercase",
            }}
          >
            spoken preview · {samples.length} sample{samples.length === 1 ? "" : "s"} · pocket TTS · voice = {character.slug}
          </span>
          <p style={{ margin: 0, fontFamily: T.fontBody, fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.55 }}>
            Three seeded samples covering intro, deflect, and grave registers — the shapes
            this character will actually speak. Edit any text, press play per row, or play all
            sequentially. The CONFIGURE tab&apos;s single-shot preview is fine for one-line
            sanity; this surface is where you tune the bake under real load.
          </p>
        </div>
        <button
          type="button"
          onClick={playAll}
          style={{
            padding: "8px 16px",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            background: "rgba(140,231,210,0.14)",
            border: "1px solid rgba(140,231,210,0.4)",
            color: "var(--accent-strong)",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          play all
        </button>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
        {samples.map((s) => (
          <SampleRow
            key={s.id}
            sample={s}
            onTextChange={(text) => updateSample(s.id, (prev) => ({ ...prev, text }))}
            onPlay={() => play(s.id)}
            onRemove={() => setSamples((list) => list.filter((x) => x.id !== s.id))}
          />
        ))}
        <button
          type="button"
          onClick={addSample}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-14)",
            padding: "12px 16px",
            background: "transparent",
            border: "1px dashed var(--input-border)",
            borderRadius: "var(--radius-sm)",
            color: "inherit",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--accent-strong)" }}>+</span>
          <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: "var(--text-tertiary)" }}>
            Add a sample
          </span>
        </button>
      </div>
    </div>
  );
}

type SampleSeed = {
  id: string;
  label: string;
  text: string;
  note: string;
};
type SamplePlayback =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; src: string; totalMs: number; firstAudioMs: number | null; durationMs: number; voice: string }
  | { kind: "error"; message: string };
type SampleState = SampleSeed & { playback: SamplePlayback };

function SampleRow({
  sample,
  onTextChange,
  onPlay,
  onRemove,
}: {
  sample: SampleState;
  onTextChange: (text: string) => void;
  onPlay: () => void;
  onRemove: () => void;
}) {
  const { playback } = sample;
  return (
    <div
      style={{
        padding: "16px 18px",
        background: "var(--card)",
        border: "1px solid var(--card-border)",
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
            color: "var(--accent-strong)",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          {sample.label}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onPlay}
          disabled={playback.kind === "loading" || !sample.text.trim()}
          style={{
            padding: "6px 14px",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            background: playback.kind === "loading" ? "rgba(140,231,210,0.06)" : "rgba(140,231,210,0.14)",
            border: "1px solid rgba(140,231,210,0.4)",
            color: "var(--accent-strong)",
            borderRadius: "var(--radius-xs)",
            cursor: playback.kind === "loading" || !sample.text.trim() ? "default" : "pointer",
            opacity: !sample.text.trim() ? 0.4 : 1,
          }}
        >
          {playback.kind === "loading"
            ? "loading…"
            : playback.kind === "ready"
              ? "re-play"
              : "play"}
        </button>
        <button
          type="button"
          onClick={onRemove}
          style={{
            padding: "5px 10px",
            background: "transparent",
            border: "1px solid var(--input-border)",
            color: "var(--text-tertiary)",
            borderRadius: "var(--radius-xs)",
            fontFamily: T.fontMono,
            fontSize: 9.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          remove
        </button>
      </header>

      <span style={{ fontFamily: T.fontBody, fontSize: 11.5, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
        {sample.note}
      </span>

      <TextArea value={sample.text} onChange={onTextChange} placeholder="Sample text…" rows={3} />

      {playback.kind === "ready" && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)", flexWrap: "wrap" }}>
          <audio src={playback.src} controls autoPlay style={{ flex: "1 1 320px", maxWidth: "100%" }} />
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--text-quaternary)" }}>
            voice={playback.voice} ·{" "}
            {playback.firstAudioMs ? `first-audio ${playback.firstAudioMs}ms · ` : ""}
            total {playback.totalMs}ms · clip {Math.round(playback.durationMs)}ms
          </span>
        </div>
      )}

      {playback.kind === "error" && (
        <div
          style={{
            padding: "10px 12px",
            background: "rgba(255,122,155,0.06)",
            border: "1px solid rgba(255,122,155,0.25)",
            borderRadius: "var(--radius-sm)",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: "rgba(255,122,155,0.95)",
          }}
        >
          tts failed · {playback.message}
        </div>
      )}
    </div>
  );
}

/* ── AUDIO VOICE tab ───────────────────────────────────────── */

/**
 * Dedicated surface for the offline-bake audio fields: voicePrompt +
 * prosody. The CONFIGURE tab still owns these for backward compatibility
 * (and because templates populate them there), but the dedicated tab
 * gives them room to breathe — Pocket TTS bake metadata, what would
 * change in a re-bake, links out to the bake script when it exists.
 *
 * Note: the CONFIGURE tab also persists these fields on its own saves
 * — if the author has unsaved changes here AND saves in CONFIGURE, the
 * CONFIGURE values win. The provider now listens for the
 * `harness:*-saved` family of events and refreshes the character prop,
 * so once CONFIGURE saves, this tab's `initial` re-derives from the
 * latest server state and the dirty-bit recomputes correctly. The only
 * remaining edge case is two tabs editing simultaneously without either
 * saving — first save wins; that's expected, not a bug.
 */
function L03AudioVoice({ character }: { character: HarnessCharacter }) {
  const initial = useMemo(
    () => ({
      voicePrompt: character.voiceStyle?.voicePrompt ?? "",
      prosody: character.voiceStyle?.prosody ?? [],
    }),
    [character.voiceStyle],
  );

  const [voicePrompt, setVoicePrompt] = useState(initial.voicePrompt);
  const [prosody, setProsody] = useState<string[]>(initial.prosody);
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  const isDirty = useMemo(
    () => JSON.stringify({ voicePrompt, prosody }) !== JSON.stringify(initial),
    [voicePrompt, prosody, initial],
  );

  const onSave = useCallback(async () => {
    setSave({ status: "saving" });
    try {
      // Preserve the four LLM-facing axes from the latest character
      // state — this tab doesn't edit them, but the save route replaces
      // the whole voiceStyle, so we have to round-trip them. Same
      // pattern would let CONFIGURE not clobber audio fields if the
      // refactor goes that direction.
      const voiceStyle: CharacterVoiceStyle = {};
      const v = character.voiceStyle ?? null;
      if (v?.tone?.length) voiceStyle.tone = v.tone;
      if (v?.decision) voiceStyle.decision = v.decision;
      if (v?.brevity) voiceStyle.brevity = v.brevity;
      if (v?.register) voiceStyle.register = v.register;
      if (v?.referenceClipUrl) voiceStyle.referenceClipUrl = v.referenceClipUrl;
      if (voicePrompt.trim()) voiceStyle.voicePrompt = voicePrompt.trim();
      if (prosody.length) voiceStyle.prosody = prosody;

      const res = await fetch(`/api/characters/${character.id}/voice-style`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceStyle }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      setSave({ status: "saved", at: Date.now() });
      window.dispatchEvent(new CustomEvent("harness:voice-style-saved"));
      window.dispatchEvent(new CustomEvent("harness:character-changed"));
    } catch (err) {
      setSave({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [character.id, character.voiceStyle, voicePrompt, prosody]);

  return (
    <div style={{ padding: "var(--space-32)", display: "flex", flexDirection: "column", gap: "var(--space-24)", width: "100%" }}>
      <SaveBar isDirty={isDirty} save={save} onSave={onSave} />

      <Card
        accent="violet"
        eyebrow="bake context · how this surface works"
        title="The audio path is offline"
        sub="Pocket TTS bakes voices ahead of time as .safetensors clips under services/audio-rt/voices/. The fields here brief the bake step — they do NOT take effect until you actually re-bake the voice clip. The Spoken Preview card (CONFIGURE tab) uses whatever clip is currently baked, not your unsaved edits here."
      >
        <div
          style={{
            padding: "10px 12px",
            background: "rgba(179,136,255,0.04)",
            border: "1px solid rgba(179,136,255,0.18)",
            borderRadius: "var(--radius-sm)",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: "rgba(179,136,255,0.95)",
            lineHeight: 1.55,
          }}
        >
          baked voice id · <strong>{character.slug}</strong>.safetensors · loaded from{" "}
          <code style={{ fontFamily: T.fontMono }}>services/audio-rt/voices/</code>
        </div>
      </Card>

      <Card
        accent="violet"
        eyebrow="voice prompt · for offline bake"
        title="Voice description"
        sub="Free-text brief for the TTS bake. Detail what the voice sounds like — age, build, register, accent cues, breath, distinctive cadence. The bake script reads this verbatim."
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
            {voicePrompt.length} / 2000
          </span>
        }
      >
        <TextArea
          value={voicePrompt}
          onChange={setVoicePrompt}
          placeholder="An older man, weathered by long travel under harsh sun. Unhurried cadence — he pauses for breath. Resonant chest voice, no accent identifiable to a specific region. Quiet but never frail."
          rows={6}
        />
      </Card>

      <Card
        accent="violet"
        eyebrow="prosody hints · for offline bake"
        title="Pacing & timbre tags"
        sub="Same as the voice description — these tags brief the bake. Pocket TTS doesn't accept per-call prosody; ElevenLabs would map these to style/stability knobs if/when we add it as a provider."
      >
        <ProsodyPalette selected={prosody} onChange={setProsody} />
      </Card>

      <Card
        accent="muted"
        eyebrow="re-bake signal · what changes if you re-bake"
        title="Bake-state summary"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <BakeStateRow label="voice id" value={`${character.slug}.safetensors`} />
          <BakeStateRow
            label="voice prompt diff"
            value={
              voicePrompt.trim() === (character.voiceStyle?.voicePrompt ?? "").trim()
                ? "unchanged from saved"
                : `edited · ${voicePrompt.length} chars (was ${(character.voiceStyle?.voicePrompt ?? "").length})`
            }
            warn={voicePrompt.trim() !== (character.voiceStyle?.voicePrompt ?? "").trim()}
          />
          <BakeStateRow
            label="prosody diff"
            value={
              JSON.stringify(prosody) === JSON.stringify(character.voiceStyle?.prosody ?? [])
                ? "unchanged from saved"
                : `edited · [${prosody.join(", ")}]`
            }
            warn={JSON.stringify(prosody) !== JSON.stringify(character.voiceStyle?.prosody ?? [])}
          />
          <BakeStateRow
            label="last bake (heuristic)"
            value="unknown — bake script doesn't currently emit a timestamp"
            muted
          />
        </div>
        <div
          style={{
            padding: "10px 14px",
            background: "rgba(255,184,112,0.04)",
            border: "1px dashed rgba(255,184,112,0.25)",
            borderRadius: "var(--radius-sm)",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: "var(--text-tertiary)",
            lineHeight: 1.55,
          }}
        >
          The bake pipeline script (<code style={{ fontFamily: T.fontMono }}>scripts/bake-voice-clip.ts</code>)
          is not yet written. Until it exists, &quot;re-bake&quot; means manually placing a new{" "}
          <code style={{ fontFamily: T.fontMono }}>{character.slug}.safetensors</code> in{" "}
          <code style={{ fontFamily: T.fontMono }}>services/audio-rt/voices/</code> and redeploying
          the audio service.
        </div>
      </Card>
    </div>
  );
}

function BakeStateRow({ label, value, warn, muted }: { label: string; value: string; warn?: boolean; muted?: boolean }) {
  const color = warn ? "rgba(255,184,112,0.95)" : muted ? "var(--text-quaternary)" : "var(--text-secondary)";
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-12)" }}>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.12em",
          color: "var(--text-tertiary)",
          textTransform: "uppercase",
          width: 160,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: T.fontMono, fontSize: 11.5, color, lineHeight: 1.5 }}>
        {value}
      </span>
    </div>
  );
}

/* ── HISTORY tab ───────────────────────────────────────────── */

/**
 * Timeline of distinct voice-style shapes seen across this character's
 * eval runs. Reconstructed from `eval_runs.characterSnapshot.voiceStyle`
 * + a stable FNV-1a hash. Same trade-off as L01/L02 HISTORY: voice
 * styles saved without a subsequent eval don't surface.
 *
 * Revert posts the snapshot's voiceStyle back through the existing API,
 * fires `harness:voice-style-saved` + `harness:character-changed`, then
 * reloads.
 */
type VoiceStyleHistoryEntry = {
  voiceStyleHash: string;
  voiceStyle: CharacterVoiceStyle | null;
  firstSeenAt: string;
  lastSeenAt: string;
  runCount: number;
  isCurrent: boolean;
};

function L03History({ character }: { character: HarnessCharacter }) {
  const [data, setData] = useState<VoiceStyleHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revertingHash, setRevertingHash] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${character.id}/voice-style/history`);
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { entries: VoiceStyleHistoryEntry[] };
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

  const revert = useCallback(async (entry: VoiceStyleHistoryEntry) => {
    setRevertingHash(entry.voiceStyleHash);
    setError(null);
    try {
      const res = await fetch(`/api/characters/${character.id}/voice-style`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceStyle: entry.voiceStyle }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      window.dispatchEvent(new CustomEvent("harness:voice-style-saved"));
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
            background: "var(--card)",
            border: "1px dashed var(--card-border)",
            borderRadius: "var(--radius-md)",
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-md)",
            color: "var(--text-tertiary)",
            lineHeight: 1.55,
          }}
        >
          No voice-style snapshots recorded yet. History reconstructs from eval
          runs — once you run a sweep, each distinct L03 voice style that was
          used appears here as a revertable checkpoint.
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
          voice-style timeline · {data.length} distinct snapshot{data.length === 1 ? "" : "s"}
        </span>
        <p style={{ margin: 0, fontFamily: T.fontBody, fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.55 }}>
          Reconstructed from eval runs against this character. Voice-style edits
          made without running an eval aren&apos;t captured here — to get a clean
          checkpoint, save and run any eval. Revert rewrites the saved voice
          style to the picked snapshot.
        </p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        {data.map((entry) => {
          const isReverting = revertingHash === entry.voiceStyleHash;
          return (
            <div
              key={entry.voiceStyleHash}
              style={{
                padding: "14px 18px",
                background: entry.isCurrent ? "rgba(140,231,210,0.04)" : "var(--card)",
                border: `1px solid ${entry.isCurrent ? "rgba(140,231,210,0.25)" : "var(--card-border)"}`,
                borderRadius: "var(--radius-md)",
                display: "flex",
                gap: "var(--space-16)",
                alignItems: "flex-start",
              }}
            >
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-6)", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-8)", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--foreground)" }}>
                    {summarizeVoiceStyle(entry.voiceStyle)}
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
                  hash {entry.voiceStyleHash}
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
                  border: `1px solid ${entry.isCurrent ? "var(--input-border)" : "rgba(255,184,112,0.3)"}`,
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
 * Headline summary for a voice-style snapshot. Composition matters more
 * than the raw values — tone palette + brevity + register quadrant is
 * what the author wants to compare.
 */
function summarizeVoiceStyle(v: CharacterVoiceStyle | null): string {
  if (!v) return "(unset — no <voice> block)";
  const bits: string[] = [];
  const tone = (v.tone ?? []).filter((t) => t?.trim());
  if (tone.length) bits.push(tone.join(" · "));
  if (v.brevity) bits.push(`brevity=${v.brevity}`);
  if (v.register) {
    const f = v.register.formality;
    const w = v.register.warmth;
    const fL = f >= 0.33 ? "formal" : f <= -0.33 ? "casual" : "balanced";
    const wL = w >= 0.33 ? "warm" : w <= -0.33 ? "cool" : "even";
    bits.push(`${fL}/${wL}`);
  }
  if (v.decision?.trim()) bits.push(`decision: ${v.decision.trim()}`);
  return bits.length > 0 ? bits.join(" · ") : "(audio-only — no text axes)";
}

/* ── Generic field helpers ─────────────────────────────────── */

function TextField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        padding: "10px 14px",
        background: "var(--input-bg)",
        border: "1px solid var(--input-border)",
        borderRadius: "var(--radius-sm)",
        color: "var(--foreground)",
        fontFamily: T.fontBody,
        fontSize: "var(--font-size-md)",
        outline: "none",
      }}
    />
  );
}

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
        background: "var(--input-bg)",
        border: "1px solid var(--input-border)",
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

/* ── Spoken preview ────────────────────────────────────────── */

/**
 * Hits `POST /api/characters/:id/probe/voice` with a sample sentence,
 * receives a base64 WAV, plays it via an inline <audio> element.
 *
 * Uses the character's slug as the voice id (audio-rt maps slug →
 * `.safetensors`). For Abraham this is `abraham.safetensors`, which
 * already exists. For new characters, a clip needs to be baked first.
 */
function SpokenPreviewCard({
  characterId,
  characterSlug,
  characterTitle,
  essence,
}: {
  characterId: string;
  characterSlug: string;
  characterTitle: string;
  essence: string | null;
}) {
  // Sensible default sample so the author can hit Play immediately without
  // typing. Prefers the L01 essence so the preview reflects the same
  // anchor that's compiled into <identity>; falls back to a tent-elder
  // line if L01 isn't authored yet.
  const defaultSample = essence
    ? `I am ${characterTitle}. ${capitalizeFirst(essence)}.`
    : `Sit awhile, my friend. Tell me what burdens you.`;
  const [sample, setSample] = useState(defaultSample);

  type PlaybackState =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; src: string; totalMs: number; firstAudioMs: number | null; durationMs: number; voice: string }
    | { kind: "error"; message: string };
  const [state, setState] = useState<PlaybackState>({ kind: "idle" });

  const onPlay = useCallback(async () => {
    const text = sample.trim();
    if (!text) return;
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/characters/${characterId}/probe/voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
      }
      const src = `data:${body.mimeType};base64,${body.audioBase64}`;
      setState({
        kind: "ready",
        src,
        totalMs: body.totalMs ?? 0,
        firstAudioMs: body.firstAudioMs ?? null,
        durationMs: body.durationMs ?? 0,
        voice: body.voice ?? characterSlug,
      });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [characterId, characterSlug, sample]);

  return (
    <section
      style={{
        padding: "var(--space-24)",
        background: "var(--card)",
        border: "1px solid rgba(140,231,210,0.18)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-16)",
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.14em",
              color: "var(--accent-strong)",
              textTransform: "uppercase",
            }}
          >
            spoken preview · kyutai pocket TTS · voice = {characterSlug}
          </span>
        </div>
        <span
          style={{
            fontFamily: T.fontHeading,
            fontSize: "var(--font-size-2xl)",
            fontWeight: 600,
            color: "var(--foreground)",
          }}
        >
          Hear the voice
        </span>
        <span
          style={{
            fontFamily: T.fontBody,
            fontSize: "var(--font-size-base)",
            color: "var(--text-tertiary)",
            lineHeight: 1.5,
          }}
        >
          Synthesizes the sample below using the baked{" "}
          <code style={{ fontFamily: T.fontMono }}>{characterSlug}.safetensors</code> voice
          file. Latency ~1–3s for a one-liner.
        </span>
      </header>

      <TextArea
        value={sample}
        onChange={setSample}
        placeholder="Type any sample text…"
        rows={3}
      />

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
        <button
          type="button"
          onClick={onPlay}
          disabled={state.kind === "loading" || !sample.trim()}
          style={{
            padding: "8px 18px",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            background: "rgba(140,231,210,0.14)",
            border: "1px solid rgba(140,231,210,0.4)",
            color: "var(--accent-strong)",
            borderRadius: "var(--radius-sm)",
            cursor: state.kind === "loading" ? "wait" : "pointer",
            opacity: !sample.trim() ? 0.4 : 1,
          }}
        >
          {state.kind === "loading" ? "synthesizing…" : "▶ play"}
        </button>
        <PlaybackStatus state={state} />
      </div>

      {state.kind === "ready" && (
        <audio
          key={state.src}
          src={state.src}
          autoPlay
          controls
          style={{ width: "100%" }}
        />
      )}
    </section>
  );
}

function PlaybackStatus({
  state,
}: {
  state:
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; totalMs: number; firstAudioMs: number | null; durationMs: number; voice: string }
    | { kind: "error"; message: string };
}) {
  if (state.kind === "idle") {
    return (
      <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)" }}>
        idle — click play to synthesize
      </span>
    );
  }
  if (state.kind === "loading") {
    return (
      <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "rgba(255,184,112,0.95)" }}>
        calling audio-rt /speak…
      </span>
    );
  }
  if (state.kind === "error") {
    return (
      <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--danger)" }}>
        error: {state.message}
      </span>
    );
  }
  // ready
  return (
    <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--accent-strong)" }}>
      {(state.durationMs / 1000).toFixed(1)}s clip · total {state.totalMs}ms
      {state.firstAudioMs !== null ? ` · TTFA ${state.firstAudioMs}ms` : ""}
    </span>
  );
}

function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
