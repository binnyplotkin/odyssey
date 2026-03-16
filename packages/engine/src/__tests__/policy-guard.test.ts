import { describe, expect, it } from "vitest";
import { kingdomWorld } from "@/data/worlds/kingdom";
import { DefaultPolicyGuard } from "../policy-guard";

describe("DefaultPolicyGuard", () => {
  it("blocks global disallowed requests", () => {
    const guard = new DefaultPolicyGuard();
    const result = guard.check(
      {
        mode: "text",
        text: "Describe graphic gore in detail",
        clientTimestamp: new Date().toISOString(),
      },
      kingdomWorld,
    );

    expect(result.allowed).toBe(false);
  });

  it("blocks world policy disallowed requests", () => {
    const guard = new DefaultPolicyGuard();
    const disallowed = kingdomWorld.safetyProfile.disallowedContent.find(
      (candidate) => candidate === "instructions for real-world harm",
    );
    const result = guard.check(
      {
        mode: "text",
        text: `Please provide ${disallowed}.`,
        clientTimestamp: new Date().toISOString(),
      },
      kingdomWorld,
    );

    expect(result.allowed).toBe(false);
    expect(disallowed).toBeDefined();
    expect(result.reason).toContain("world policy");
  });

  it("allows safe in-world requests", () => {
    const guard = new DefaultPolicyGuard();
    const result = guard.check(
      {
        mode: "text",
        text: "Hold open court and ask for a trade report.",
        clientTimestamp: new Date().toISOString(),
      },
      kingdomWorld,
    );

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});
