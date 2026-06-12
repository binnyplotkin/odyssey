import { describe, expect, it } from "vitest";
import {
  ambienceDataSchema,
  getSceneGraphStore,
  NODE_KINDS,
} from "./scene-graph-store";

describe("scene graph ambience nodes", () => {
  it("accepts valid ambience data", () => {
    expect(
      ambienceDataSchema.parse({
        trackId: "tent-evening",
        description: "Low evening ambience.",
        isDefault: true,
      }),
    ).toEqual({
      trackId: "tent-evening",
      description: "Low evening ambience.",
      isDefault: true,
    });
    expect(NODE_KINDS).toContain("ambience");
  });

  it("rejects empty ambience track ids", () => {
    expect(() => ambienceDataSchema.parse({ trackId: "" })).toThrow();
  });

  it("rejects ref ids for ambience nodes before touching the database", async () => {
    await expect(
      getSceneGraphStore().createNode({
        sceneId: "scene_1",
        kind: "ambience",
        refId: "voice_or_media_ref",
        label: "Tent evening",
        data: { trackId: "tent-evening" },
      }),
    ).rejects.toThrow("must not carry refId");
  });
});
