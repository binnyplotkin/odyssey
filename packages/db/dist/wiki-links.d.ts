/**
 * Wikilink parser + formatter.
 *
 * Syntax: [[slug]] or [[slug|Display Text]]
 *   - Slugs are immutable (the canonical reference).
 *   - Display text is optional; when absent, render with current page title.
 *   - Whitespace inside [[ ]] is trimmed.
 *   - Unknown slugs are allowed — the page save still succeeds, the edge
 *     just isn't created (see wiki-store.reconcileEdges).
 *
 * Slug rules (enforced at create time, not parse time):
 *   - Lowercase kebab-case, alphanumeric + hyphens, 2–64 chars
 *   - Must start with a letter
 */
import type { ParsedWikilink } from "./wiki-types";
/**
 * Parse all wikilinks out of a body. Returns them in document order with
 * duplicates preserved (callers dedupe as needed).
 */
export declare function parseWikilinks(body: string): ParsedWikilink[];
/** Unique slugs referenced in the body, in first-seen order. */
export declare function extractReferencedSlugs(body: string): string[];
/** Build a wikilink. `display` is only emitted when different from the slug. */
export declare function formatWikilink(slug: string, display?: string | null): string;
/**
 * Replace every wikilink in `body` with its resolved form.
 *
 * - If the slug is known, emit "[[slug|currentTitle]]" (auto-updates display
 *   to follow renames — the slug is canonical, the title is cosmetic).
 * - If the slug is unknown, emit "[[slug|?]]" so it shows up clearly in the
 *   admin UI as a broken link.
 */
export declare function resolveWikilinks(body: string, titleBySlug: Map<string, string>): string;
/**
 * Strip wikilink syntax for downstream consumers that should never see it
 * (LLM prompt chunks, voice transcripts, plain-text exports). Each link is
 * collapsed to a human-readable form:
 *
 *   - `[[slug|Display Text]]`   → `Display Text`
 *   - `[[slug]]` (known)        → `<title from titleBySlug>`
 *   - `[[slug]]` (unknown)      → derived from the slug
 *                                  (e.g. `haran-city` → `Haran City`)
 *
 * The LLM doesn't use the slug-as-anchor signal for anything generative —
 * left in place it just bleeds the `[[…]]` syntax into model output. Strip
 * at render time and the prompt reads as natural language.
 */
export declare function flattenWikilinks(body: string, titleBySlug?: Map<string, string>): string;
export declare function isValidSlug(slug: string): boolean;
/**
 * Best-effort conversion of a title to a slug. Still validate with isValidSlug
 * — some titles (numbers-first, punctuation) won't produce a legal slug and
 * should be manually authored.
 */
export declare function slugifyTitle(title: string): string;
//# sourceMappingURL=wiki-links.d.ts.map