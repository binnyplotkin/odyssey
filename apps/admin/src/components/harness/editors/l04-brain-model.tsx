"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CharacterBrainModel } from "@odyssey/db";
import type { HarnessCharacter } from "../harness-types";
import { MODEL_REGISTRY, DEFAULT_CHAT_MODEL, modelsFor } from "@/lib/model-registry";
import { formatRelative } from "../shared/format-relative";
import { ModelBrowser } from "./model-browser";

/**
 * L04 Brain / Model editor — per-character LLM substrate config.
 *
 *   - Primary model picker (chat-compatible Anthropic models)
 *   - Sampling sliders (temperature 0–2, top_p 0–1, max_tokens 64–4096)
 *   - Cache control toggle (default on; off is an A/B testing escape hatch)
 *   - Fallback chain (schema-only in 1.4a; chat route doesn't act on it yet)
 *
 * Save flow mirrors L01/L02/L03. Dispatches `harness:brain-model-saved`
 * so the right-rail preview re-fetches (cache may flip cached/uncached
 * if the cacheControl flag changed).
 */

const T = {
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

// Pre-v2 this filtered to Anthropic-only. Multi-provider chat means we
// now show every chat-capable model in the registry. The picker groups by
// provider so the user can scan within a single vendor's lineup.
const CHAT_MODELS = MODEL_REGISTRY.filter((m) => m.modes.includes("chat"));

// Voice surface wires Anthropic + Cerebras + Groq today (OpenAI's realtime
// shape isn't integrated). Used by the optional "Voice mode" override card
// so the voice picker can't surface a model the voice-stream route would
// 400 on.
const VOICE_MODELS = modelsFor("voice").filter(
  (m) => m.provider === "anthropic" || m.provider === "cerebras" || m.provider === "groq",
);

const DEFAULTS = {
  model: DEFAULT_CHAT_MODEL,
  temperature: 1.0, // Anthropic default
  topP: 1.0, // Anthropic default
  maxTokens: 1024,
  cacheControl: true,
  // Starter pick when the author flips "pin separate model" on. GPT-OSS 120B
  // is the empirically-validated default after the Abraham head-to-head:
  // mean 18.7/20 (within 1.5% of Sonnet) at ~650ms TTFT and ~8× cheaper.
  // Author can pick anything else from the voice-capable list once the
  // picker mounts.
  voiceFallback: "openai/gpt-oss-120b",
};

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; at: number }
  | { status: "error"; message: string };

type Props = {
  character: HarnessCharacter;
  /**
   * Which tab the LayerHeader has selected. The configure tab renders
   * the editor; presets / runs / history render their own surfaces.
   * Defaults to "configure" so this component can still mount standalone
   * (e.g. in tests) without a header.
   */
  activeTab?: string;
};

export function L04BrainModel({ character, activeTab = "configure" }: Props) {
  if (activeTab === "presets") return <L04Presets character={character} />;
  if (activeTab === "runs") return <L04Runs character={character} />;
  if (activeTab === "history") return <L04History character={character} />;
  return <L04Configure character={character} />;
}

/**
 * The CONFIGURE tab — the original L04 editor surface. Saving here
 * writes the character's L04 Brain/Model record; the other three tabs
 * are read-only views except for PRESETS which mutates the same draft.
 *
 * Extracted from `L04BrainModel` so the tab switch above can compose
 * the four surfaces cleanly. Behavior unchanged from the pre-tabs
 * version — every state setter, save handler, and card is identical.
 */
