import { getWorldDefinitions } from "@/data/worlds";
import { createSimulationService } from "@odyssey/engine";

export const {
  listWorlds,
  getVisibleWorldById,
  getWorldDetailById,
  updateWorldDefinition,
  buildWorldFromPrompt,
  startSession,
  resumeSession,
  listRecentSessions,
  processTurn,
  getSessionTurns,
  replaySession,
  createIntroResult,
} = createSimulationService(getWorldDefinitions());
