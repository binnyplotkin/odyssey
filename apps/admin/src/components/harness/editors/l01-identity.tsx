"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CharacterIdentity, IdentityTrait } from "@odyssey/db";
import { compileIdentityXml } from "@/lib/character-prompt-builders";
import type { HarnessCharacter } from "../harness-types";
import { AdvisoryStack, type Advisory } from "../shared/advisory";
import { formatRelative } from "../shared/format-relative";

/**
 * L01 Identity editor — name (read-only from character.title), essence
 * one-liner, exactly-two trait slots, optional era + setting.
 *
 * Save flow mirrors L02: builds the identity object client-side, POSTs
 * to /api/characters/:id/identity, fires `harness:identity-saved` so
 * the right-rail preview re-fetches the compiled prompt with the new
 * `<identity>` block.
 *
 * Hard top-2 trait cap is enforced visually (two slots, third is
 * locked) AND at the API. Adding a third correlates with demographic-
 * leakage failure modes per Venkit et al. 2026 (~30pp behavioural drift
 * on unrelated tasks). The locked slot has a "+ → goes in L02" affordance
 * to redirect authors toward the right layer for nuance.
 */

const T = {
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

/**
 * Curated reference library of trait noun anchors with scaffolded
 * default descriptions. Free-text input stays unchanged — these are a
 * browseable shortcut, not a constraint.
 *
 * The `gloss` is a generic one-sentence definition of the noun. When an
 * author picks a chip, the slot's description is pre-filled with
 *
 *   "{gloss} {SCAFFOLD_TRAILER}"
 *
 * where SCAFFOLD_TRAILER is an open-ended trailing phrase that forces
 * the author to add the character-specific texture rather than ship the
 * boilerplate. The "default description unedited" advisory chip flags
 * any trait description that matches the literal scaffold so authors
 * can't accidentally save the prompt verbatim.
 *
 * Curation principles:
 *   - Single-word noun (matches the L01 advisory that flags phrase-
 *     shaped trait names — clicking from here always lands clean).
 *   - Anchor-shaped, not adjective or action: "weariness" not "weary".
 *   - Gloss is generic enough to apply across characters; concrete
 *     enough to feel like a definition rather than fluff.
 *   - Diverse across archetype clusters so any character finds 2 here.
 *
 * Organized into seven semantic clusters for browseability. Categories
 * are author-facing only — the model never sees them.
 */
type TraitNoun = { noun: string; gloss: string };

const TRAIT_NOUN_LIBRARY: Array<{ category: string; nouns: TraitNoun[] }> = [
  {
    category: "faith & doubt",
    nouns: [
      { noun: "faith", gloss: "A trust that runs ahead of evidence, committed before the outcome can be seen." },
      { noun: "trust", gloss: "A working assumption about another's good faith that survives small breaches without collapse." },
      { noun: "devotion", gloss: "A held attention that doesn't waver even when its object is absent or silent." },
      { noun: "reverence", gloss: "A posture of being-impressed that approaches its object slowly and on its terms." },
      { noun: "doubt", gloss: "A working refusal to accept the next step until something in it can be tested." },
      { noun: "longing", gloss: "An attention pulled toward what isn't here, that doesn't resolve into action." },
    ],
  },
  {
    category: "intellect",
    nouns: [
      { noun: "curiosity", gloss: "An appetite for what's actually the case, not what the rules say should be." },
      { noun: "skepticism", gloss: "A held question that demands a reason before assenting to a claim." },
      { noun: "rigor", gloss: "An insistence on grounding each step in something one could check." },
      { noun: "wonder", gloss: "A capacity to be stopped by the thing in front of one rather than move past it." },
      { noun: "discernment", gloss: "A trained ability to tell apart things that look similar." },
      { noun: "paradox", gloss: "A comfort holding two true-seeming opposites without forcing resolution." },
    ],
  },
  {
    category: "duty & honor",
    nouns: [
      { noun: "duty", gloss: "A loyalty to a charge that doesn't ask to be questioned and can't be set down." },
      { noun: "honor", gloss: "A practiced habit of acting consistently with one's stated commitments, costly or not." },
      { noun: "loyalty", gloss: "A bias toward staying-with that survives the option to leave with cause." },
      { noun: "resolve", gloss: "A steadiness in following through that doesn't recompute under pressure." },
      { noun: "discipline", gloss: "A withholding of impulse that has become the default rather than the effort." },
      { noun: "vow", gloss: "A self-binding that puts the future you on a leash the current you can't slip." },
    ],
  },
  {
    category: "endurance & weight",
    nouns: [
      { noun: "weariness", gloss: "The ache of long obedience — paid prices, lost things, walked further than one chose." },
      { noun: "endurance", gloss: "A capacity to keep going when going feels less alive than stopping." },
      { noun: "patience", gloss: "A willingness to wait without filling the waiting with action." },
      { noun: "stoicism", gloss: "A composure in the presence of suffering that performs neither acceptance nor fight." },
      { noun: "burden", gloss: "A weight one carries that's visible in the posture and the cadence." },
      { noun: "stillness", gloss: "A trained absence of unnecessary motion — speaks only when the silence has earned it." },
    ],
  },
  {
    category: "fear & vigilance",
    nouns: [
      { noun: "dread", gloss: "A clear-eyed knowledge of what's coming that doesn't paralyze action." },
      { noun: "vigilance", gloss: "An attention to what could go wrong that doesn't tilt into paranoia." },
      { noun: "caution", gloss: "A habit of testing each step before committing weight to it." },
      { noun: "restraint", gloss: "A held withholding of force or speech that the moment could permit." },
      { noun: "grief", gloss: "A presence of what's been lost that hasn't been resolved into a story." },
      { noun: "wrath", gloss: "A heated response to injustice that holds its shape without breaking into chaos." },
    ],
  },
  {
    category: "warmth & care",
    nouns: [
      { noun: "tenderness", gloss: "A handling-with-care of another that's the default register, not the effort." },
      { noun: "warmth", gloss: "A generosity of presence that meets the other where they are." },
      { noun: "compassion", gloss: "A felt-with that doesn't tip into pity or rescue." },
      { noun: "mercy", gloss: "A withheld application of deserved consequence." },
      { noun: "generosity", gloss: "A giving that doesn't track what's been given." },
      { noun: "gentleness", gloss: "A softness in handling that doesn't read as weakness." },
    ],
  },
  {
    category: "wit & appetite",
    nouns: [
      { noun: "cunning", gloss: "A read of situations sideways — the angle nobody else has bothered to look from." },
      { noun: "wit", gloss: "A quickness in conversation that lands as a small surprise." },
      { noun: "mischief", gloss: "A delight in upsetting the order of things that's rarely cruel." },
      { noun: "ambition", gloss: "A reach for what isn't yet that organizes everything around the reach." },
      { noun: "hunger", gloss: "An appetite that defines what one moves toward." },
      { noun: "play", gloss: "A treating of serious things as if they were stakes in a game, without disrespecting them." },
    ],
  },
];

/** Open-ended trailing phrase appended after the gloss when a chip is
 * picked. Forces the author to add the character-specific texture
 * rather than ship the boilerplate. Trailing space is intentional —
 * the caret lands ready to type. */
const SCAFFOLD_TRAILER = "For this character, that looks like:";

/** Flat lookup — `noun` → entry. Used by the "in library" badge in
 * each trait slot and by the unedited-default advisory check. */
const TRAIT_NOUN_INDEX = new Map<string, TraitNoun>(
  TRAIT_NOUN_LIBRARY.flatMap((g) => g.nouns.map((n) => [n.noun, n])),
);
const TRAIT_NOUN_SET = new Set(TRAIT_NOUN_INDEX.keys());

/** Build the scaffolded description for a picked noun. Public so the
 * `onPick` handler and the "unedited default" advisory can both produce/
 * recognize the canonical form. */
function scaffoldDescriptionFor(noun: string): string {
  const entry = TRAIT_NOUN_INDEX.get(noun);
  if (!entry) return "";
  return `${entry.gloss} ${SCAFFOLD_TRAILER} `;
}

/** True when this trait's description matches the scaffold for its
 * noun verbatim — meaning the author picked the chip and saved without
 * adding the character-specific texture. Used by the advisory chip. */
function isUneditedScaffold(trait: IdentityTrait): boolean {
  if (!trait.name.trim() || !trait.description.trim()) return false;
  const scaffold = scaffoldDescriptionFor(trait.name.trim().toLowerCase());
  if (!scaffold) return false;
  return trait.description.trim() === scaffold.trim();
}

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; at: number }
  | { status: "error"; message: string };