function L04Configure({ character }: { character: HarnessCharacter }) {
  const initial = useMemo(() => toDraft(character.brainModel), [character.brainModel]);

  const [model, setModel] = useState<string>(initial.model);
  const [temperature, setTemperature] = useState<number>(initial.temperature);
  const [topP, setTopP] = useState<number>(initial.topP);
  const [maxTokens, setMaxTokens] = useState<number>(initial.maxTokens);
  const [cacheControl, setCacheControl] = useState<boolean>(initial.cacheControl);
  const [fallbacks, setFallbacks] = useState<CharacterBrainModel["fallbacks"]>(
    initial.fallbacks,
  );
  // Voice override — when null the voice-stream route uses the chat model
  // above (inherits everything). When set, the author has explicitly pinned
  // a separate voice-mode substrate. The "Voice mode" card's "Pin a separate
  // model" toggle flips this between null and a starter pick.
  const [voiceModel, setVoiceModel] = useState<string | null>(initial.voiceModel);
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  const isDirty = useMemo(() => {
    const current = JSON.stringify({ model, temperature, topP, maxTokens, cacheControl, fallbacks, voiceModel });
    return current !== JSON.stringify(initial);
  }, [model, temperature, topP, maxTokens, cacheControl, fallbacks, voiceModel, initial]);

  // Capability-aware UI gating — when the selected model doesn't support
  // a parameter, its control disables. Source of truth is the registry
  // entry's `capabilities` flags; the providers also drop unsupported
  // params before sending, so this is a clarity-only UI signal (no
  // backend behavior depends on it).
  const modelMeta = useMemo(() => MODEL_REGISTRY.find((m) => m.id === model), [model]);
  const supportsTemperature = modelMeta?.capabilities.temperature !== false;
  const supportsTopP = modelMeta?.capabilities.topP !== false;
  const supportsPromptCache = modelMeta?.capabilities.promptCache === true;

  const onSave = useCallback(async () => {
    setSave({ status: "saving" });
    try {
      // Only send fields that differ from the runtime defaults — anything
      // matching default stays null/undefined in storage so the chat route
      // falls back cleanly. `provider` is derived from the selected model
      // via the registry so we don't have to keep an extra dropdown in
      // sync; the brain-model API also re-coerces this on save as a safety
      // net.
      const selected = MODEL_REGISTRY.find((m) => m.id === model);
      const provider = selected?.provider;
      const brainModel: CharacterBrainModel = {};
      if (
        provider === "anthropic" ||
        provider === "openai" ||
        provider === "cerebras" ||
        provider === "groq"
      ) {
        brainModel.provider = provider;
      }
      brainModel.model = model; // always store explicit model
      if (temperature !== DEFAULTS.temperature) brainModel.temperature = temperature;
      if (topP !== DEFAULTS.topP) brainModel.topP = topP;
      if (maxTokens !== DEFAULTS.maxTokens) brainModel.maxTokens = maxTokens;
      if (cacheControl !== DEFAULTS.cacheControl) brainModel.cacheControl = cacheControl;
      if (fallbacks?.length) brainModel.fallbacks = fallbacks;
      // Voice override — only send the block when the author has pinned a
      // separate model. Null state = inherit chat model, no `voice` field
      // persisted (route falls back through `voice → top-level → default`).
      if (voiceModel) {
        const voiceMeta = VOICE_MODELS.find((m) => m.id === voiceModel);
        const voiceProvider = voiceMeta?.provider;
        const voice: NonNullable<CharacterBrainModel["voice"]> = { model: voiceModel };
        if (
          voiceProvider === "anthropic" ||
          voiceProvider === "cerebras" ||
          voiceProvider === "groq"
        ) {
          voice.provider = voiceProvider;
        }
        brainModel.voice = voice;
      }

      const res = await fetch(`/api/characters/${character.id}/brain-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brainModel }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body.slice(0, 200)}`);
      }
      setSave({ status: "saved", at: Date.now() });
      window.dispatchEvent(new CustomEvent("harness:brain-model-saved"));
    } catch (err) {
      setSave({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [character.id, model, temperature, topP, maxTokens, cacheControl, fallbacks, voiceModel]);

  return (
    <div style={{ padding: "var(--space-32)", display: "flex", flexDirection: "column", gap: "var(--space-24)", width: "100%" }}>
      <SaveBar isDirty={isDirty} save={save} onSave={onSave} />

      <Card
        accent="gray"
        eyebrow="tier 0 substrate · primary"
        title="Model"
        sub="Which LLM runs this character. Anthropic, OpenAI, and Cerebras open-weights are all chat-capable — pick by cost, latency, or quality."
      >
        <ModelPicker value={model} onChange={setModel} />
      </Card>

      <Card
        accent="muted"
        eyebrow="explore · filter · compare"
        title="Browse all models"
        sub="Sortable table across providers with side-by-side compare. Use this to find candidates worth sweeping against the current preset."
      >
        <ModelBrowser currentModel={model} onAdopt={setModel} />
      </Card>

      <Card
        accent="pink"
        eyebrow="voice mode · optional override"
        title="Pin a separate model for voice"
        sub={
          voiceModel
            ? "Voice turns use this model; the chat model above is unaffected. Inherits temperature, top_p, and max_tokens from chat."
            : "Voice turns currently use the chat model. Pin a faster substrate here if the chat model is too slow for spoken latency (~600ms TTFT target)."
        }
        action={
          <button
            type="button"
            onClick={() => setVoiceModel(voiceModel ? null : DEFAULTS.voiceFallback)}
            style={{
              padding: "5px 10px",
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              background: voiceModel ? "rgba(255,122,155,0.12)" : "var(--control-bg)",
              border: `1px solid ${voiceModel ? "rgba(255,122,155,0.4)" : "var(--control-border)"}`,
              color: voiceModel ? "rgba(255,122,155,0.95)" : "var(--text-secondary)",
              borderRadius: "var(--radius-xs)",
              cursor: "pointer",
            }}
          >
            {voiceModel ? "inherit from chat" : "pin separate model"}
          </button>
        }
      >
        {voiceModel && (
          <VoiceModelPicker
            value={voiceModel}
            onChange={setVoiceModel}
            chatModel={model}
          />
        )}
      </Card>

      <Card
        accent="phosphor"
        eyebrow="sampling parameters"
        title="How creative · how bounded"
        sub="Three knobs that govern every generation. Sliders dim when the selected model locks the parameter to its default."
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-16)" }}>
          {/* Capability gating reads from the registry: when the selected
              model has `capabilities.temperature: false` (or topP), the
              corresponding slider disables with an explanatory note. The
              provider drops the param anyway, so we surface that decision
              in the UI rather than letting the user think it's wired. */}
          <SamplingKnob
            label="temperature"
            value={temperature}
            onChange={setTemperature}
            min={0}
            max={2}
            step={0.05}
            tickLabels={["0.0 · deterministic", "1.0 · neutral", "2.0 · chaotic"]}
            tip="Lower keeps the character consistent across reruns. 0.6–0.8 is the in-character sweet spot."
            disabled={!supportsTemperature}
            disabledReason={
              supportsTemperature ? undefined : `${modelMeta?.label ?? model} locks temperature to default (1.0)`
            }
          />
          <SamplingKnob
            label="top_p"
            value={topP}
            onChange={setTopP}
            min={0}
            max={1}
            step={0.01}
            tickLabels={["0.1 · narrow", "0.5", "1.0 · full"]}
            tip="Nucleus sampling. Anthropic recommends tuning temp OR top_p, not both at once."
            disabled={!supportsTopP}
            disabledReason={
              supportsTopP ? undefined : `${modelMeta?.label ?? model} locks top_p to default (1.0)`
            }
          />
          <SamplingKnob
            label="max_tokens"
            value={maxTokens}
            onChange={(v) => setMaxTokens(Math.round(v))}
            min={64}
            max={4096}
            step={64}
            tickLabels={["64 · terse", "1024", "4096 · long-form"]}
            tip="Hard ceiling on the response. L03 brevity sets the soft default; this is the wall."
            format={(v) => Math.round(v).toString()}
          />
        </div>
        {supportsTemperature && supportsTopP &&
          Math.abs(temperature - 1) > 0.01 && Math.abs(topP - 1) > 0.01 && (
            <Advisory>
              temp {temperature.toFixed(2)} + top_p {topP.toFixed(2)} — both off neutral.
              Pin one to default and tune the other for cleaner attribution.
            </Advisory>
          )}
      </Card>

      <Card
        accent="pink"
        eyebrow="prompt cache · cache_control header"
        title="Cache the system envelope"
        sub={
          supportsPromptCache
            ? "T1 layers cache once per session — Anthropic gives ~90% off input cost on every turn after the first within a 5-min TTL. Off is an A/B testing escape hatch."
            : `${modelMeta?.label ?? model} doesn't expose prompt caching. The flag is stored for when you swap to a cache-capable model.`
        }
        action={
          <Toggle
            value={cacheControl}
            onChange={setCacheControl}
            onLabel="enabled"
            offLabel="off"
            disabled={!supportsPromptCache}
          />
        }
      />

      <Card
        accent="muted"
        eyebrow="fallback chain · schema-only in 1.4a"
        title="When the primary trips"
        sub="Declare the chain of models to try on 5xx or rate-limit. The runtime does NOT act on this yet — the chat route only calls the primary in 1.4a. Authoring it now means 1.4b can wire it cleanly."
        action={
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              padding: "5px 10px",
              background: "rgba(255,184,112,0.08)",
              border: "1px solid rgba(255,184,112,0.25)",
              borderRadius: "var(--radius-xs)",
              color: "rgba(255,184,112,0.95)",
            }}
          >
            not wired · 1.4b
          </span>
        }
      >
        <FallbackChain value={fallbacks ?? []} onChange={setFallbacks} primaryModel={model} />
      </Card>
    </div>
  );
}

