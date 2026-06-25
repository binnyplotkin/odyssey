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
  const slugs = input.selectedPages.map((selected) => selected.page.slug.toLowerCase());
  // Exclude the character's own *-voice-identity page: it's always seeded, and its title
  // is an editorial meta-name ("Sarah — Voice & Identity"), not an in-world topic — so
  // "Yes, I can speak of Sarah — Voice & Identity" breaks the fourth wall. Only real
  // entity pages are things the character can "speak of".
  const titles = input.selectedPages
    .filter((selected) => !selected.page.slug.toLowerCase().endsWith("voice-identity"))
    .map((selected) => selected.page.title.trim())
    .filter(Boolean);
  if (slugs.includes("lot") || /\blot\b/i.test(message)) {
    return "Yes, I remember Lot.";
  }
  const firstEntityTitle =
    titles.find((title) => title.toLowerCase() !== input.characterTitle.toLowerCase()) ?? null;
  if (firstEntityTitle && /\b(who|what|where|when|why|how|tell|describe|explain|remember)\b/i.test(message)) {
    return `Yes, I can speak of ${firstEntityTitle}.`;
  }
  if (/\bseparat|part(ed|ing)?|leave|left\b/i.test(message)) {
    return "That parting was not easy.";
  }
  return "I can speak to that.";
}

export function isAckLaneEnabled(): boolean {
  return process.env.VOICE_ACK_LANE !== "0";
}

function isTrivialAckMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/[^a-z\s]/g, "").trim();
  if (!normalized) return true;
  return /^(hi|hey|hello|ok|okay|thanks|thank you|yes|yeah|no|bye|goodbye)$/.test(normalized);
}
