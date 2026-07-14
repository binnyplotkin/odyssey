/** True when a text span is ENTIRELY a stage direction — "(No reply needed)",
 *  "[a pause]" — optionally with trailing punctuation. These are the model (or
 *  the driver) narrating, not the character speaking, and not the user either:
 *  the proactive silence tick sends "(The user has gone quiet.)" as the turn
 *  message. TTS providers read them aloud verbatim, and the ack lane treats
 *  them as askable questions — both wrong. Mixed spans (a bracketed aside
 *  followed by real speech) do NOT match. */
export function isStageDirection(text: string): boolean {
  return /^[([][^()[\]]{0,120}[)\]][\s.!?]*$/.test(text.trim());
}
