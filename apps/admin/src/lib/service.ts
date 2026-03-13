import { getWorldDefinitions } from "@/data/worlds";
import { createSimulationService } from "@odyssey/engine";

export const {
  listWorlds,
  getVisibleWorldById,
  getWorldDetailById,
  updateWorldDefinition,
  buildWorldFromPrompt,
  traceTurnPipeline,
} = createSimulationService(getWorldDefinitions());
