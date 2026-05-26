"use client";

/**
 * Layout-level no-op for /characters/[slug]/* routes.
 *
 * The character config page (/characters/[slug]) injects its own header
 * via CharacterConfig so the editable title + sidebar can share state.
 * The /chat route also injects its own immersive header. There's no
 * remaining route under this layout that needs a generic header here.
 *
 * Kept as a stub so the layout's <Suspense><CharacterHeaderShell /></Suspense>
 * boundary still does the 404 lookup before rendering page content.
 */
export function CharacterHeader(_props: {
  character: { id: string; slug: string; title: string };
}) {
  return null;
}
