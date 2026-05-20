/**
 * Named gradient library for character thumbnails. Stored on
 * `character.thumbnailColor` as the gradient key; renderer resolves to CSS.
 *
 * Adding new gradients is safe — old records that point to a removed key
 * fall back to the slug-hash gradient via `resolveAvatarGradient`.
 */

export type AvatarGradientKey =
  | "dune"
  | "mint"
  | "fog"
  | "amethyst"
  | "amber"
  | "moss"
  | "clay"
  | "graphite"
  | "candle"
  | "navy";

export const AVATAR_GRADIENTS: Record<AvatarGradientKey, string> = {
  dune: "linear-gradient(135deg, #C9A26B 0%, #6E5031 100%)",
  mint: "linear-gradient(135deg, #8CE7D2 0%, #3F8F84 100%)",
  fog: "linear-gradient(135deg, #A8C4E8 0%, #4F6A9C 100%)",
  amethyst: "linear-gradient(135deg, #C7A5FF 0%, #6E4FB8 100%)",
  amber: "linear-gradient(135deg, #E8B87A 0%, #8C6A38 100%)",
  moss: "linear-gradient(135deg, #8AD09A 0%, #4F8060 100%)",
  clay: "linear-gradient(135deg, #E89090 0%, #8C3F3F 100%)",
  graphite: "linear-gradient(135deg, #6E7C8C 0%, #2A323D 100%)",
  candle: "linear-gradient(135deg, #F2C870 0%, #B07A1F 100%)",
  navy: "linear-gradient(135deg, #5B7DB8 0%, #2A4570 100%)",
};

export const AVATAR_GRADIENT_KEYS = Object.keys(AVATAR_GRADIENTS) as AvatarGradientKey[];

/**
 * Used by the migration to backfill existing characters and as the runtime
 * fallback when `thumbnailColor` is null. Must match the original hash used
 * before this feature shipped so existing characters keep their color.
 */
export function legacyGradientKeyForSlug(slug: string): AvatarGradientKey {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = ((h << 5) - h + slug.charCodeAt(i)) | 0;
  // The original code rotated through the first six keys in this order.
  const ORIGINAL_SIX: AvatarGradientKey[] = ["dune", "mint", "fog", "amethyst", "amber", "moss"];
  return ORIGINAL_SIX[Math.abs(h) % ORIGINAL_SIX.length];
}

export function isAvatarGradientKey(value: unknown): value is AvatarGradientKey {
  return typeof value === "string" && value in AVATAR_GRADIENTS;
}

/**
 * Resolve a character's thumbnail to a CSS gradient string. If the stored
 * key is missing or unknown, falls back to the legacy slug-hash so the
 * thumbnail keeps a stable look across deploys.
 */
export function resolveAvatarGradient(
  thumbnailColor: string | null | undefined,
  slug: string,
): string {
  const key = isAvatarGradientKey(thumbnailColor)
    ? thumbnailColor
    : legacyGradientKeyForSlug(slug);
  return AVATAR_GRADIENTS[key];
}
