/**
 * Turn the selected pages into a single markdown prompt chunk the voice
 * pipeline can inject into a character's system prompt.
 *
 * Shape:
 *
 *   ## Who you are
 *   <voice_identity full body + frontmatter>
 *
 *   ## What's present in this moment
 *   - [[slug]] Title — summary
 *   ...
 *
 *   ## What you know
 *   ### <entity|event|concept|relationship>
 *   #### Title  (slug, era, confidence)
 *   <full body>
 *
 *   ## Also aware of
 *   - [[slug]] Title
 *   ...
 */

import { flattenWikilinks, type WikiPageRecord } from "@odyssey/db";
import type { SelectedPage } from "./types";

export function renderPromptChunk(
  selected: SelectedPage[],
  options: { activeEntitySlugs: Set<string> },
): string {
  const voiceIdentities = selected.filter((s) => s.page.type === "voice_identity");
  const sceneActive = selected.filter(
    (s) => s.page.type !== "voice_identity" && options.activeEntitySlugs.has(s.page.slug),
  );
  const fullBodies = selected.filter(
    (s) =>
      s.rendering === "full" &&
      s.page.type !== "voice_identity" &&
      !options.activeEntitySlugs.has(s.page.slug),
  );
  const summaries = selected.filter(
    (s) =>
      s.rendering === "summary" &&
      s.page.type !== "voice_identity" &&
      !options.activeEntitySlugs.has(s.page.slug),
  );
  const titles = selected.filter(
    (s) =>
      s.rendering === "title" &&
      s.page.type !== "voice_identity" &&
      !options.activeEntitySlugs.has(s.page.slug),
  );

  const parts: string[] = [];

  // 1. Voice identity — the character's system prompt soul.
  if (voiceIdentities.length > 0) {
    parts.push("## Who you are");
    for (const v of voiceIdentities) {
      if (v.rendering === "full") {
        if (v.page.body?.trim()) parts.push(v.page.body.trim());
        const fmText = renderFrontmatter(v.page);
        if (fmText) parts.push(fmText);
      } else if (v.rendering === "summary") {
        parts.push(v.page.summary?.trim() || v.page.title);
        const fmText = renderFrontmatter(v.page);
        if (fmText) parts.push(fmText);
      } else {
        parts.push(v.page.title);
      }
    }
  }

  // 2. Scene — things currently present in the moment.
  if (sceneActive.length > 0) {
    parts.push("\n## What's present in this moment");
    for (const s of sceneActive) {
      const label = `[[${s.page.slug}]] ${s.page.title}`;
      const tail = s.rendering === "full" ? `\n${s.page.body.trim()}` : s.page.summary ? ` — ${s.page.summary}` : "";
      parts.push(`- ${label}${tail}`);
    }
  }

  // 3. Full bodies — the core context for this turn.
  if (fullBodies.length > 0) {
    parts.push("\n## What you know");
    const byType = groupByType(fullBodies.map((b) => b.page));
    for (const [type, pages] of byType) {
      parts.push(`\n### ${humanType(type)}`);
      for (const p of pages) {
        parts.push(renderPageFull(p));
      }
    }
  }

  // 4. Summaries — paged in at lower priority.
  if (summaries.length > 0) {
    parts.push("\n## Also on your mind");
    for (const s of summaries) {
      parts.push(
        `- [[${s.page.slug}]] ${s.page.title} — ${s.page.summary ?? "(no summary)"}`,
      );
    }
  }

  // 5. Titles-only — just nods; the curator knew to keep the slug available
  //    for wikilink resolution if the character references it.
  if (titles.length > 0) {
    parts.push("\n## Aware of");
    const list = titles.map((t) => `[[${t.page.slug}]] ${t.page.title}`).join(", ");
    parts.push(list);
  }

  // Build a slug→title map from every selected page so flattenWikilinks
  // can resolve display-less `[[slug]]` references to their real title.
  // Anything not in the map falls back to a prettified slug.
  const titleBySlug = new Map<string, string>();
  for (const s of selected) titleBySlug.set(s.page.slug, s.page.title);

  // Strip every wikilink before handing the chunk to the LLM. The model
  // doesn't use slug-as-anchor for anything generative — leaving them in
  // just bleeds `[[…]]` syntax into the response (observed regression in
  // Abraham's "Were you afraid?" probe). Doing this as a final pass means
  // every emit site above stays template-simple — no `flatten()` calls
  // sprinkled through the renderer.
  return flattenWikilinks(parts.join("\n").trim(), titleBySlug);
}

