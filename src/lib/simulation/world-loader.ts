import { getWorldDefinition, getWorldDefinitions } from "@/data/worlds";
import { WorldLoader } from "@/lib/simulation/interfaces";

export class StaticWorldLoader implements WorldLoader {
  async listWorlds() {
    return getWorldDefinitions();
  }

  async getWorld(worldId: string) {
    return getWorldDefinition(worldId);
  }
}
