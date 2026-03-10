import { describe, expect, it } from "vitest";
import { kingdomWorld } from "@/data/worlds/kingdom";
import { DefaultPolicyGuard } from "@/lib/simulation/policy-guard";

describe("DefaultPolicyGuard", () => {
  it("blocks disallowed requests", () => {
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
});
