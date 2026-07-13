import { describe, expect, it } from "vitest";
import { compileDirectiveXml } from "../directive-xml";

describe("compileDirectiveXml scope handling", () => {
  it("never emits <engage>, even when stale data survives in the row", () => {
    const xml = compileDirectiveXml({
      scope: {
        engage: ["hospitality", "the call from Ur"],
        refuse: ["modern politics"],
      },
    });
    expect(xml).not.toContain("<engage>");
    expect(xml).not.toContain("hospitality");
    expect(xml).toContain("<refuse>");
    expect(xml).toContain("modern politics");
  });

  it("omits <scope> entirely when only stale engage data exists", () => {
    const xml = compileDirectiveXml({
      scope: { engage: ["hospitality"] },
      never: ["break character"],
    });
    expect(xml).not.toContain("<scope>");
    expect(xml).toContain("<never>");
  });

  it("compiles the remaining sections in order", () => {
    const xml = compileDirectiveXml({
      scope: { refuse: ["medical advice"] },
      exemplars: [
        { user: "Who are you?", you: "A wanderer.", tags: ["identity"] },
      ],
      never: ["Do not break character"],
      framing: "A dramatized portrayal.",
      guidance: "When uncertain, pause.",
    });
    const order = [
      xml.indexOf("<scope>"),
      xml.indexOf("<exemplars>"),
      xml.indexOf("<never>"),
      xml.indexOf("<framing>"),
      xml.indexOf("<guidance>"),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // "Do not " prefix is normalized, not doubled.
    expect(xml).toContain("- Do not break character");
    expect(xml).not.toContain("Do not Do not");
  });

  it("returns empty string for null or fully empty directives", () => {
    expect(compileDirectiveXml(null)).toBe("");
    expect(compileDirectiveXml({ scope: { engage: [" "] } })).toBe("");
  });
});
