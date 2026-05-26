import { NextResponse } from "next/server";
import {
  getCharacterStore,
  getWikiStore,
  type CharacterIdentity,
  type VoiceIdentityFrontmatter,
  type WikiPageRecord,
} from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/characters/:id/identity/suggest
 *
 * Returns two kinds of starting points for the L01 editor:
 *
 *   1. `templates` — fixed library of archetype identities (tent-elder,
 *      scholar, soldier, lover, trickster, sage). Same idea as L04
 *      presets: pre-vetted shapes that pay rent for first-time authors.
 *      Selection populates the draft form but does NOT save — the
 *      author tweaks then commits via the existing Save button.
 *
 *   2. `wikiDerived` — when the character has a wiki page of type
 *      `voice_identity`, derive an essence + trait suggestion from its
 *      summary + frontmatter (beliefs, emotionalRange). Heuristic, not
 *      authoritative — the author always edits. Null when no
 *      voice_identity page exists.
 *
 * The endpoint reads only the wiki page's static content; no LLM calls.
 * Keeps it cheap, deterministic, and offline-safe.
 */

type Suggestion = {
  id: string;
  label: string;
  description: string;
  identity: CharacterIdentity;
};

const TEMPLATES: Suggestion[] = [
  {
    id: "tent-elder",
    label: "Tent-elder",
    description: "Abraham-shaped. Old, weathered, hospitable, has paid prices.",
    identity: {
      essence: "An aged patriarch wandering the land, having staked everything on a voice he cannot name.",
      traits: [
        { name: "faith", description: "A trust that runs ahead of evidence — not blind, but committed before the outcome can be seen." },
        { name: "weariness", description: "The ache of long obedience — he has paid prices, lost things, walked further than he chose." },
      ],
    },
  },
  {
    id: "scholar",
    label: "Scholar",
    description: "Aristotelian — tests every premise against observation before accepting it.",
    identity: {
      essence: "A thinker who tests every premise against observation before accepting it.",
      traits: [
        { name: "curiosity", description: "An appetite for the actual — what is the case, not what ought to be the case." },
        { name: "rigor", description: "Insists on grounding every claim in something one could check, and is patient with people who can't yet." },
      ],
    },
  },
  {
    id: "soldier",
    label: "Soldier",
    description: "Hektor-shaped. Fights because the alternative is unbearable, not because they believe in winning.",
    identity: {
      essence: "A protector who fights because the alternative is unbearable, not because he believes in winning.",
      traits: [
        { name: "duty", description: "Loyalty to a charge that doesn't ask to be questioned — kin, city, oath — and that he wouldn't survive abandoning." },
        { name: "dread", description: "Sees the cost clearly and goes anyway. Not bravery — knowledge braced against necessity." },
      ],
    },
  },
  {
    id: "lover",
    label: "Lover",
    description: "Penelope-shaped. A keeper of the hearth whose patience is itself a refusal.",
    identity: {
      essence: "A keeper of the hearth whose patience is itself a refusal.",
      traits: [
        { name: "devotion", description: "Hers is not the warmth of comfort but the heat of holding-out — a fire that has not gone out because she has not let it." },
        { name: "cunning", description: "Wears softness as a guard. Knows what's being asked of her and what she's chosen to give and not give." },
      ],
    },
  },
  {
    id: "trickster",
    label: "Trickster",
    description: "Hermes/Loki-shaped. Moves between worlds, solves problems by changing the rules.",
    identity: {
      essence: "A mover between worlds who solves problems by changing the rules of what counts as the problem.",
      traits: [
        { name: "wit", description: "Reads situations sideways — the angle nobody else has bothered to look from." },
        { name: "mischief", description: "Delights in upsetting the order of things, but rarely cruelly — the chaos is supposed to clarify, not wound." },
      ],
    },
  },
  {
    id: "sage",
    label: "Sage",
    description: "Lao-Tzu-shaped. Answers in questions, walks the long way home.",
    identity: {
      essence: "An old one who answers in questions and walks the long way home.",
      traits: [
        { name: "stillness", description: "Has stopped needing to be heard. Speaks only when the silence has been long enough to make the words count." },
        { name: "paradox", description: "Holds opposites at the same time without flinching — and finds that's often where the truth was hiding." },
      ],
    },
  },
];

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const character = await getCharacterStore().getById(id);
  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  // Pull a voice_identity page if any. listPages already filters by type
  // server-side — a single small query.
  let wikiDerived: Suggestion | null = null;
  try {
    const pages = await getWikiStore().listPages(character.id, { type: "voice_identity" });
    if (pages.length > 0) {
      wikiDerived = deriveFromVoiceIdentity(pages[0], character.title);
    }
  } catch {
    // Don't fail the whole endpoint if the wiki query trips — templates
    // still ship; the wiki suggestion just won't appear.
    wikiDerived = null;
  }

  return NextResponse.json({ templates: TEMPLATES, wikiDerived });
}

/**
 * Heuristic derivation. The wiki voice_identity page is a richer
 * authoring surface than L01 ever wants to be — this just extracts an
 * essence + 2 trait names worth seeding so the author isn't typing
 * from scratch.
 *
 *   - Essence ← page.summary (the most identity-shaped field of the page)
 *   - Traits  ← first 2 from frontmatter.beliefs, then emotionalRange,
 *               then idioms. The descriptions point back to the wiki
 *               page so the author knows where to look for more.
 *
 * Trait names come straight from the wiki and may be long or sentence-
 * shaped — the L01 advisory chips will flag those after the import,
 * which is the right place to fix them.
 */
function deriveFromVoiceIdentity(page: WikiPageRecord, characterName: string): Suggestion {
  const fm = page.frontmatter as VoiceIdentityFrontmatter;
  const essence = page.summary?.trim() ?? `(no summary on ${page.title} — write one in the wiki page first)`;

  const traitSources: string[] = [];
  if (Array.isArray(fm.beliefs)) traitSources.push(...fm.beliefs);
  if (Array.isArray(fm.emotionalRange)) traitSources.push(...fm.emotionalRange);
  if (Array.isArray(fm.idioms)) traitSources.push(...fm.idioms);

  const traits = traitSources
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => ({
      name: s,
      description: `Surfaced from ${page.title} — refine in voice before saving.`,
    }));

  return {
    id: "from-wiki",
    label: `From knowledge · ${page.title}`,
    description: `Derived from this character's voice_identity wiki page. Heuristic — edit before saving.`,
    identity: {
      essence,
      ...(traits.length ? { traits } : {}),
    },
  };
  // `characterName` is unused today; kept in the signature so future
  // derivations (e.g. era lookup based on the character's eras config)
  // have a hook without changing the call site.
  void characterName;
}
