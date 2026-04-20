import { abrahamsTentWorld } from "./abrahams-tent";
import { abrahamsTentBaseWorld } from "./abrahams-tent-base";
import { kingdomWorld } from "./kingdom";
import type { WorldDefinition } from "@odyssey/types";

export { abrahamsTentWorld, abrahamsTentBaseWorld, kingdomWorld };

export function getWorldDefinitions(): WorldDefinition[] {
  return [kingdomWorld];
}
