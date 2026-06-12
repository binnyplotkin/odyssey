/**
 * Helpers for the voice-stream route's context-building path.
 *
 *   shouldSkipRetrieval — gate the per-turn embedding+search on conversational
 *   utterances that wouldn't benefit from semantic retrieval. Greetings,
 *   acknowledgements, very short replies. Saves the ~500ms embedding tax.
 *
 *   summarizeTurnInBackground — fire-and-forget call to Cerebras after a turn
 *   completes, persists a 30-word summary as a world_session event so the
 *   next turn's system prompt can carry a "Recent conversation" section.
 *
 *   getRecentTurnSummaries — read the last N voice.summary events for a
 *   session at turn start.
 */

import { getDb, sceneSessionEventsTable } from "@odyssey/db";
import { and, desc, eq } from "drizzle-orm";

const VOICE_SUMMARY_EVENT_TYPE = "voice.summary";

const SKIP_RETRIEVAL_OPENERS = new Set([
  "hi", "hey", "hello", "yo", "sup", "howdy",
  "ok", "okay", "sure", "alright", "right", "got",
  "yes", "yeah", "yep", "no", "nope",
  "thanks", "thank", "ty",
  "cool", "nice", "wow", "huh", "oh", "ah",
  "hm", "hmm", "uh", "um",
  "bye", "goodbye",
]);

/**
 * Decide whether to skip the per-turn embedding+pgvector retrieval pass.
 *
 * True for short conversational fluff: greetings, acknowledgements, ≤3-word
 * utterances that almost never benefit from wiki retrieval. Returns false on
 * anything containing capitalized non-initial words (likely proper nouns) or
 * an explicit question word, so "What about Sarah?" still triggers retrieval
 * even when short.
 */
export function shouldSkipRetrieval(message: string): {
  skip: boolean;
  reason: string;
} {
  const trimmed = message.trim();
  if (!trimmed) return { skip: true, reason: "empty" };

  const tokens = trimmed.split(/\s+/);
  const wordCount = tokens.length;

  // Specific-question words always trigger retrieval, even at low word counts.
  const questionWords = /\b(who|what|where|when|why|how|which|tell|describe|explain)\b/i;
  if (questionWords.test(trimmed)) {
    return { skip: false, reason: "has-question-word" };
  }

  // A capitalized non-first word usually signals a proper noun / specific topic.
  for (let i = 1; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (/^[A-Z][a-z]/.test(t)) {
      return { skip: false, reason: "has-proper-noun" };
    }
  }

  if (wordCount <= 2) return { skip: true, reason: "too-short" };

  const firstWord = tokens[0].toLowerCase().replace(/[^a-z]/g, "");
  if (wordCount <= 5 && SKIP_RETRIEVAL_OPENERS.has(firstWord)) {
    return { skip: true, reason: `conversational-opener (${firstWord})` };
  }

  return { skip: false, reason: "default" };
}

/**
 * Read the most recent N voice.summary events for a session, oldest first.
 * Returns an empty array on missing sessionId or no prior summaries.
 */
export async function getRecentTurnSummaries(
  sessionId: string | null | undefined,
  limit: number = 3,
): Promise<string[]> {
  if (!sessionId) return [];
  try {
    const db = getDb();
    if (!db) return [];
    const rows = await db
      .select({ payload: sceneSessionEventsTable.payload, createdAt: sceneSessionEventsTable.createdAt })
      .from(sceneSessionEventsTable)
      .where(
        and(
          eq(sceneSessionEventsTable.sessionId, sessionId),
          eq(sceneSessionEventsTable.type, VOICE_SUMMARY_EVENT_TYPE),
        ),
      )
      .orderBy(desc(sceneSessionEventsTable.createdAt))
      .limit(limit);
    return rows
      .reverse()  // oldest → newest, so the LLM reads them chronologically
      .map((r) => {
        const payload = r.payload as { summary?: string } | null;
        return payload?.summary?.trim() ?? "";
      })
      .filter((s) => s.length > 0);
  } catch (error) {
    console.error("[voice-context] getRecentTurnSummaries failed", error);
    return [];
  }
}

/**
 * Format a list of summaries into a system-prompt section. Returns empty
 * string when there are no summaries so the prompt stays clean for first-turn.
 */
export function formatRecentConversation(summaries: string[]): string {
  if (summaries.length === 0) return "";
  const bulleted = summaries.map((s) => `- ${s}`).join("\n");
  return `\n\n## Recent conversation\n${bulleted}`;
}

/**
 * Spawn a fire-and-forget background task that summarizes the just-completed
 * turn via Cerebras (50 tokens out, no retries) and persists it as a
 * world_session event. Returns immediately so the caller doesn't block the
 * SSE stream's `done` event.
 */
export function summarizeTurnInBackground(args: {
  sessionId: string;
  turnId?: string | null;
  characterTitle: string;
  userMessage: string;
  agentReply: string;
  cerebrasApiKey: string;
  cerebrasModel: string;
}): void {
  const { sessionId, turnId, characterTitle, userMessage, agentReply, cerebrasApiKey, cerebrasModel } = args;
  const userTrimmed = userMessage.trim();
  const replyTrimmed = agentReply.trim();
  if (!userTrimmed || !replyTrimmed) return;

  // Capture the things we need synchronously; everything past this runs
  // detached. Errors are swallowed (logged) — a failed summary doesn't
  // break the next turn, it just means the next turn lacks one bullet.
  void (async () => {
    try {
      const summary = await callCerebrasSummary({
        cerebrasApiKey,
        cerebrasModel,
        characterTitle,
        userMessage: userTrimmed,
        agentReply: replyTrimmed,
      });
      if (!summary) return;
      // Lazy-import the store to avoid pulling drizzle into the request hot
      // path; this background task can afford the cost.
      const { getSceneSessionStore } = await import("@odyssey/db");
      await getSceneSessionStore().appendEvent({
        sessionId,
        turnId: turnId ?? null,
        type: VOICE_SUMMARY_EVENT_TYPE,
        source: "system",
        payload: { summary, userChars: userTrimmed.length, replyChars: replyTrimmed.length },
      });
    } catch (error) {
      console.error("[voice-context] background summary failed", error);
    }
  })();
}

async function callCerebrasSummary(args: {
  cerebrasApiKey: string;
  cerebrasModel: string;
  characterTitle: string;
  userMessage: string;
  agentReply: string;
}): Promise<string | null> {
  const systemPrompt =
    "You write one-sentence conversation memos so a voice agent can remember " +
    "what was just said. Output a single sentence, ≤30 words, third-person, " +
    "covering both what the user asked and what the character answered. No " +
    "preamble, no quotes, no extra commentary.";
  const userPrompt = `Character: ${args.characterTitle}\nUser said: "${args.userMessage}"\n${args.characterTitle} replied: "${args.agentReply}"\n\nMemo:`;

  const resp = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.cerebrasApiKey}`,
    },
    body: JSON.stringify({
      model: args.cerebrasModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: 80,
      temperature: 0.3,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error(`[voice-context] summarizer Cerebras ${resp.status}: ${text.slice(0, 200)}`);
    return null;
  }
  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const summary = json.choices?.[0]?.message?.content?.trim();
  if (!summary) return null;
  // Strip any wrapping quotes or trailing periods that hurt the next prompt's flow.
  return summary.replace(/^["']|["']$/g, "").trim();
}
