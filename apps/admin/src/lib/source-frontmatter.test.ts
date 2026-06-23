import { describe, expect, it } from "vitest";
import { parseSourceFrontmatter } from "./source-frontmatter";

describe("parseSourceFrontmatter", () => {
  it("preserves raw YAML and returns parsed JSON metadata", () => {
    const raw = [
      "author: Sarah",
      "source_url: https://example.com/source",
      "subjects:",
      "  - mary",
      "  - abraham",
      "confidence: 0.82",
    ].join("\n");

    expect(parseSourceFrontmatter(raw)).toEqual({
      ok: true,
      raw,
      metadata: {
        author: "Sarah",
        source_url: "https://example.com/source",
        subjects: ["mary", "abraham"],
        confidence: 0.82,
      },
    });
  });

  it("returns empty metadata for blank frontmatter", () => {
    expect(parseSourceFrontmatter("\n  \n")).toEqual({
      ok: true,
      raw: "\n  \n",
      metadata: {},
    });
  });

  it("accepts pasted frontmatter delimiters", () => {
    const result = parseSourceFrontmatter("---\ntitle: Source\n---\nIgnored body");
    expect(result).toMatchObject({
      ok: true,
      raw: "---\ntitle: Source\n---\nIgnored body",
      metadata: { title: "Source" },
    });
  });

  it("parses biblical source frontmatter with nested metadata", () => {
    const raw = [
      "title: Genesis 11:27–32 — Sarah's Introduction",
      "book: Genesis",
      "chapter: 11",
      'verses: "27-32"',
      "",
      "source_type: primary",
      "canonicality: biblical",
      "",
      "character_focus:",
      "  - Sarah",
      "",
      "chronological_order: 1",
      "",
      "time_period: Sarah's lifetime",
      "",
      "location:",
      "  - Ur of the Chaldeans",
      "  - Haran",
      "",
      "participants:",
      "  - Sarah",
      "  - Abraham",
      "  - Terah",
      "  - Lot",
      "",
      "speaker:",
      "  - Narrator",
      "",
      "knowledge_accessible: true",
      "",
      "themes:",
      "  - family",
      "  - barrenness",
      "  - migration",
      "  - origins",
      "",
      "relationships:",
      "  Sarah: wife of Abraham",
      "  Abraham: husband of Sarah",
      "  Terah: father-in-law of Sarah",
      "  Lot: nephew of Abraham",
      "",
      "emotions:",
      "  - uncertainty",
      "  - displacement",
      "  - longing",
      "",
      "confidence: high",
    ].join("\n");

    expect(parseSourceFrontmatter(raw)).toEqual({
      ok: true,
      raw,
      metadata: {
        title: "Genesis 11:27–32 — Sarah's Introduction",
        book: "Genesis",
        chapter: 11,
        verses: "27-32",
        source_type: "primary",
        canonicality: "biblical",
        character_focus: ["Sarah"],
        chronological_order: 1,
        time_period: "Sarah's lifetime",
        location: ["Ur of the Chaldeans", "Haran"],
        participants: ["Sarah", "Abraham", "Terah", "Lot"],
        speaker: ["Narrator"],
        knowledge_accessible: true,
        themes: ["family", "barrenness", "migration", "origins"],
        relationships: {
          Sarah: "wife of Abraham",
          Abraham: "husband of Sarah",
          Terah: "father-in-law of Sarah",
          Lot: "nephew of Abraham",
        },
        emotions: ["uncertainty", "displacement", "longing"],
        confidence: "high",
      },
    });
  });

  it("rejects non-mapping YAML", () => {
    expect(parseSourceFrontmatter("- one\n- two")).toMatchObject({
      ok: false,
      error: "Frontmatter must be a YAML mapping.",
    });
  });

  it("rejects invalid YAML", () => {
    expect(parseSourceFrontmatter("title: [broken")).toMatchObject({
      ok: false,
    });
  });
});
