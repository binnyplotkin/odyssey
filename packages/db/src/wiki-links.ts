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

/* ── Parsing ────────────────────────────────────────────────────── */

/**
 * Matches [[slug]] or [[slug|Display]] — non-greedy so they don't run together.
 * Captures:
 *   1 = slug (raw, pre-trim)
 *   2 = display text (raw, pre-trim; may be undefined)
 */
const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

/**
 * Parse all wikilinks out of a body. Returns them in document order with
 * duplicates preserved (callers dedupe as needed).
 */
export function parseWikilinks(body: string): ParsedWikilink[] {
  if (!body) return [];
  const out: ParsedWikilink[] = [];
  // Reset lastIndex each call — WIKILINK_RE is stateful with /g.
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    const rawSlug = m[1]?.trim();
    if (!rawSlug) continue;
    const display = m[2]?.trim() ?? null;
    out.push({
      raw: m[0],
      slug: rawSlug,
      display,
    });
  }
  return out;
}

/** Unique slugs referenced in the body, in first-seen order. */
export function extractReferencedSlugs(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const link of parseWikilinks(body)) {
    if (!seen.has(link.slug)) {
      seen.add(link.slug);
      out.push(link.slug);
    }
  }
  return out;
}

/* ── Formatting ─────────────────────────────────────────────────── */

/** Build a wikilink. `display` is only emitted when different from the slug. */
export function formatWikilink(slug: string, display?: string | null): string {
  if (!display || display === slug) return `[[${slug}]]`;
  return `[[${slug}|${display}]]`;
}

/**
 * Replace every wikilink in `body` with its resolved form.
 *
 * - If the slug is known, emit "[[slug|currentTitle]]" (auto-updates display
 *   to follow renames — the slug is canonical, the title is cosmetic).
 * - If the slug is unknown, emit "[[slug|?]]" so it shows up clearly in the
 *   admin UI as a broken link.
 */
export function resolveWikilinks(
  body: string,
  titleBySlug: Map<string, string>,
): string {
  if (!body) return body;
  return body.replace(WIKILINK_RE, (match, rawSlug: string, rawDisplay?: string) => {
    const slug = rawSlug.trim();
    const knownTitle = titleBySlug.get(slug);
    if (!knownTitle) {
      // Unknown target — preserve the author's display (or slug) but mark "?"
      const d = rawDisplay?.trim() ?? slug;
      return `[[${slug}|${d} ?]]`;
    }
    const display = rawDisplay?.trim() ?? knownTitle;
    return `[[${slug}|${display}]]`;
    void match;
  });
}

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
export function flattenWikilinks(
  body: string,
  titleBySlug?: Map<string, string>,
): string {
  if (!body) return body;
  return body.replace(WIKILINK_RE, (_match, rawSlug: string, rawDisplay?: string) => {
    const slug = rawSlug.trim();
    const display = rawDisplay?.trim();
    if (display) return display;
    const known = titleBySlug?.get(slug);
    if (known) return known;
    return prettifySlug(slug);
  });
}

/** Best-effort fallback when we have only a slug — `haran-city` → `Haran City`.
 * Not perfect for slugs that already encode meaningful punctuation, but good
 * enough for the unknown-link case where the alternative is leaking syntax. */
function prettifySlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/* ── Slug validation ───────────────────────────────────────────── */

const SLUG_RE = /^[a-z][a-z0-9-]{1,63}$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/**
 * Best-effort conversion of a title to a slug. Still validate with isValidSlug
 * — some titles (numbers-first, punctuation) won't produce a legal slug and
 * should be manually authored.
 */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