type Props = {
  character: HarnessCharacter;
  /**
   * Which tab the LayerHeader has selected. The configure tab renders
   * the editor; history is a per-tab body (filled in by the L01 HISTORY
   * task). Defaults to "configure" so this component still mounts
   * standalone (e.g. in tests) without a header.
   */
  activeTab?: string;
};

export function L01Identity({ character, activeTab = "configure" }: Props) {
  if (activeTab === "history") return <L01History character={character} />;
  return <L01Configure character={character} />;
}

/**
 * The CONFIGURE tab — the original L01 editor surface. Saving here
 * writes the character's L01 Identity record; the HISTORY tab is a
 * read-only timeline reconstructed from eval-run snapshots.
 *
 * Extracted from `L01Identity` so the tab switch above can compose the
 * two surfaces cleanly. Behavior unchanged from the pre-tabs version.
 */
function L01Configure({ character }: { character: HarnessCharacter }) {
  const initial = useMemo<IdentityDraft>(
    () => toDraft(character.identity),
    [character.identity],
  );

  const [essence, setEssence] = useState(initial.essence);
  const [traits, setTraits] = useState<IdentityTrait[]>(initial.traits);
  const [era, setEra] = useState(initial.era);
  const [setting, setSetting] = useState(initial.setting);
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  const isDirty = useMemo(() => {
    const current = JSON.stringify({ essence, traits, era, setting });
    const base = JSON.stringify(initial);
    return current !== base;
  }, [essence, traits, era, setting, initial]);

  // Authoring advisories — antipatterns common in early L01 drafts.
  // Soft warnings, not blockers: the editor still saves, but the chips
  // surface the lift authors are leaving on the table. Severity:
  //   warn — the model will probably perform worse with this shape
  //   info — best-practice guidance, not a likely regression
  // Computed live so the chips disappear as the author fixes them.
  const advisories = useMemo<Advisory[]>(() => {
    const out: Advisory[] = [];
    const essTrim = essence.trim();
    const cleanTraits = traits.filter((t) => t.name.trim());

    // Hardest case: no essence + no traits. Model only sees the hardcoded
    // single-line anchor. Always the top advisory when triggered.
    if (!essTrim && cleanTraits.length === 0) {
      out.push({
        severity: "warn",
        title: "no anchor authored",
        body: "Without essence or traits the model receives only the hardcoded fallback line. Add at least an essence sentence so the character is distinct from the template.",
      });
    } else if (!essTrim && cleanTraits.length > 0) {
      // Traits without essence — the traits land but they have no frame.
      out.push({
        severity: "warn",
        title: "traits without essence",
        body: "You have traits but no essence sentence — the model will hold the traits with only the generic 'You are X.' anchor. Add an essence so the traits are framed by who the character is.",
      });
    }

    // Essence past the dilution threshold (~80 chars). Hard cap is 140
    // but anchor lines compress best around tweet-length.
    if (essTrim.length > 80) {
      out.push({
        severity: "info",
        title: "essence over recommended length",
        body: `Essence is ${essTrim.length} chars. The cap is 140 but anchors land hardest under ~80 — compression makes the line easier for the model to attend to.`,
      });
    }

    // Per-trait checks.
    for (const t of cleanTraits) {
      const name = t.name.trim();
      const desc = t.description.trim();
      if (!desc) {
        out.push({
          severity: "warn",
          title: `trait "${name}" has no description`,
          body: "The trait name alone is a weak anchor — Araujo et al. 2025's recovery rates depend on a 1-2 sentence justification that grounds the trait in voice. Add what this means in practice for the character.",
        });
      } else if (isUneditedScaffold(t)) {
        // Author picked a chip but never wrote the character-specific
        // continuation — the description is the generic gloss + scaffold
        // trailer verbatim. Worse than no description for production
        // characters; surface as a warn.
        out.push({
          severity: "warn",
          title: `trait "${name}" is the scaffold default`,
          body: "You picked this noun from the library but the description is the generic definition + \"For this character, that looks like:\" prompt — unedited. The whole point of the scaffold is that the line after it carries the character-specific texture. Add a sentence about what this trait looks like FOR THIS CHARACTER before saving.",
        });
      }
      const wordCount = name.split(/\s+/).filter(Boolean).length;
      if (wordCount >= 4 || name.endsWith(".")) {
        out.push({
          severity: "info",
          title: `trait "${name}" reads as a phrase`,
          body: "Single-word noun anchors (faith, weariness, doubt, curiosity) attend harder than full phrases. Move the texture into the description; keep the name short.",
        });
      }
    }

    // No grounding context. Optional, surface as info not warn.
    if (!era.trim() && !setting.trim() && essTrim) {
      out.push({
        severity: "info",
        title: "no era or setting",
        body: "Optional — but for domain-grounded characters (historical, regional, mythic) era + setting save the curator from inferring them. Skip for generic fictional characters.",
      });
    }

    return out;
  }, [essence, traits, era, setting]);

  // Live preview of the compiled <identity> block. Computed from the
  // SAME compiler that builds the system prompt at chat time, so what
  // the author sees here is byte-identical to what the model will
  // receive after save. When every field is empty the compiler returns
  // "" — surface that explicitly with the hardcoded fallback text the
  // system-prompt builder uses in that case (see
  // packages/engine/src/character-system-prompt.ts).
  const previewXml = useMemo(() => {
    const draftIdentity: CharacterIdentity = {};
    if (essence.trim()) draftIdentity.essence = essence.trim();
    const cleanTraits = traits
      .filter((t) => t.name.trim())
      .map((t) => ({ name: t.name.trim(), description: t.description.trim() }));
    if (cleanTraits.length) draftIdentity.traits = cleanTraits;
    if (era.trim()) draftIdentity.era = era.trim();
    if (setting.trim()) draftIdentity.setting = setting.trim();

    const xml = compileIdentityXml(character.title, draftIdentity);
    if (xml) return xml;
    // Compiler returns empty when nothing's filled in. Mirror the
    // fallback shown in buildStructuredParts() so authors see what
    // ships in that case.
    return `<identity>\n  You are ${character.title}. You speak in first person, never narrate or stage-direct. You do not break character.\n</identity>`;
  }, [essence, traits, era, setting, character.title]);

  const onSave = useCallback(async () => {
    setSave({ status: "saving" });
    try {
      const identity: CharacterIdentity = {};
      if (essence.trim()) identity.essence = essence.trim();
      const cleanTraits = traits
        .filter((t) => t.name.trim())
        .map((t) => ({ name: t.name.trim(), description: t.description.trim() }));
      if (cleanTraits.length) identity.traits = cleanTraits;
      if (era.trim()) identity.era = era.trim();
      if (setting.trim()) identity.setting = setting.trim();

      const res = await fetch(`/api/characters/${character.id}/identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body.slice(0, 200)}`);
      }
      setSave({ status: "saved", at: Date.now() });
      window.dispatchEvent(new CustomEvent("harness:identity-saved"));
    } catch (err) {
      setSave({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [character.id, essence, traits, era, setting]);

  const remainingTraitSlots = 2 - traits.filter((t) => t.name.trim()).length;

  return (
    <div
      style={{
        padding: "var(--space-32)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-24)",
        width: "100%",
      }}
    >
      <SaveBar isDirty={isDirty} save={save} onSave={onSave} />

      <TemplatesCard
        characterId={character.id}
        onApply={(identity) => {
          // Populate the draft from a template/wiki suggestion. Doesn't
          // save — author can tweak and commit via the Save button.
          // Replace, don't merge: a template is meant to be a complete
          // starting point. Authors can clear individual fields after.
          setEssence(identity.essence ?? "");
          setTraits(identity.traits ?? []);
          setEra(identity.era ?? "");
          setSetting(identity.setting ?? "");
        }}
      />

      <Card
        accent="phosphor"
        eyebrow="the core · <identity>"
        title="Name & essence"
        action={
          <CharCount value={essence.length} max={140} />
        }
      >
        <ReadOnlyField
          label="name · from character.title"
          value={character.title}
        />
        <TextArea
          label="essence · one sentence, max 140 chars"
          value={essence}
          onChange={setEssence}
          placeholder="An aged patriarch wandering Canaan, having staked everything on a voice he cannot name."
          rows={2}
          maxLength={140}
        />
      </Card>

      <Card
        accent="phosphor"
        eyebrow="defining traits · top-2 only"
        title="Two slots — no more"
        action={
          <TraitSlotIndicator filled={2 - remainingTraitSlots} />
        }
        body={
          <p
            style={{
              margin: 0,
              fontFamily: T.fontBody,
              fontSize: 12.5,
              color: "var(--text-tertiary)",
              lineHeight: 1.55,
            }}
          >
            A hard limit, not a guideline. <em>Araujo et al. 2025</em> — top-2
            attributes recover &gt;80% of personality fidelity. Add a third and
            you start getting demographic leakage. Move nuance to{" "}
            <span style={{ color: "var(--accent-strong)" }}>L02 Directive</span>{" "}
            as an exemplar instead.
          </p>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-16)" }}>
          <TraitSlot
            index={0}
            trait={traits[0] ?? { name: "", description: "" }}
            primary
            onChange={(next) =>
              setTraits((t) => {
                const out = [...t];
                out[0] = next;
                return out.filter((_, i) => i < 2);
              })
            }
            onClear={() =>
              setTraits((t) => (t[1] ? [t[1]] : []))
            }
          />
          <TraitSlot
            index={1}
            trait={traits[1] ?? { name: "", description: "" }}
            primary={false}
            onChange={(next) =>
              setTraits((t) => {
                const out = [...t];
                out[1] = next;
                return out.filter((_, i) => i < 2);
              })
            }
            onClear={() =>
              setTraits((t) => (t[0] ? [t[0]] : []))
            }
          />
        </div>

        <TraitNounPalette
          traits={traits}
          onPick={(noun) => {
            // Fill the next empty slot. Description seeds with the
            // scaffolded default — a one-sentence gloss for the noun
            // plus an open-ended "For this character, that looks like:"
            // trailer that nudges the author toward the character-
            // specific texture. The "unedited default" advisory chip
            // flags the slot if it's saved with the scaffold verbatim.
            const scaffolded = scaffoldDescriptionFor(noun);
            setTraits((t) => {
              if (!t[0]?.name?.trim()) {
                return [
                  { name: noun, description: scaffolded },
                  ...(t[1] ? [t[1]] : []),
                ];
              }
              if (!t[1]?.name?.trim()) {
                return [t[0], { name: noun, description: scaffolded }];
              }
              return t;
            });
          }}
        />
      </Card>

      <Card
        accent="muted"
        eyebrow="setting context · light grounding"
        title="When & where"
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "var(--space-16)" }}>
          <TextField
            label="era"
            value={era}
            onChange={setEra}
            placeholder="~2000 BCE"
          />
          <TextField
            label="setting"
            value={setting}
            onChange={setSetting}
            placeholder="Canaan, Negev desert"
          />
        </div>
      </Card>

      {advisories.length > 0 && <AdvisoryStack advisories={advisories} />}

      <Card
        accent="muted"
        eyebrow="live preview · what the model will see"
        title="Compiled <identity> block"
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
        body={
          <p
            style={{
              margin: 0,
              fontFamily: T.fontBody,
              fontSize: 12.5,
              color: "var(--text-tertiary)",
              lineHeight: 1.55,
            }}
          >
            Re-rendered live from the same compiler the chat route uses. When you
            save, this is byte-identical to what lands at the top of the cached
            system envelope.
          </p>
        }
      >
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
            maxHeight: 320,
          }}
        >
          {previewXml}
        </pre>
      </Card>
    </div>
  );
}

