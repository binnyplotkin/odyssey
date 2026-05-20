/** Voice-slug helpers — pure functions, safe to import in client components.
 *
 * Lives in a separate file from voices-storage.ts so importing the slug
 * functions doesn't pull in the Supabase service-role client (server-only).
 */

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isValidVoiceSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function slugifyVoiceName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}
