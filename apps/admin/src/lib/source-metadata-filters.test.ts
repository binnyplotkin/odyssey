import { describe, expect, it } from "vitest";
import {
  parseSourceMetadataFilters,
  serializeSourceMetadataFilters,
  sourceMetadataFilterCount,
} from "./source-metadata-filters";

describe("source metadata filters", () => {
  it("parses repeated and comma-separated metadata query filters", () => {
    const params = new URLSearchParams();
    params.append("character_focus", "Sarah");
    params.append("themes", "migration,origins");
    params.append("participants", "Abraham");
    params.append("participants", "Lot");
    params.append("canonicality", "biblical");
    params.append("knowledge_accessible", "true");
    params.append("location", "Haran");
    params.append("time_period", "Sarah's lifetime");
    params.append("speaker", "Narrator");
    params.append("chronological_order", "1");

    expect(parseSourceMetadataFilters(params)).toEqual({
      character_focus: "Sarah",
      themes: ["migration", "origins"],
      participants: ["Abraham", "Lot"],
      canonicality: "biblical",
      knowledge_accessible: true,
      location: "Haran",
      time_period: "Sarah's lifetime",
      speaker: "Narrator",
      chronological_order: 1,
    });
  });

  it("supports singular aliases for common list filters", () => {
    expect(
      parseSourceMetadataFilters({
        character: "Sarah",
        theme: "family",
        participant: "Terah",
        accessible: "yes",
        chronology: "2",
      }),
    ).toEqual({
      character_focus: "Sarah",
      themes: "family",
      participants: "Terah",
      knowledge_accessible: true,
      chronological_order: 2,
    });
  });

  it("merges canonical query keys with aliases", () => {
    expect(
      parseSourceMetadataFilters({
        theme: "family",
        themes: "migration",
        participant: "Sarah",
        participants: "Abraham, Lot",
      }),
    ).toEqual({
      themes: ["family", "migration"],
      participants: ["Sarah", "Abraham", "Lot"],
    });
  });

  it("serializes filters back to stable query params", () => {
    const params = serializeSourceMetadataFilters({
      themes: ["family", "migration"],
      participants: "Sarah",
      speaker: "Narrator",
      knowledge_accessible: false,
      chronological_order: 1,
    });

    expect(params.getAll("themes")).toEqual(["family", "migration"]);
    expect(params.get("participants")).toBe("Sarah");
    expect(params.get("speaker")).toBe("Narrator");
    expect(params.get("knowledge_accessible")).toBe("false");
    expect(params.get("chronological_order")).toBe("1");
  });

  it("counts fields, not individual repeated values", () => {
    expect(
      sourceMetadataFilterCount({
        themes: ["family", "migration"],
        participants: "Sarah",
        chronological_order: 1,
      }),
    ).toBe(3);
  });
});
