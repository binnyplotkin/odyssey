import { describe, expect, it } from "vitest";
import { selectDefaultAmbienceTrackId } from "./scene-store";

const baseNode = {
  kind: "ambience" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  data: {},
};

describe("scene ambience resolution", () => {
  it("uses the default ambience node track id", () => {
    expect(
      selectDefaultAmbienceTrackId(
        [
          {
            ...baseNode,
            id: "node_b",
            data: { trackId: "tent-evening", isDefault: true },
          },
        ],
        "legacy-track",
      ),
    ).toBe("tent-evening");
  });

  it("falls back to scene definition ambience when no ambience node is default", () => {
    expect(
      selectDefaultAmbienceTrackId(
        [
          {
            ...baseNode,
            id: "node_b",
            data: { trackId: "tent-evening" },
          },
        ],
        "legacy-track",
      ),
    ).toBe("legacy-track");
  });

  it("resolves multiple default ambience nodes deterministically", () => {
    expect(
      selectDefaultAmbienceTrackId(
        [
          {
            ...baseNode,
            id: "node_b",
            createdAt: "2026-01-01T00:00:00.000Z",
            data: { trackId: "second", isDefault: true },
          },
          {
            ...baseNode,
            id: "node_a",
            createdAt: "2026-01-01T00:00:00.000Z",
            data: { trackId: "first", isDefault: true },
          },
        ],
        null,
      ),
    ).toBe("first");
  });
});