/* ── PRESETS tab ───────────────────────────────────────────── */

/**
 * Named substrate snapshots the author can adopt with one click. These
 * are the configs that pay rent — they're battle-tested against the
 * Abraham eval suite (or codify a well-known sampling regime) and serve
 * as a starting point or quick-flip target.
 *
 * "Apply" writes to the SAME `brainModel` API endpoint the CONFIGURE
 * tab uses, then dispatches `harness:brain-model-saved` so the right rail
 * and any preview re-fetches. There's no draft-then-save here — pressing
 * apply commits immediately, on the theory that presets are pre-vetted
 * and the author can always revert via the HISTORY tab.
 *
 * Future work — user-defined presets: store under `character.brainModel.userPresets`
 * or a dedicated `brain_model_presets` table. For 1.4a the fixed library
 * is the only thing exposed.
 */
type Preset = {
  id: string;
  label: string;
  eyebrow: string;
  /** One-sentence positioning. */
  description: string;
  /** Headline metric or differentiator shown to the right of the label. */
  signal?: string;
  /** Background tint chip — picks accent color and badge label. */
  accent: "phosphor" | "pink" | "gray" | "muted";
  /** Partial mind/model — only the keys present here are written; others
   * stay at their current values. So a sampling-only preset (e.g.
   * "Deterministic") doesn't blow away the author's voice override. */
  config: Partial<CharacterBrainModel>;
};

const PRESETS: Preset[] = [
  {
    id: "production-sonnet",
    label: "Production · Sonnet 4.5",
    eyebrow: "frontier-grade chat",
    description: "Anthropic's daily-driver. Highest in-character quality, prompt cache enabled, neutral sampling.",
    signal: "19/20 · $0.31/run · 4.7s",
    accent: "phosphor",
    config: {
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      temperature: 1.0,
      topP: 1.0,
      maxTokens: 1024,
      cacheControl: true,
    },
  },
  {
    id: "production-gpt-oss",
    label: "Production · GPT-OSS 120B",
    eyebrow: "cost-optimized chat",
    description: "OpenAI open-weights on Cerebras silicon. Within 1.5% of Sonnet quality at ~8× cheaper, ~7× faster.",
    signal: "18.7/20 · $0.037/run · 0.65s",
    accent: "phosphor",
    config: {
      provider: "cerebras",
      model: "gpt-oss-120b",
      temperature: 1.0,
      topP: 1.0,
      maxTokens: 1024,
      cacheControl: true, // ignored by Cerebras provider; stored for symmetry
    },
  },
  {
    id: "voice-groq-gpt-oss",
    label: "Voice · Groq GPT-OSS 120B",
    eyebrow: "low-latency voice pin",
    description: "Chat stays on whatever's set; voice turns flip to Groq GPT-OSS for sub-second TTFT. Drop-in for the demo voice pipeline.",
    signal: "650ms TTFT · voice-only override",
    accent: "pink",
    config: {
      voice: { provider: "groq", model: "openai/gpt-oss-120b" },
    },
  },
  {
    id: "frontier-opus",
    label: "Frontier · Opus 4.5",
    eyebrow: "max quality regardless of cost",
    description: "Anthropic's flagship. Worth the spend when you're vetting hard scenes or capturing reference behavior.",
    signal: "$3-15/M · longest TTFT",
    accent: "gray",
    config: {
      provider: "anthropic",
      model: "claude-opus-4-5",
      temperature: 1.0,
      topP: 1.0,
      maxTokens: 1024,
      cacheControl: true,
    },
  },
  {
    id: "deterministic",
    label: "Deterministic · temp 0.2",
    eyebrow: "sampling only · reproducible",
    description: "Doesn't touch the model — pins temperature low for run-to-run consistency. Use when you're debugging a single failing probe.",
    accent: "muted",
    config: { temperature: 0.2, topP: 1.0 },
  },
  {
    id: "creative",
    label: "Creative · temp 1.2",
    eyebrow: "sampling only · high-variance",
    description: "Cranks temperature past neutral. Surface the model's wider distribution — useful for stress-testing voice consistency.",
    accent: "muted",
    config: { temperature: 1.2, topP: 0.95 },
  },
];

