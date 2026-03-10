import { PolicyGuard } from "@/lib/simulation/interfaces";
import { TurnInput, WorldDefinition } from "@/types/simulation";

const blockedPatterns = [
  "sexual violence",
  "explicit torture",
  "graphic gore",
  "erotic slavery",
  "how to kill",
];

export class DefaultPolicyGuard implements PolicyGuard {
  check(input: TurnInput, world: WorldDefinition) {
    const lowered = input.text.toLowerCase();

    const matchedBlockedPattern = blockedPatterns.find((pattern) =>
      lowered.includes(pattern),
    );

    if (matchedBlockedPattern) {
      return {
        allowed: false,
        reason: `The request conflicts with runtime safety policy: ${matchedBlockedPattern}.`,
      };
    }

    const matchedWorldPolicy = world.safetyProfile.disallowedContent.find((pattern) =>
      lowered.includes(pattern.toLowerCase()),
    );

    if (matchedWorldPolicy) {
      return {
        allowed: false,
        reason: `The request conflicts with world policy: ${matchedWorldPolicy}.`,
      };
    }

    return { allowed: true };
  }
}