/* ── Page rendering helpers ────────────────────────────────────── */

function renderPageFull(page: WikiPageRecord): string {
  const head = [
    `#### ${page.title}`,
    renderMetaLine(page),
  ].filter(Boolean).join("\n");

  const body = page.body?.trim() ?? "";
  const summary = page.summary?.trim();
  const fmText = renderFrontmatter(page);

  return [
    head,
    summary ? `*${summary}*` : null,
    body,
    fmText,
  ].filter(Boolean).join("\n\n");
}

function renderMetaLine(page: WikiPageRecord): string {
  const bits: string[] = [`[[${page.slug}]]`];
  if (page.timeIndex) bits.push(`${page.timeIndex.era}·${page.timeIndex.index}`);
  if (page.confidence !== 0.5) bits.push(`conf ${page.confidence.toFixed(2)}`);
  if (page.knowsFuture) bits.push("future");
  return bits.length > 1 ? `<sub>${bits.join(" · ")}</sub>` : "";
}

/**
 * Emit a terse summary of the structured frontmatter that the LLM might use
 * at runtime. We only include fields that are cheap + useful in-prompt.
 */
function renderFrontmatter(page: WikiPageRecord): string | null {
  const fm = page.frontmatter as Record<string, unknown>;
  if (!fm) return null;

  const lines: string[] = [];

  if (page.type === "event") {
    const where = typeof fm.where === "string" ? fm.where : null;
    const participants = asArray(fm.participants);
    if (where) lines.push(`- happens at [[${where}]]`);
    if (participants.length) lines.push(`- participants: ${participants.map((p) => `[[${p}]]`).join(", ")}`);
  } else if (page.type === "relationship") {
    const from = typeof fm.from === "string" ? fm.from : null;
    const to = typeof fm.to === "string" ? fm.to : null;
    const kind = typeof fm.kind === "string" ? fm.kind : null;
    if (from && to) lines.push(`- [[${from}]] ↔ [[${to}]]${kind ? ` (${kind})` : ""}`);
  } else if (page.type === "voice_identity") {
    const speech = asArray(fm.speechPatterns);
    const beliefs = asArray(fm.beliefs);
    const taboos = asArray(fm.taboos);
    if (speech.length) lines.push(`- speech: ${speech.join("; ")}`);
    if (beliefs.length) lines.push(`- beliefs: ${beliefs.join("; ")}`);
    if (taboos.length) lines.push(`- avoid: ${taboos.join("; ")}`);
  } else if (page.type === "entity") {
    const aliases = asArray(fm.aliases);
    if (aliases.length) lines.push(`- also known as: ${aliases.join(", ")}`);
  }

  // Perspective (applies to any type that has it — usually entities/events).
  const perspective = page.perspective ?? {};
  const feels = Array.isArray(perspective.feels)
    ? perspective.feels.filter((f): f is string => typeof f === "string")
    : [];
  if (perspective.knowsHow) lines.push(`- knows: ${perspective.knowsHow}`);
  if (feels.length) lines.push(`- feels: ${feels.join(", ")}`);
  if (typeof perspective.stake === "string" && perspective.stake.trim()) {
    lines.push(`- stake: "${perspective.stake.trim()}"`);
  }

  return lines.length ? lines.join("\n") : null;
}

/* ── Misc ──────────────────────────────────────────────────────── */

function groupByType(pages: WikiPageRecord[]): Map<string, WikiPageRecord[]> {
  const order = ["relationship", "entity", "event", "concept", "timeline"];
  const groups = new Map<string, WikiPageRecord[]>();
  for (const p of pages) {
    if (!groups.has(p.type)) groups.set(p.type, []);
    groups.get(p.type)!.push(p);
  }
  const out = new Map<string, WikiPageRecord[]>();
  for (const key of order) {
    if (groups.has(key)) out.set(key, groups.get(key)!);
  }
  // Any types not in our canonical order, append last.
  for (const [key, val] of groups) if (!out.has(key)) out.set(key, val);
  return out;
}

function humanType(type: string): string {
  switch (type) {
    case "relationship": return "People you know";
    case "entity":       return "People, places, things";
    case "event":        return "Things that happened";
    case "concept":      return "What you believe";
    case "voice_identity": return "Who you are";
    case "timeline":     return "Timeline";
    default:             return type;
  }
}

function asArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}
