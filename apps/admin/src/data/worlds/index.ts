import { kingdomWorld } from "@/data/worlds/kingdom";
import { visibleWorldSchema, WorldDefinition } from "@odyssey/types";

const worlds = [kingdomWorld] satisfies WorldDefinition[];

export function getWorldDefinitions() {
  return worlds;
}

export function getVisibleWorlds() {
  return worlds.map((world) => visibleWorldSchema.parse(world));
}

export function getWorldDefinition(worldId: string) {
  return worlds.find((world) => world.id === worldId) ?? null;
}
