/**
 * Inline 14×14 SVG glyphs for the character node slots (brain / wikis /
 * voice). Shared between the canvas CharacterNode and the grid card so
 * both surfaces use the same icon vocabulary.
 *
 * Stroke weight + sizing match Lucide-style line icons.
 */

export function BrainGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ color: "var(--accent-strong)", flexShrink: 0 }}
    >
      <path d="M12 5a3 3 0 0 0-3 3v0a3 3 0 0 0-3 3v1a3 3 0 0 0 1 2.236V16a3 3 0 0 0 3 3 3 3 0 0 0 2-.764" />
      <path d="M12 5a3 3 0 0 1 3 3v0a3 3 0 0 1 3 3v1a3 3 0 0 1-1 2.236V16a3 3 0 0 1-3 3 3 3 0 0 1-2-.764" />
      <path d="M12 5v14" />
    </svg>
  );
}

export function WikisGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ color: "var(--accent-strong)", flexShrink: 0 }}
    >
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <path d="M7.5 7.5L11 16.5" />
      <path d="M16.5 7.5L13 16.5" />
      <path d="M8 6h8" />
    </svg>
  );
}

export function VoiceGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ color: "var(--accent-strong)", flexShrink: 0 }}
    >
      <line x1="6" y1="9" x2="6" y2="15" />
      <line x1="10" y1="6" x2="10" y2="18" />
      <line x1="14" y1="8" x2="14" y2="16" />
      <line x1="18" y1="11" x2="18" y2="13" />
    </svg>
  );
}
