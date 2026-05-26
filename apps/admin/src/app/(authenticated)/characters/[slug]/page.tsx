import { notFound } from "next/navigation";
import { MODEL_REGISTRY } from "@/lib/model-registry";
import { CharacterConfig } from "@/components/character-config";
import {
  getCharacterDetail,
  getCharacterIdBySlugOrId,
} from "@/lib/character-detail-cache";

/*
 * Cached read path — see `character-detail-cache.ts`. Two cache layers:
 *   1. slug → id (tagged with characters-list; cheap)
 *   2. id → full payload (tagged per-character; collapses 4 + 4N
 *      DB round-trips to 0 on cache hits)
 *
 * Page-level `dynamic` flag intentionally omitted: with the cache in
 * place we want Next to serve from the data cache on subsequent
 * navigations rather than re-fetching every request. Mutation routes
 * fire `invalidateCharacterDetail(id)` to refresh.
 */

// Model registry filters are pure constants over a static import —
// hoisted out of the request lifecycle so they're computed once at
// module load, not on every page render.
const CHAT_MODELS = MODEL_REGISTRY.filter((m) => m.modes.includes("chat"));
const VOICE_MODELS = MODEL_REGISTRY.filter(
  (m) =>
    m.modes.includes("voice") &&
    (m.provider === "anthropic" ||
      m.provider === "cerebras" ||
      m.provider === "groq"),
);

type Params = Promise<{ slug: string }>;

export default async function CharacterConfigPage({ params }: { params: Params }) {
  const { slug } = await params;

  const id = await getCharacterIdBySlugOrId(slug);
  if (!id) notFound();

  const payload = await getCharacterDetail(id);
  if (!payload) notFound();

  return (
    <CharacterConfig
      character={payload.character}
      knowledge={payload.knowledge}
      sessions={{ rememberedCount: 0 }}
      versions={payload.versions}
      chatModels={CHAT_MODELS}
      voiceModels={VOICE_MODELS}
    />
  );
}
