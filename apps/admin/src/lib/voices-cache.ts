import { revalidateTag, unstable_cache } from "next/cache";
import { getVoiceStore } from "@odyssey/db";
import type { VoiceSummary } from "@/app/(authenticated)/voices/page";

/** Cache tag every voice-mutating route invalidates via
 * `invalidateVoicesList`. Bound character bindings PATCH on the
 * character side also need to fire this — the list page surfaces
 * `boundCharacterCount` + `boundCharacters` per voice. */
export const VOICES_LIST_CACHE_TAG = "voices-list";

/** Purge the cached voices list. Wraps `revalidateTag` so the Next 16+
 * required `profile` argument lives in one place — when Next changes
 * this API again (it moved between 14/15/16) we update here instead of
 * every mutation route. "max" matches Next's own deprecation-message
 * recommendation for non-server-action callers. */
export function invalidateVoicesList(): void {
  revalidateTag(VOICES_LIST_CACHE_TAG, "max");
}

/**
 * Cached list of voice summaries — the exact payload the `/voices` index
 * page hydrates VoicesGrid with. Wraps the Neon round-trip in
 * `unstable_cache` so navigations within the cache window skip the DB
 * entirely (sub-10ms hit vs 100–400ms cold query).
 *
 * Stays fresh via `revalidateTag(VOICES_LIST_CACHE_TAG)` — every voice
 * create/update/delete/extract/archive/unarchive route fires this. The
 * 1-hour `revalidate` is just a long-stop in case a tag invalidation
 * ever gets dropped; in normal operation tags do the real work.
 */
export const listVoiceSummaries = unstable_cache(
  async (): Promise<VoiceSummary[]> => {
    const voices = await getVoiceStore().list();
    return voices.map(
      (v): VoiceSummary => ({
        id: v.id,
        slug: v.slug,
        name: v.name,
        description: v.description,
        provider: v.provider,
        status: v.status,
        statusError: v.statusError,
        durationS: v.durationS,
        sampleRate: v.sampleRate,
        boundCharacterCount: v.boundCharacterCount ?? 0,
        boundCharacters: v.boundCharacters ?? [],
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      }),
    );
  },
  ["voices-list-summaries"],
  {
    tags: [VOICES_LIST_CACHE_TAG],
    revalidate: 60 * 60,
  },
);
