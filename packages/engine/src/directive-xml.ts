import type { CharacterDirective } from "@odyssey/db";

/**
 * Compile an L02 Directive into the Frontier Playbook XML envelope.
 *
 * Design references:
 *   - Anthropic's "Use XML Tags to Structure Prompts" — tagged sections
 *     attend more reliably than prose paragraphs labeled "Important:".
 *   - Anthropic's "Keep Claude in Character" — anti-patterns and explicit
 *     refusal-shaped exemplars land harder than vague "stay in character".
 *   - Synthesized in `odyssey labs - harness` Paper file, artboard 6KB-0
 *     "The Frontier Playbook".
 *
 * Empty sections are omitted so partially-authored directives still produce
 * clean output. If every section is empty, returns the empty string (callers
 * fall back to the legacy template).
 */
export function compileDirectiveXml(
  directive: CharacterDirective | null | undefined,
): string {
  if (!directive) return "";

  const sections: string[] = [];

  const engage = cleanList(directive.scope?.engage);
  const refuse = cleanList(directive.scope?.refuse);
  if (engage.length || refuse.length) {
    const parts: string[] = [];
    if (engage.length) {
      parts.push(`  <engage>\n${formatList(engage, 4)}\n  </engage>`);
    }
    if (refuse.length) {
      parts.push(`  <refuse>\n${formatList(refuse, 4)}\n  </refuse>`);
    }
    sections.push(`<scope>\n${parts.join("\n")}\n</scope>`);
  }

  const exemplars = (directive.exemplars ?? []).filter(
    (e) => e.user?.trim() && e.you?.trim(),
  );
  if (exemplars.length) {
    const rows = exemplars
      .map((e) => {
        const u = e.user.trim();
        const y = e.you.trim();
        const tags = (e.tags ?? []).map((t) => t.trim()).filter(Boolean);
        const tagsLine = tags.length
          ? `\n    <tags>${escapeXml(tags.join(", "))}</tags>`
          : "";
        // Authoring annotation — surfaced as <rationale> so the model can
        // pattern-match on the *why*, not just the lines. Optional.
        const rationale = e.rationale?.trim();
        const rationaleLine = rationale
          ? `\n    <rationale>${escapeXml(rationale)}</rationale>`
          : "";
        return `  <example>\n    <user>${escapeXml(u)}</user>\n    <you>${escapeXml(y)}</you>${tagsLine}${rationaleLine}\n  </example>`;
      })
      .join("\n");
    sections.push(`<exemplars>\n${rows}\n</exemplars>`);
  }

  const never = cleanList(directive.never);
  if (never.length) {
    const rows = never
      .map((rule) => `  - Do not ${stripLeadingDoNot(rule)}`)
      .join("\n");
    sections.push(`<never>\n${rows}\n</never>`);
  }

  const framing = directive.framing?.trim();
  if (framing) sections.push(`<framing>\n  ${escapeXml(framing)}\n</framing>`);

  const guidance = directive.guidance?.trim();
  if (guidance) sections.push(`<guidance>\n  ${escapeXml(guidance)}\n</guidance>`);

  return sections.join("\n\n");
}

function cleanList(list: string[] | undefined): string[] {
  if (!list) return [];
  return list.map((s) => s.trim()).filter(Boolean);
}

function formatList(items: string[], indent: number): string {
  const pad = " ".repeat(indent);
  return items.map((s) => `${pad}- ${escapeXml(s)}`).join("\n");
}

/** Permit authors to write either "Do not …" or "…" — normalize to the
 * second form so the compiler can prepend "Do not " consistently. */
function stripLeadingDoNot(rule: string): string {
  const trimmed = rule.trim();
  return trimmed.replace(/^[Dd]o[\s ]+not[\s ]+/, "");
}

/** Minimal XML escaping — we never inject the directive into HTML, but
 * we do want a clean preview in the right rail and want to avoid stray
 * `<` confusing the model's tag parser. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
