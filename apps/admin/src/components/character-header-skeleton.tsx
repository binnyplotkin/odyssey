"use client";

/**
 * Suspense fallback for CharacterHeaderShell. Each subpage injects its
 * own header once it loads (CharacterConfig has breadcrumb + version
 * dropdown + Sandbox link; chat has its own immersive header; etc.), so
 * this fallback intentionally does not write to the shared root header.
 *
 * Writing a temporary skeleton into HeaderContext and clearing it on
 * unmount can race with the page-level header effect during route
 * transitions, leaving the root header empty after the real controls
 * have mounted.
 */

export function CharacterHeaderSkeleton() {
  return null;
}
