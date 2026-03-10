import { WorldLoader } from "@/lib/simulation/interfaces";
import { getWorldRepository } from "@/lib/worlds/repository";

export class StaticWorldLoader implements WorldLoader {
  async listWorlds() {
    return getWorldRepository().listWorlds();
  }

  async getWorld(worldId: string) {
    return getWorldRepository().getWorldById(worldId);
  }
}
