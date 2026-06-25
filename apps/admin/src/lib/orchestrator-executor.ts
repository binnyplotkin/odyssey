// Moved to @odyssey/orchestration so the LiveKit world-agent (services/voice-agent)
// can resolve the orchestrator executor in-process (no HTTP hop on turn-driving).
// Re-exported here so existing app imports (@/lib/orchestrator-executor) keep working.
export { resolveOrchestratorExecutor } from "@odyssey/orchestration";
export type {
  OrchestratorExecutor,
  OrchestratorProvider,
  OrchestratorExecutorResolution,
  OrchestratorExecutorConfig,
} from "@odyssey/orchestration";