function L04Presets({ character }: { character: HarnessCharacter }) {
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentMm = character.brainModel ?? null;

  const apply = useCallback(async (preset: Preset) => {
    setApplyingId(preset.id);
    setError(null);
    try {
      // Merge into current config so sampling-only presets don't blow
      // away the saved model, and vice versa. Voice block merges per-field
      // — applying the voice preset doesn't reset the author's voice temp.
      const merged: CharacterBrainModel = { ...(currentMm ?? {}) };
      if (preset.config.provider !== undefined) merged.provider = preset.config.provider;
      if (preset.config.model !== undefined) merged.model = preset.config.model;
      if (preset.config.temperature !== undefined) merged.temperature = preset.config.temperature;
      if (preset.config.topP !== undefined) merged.topP = preset.config.topP;
      if (preset.config.maxTokens !== undefined) merged.maxTokens = preset.config.maxTokens;
      if (preset.config.cacheControl !== undefined) merged.cacheControl = preset.config.cacheControl;
      if (preset.config.fallbacks !== undefined) merged.fallbacks = preset.config.fallbacks;
      if (preset.config.voice !== undefined) {
        merged.voice = { ...(merged.voice ?? {}), ...preset.config.voice };
      }

      const res = await fetch(`/api/characters/${character.id}/brain-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brainModel: merged }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body.slice(0, 200)}`);
      }
      window.dispatchEvent(new CustomEvent("harness:brain-model-saved"));
      // Tell the harness shell to re-fetch the character. The configure
      // tab's `useMemo(toDraft)` keys off character.brainModel; firing
      // this event triggers a soft refresh so flipping to "configure"
      // after applying shows the new state.
      window.dispatchEvent(new CustomEvent("harness:character-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingId(null);
    }
  }, [character.id, currentMm]);

  // Compare each preset's config to the currently-saved record so the
  // applied preset shows a "● applied" badge — gives the author a
  // ground-truth signal for which preset is live.
  const matches = useCallback((preset: Preset) => {
    if (!currentMm) return false;
    for (const [k, v] of Object.entries(preset.config)) {
      // Voice block compares structurally — preset.config.voice is a
      // partial that must be a subset of currentMm.voice for a match.
      if (k === "voice") {
        const cv = currentMm.voice ?? {};
        const pv = v as NonNullable<CharacterBrainModel["voice"]>;
        for (const [vk, vv] of Object.entries(pv)) {
          if ((cv as Record<string, unknown>)[vk] !== vv) return false;
        }
        continue;
      }
      if ((currentMm as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
  }, [currentMm]);

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
          one-click apply · pre-vetted substrate snapshots
        </span>
        <p style={{ margin: 0, fontFamily: T.fontBody, fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.55 }}>
          Sampling-only presets (deterministic / creative) leave your saved model untouched. Model presets overwrite the substrate but preserve voice overrides. Apply commits immediately — revert via the HISTORY tab if needed.
        </p>
      </header>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            background: "rgba(255,122,155,0.08)",
            border: "1px solid rgba(255,122,155,0.3)",
            borderRadius: "var(--radius-sm)",
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-sm)",
            color: "rgba(255,122,155,0.95)",
          }}
        >
          apply failed · {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-12)" }}>
        {PRESETS.map((preset) => {
          const isApplied = matches(preset);
          const isApplying = applyingId === preset.id;
          const accentBg = {
            phosphor: "rgba(140,231,210,0.06)",
            pink: "rgba(255,122,155,0.06)",
            gray: "rgba(255,255,255,0.04)",
            muted: "var(--control-bg)",
          }[preset.accent];
          const accentBorder = {
            phosphor: "rgba(140,231,210,0.25)",
            pink: "rgba(255,122,155,0.25)",
            gray: "rgba(255,255,255,0.12)",
            muted: "var(--control-border)",
          }[preset.accent];
          const accentEyebrow = {
            phosphor: "var(--accent-strong)",
            pink: "rgba(255,122,155,0.95)",
            gray: "rgba(255,255,255,0.6)",
            muted: "var(--text-tertiary)",
          }[preset.accent];

          return (
            <div
              key={preset.id}
              style={{
                padding: "18px 20px",
                background: accentBg,
                border: `1px solid ${accentBorder}`,
                borderRadius: "var(--radius-md)",
                display: "flex",
                gap: "var(--space-16)",
                alignItems: "flex-start",
              }}
            >
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-6)", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)", flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontFamily: T.fontMono,
                      fontSize: "var(--font-size-xs)",
                      letterSpacing: "0.12em",
                      color: accentEyebrow,
                      textTransform: "uppercase",
                    }}
                  >
                    {preset.eyebrow}
                  </span>
                  {isApplied && (
                    <span
                      style={{
                        fontFamily: T.fontMono,
                        fontSize: 9.5,
                        padding: "1px 6px",
                        borderRadius: "var(--radius-xs)",
                        background: "rgba(140,231,210,0.12)",
                        color: "var(--accent-strong)",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      ● applied
                    </span>
                  )}
                </div>
                <span style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-xl)", fontWeight: 600, color: "var(--foreground)" }}>
                  {preset.label}
                </span>
                <span style={{ fontFamily: T.fontBody, fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
                  {preset.description}
                </span>
                {preset.signal && (
                  <span style={{ fontFamily: T.fontMono, fontSize: 10.5, color: "var(--text-quaternary)" }}>
                    {preset.signal}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => !isApplied && !isApplying && apply(preset)}
                disabled={isApplied || isApplying}
                style={{
                  padding: "8px 16px",
                  fontFamily: T.fontMono,
                  fontSize: "var(--font-size-xs)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  background: isApplied
                    ? "transparent"
                    : isApplying
                      ? "rgba(140,231,210,0.06)"
                      : "rgba(140,231,210,0.14)",
                  border: `1px solid ${isApplied ? "var(--control-border)" : "rgba(140,231,210,0.4)"}`,
                  color: isApplied ? "var(--text-quaternary)" : "var(--accent-strong)",
                  borderRadius: "var(--radius-xs)",
                  cursor: isApplied || isApplying ? "default" : "pointer",
                  flexShrink: 0,
                }}
              >
                {isApplied ? "applied" : isApplying ? "applying…" : "apply"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── RUNS tab ──────────────────────────────────────────────── */

/**
 * Per-config eval summary for this character. Reads `eval_runs` grouped
 * by `configHash` (purpose-built index already on the table — see
 * `eval_runs_config_hash_idx`), surfaces win/loss/cost/latency per
 * distinct substrate config so the author can see at a glance which
 * presets actually held up against the suite.
 *
 * Backed by GET /api/characters/:id/brain-model/runs (added below).
 */
type RunGroup = {
  configHash: string;
  modelLabel: string;
  modelId: string;
  provider: string;
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
  runCount: number;
  totalPassed: number;
  totalProbes: number;
  meanPass: number;
  meanAvg: number;
  meanLatencyMs: number;
  meanCostUsd: number;
  firstSeenAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
};

function L04Runs({ character }: { character: HarnessCharacter }) {
  const [data, setData] = useState<RunGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/characters/${character.id}/brain-model/runs`);
        if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
        const body = await res.json() as { groups: RunGroup[] };
        if (!cancelled) setData(body.groups);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [character.id]);

  if (error) {
    return (
      <div style={{ padding: "var(--space-32)", fontFamily: T.fontMono, fontSize: "var(--font-size-base)", color: "rgba(255,122,155,0.9)" }}>
        runs query failed · {error}
      </div>
    );
  }
  if (data === null) {
    return <div style={{ padding: "var(--space-32)", fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--text-tertiary)" }}>loading runs…</div>;
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
          No eval runs against this character yet. Run a sweep against the Abraham suite (or another suite if you have one) and this tab will fill in with per-config win/loss summaries.
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
          eval runs grouped by substrate config · {data.length} distinct config{data.length === 1 ? "" : "s"}
        </span>
        <p style={{ margin: 0, fontFamily: T.fontBody, fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.55 }}>
          Each row aggregates every run that hit the same configHash. Sorted by mean pass rate so the strongest configs surface first.
        </p>
      </header>

      <div
        style={{
          background: "var(--material-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(180px, 1.5fr) 80px 90px 90px 90px 90px 120px",
            gap: "var(--space-12)",
            padding: "10px 16px",
            background: "rgba(255,255,255,0.03)",
            borderBottom: "1px solid var(--border-subtle)",
            fontFamily: T.fontMono,
            fontSize: 9.5,
            letterSpacing: "0.1em",
            color: "var(--text-tertiary)",
            textTransform: "uppercase",
          }}
        >
          <span>config</span>
          <span>runs</span>
          <span>mean pass</span>
          <span>mean ⌀</span>
          <span>latency</span>
          <span>cost/run</span>
          <span>last seen</span>
        </div>
        {data.map((g) => (
          <div
            key={g.configHash}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(180px, 1.5fr) 80px 90px 90px 90px 90px 120px",
              gap: "var(--space-12)",
              padding: "12px 16px",
              borderBottom: "1px solid var(--border-subtle)",
              alignItems: "center",
              background: g.isCurrent ? "rgba(140,231,210,0.04)" : "transparent",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-8)" }}>
                <span
                  style={{
                    fontFamily: T.fontHeading,
                    fontSize: "var(--font-size-md)",
                    fontWeight: 600,
                    color: "var(--foreground)",
                  }}
                >
                  {g.modelLabel}
                </span>
                {g.isCurrent && (
                  <span
                    style={{
                      fontFamily: T.fontMono,
                      fontSize: "var(--font-size-2xs)",
                      padding: "1px 5px",
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
              <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--text-quaternary)" }}>
                {g.provider} · {g.modelId} · temp {g.temperature?.toFixed(2) ?? "—"} · topP {g.topP?.toFixed(2) ?? "—"} · maxTok {g.maxTokens ?? "—"}
              </span>
            </div>
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-base)", color: "var(--text-secondary)" }}>
              {g.runCount}
            </span>
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-base)", color: "var(--accent-strong)" }}>
              {g.meanPass.toFixed(1)}/{(g.totalProbes / g.runCount).toFixed(0)}
            </span>
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-base)", color: "var(--text-secondary)" }}>
              {g.meanAvg.toFixed(2)}
            </span>
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-base)", color: "var(--text-secondary)" }}>
              {Math.round(g.meanLatencyMs)}ms
            </span>
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-base)", color: "var(--text-secondary)" }}>
              ${g.meanCostUsd.toFixed(4)}
            </span>
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--text-quaternary)" }}>
              {formatRelative(g.lastSeenAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── HISTORY tab ───────────────────────────────────────────── */

/**
 * Timeline of distinct mind/model configs seen across this character's
 * eval runs. There's no dedicated character_versions table yet — we
 * reconstruct the history from `eval_runs.characterSnapshot.brainModel`
 * + `configHash`. This captures every config change followed by an
 * eval; changes without an eval are invisible until the next run.
 *
 * "Revert" rewrites the character's `brainModel` back to the snapshot.
 * The same `harness:brain-model-saved` event fires, so the CONFIGURE
 * tab and right rail re-render against the rolled-back state.
 */
type HistoryEntry = {
  configHash: string;
  brainModel: CharacterBrainModel | null;
  firstSeenAt: string;
  lastSeenAt: string;
  runCount: number;
  isCurrent: boolean;
};

function L04History({ character }: { character: HarnessCharacter }) {
  const [data, setData] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revertingHash, setRevertingHash] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${character.id}/brain-model/history`);
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json() as { entries: HistoryEntry[] };
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

  const revert = useCallback(async (entry: HistoryEntry) => {
    setRevertingHash(entry.configHash);
    setError(null);
    try {
      const res = await fetch(`/api/characters/${character.id}/brain-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brainModel: entry.brainModel }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      window.dispatchEvent(new CustomEvent("harness:brain-model-saved"));
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
      <div style={{ padding: "var(--space-32)", fontFamily: T.fontMono, fontSize: "var(--font-size-base)", color: "rgba(255,122,155,0.9)" }}>
        history query failed · {error}
      </div>
    );
  }
  if (data === null) {
    return <div style={{ padding: "var(--space-32)", fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--text-tertiary)" }}>loading history…</div>;
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
          No mind/model snapshots recorded yet. History is reconstructed from eval runs — once you run a sweep, each distinct config that was used appears here as a revertable checkpoint.
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
          mind/model timeline · {data.length} distinct snapshot{data.length === 1 ? "" : "s"}
        </span>
        <p style={{ margin: 0, fontFamily: T.fontBody, fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.55 }}>
          Reconstructed from eval runs against this character. Configs changed outside of evals aren't captured here — to get a clean checkpoint, save your changes and run any eval. Revert rewrites the saved brainModel to the picked snapshot.
        </p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        {data.map((entry) => {
          const isReverting = revertingHash === entry.configHash;
          return (
            <div
              key={entry.configHash}
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
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-4)", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-8)", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--foreground)" }}>
                    {summarizeBrainModel(entry.brainModel)}
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
                  hash {entry.configHash.slice(0, 12)}…
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

/* ── Shared helpers ────────────────────────────────────────── */

/** Plain-English summary line for a mind/model snapshot, used in the
 * HISTORY card title. Models are looked up by id so renamed labels in
 * the registry travel with the history. */
function summarizeBrainModel(mm: CharacterBrainModel | null): string {
  if (!mm) return "(unset — runtime defaults)";
  const meta = mm.model ? MODEL_REGISTRY.find((m) => m.id === mm.model) : null;
  const modelLabel = meta?.label ?? mm.model ?? "(default model)";
  const bits: string[] = [modelLabel];
  if (typeof mm.temperature === "number" && Math.abs(mm.temperature - 1) > 0.01) {
    bits.push(`t=${mm.temperature.toFixed(2)}`);
  }
  if (typeof mm.topP === "number" && Math.abs(mm.topP - 1) > 0.01) {
    bits.push(`p=${mm.topP.toFixed(2)}`);
  }
  if (mm.voice?.model) {
    const vMeta = MODEL_REGISTRY.find((m) => m.id === mm.voice?.model);
    bits.push(`voice→${vMeta?.label ?? mm.voice.model}`);
  }
  return bits.join(" · ");
}

/* ── Draft conversion ──────────────────────────────────────── */

type Draft = {
  model: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  cacheControl: boolean;
  fallbacks: CharacterBrainModel["fallbacks"];
  /** null = inherit chat model for voice; string = explicit voice override. */
  voiceModel: string | null;
};

function toDraft(mm: CharacterBrainModel | null): Draft {
  return {
    model: mm?.model ?? DEFAULTS.model,
    temperature: mm?.temperature ?? DEFAULTS.temperature,
    topP: mm?.topP ?? DEFAULTS.topP,
    maxTokens: mm?.maxTokens ?? DEFAULTS.maxTokens,
    cacheControl: mm?.cacheControl ?? DEFAULTS.cacheControl,
    fallbacks: mm?.fallbacks ?? [],
    voiceModel: mm?.voice?.model ?? null,
  };
}

/* ── Save bar (same shape as other editors) ────────────────── */

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
  else if (save.status === "saved") statusEl = <Status tone="accent">saved · sandbox uses new model on next turn</Status>;
  else if (save.status === "error") statusEl = <Status tone="danger">save failed · {save.message}</Status>;
  else if (isDirty) statusEl = <Status tone="amber">unsaved changes</Status>;
  else statusEl = <Status tone="muted">in sync with runtime defaults / saved config</Status>;

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
        L04 · mind / model
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
        save mind / model
      </button>
    </div>
  );
}

function Status({ children, tone }: { children: React.ReactNode; tone: "accent" | "amber" | "danger" | "muted" }) {
  const colorMap = {
    accent: "var(--accent-strong)",
    amber: "rgba(255,184,112,0.95)",
    danger: "var(--status-error)",
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
  accent: "gray" | "phosphor" | "pink" | "muted";
  eyebrow: string;
  title: string;
  sub?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const borderMap = {
    gray: "rgba(255,255,255,0.10)",
    phosphor: "rgba(140,231,210,0.18)",
    pink: "rgba(255,122,155,0.18)",
    muted: "var(--border-subtle)",
  };
  const eyebrowMap = {
    gray: "rgba(255,255,255,0.55)",
    phosphor: "var(--accent-strong)",
    pink: "rgba(255,122,155,0.95)",
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
          {sub && (
            <span
              style={{
                fontFamily: T.fontBody,
                fontSize: "var(--font-size-base)",
                color: "var(--text-tertiary)",
                lineHeight: 1.55,
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

/* ── Model picker ──────────────────────────────────────────── */

/** Coarse list-price tier shown on each model row. ~$/M input tokens. */
function tierBadge(input: number): string {
  if (input >= 10) return "frontier · $$$$";
  if (input >= 2) return "production · $$$";
  if (input >= 0.5) return "balanced · $$";
  return "budget · $";
}

function ModelPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // Group models by provider so the picker scans naturally per vendor.
  const byProvider = new Map<string, typeof CHAT_MODELS>();
  for (const m of CHAT_MODELS) {
    if (!byProvider.has(m.provider)) byProvider.set(m.provider, []);
    byProvider.get(m.provider)!.push(m);
  }

  // Stable provider order — anthropic first (today's daily driver), then
  // OpenAI-compatible low-latency providers.
  const PROVIDER_ORDER = ["anthropic", "openai", "cerebras", "groq"];
  const sortedProviders = Array.from(byProvider.keys()).sort(
    (a, b) => PROVIDER_ORDER.indexOf(a) - PROVIDER_ORDER.indexOf(b),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-18)" }}>
      {sortedProviders.map((providerId) => (
        <div key={providerId} style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.14em",
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
            }}
          >
            {providerId}
          </span>
          {byProvider.get(providerId)!.map((m) => {
            const active = m.id === value;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onChange(m.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--space-12)",
                  padding: "14px 16px",
                  background: active ? "rgba(140,231,210,0.08)" : "var(--control-bg)",
                  border: `1px solid ${active ? "rgba(140,231,210,0.4)" : "var(--control-border)"}`,
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  color: "inherit",
                  fontFamily: "inherit",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-8)" }}>
                    <span
                      style={{
                        fontFamily: T.fontHeading,
                        fontSize: "var(--font-size-lg)",
                        fontWeight: 600,
                        color: active ? "var(--foreground)" : "var(--text-secondary)",
                      }}
                    >
                      {m.label}
                    </span>
                    <span
                      style={{
                        fontFamily: T.fontMono,
                        fontSize: 9.5,
                        letterSpacing: "0.08em",
                        color: "var(--text-tertiary)",
                        textTransform: "uppercase",
                      }}
                    >
                      {tierBadge(m.pricing.input)}
                    </span>
                    {m.preview && (
                      <span
                        style={{
                          fontFamily: T.fontMono,
                          fontSize: "var(--font-size-2xs)",
                          padding: "1px 6px",
                          borderRadius: "var(--radius-xs)",
                          background: "rgba(255,184,112,0.08)",
                          border: "1px solid rgba(255,184,112,0.25)",
                          color: "rgba(255,184,112,0.95)",
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                        }}
                      >
                        preview
                      </span>
                    )}
                  </div>
                  {m.description && (
                    <span
                      style={{
                        fontFamily: T.fontBody,
                        fontSize: "var(--font-size-base)",
                        color: "var(--text-tertiary)",
                        lineHeight: 1.45,
                      }}
                    >
                      {m.description}
                    </span>
                  )}
                  <span
                    style={{
                      fontFamily: T.fontMono,
                      fontSize: "var(--font-size-xs)",
                      color: "var(--text-quaternary)",
                    }}
                  >
                    {m.id} · {(m.contextWindow / 1000).toFixed(0)}k ctx · ${m.pricing.input}/M in · ${m.pricing.output}/M out
                  </span>
                </div>
                {active && (
                  <span
                    style={{
                      fontFamily: T.fontMono,
                      fontSize: 9.5,
                      letterSpacing: "0.1em",
                      color: "var(--accent-strong)",
                      textTransform: "uppercase",
                    }}
                  >
                    ● primary
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ── Voice model picker ─────────────────────────────────────── */

/**
 * Slim sibling of `ModelPicker` that surfaces only voice-capable models
 * (Anthropic + Cerebras subset). Mounted inside the "pin separate model
 * for voice" card. Highlights the row matching `value`, and surfaces a
 * tertiary "same as chat" badge when the author has picked the same id
 * the chat block already has — usually a sign to flip the parent toggle
 * back to "inherit from chat" instead.
 *
 * Rendering keeps the same provider-grouped pattern as `ModelPicker` for
 * visual continuity — authors who picked their chat model upstairs will
 * recognize the same shape downstairs.
 */
function VoiceModelPicker({
  value,
  onChange,
  chatModel,
}: {
  value: string;
  onChange: (id: string) => void;
  chatModel: string;
}) {
  const byProvider = new Map<string, typeof VOICE_MODELS>();
  for (const m of VOICE_MODELS) {
    if (!byProvider.has(m.provider)) byProvider.set(m.provider, []);
    byProvider.get(m.provider)!.push(m);
  }
  const PROVIDER_ORDER = ["cerebras", "groq", "anthropic"];
  const sortedProviders = Array.from(byProvider.keys()).sort(
    (a, b) => PROVIDER_ORDER.indexOf(a) - PROVIDER_ORDER.indexOf(b),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-16)" }}>
      {sortedProviders.map((providerId) => (
        <div key={providerId} style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-xs)",
              letterSpacing: "0.14em",
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
            }}
          >
            {providerId}
          </span>
          {byProvider.get(providerId)!.map((m) => {
            const active = m.id === value;
            const sameAsChat = m.id === chatModel;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onChange(m.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--space-12)",
                  padding: "10px 14px",
                  background: active ? "rgba(255,122,155,0.08)" : "var(--control-bg)",
                  border: `1px solid ${active ? "rgba(255,122,155,0.4)" : "var(--control-border)"}`,
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  color: "inherit",
                  fontFamily: "inherit",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-8)" }}>
                    <span
                      style={{
                        fontFamily: T.fontHeading,
                        fontSize: "var(--font-size-md)",
                        fontWeight: 600,
                        color: active ? "var(--foreground)" : "var(--text-secondary)",
                      }}
                    >
                      {m.label}
                    </span>
                    <span
                      style={{
                        fontFamily: T.fontMono,
                        fontSize: 9.5,
                        letterSpacing: "0.08em",
                        color: "var(--text-tertiary)",
                        textTransform: "uppercase",
                      }}
                    >
                      {m.latencyTier} · ${m.pricing.input}/M in
                    </span>
                    {sameAsChat && (
                      <span
                        style={{
                          fontFamily: T.fontMono,
                          fontSize: "var(--font-size-2xs)",
                          padding: "1px 6px",
                          borderRadius: "var(--radius-xs)",
                          background: "rgba(255,255,255,0.05)",
                          color: "var(--text-quaternary)",
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                        }}
                      >
                        same as chat
                      </span>
                    )}
                  </div>
                  {m.description && (
                    <span
                      style={{
                        fontFamily: T.fontBody,
                        fontSize: 11.5,
                        color: "var(--text-tertiary)",
                        lineHeight: 1.45,
                      }}
                    >
                      {m.description}
                    </span>
                  )}
                </div>
                {active && (
                  <span
                    style={{
                      fontFamily: T.fontMono,
                      fontSize: 9.5,
                      letterSpacing: "0.1em",
                      color: "rgba(255,122,155,0.95)",
                      textTransform: "uppercase",
                    }}
                  >
                    ● voice
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ── Sampling knob ─────────────────────────────────────────── */

function SamplingKnob({
  label,
  value,
  onChange,
  min,
  max,
  step,
  tickLabels,
  tip,
  format,
  disabled,
  disabledReason,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  tickLabels: [string, string, string];
  tip: string;
  format?: (v: number) => string;
  /** Capability-gated by the parent — when true, slider locks + opacity drops. */
  disabled?: boolean;
  /** Single-line reason shown in place of the tip when `disabled`. */
  disabledReason?: string;
}) {
  const displayed = format ? format(value) : value.toFixed(2);
  return (
    <div
      style={{
        padding: "var(--space-14)",
        background: "var(--control-bg)",
        border: "1px solid var(--control-border)",
        borderRadius: "var(--radius-sm)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-10)",
        opacity: disabled ? 0.55 : 1,
        // Strikethrough the disabled value to reinforce "this isn't reaching the model".
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.12em",
            color: "var(--text-secondary)",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-lg)", color: "var(--accent-strong)" }}>
          {displayed}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: "100%",
          accentColor: "var(--accent-strong)",
          cursor: disabled ? "not-allowed" : "pointer",
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
        <span>{tickLabels[0]}</span>
        <span>{tickLabels[2]}</span>
      </div>
      <span
        style={{
          fontFamily: T.fontBody,
          fontSize: 11.5,
          // When disabled, swap the helpful tip for the reason it's
          // greyed out. Reasoning models that lock sampling are a common
          // gotcha; surfacing the why right under the slider beats
          // leaving the user to guess.
          color: disabled ? "rgba(255,184,112,0.85)" : "var(--text-tertiary)",
          lineHeight: 1.5,
          paddingTop: "var(--space-4)",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        {disabled && disabledReason ? `⚠ ${disabledReason}` : tip}
      </span>
    </div>
  );
}

/* ── Advisory ──────────────────────────────────────────────── */

function Advisory({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "var(--space-12)",
        padding: "12px 14px",
        background: "rgba(255,184,112,0.04)",
        border: "1px solid rgba(255,184,112,0.15)",
        borderRadius: "var(--radius-sm)",
        alignItems: "flex-start",
      }}
    >
      <span style={{ color: "rgba(255,184,112,0.95)", fontFamily: T.fontMono, fontSize: "var(--font-size-base)" }}>
        ⚠
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: 9.5,
            letterSpacing: "0.12em",
            color: "rgba(255,184,112,0.95)",
            textTransform: "uppercase",
          }}
        >
          advisory
        </span>
        <span
          style={{
            fontFamily: T.fontBody,
            fontSize: 11.5,
            color: "var(--text-secondary)",
            lineHeight: 1.5,
          }}
        >
          {children}
        </span>
      </div>
    </div>
  );
}

/* ── Cache toggle ──────────────────────────────────────────── */

function Toggle({
  value,
  onChange,
  onLabel,
  offLabel,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  onLabel: string;
  offLabel: string;
  /** Capability-gated by the parent — when true, click is a no-op + dimmed. */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && onChange(!value)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-8)",
        padding: "5px 10px",
        background: value ? "rgba(140,231,210,0.08)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${value ? "rgba(140,231,210,0.3)" : "var(--control-border)"}`,
        borderRadius: "var(--radius-xs)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        color: "inherit",
        fontFamily: "inherit",
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: value ? "var(--accent-strong)" : "var(--text-quaternary)",
        }}
      />
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.1em",
          color: value ? "var(--accent-strong)" : "var(--text-tertiary)",
          textTransform: "uppercase",
        }}
      >
        {value ? onLabel : offLabel}
      </span>
    </button>
  );
}

/* ── Fallback chain ────────────────────────────────────────── */

function FallbackChain({
  value,
  onChange,
  primaryModel,
}: {
  value: NonNullable<CharacterBrainModel["fallbacks"]>;
  onChange: (next: CharacterBrainModel["fallbacks"]) => void;
  primaryModel: string;
}) {
  const available = CHAT_MODELS.filter((m) => m.id !== primaryModel);

  const addFallback = (model: string) => {
    // Coerce provider from the registry so the fallback record stays
    // self-consistent — adding "gpt-5" or "qwen-3-…" can't be saved with
    // the wrong provider label.
    const meta = CHAT_MODELS.find((m) => m.id === model);
    const provider: "anthropic" | "openai" | "cerebras" | "groq" =
      meta?.provider === "openai" ? "openai"
      : meta?.provider === "cerebras" ? "cerebras"
      : meta?.provider === "groq" ? "groq"
      : "anthropic";
    const next = [...value, { provider, model, trigger: "5xx" as const }];
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
      {value.length === 0 && (
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
          no fallbacks declared — primary failures will surface to the sandbox as errors
        </div>
      )}

      {value.map((fb, i) => (
        <div
          key={`${fb.model}-${i}`}
          style={{
            display: "flex",
            alignItems: "center",
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
              fontSize: 9.5,
              letterSpacing: "0.12em",
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
              width: 64,
            }}
          >
            retry · {i + 1}
          </span>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "var(--space-2)" }}>
            <span style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-md)", fontWeight: 500, color: "var(--foreground)" }}>
              {CHAT_MODELS.find((m) => m.id === fb.model)?.label ?? fb.model}
            </span>
            <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--text-tertiary)" }}>
              on {fb.trigger ?? "5xx"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            style={{
              padding: "3px 8px",
              background: "transparent",
              border: "1px solid var(--control-border)",
              borderRadius: "var(--radius-xs)",
              color: "var(--text-tertiary)",
              fontFamily: T.fontMono,
              fontSize: 9.5,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            remove
          </button>
        </div>
      ))}

      {available.length > 0 && value.length < CHAT_MODELS.length - 1 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-6)",
            padding: "10px 12px",
            background: "rgba(0,0,0,0.2)",
            border: "1px dashed var(--control-border)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 9.5,
              letterSpacing: "0.1em",
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
              alignSelf: "center",
              marginRight: "var(--space-4)",
            }}
          >
            + add
          </span>
          {available
            .filter((m) => !value.some((fb) => fb.model === m.id))
            .map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => addFallback(m.id)}
                style={{
                  padding: "5px 10px",
                  background: "transparent",
                  border: "1px solid var(--control-border)",
                  borderRadius: "var(--radius-xs)",
                  color: "var(--text-secondary)",
                  fontFamily: T.fontMono,
                  fontSize: 10.5,
                  cursor: "pointer",
                }}
              >
                {m.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