/* ── HISTORY tab ───────────────────────────────────────────── */

/**
 * Timeline of distinct identity shapes seen across this character's
 * eval runs. There's no dedicated character_identity_versions table —
 * we reconstruct from `eval_runs.characterSnapshot.identity` + a
 * stable hash. Same trade-off as the L04 HISTORY tab: configs the
 * author saved without running an eval don't show up.
 *
 * Revert posts the snapshot's identity back through the existing
 * identity API and fires `harness:identity-saved` so the right rail
 * + CONFIGURE tab re-render against the rolled-back state.
 */
type IdentityHistoryEntry = {
  identityHash: string;
  identity: CharacterIdentity | null;
  firstSeenAt: string;
  lastSeenAt: string;
  runCount: number;
  isCurrent: boolean;
};

function L01History({ character }: { character: HarnessCharacter }) {
  const [data, setData] = useState<IdentityHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revertingHash, setRevertingHash] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters/${character.id}/identity/history`);
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { entries: IdentityHistoryEntry[] };
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

  const revert = useCallback(async (entry: IdentityHistoryEntry) => {
    setRevertingHash(entry.identityHash);
    setError(null);
    try {
      const res = await fetch(`/api/characters/${character.id}/identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: entry.identity }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      window.dispatchEvent(new CustomEvent("harness:identity-saved"));
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
          No identity snapshots recorded yet. History reconstructs from eval
          runs — once you run a sweep, each distinct L01 identity that was used
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
          identity timeline · {data.length} distinct snapshot{data.length === 1 ? "" : "s"}
        </span>
        <p style={{ margin: 0, fontFamily: T.fontBody, fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.55 }}>
          Reconstructed from eval runs against this character. Identity edits
          made without running an eval aren&apos;t captured here — to get a clean
          checkpoint, save and run any eval. Revert rewrites the saved identity
          to the picked snapshot.
        </p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        {data.map((entry) => {
          const isReverting = revertingHash === entry.identityHash;
          return (
            <div
              key={entry.identityHash}
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
                    {summarizeIdentity(entry.identity, character.title)}
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
                  hash {entry.identityHash}
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

/**
 * One-line summary of an identity snapshot for the history card title.
 * Prefers essence (the most human-meaningful field). Falls back to trait
 * names, then "(unset — fallback anchor)" when the snapshot is null.
 */
function summarizeIdentity(identity: CharacterIdentity | null, characterTitle: string): string {
  if (!identity) return `(unset — fallback anchor for ${characterTitle})`;
  const essence = identity.essence?.trim();
  if (essence) return essence;
  const traits = (identity.traits ?? []).filter((t) => t.name?.trim());
  if (traits.length) return traits.map((t) => t.name.trim()).join(" · ");
  const era = identity.era?.trim();
  const setting = identity.setting?.trim();
  const ctx = [era, setting].filter(Boolean).join(" · ");
  if (ctx) return `(era/setting only: ${ctx})`;
  return "(empty identity)";
}

/* ── Templates & wiki import ───────────────────────────────── */

type Suggestion = {
  id: string;
  label: string;
  description: string;
  identity: CharacterIdentity;
};

type SuggestResponse = {
  templates: Suggestion[];
  wikiDerived: Suggestion | null;
};

/**
 * "Start from a template" surface. Fetches the suggestions endpoint
 * once on mount, renders the fixed template library as a row of cards
 * plus a special "from wiki" card when the character has a
 * voice_identity page authored.
 *
 * Apply populates the draft form — it does NOT save. Authors review
 * and commit via the Save button so they can tweak before publishing.
 * The card collapses by default to keep the editor surface clean for
 * authors who don't need starting help.
 */
function TemplatesCard({
  characterId,
  onApply,
}: {
  characterId: string;
  onApply: (identity: CharacterIdentity) => void;
}) {
  const [data, setData] = useState<SuggestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/characters/${characterId}/identity/suggest`);
        if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
        const body = (await res.json()) as SuggestResponse;
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
            Pre-vetted starter identities plus an import from this character&apos;s{" "}
            <code style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)" }}>voice_identity</code> wiki page if one exists.
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
          {data.wikiDerived && (
            <TemplateRow suggestion={data.wikiDerived} onApply={onApply} accent="pink" />
          )}
          {data.templates.map((tpl) => (
            <TemplateRow key={tpl.id} suggestion={tpl} onApply={onApply} accent="muted" />
          ))}
        </div>
      )}
    </section>
  );
}

function TemplateRow({
  suggestion,
  onApply,
  accent,
}: {
  suggestion: Suggestion;
  onApply: (identity: CharacterIdentity) => void;
  accent: "muted" | "pink";
}) {
  const bg = accent === "pink" ? "rgba(255,122,155,0.04)" : "rgba(255,255,255,0.02)";
  const border = accent === "pink" ? "rgba(255,122,155,0.2)" : "var(--control-border)";
  const accentColor = accent === "pink" ? "rgba(255,122,155,0.95)" : "var(--text-secondary)";

  return (
    <div
      style={{
        padding: "12px 14px",
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: "var(--radius-sm)",
        display: "flex",
        gap: "var(--space-12)",
        alignItems: "flex-start",
      }}
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-4)", minWidth: 0 }}>
        <span style={{ fontFamily: T.fontHeading, fontSize: "var(--font-size-lg)", fontWeight: 600, color: accentColor }}>
          {suggestion.label}
        </span>
        <span style={{ fontFamily: T.fontBody, fontSize: "var(--font-size-base)", color: "var(--text-tertiary)", lineHeight: 1.5 }}>
          {suggestion.description}
        </span>
        {suggestion.identity.essence && (
          <span
            style={{
              fontFamily: T.fontBody,
              fontSize: 12.5,
              fontStyle: "italic",
              color: "var(--text-secondary)",
              lineHeight: 1.55,
            }}
          >
            “{suggestion.identity.essence}”
          </span>
        )}
        {suggestion.identity.traits?.length ? (
          <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: "var(--text-quaternary)" }}>
            traits · {suggestion.identity.traits.map((t) => t.name).join(" · ")}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onApply(suggestion.identity)}
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

/* ── Draft conversion ──────────────────────────────────────── */

type IdentityDraft = {
  essence: string;
  traits: IdentityTrait[];
  era: string;
  setting: string;
};

function toDraft(identity: CharacterIdentity | null): IdentityDraft {
  return {
    essence: identity?.essence ?? "",
    traits: identity?.traits ?? [],
    era: identity?.era ?? "",
    setting: identity?.setting ?? "",
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
        L01 · identity
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
        save identity
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
  body,
  children,
}: {
  accent: "phosphor" | "muted";
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
  body?: React.ReactNode;
  children: React.ReactNode;
}) {
  const borderMap = {
    phosphor: "rgba(140,231,210,0.18)",
    muted: "var(--border-subtle)",
  };
  const eyebrowMap = {
    phosphor: "var(--accent-strong)",
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
      {body}
      {children}
    </section>
  );
}

/* ── Trait slot ────────────────────────────────────────────── */

function TraitSlot({
  index,
  trait,
  primary,
  onChange,
  onClear,
}: {
  index: number;
  trait: IdentityTrait;
  primary: boolean;
  onChange: (next: IdentityTrait) => void;
  onClear: () => void;
}) {
  const filled = trait.name.trim().length > 0;
  return (
    <div
      style={{
        padding: "var(--space-16)",
        background: "var(--control-bg)",
        border: `1px solid ${filled ? "rgba(140,231,210,0.22)" : "var(--control-border)"}`,
        borderRadius: "var(--radius-sm)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-6)" }}>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: 9.5,
            letterSpacing: "0.14em",
            color: filled ? "var(--accent-strong)" : "var(--text-tertiary)",
            textTransform: "uppercase",
          }}
        >
          trait · {String(index + 1).padStart(2, "0")}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
          {/* Hint that the authored noun matches a curated library
              entry — pure positive signal, no behaviour change.
              Catches typos too: typing "patience" lights up, typing
              "patien" doesn't, so the badge effectively acts as a soft
              spell-check for canonical-noun pickers. */}
          {filled && TRAIT_NOUN_SET.has(trait.name.trim().toLowerCase()) && (
            <span
              title="This noun is in the curated trait library"
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-2xs)",
                letterSpacing: "0.08em",
                color: "var(--accent-strong)",
                textTransform: "uppercase",
                padding: "1px 5px",
                borderRadius: "var(--radius-xs)",
                background: "rgba(140,231,210,0.08)",
              }}
            >
              in library
            </span>
          )}
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-2xs)",
              letterSpacing: "0.08em",
              color: "var(--text-quaternary)",
              textTransform: "uppercase",
            }}
          >
            {primary ? "primary" : "secondary"}
          </span>
        </div>
      </div>
      <input
        value={trait.name}
        onChange={(e) => onChange({ ...trait, name: e.target.value })}
        placeholder={primary ? "faith" : "weariness"}
        maxLength={24}
        style={{
          width: "100%",
          padding: "8px 12px",
          background: "rgba(0,0,0,0.2)",
          border: "1px solid var(--control-border)",
          borderRadius: "var(--radius-xs)",
          color: "var(--foreground)",
          fontFamily: T.fontHeading,
          fontSize: "var(--font-size-3xl)",
          fontWeight: 600,
          outline: "none",
        }}
      />
      <textarea
        value={trait.description}
        onChange={(e) => onChange({ ...trait, description: e.target.value })}
        rows={2}
        maxLength={280}
        placeholder={
          primary
            ? "A trust that runs ahead of evidence — not blind, but committed before the outcome can be seen."
            : "The ache of long obedience — he has paid prices, lost things, walked further than he chose."
        }
        style={{
          width: "100%",
          padding: "8px 12px",
          background: "rgba(0,0,0,0.2)",
          border: "1px solid var(--control-border)",
          borderRadius: "var(--radius-xs)",
          color: "var(--foreground)",
          fontFamily: T.fontBody,
          fontSize: 12.5,
          lineHeight: 1.55,
          outline: "none",
          resize: "vertical",
        }}
      />
      {filled && (
        <button
          type="button"
          onClick={onClear}
          style={{
            alignSelf: "flex-start",
            padding: "3px 8px",
            background: "transparent",
            border: "1px solid var(--control-border)",
            color: "var(--text-tertiary)",
            borderRadius: "var(--radius-xs)",
            fontFamily: T.fontMono,
            fontSize: 9.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          clear
        </button>
      )}
    </div>
  );
}

function TraitSlotIndicator({ filled }: { filled: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-6)",
        padding: "5px 10px",
        background: filled === 2 ? "rgba(140,231,210,0.08)" : "var(--control-bg)",
        border: `1px solid ${filled === 2 ? "rgba(140,231,210,0.25)" : "var(--control-border)"}`,
        borderRadius: "var(--radius-xs)",
      }}
    >
      {[0, 1].map((i) => (
        <div
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background:
              i < filled ? "var(--accent-strong)" : "var(--text-quaternary)",
          }}
        />
      ))}
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.1em",
          color: filled === 2 ? "var(--accent-strong)" : "var(--text-tertiary)",
          textTransform: "uppercase",
        }}
      >
        {filled} / 2
      </span>
    </div>
  );
}

/* ── Trait noun palette ────────────────────────────────────── */

/**
 * Browseable chip library of curated single-noun trait anchors. The
 * trait slots above remain freeform text — this palette is a reference
 * shortcut, not a constraint. Clicking a chip fills the next empty
 * slot's name (description stays blank for the author to write).
 *
 * Chips already in use are visually muted with a "✓ in use" cue;
 * clicking them is a no-op so authors don't accidentally double-pick.
 * Categories are author-facing organization only (the model never sees
 * them — only the noun the author picked lands in the directive XML).
 */
function TraitNounPalette({
  traits,
  onPick,
}: {
  traits: IdentityTrait[];
  onPick: (noun: string) => void;
}) {
  const usedNames = new Set(
    traits
      .map((t) => t.name?.trim().toLowerCase())
      .filter((n): n is string => !!n),
  );
  const bothSlotsFilled = traits.filter((t) => t.name?.trim()).length >= 2;

  return (
    <div
      style={{
        marginTop: "var(--space-4)",
        padding: "14px 16px",
        background: "rgba(255,255,255,0.02)",
        border: "1px dashed var(--control-border)",
        borderRadius: "var(--radius-sm)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.12em",
            color: "var(--text-tertiary)",
            textTransform: "uppercase",
          }}
        >
          trait noun library · reference, not a constraint
        </span>
        <span style={{ fontFamily: T.fontBody, fontSize: 11.5, color: "var(--text-quaternary)", lineHeight: 1.5 }}>
          {bothSlotsFilled
            ? "Both slots are full — clear one above to pick from here. Or just keep typing freely; the slots accept any noun, not only these."
            : "Click any noun to fill the next empty slot. The description seeds with a generic one-line definition + \"For this character, that looks like:\" — finish that sentence with the character-specific texture before saving (Araujo 2025: the texture is where >80% of the recovery rate lives, not the noun)."}
        </span>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        {TRAIT_NOUN_LIBRARY.map((group) => (
          <div key={group.category} style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-2xs)",
                letterSpacing: "0.14em",
                color: "var(--text-quaternary)",
                textTransform: "uppercase",
              }}
            >
              {group.category}
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-5)" }}>
              {group.nouns.map(({ noun, gloss }) => {
                const used = usedNames.has(noun);
                const disabled = used || bothSlotsFilled;
                // Tooltip carries the gloss preview so authors can
                // browse meanings without committing. The actual scaffold
                // (gloss + trailer) only lands on click.
                const tooltip = used
                  ? `"${noun}" is already a trait — clear the slot above to remove it`
                  : bothSlotsFilled
                    ? `Both trait slots are filled — clear one to pick "${noun}"\n\n${gloss}`
                    : `${gloss}\n\nClick to fill the next empty slot with this noun + scaffolded description.`;
                return (
                  <button
                    key={noun}
                    type="button"
                    onClick={() => !disabled && onPick(noun)}
                    disabled={disabled}
                    title={tooltip}
                    style={{
                      padding: "5px 10px",
                      background: used
                        ? "rgba(140,231,210,0.08)"
                        : "var(--control-bg)",
                      border: `1px solid ${
                        used ? "rgba(140,231,210,0.3)" : "var(--control-border)"
                      }`,
                      borderRadius: "var(--radius-xs)",
                      fontFamily: T.fontMono,
                      fontSize: "var(--font-size-sm)",
                      color: used
                        ? "var(--accent-strong)"
                        : disabled
                          ? "var(--text-quaternary)"
                          : "var(--text-secondary)",
                      cursor: disabled ? "default" : "pointer",
                      opacity: disabled && !used ? 0.45 : 1,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--space-5)",
                    }}
                  >
                    {noun}
                    {used && (
                      <span
                        style={{
                          fontSize: "var(--font-size-2xs)",
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          opacity: 0.85,
                        }}
                      >
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Field helpers ─────────────────────────────────────────── */

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: 9.5,
          letterSpacing: "0.12em",
          color: "var(--text-quaternary)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <div
        style={{
          padding: "10px 14px",
          background: "rgba(0,0,0,0.15)",
          border: "1px solid var(--control-border)",
          borderRadius: "var(--radius-sm)",
          fontFamily: T.fontHeading,
          fontSize: "var(--font-size-xl)",
          fontWeight: 600,
          color: "var(--text-secondary)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: 9.5,
          letterSpacing: "0.12em",
          color: "var(--text-quaternary)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: "10px 14px",
          background: "var(--control-bg)",
          border: "1px solid var(--control-border)",
          borderRadius: "var(--radius-sm)",
          color: "var(--foreground)",
          fontFamily: T.fontBody,
          fontSize: "var(--font-size-md)",
          outline: "none",
        }}
      />
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rows: number;
  maxLength?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: 9.5,
          letterSpacing: "0.12em",
          color: "var(--text-quaternary)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        style={{
          width: "100%",
          padding: "12px 14px",
          background: "var(--control-bg)",
          border: "1px solid var(--control-border)",
          borderRadius: "var(--radius-sm)",
          color: "var(--foreground)",
          fontFamily: T.fontBody,
          fontSize: "var(--font-size-lg)",
          lineHeight: 1.55,
          outline: "none",
          resize: "vertical",
        }}
      />
    </div>
  );
}

function CharCount({ value, max }: { value: number; max: number }) {
  const tone =
    value === 0
      ? "var(--text-quaternary)"
      : value > max * 0.9
        ? "rgba(255,184,112,0.95)"
        : "var(--text-tertiary)";
  return (
    <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-xs)", color: tone }}>
      {value} / {max}
    </span>
  );
}
