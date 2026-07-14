import { isStageDirection } from "./stage-direction";

type AckSelectedPage = {
  page: {
    slug: string;
    title: string;
  };
};

export function selectVoiceAck(input: {
  enabled: boolean;
  characterTitle: string;
  message: string;
  selectedPages: AckSelectedPage[];
}): string | null {
  if (!input.enabled) return null;
  const message = input.message.trim();
  if (!message || isTrivialAckMessage(message)) return null;
  // Stage directions are not user speech. The proactive silence tick sends
  // "(The user has gone quiet.)" as the message — acknowledging it ("I can
  // speak to that.") answers something nobody said, and dangles as an orphan
  // when the brain then decides not to reply at all.
  if (isStageDirection(message)) return null;
  const messageLower = message.toLowerCase();
  // Candidate entity pages (exclude the always-seeded *-voice-identity sheet —
  // its title is an editorial meta-name, not an in-world topic).
  const titles = input.selectedPages
    .filter((selected) => !selected.page.slug.toLowerCase().endsWith("voice-identity"))
    .map((selected) => selected.page.title.trim())
    .filter(Boolean);

  // Only "speak of X" when the user actually NAMED X this turn. selectedPages can
  // be stale (served from the per-session context cache) or alias-seeded, so naming
  // a page the user didn't mention yields wrong, meta acks ("Yes, I can speak of
  // Hagar" when they asked about the husband). Ground the ack in the user's words.
  const namedEntity = titles.find(
    (title) =>
      title.toLowerCase() !== input.characterTitle.toLowerCase() &&
      titleMentionedInMessage(title, messageLower),
  );
  if (namedEntity && /\b(who|what|where|when|why|how|tell|describe|explain|remember)\b/i.test(message)) {
    return `Yes, I can speak of ${namedEntity}.`;
  }
  if (/\bseparat|part(ed|ing)?|leave|left\b/i.test(message)) {
    return "That parting was not easy.";
  }
  return "I can speak to that.";
}

const ACK_TITLE_STOPWORDS = new Set([
  "your", "this", "that", "with", "from", "they", "them", "what", "when",
  "where", "which", "there", "here", "about", "into", "their",
]);

/** The page title — or a distinctive word from it — appears in the user's message. */
function titleMentionedInMessage(title: string, messageLower: string): boolean {
  const t = title.toLowerCase();
  // Whole-title mention, word-boundaried so "Lot" can't match "a lot"; min 4 chars
  // so short/common names fall through to a generic ack instead of false-firing.
  if (t.length >= 4 && new RegExp(`\\b${escapeRegExp(t)}\\b`).test(messageLower)) return true;
  // Multi-word titles: match on a distinctive word (≥4 letters, not a stopword).
  return t
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !ACK_TITLE_STOPWORDS.has(w))
    .some((w) => new RegExp(`\\b${w}\\b`).test(messageLower));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isAckLaneEnabled(): boolean {
  return process.env.VOICE_ACK_LANE !== "0";
}

function isTrivialAckMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/[^a-z\s]/g, "").trim();
  if (!normalized) return true;
  return /^(hi|hey|hello|ok|okay|thanks|thank you|yes|yeah|no|bye|goodbye)$/.test(normalized);
}
