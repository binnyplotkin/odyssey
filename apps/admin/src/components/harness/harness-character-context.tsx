"use client";

import { createContext, useContext, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { HarnessCharacter } from "./harness-types";

/**
 * Lets nested route pages read the character without re-fetching it. The
 * layout fetches once and provides; pages call `useHarnessCharacter()`.
 *
 * Server components in nested routes can read `params.slug` directly and
 * skip this entirely — but client components benefit from the shared
 * reference (no re-fetch on route change).
 *
 * Refresh behavior: when any editor or revert flow fires the
 * `harness:character-changed` window event, the provider triggers
 * `router.refresh()` which re-runs the server layout's `getBySlug`
 * fetch. The new character flows back through this provider as a prop
 * automatically. Client-side editor state isn't touched — only the
 * server-fetched data refreshes.
 *
 * Why router.refresh() instead of a client-side re-fetch? The layout
 * is already `force-dynamic` and the harness pages all consume the
 * single shared character — running the server fetch once and letting
 * it propagate is fewer code paths than introducing a parallel client
 * fetch + state store + cache invalidation. The cost is a server
 * round-trip on each save, which is the same cost we already pay on
 * navigation between harness routes.
 *
 * Events that trigger a refresh (any of these signals a character
 * mutation that landed via POST):
 *   - `harness:character-changed` — explicit signal (preferred for new
 *     mutations; e.g. L02-7 promote-from-eval-results, L04 revert)
 *   - `harness:identity-saved`, `harness:directive-saved`,
 *     `harness:voice-style-saved`, `harness:brain-model-saved` — the
 *     per-layer save events. Listening here too means existing editors
 *     get the refresh-after-save behavior without needing to dispatch
 *     the explicit `character-changed` event in addition.
 */
const Ctx = createContext<HarnessCharacter | null>(null);

const REFRESH_EVENTS = [
  "harness:character-changed",
  "harness:identity-saved",
  "harness:directive-saved",
  "harness:voice-style-saved",
  "harness:brain-model-saved",
] as const;

export function HarnessCharacterProvider({
  character,
  children,
}: {
  character: HarnessCharacter;
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    const onChanged = () => router.refresh();
    for (const ev of REFRESH_EVENTS) window.addEventListener(ev, onChanged);
    return () => {
      for (const ev of REFRESH_EVENTS) window.removeEventListener(ev, onChanged);
    };
  }, [router]);

  return <Ctx.Provider value={character}>{children}</Ctx.Provider>;
}

export function useHarnessCharacter(): HarnessCharacter {
  const c = useContext(Ctx);
  if (!c) {
    throw new Error("useHarnessCharacter must be called inside HarnessCharacterProvider");
  }
  return c;
}
