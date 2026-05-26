import {
  getCharacterStore,
  getVoiceStore,
  getWikisStore,
  getWorldSessionStore,
  type CharacterRecord,
  type VoiceRecord,
} from "@odyssey/db";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_VOICE_MODEL,
  POCKET_TTS_SAMPLE_RATE,
  createSpeechToTextAdapter,
  createStreamingTtsAdapterForVoice,
  getChatProviderForModel,
  getPocketTtsBaseUrl,
  modelMetaFor,
  resolveSttProvider,
  type ModelOption,
  type ProviderId,
  type StreamingTtsProvider,
  type VoiceForRouting,
} from "@odyssey/engine";
import { createEmbeddingSignedUrl } from "@/lib/voices-storage";
import { VOICE_PIPELINE_CONFIG } from "@/lib/voice-pipeline-config";

export type SandboxReadinessMode = "chat" | "voice";

export type SandboxReadinessStatus =
  | "not_checked"
  | "checking"
  | "ready"
  | "warning"
  | "blocked"
  | "degraded"
  | "unavailable";

export type SandboxReadinessGroup =
  | "routing"
  | "voice"
  | "context"
  | "persistence"
  | "browser";

export type SandboxReadinessAction =
  | "check_model"
  | "check_tts"
  | "check_stt"
  | "check_persistence"
  | "run_all";

export type SandboxReadinessCheck = {
  id: string;
  label: string;
  group: SandboxReadinessGroup;
  status: SandboxReadinessStatus;
  summary: string;
  detail?: string;
  checkedAt?: string;
  metadata?: Record<string, unknown>;
  action?: SandboxReadinessAction;
};

export type SandboxReadinessReport = {
  timestamp: string;
  mode: SandboxReadinessMode;
  overallStatus: SandboxReadinessStatus;
  character: {
    id: string;
    slug: string;
    title: string;
  };
  selected: {
    chatModel: ModelReadinessSelection;
    voiceModel?: ModelReadinessSelection;
    voice?: VoiceReadinessSelection;
    stt: {
      provider: string;
      label: string;
      configured: boolean;
    };
  };
  checks: SandboxReadinessCheck[];
  groups: Array<{
    id: SandboxReadinessGroup;
    status: SandboxReadinessStatus;
    ready: number;
    warnings: number;
    blocked: number;
    total: number;
  }>;
};

export type SandboxReadinessActionResult = {
  timestamp: string;
  action: SandboxReadinessAction;
  checks: SandboxReadinessCheck[];
};

export type BuildSandboxReadinessInput = {
  characterIdOrSlug: string;
  mode?: string | null;
  chatModel?: string | null;
  voiceModel?: string | null;
};

type ModelReadinessSelection = {
  id: string;
  label: string;
  provider: ProviderId | null;
  mode: "chat" | "voice";
  known: boolean;
  configured: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  streaming?: boolean;
  latencyTier?: string;
  qualityTier?: string;
  missingEnv?: string | null;
};

type VoiceReadinessSelection = {
  provider: StreamingTtsProvider;
  slug: string;
  name?: string | null;
  status: string;
  boundVoiceId?: string | null;
  sampleRate?: number;
  fallback: boolean;
};

type LoadedSandboxReadiness = {
  mode: SandboxReadinessMode;
  character: CharacterRecord;
  boundVoice: VoiceRecord | null;
  chatModelId: string;
  voiceModelId: string;
};

export async function buildSandboxReadinessReport(
  input: BuildSandboxReadinessInput,
): Promise<SandboxReadinessReport> {
  const loaded = await loadSandboxReadiness(input);
  const { mode, character, boundVoice, chatModelId, voiceModelId } = loaded;
  const checks: SandboxReadinessCheck[] = [];

  const chatSelection = describeModelSelection(chatModelId, "chat");
  checks.push(modelCheck(chatSelection));

  const voiceSelection =
    mode === "voice" ? describeModelSelection(voiceModelId, "voice") : undefined;
  if (voiceSelection) checks.push(modelCheck(voiceSelection));

  const sttSelection = describeSttSelection();
  const voiceSelectionForTts =
    mode === "voice" ? describeVoiceSelection(character, boundVoice) : undefined;

  if (mode === "voice") {
    checks.push(sttCheck(sttSelection));
    checks.push(ttsCheck(voiceSelectionForTts));
    checks.push(audioGatewayCheck(voiceSelectionForTts));
  }

  checks.push(...(await contextChecks(character)));
  checks.push(persistenceCheck());
  checks.push(...browserChecks(mode));

  return {
    timestamp: new Date().toISOString(),
    mode,
    overallStatus: aggregateStatus(checks),
    character: {
      id: character.id,
      slug: character.slug,
      title: character.title,
    },
    selected: {
      chatModel: chatSelection,
      ...(voiceSelection ? { voiceModel: voiceSelection } : {}),
      ...(voiceSelectionForTts ? { voice: voiceSelectionForTts } : {}),
      stt: sttSelection,
    },
    checks,
    groups: summarizeGroups(checks),
  };
}

export async function runSandboxReadinessAction(
  input: BuildSandboxReadinessInput & { action: SandboxReadinessAction },
): Promise<SandboxReadinessActionResult> {
  const loaded = await loadSandboxReadiness(input);
  const actions =
    input.action === "run_all"
      ? (["check_model", "check_tts", "check_stt", "check_persistence"] as const)
      : ([input.action] as const);

  const checks: SandboxReadinessCheck[] = [];
  for (const action of actions) {
    switch (action) {
      case "check_model":
        checks.push(await checkModelRoute(loaded));
        break;
      case "check_tts":
        checks.push(await checkTtsRoute(loaded));
        break;
      case "check_stt":
        checks.push(await checkSttRoute());
        break;
      case "check_persistence":
        checks.push(await checkPersistence(loaded));
        break;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    action: input.action,
    checks,
  };
}

async function loadSandboxReadiness(
  input: BuildSandboxReadinessInput,
): Promise<LoadedSandboxReadiness> {
  const mode = input.mode === "chat" ? "chat" : "voice";
  const characterStore = getCharacterStore();
  const character =
    (await characterStore.getById(input.characterIdOrSlug)) ??
    (await characterStore.getBySlug(input.characterIdOrSlug));
  if (!character) {
    throw Object.assign(new Error("character not found"), { status: 404 });
  }

  const boundVoice = character.voiceId
    ? await getVoiceStore().getById(character.voiceId)
    : null;
  const voiceCfg = character.brainModel?.voice;
  const chatModelId =
    input.chatModel?.trim() || character.brainModel?.model?.trim() || DEFAULT_CHAT_MODEL;
  const voiceModelId =
    input.voiceModel?.trim() ||
    voiceCfg?.model?.trim() ||
    character.brainModel?.model?.trim() ||
    DEFAULT_VOICE_MODEL;

  return { mode, character, boundVoice, chatModelId, voiceModelId };
}

function describeModelSelection(
  modelId: string,
  mode: "chat" | "voice",
): ModelReadinessSelection {
  const meta = modelMetaFor(modelId);
  const missingEnv = meta ? missingProviderEnv(meta.provider) : null;
  return {
    id: modelId,
    label: meta?.label ?? modelId,
    provider: meta?.provider ?? null,
    mode,
    known: Boolean(meta),
    configured: Boolean(meta && !missingEnv),
    ...(meta
      ? {
          contextWindow: meta.contextWindow,
          maxOutputTokens: meta.maxOutputTokens,
          streaming: meta.capabilities.streaming === true,
          latencyTier: meta.latencyTier,
          qualityTier: meta.qualityTier,
          missingEnv,
        }
      : {}),
  };
}

function modelCheck(selection: ModelReadinessSelection): SandboxReadinessCheck {
  const meta = modelMetaFor(selection.id);
  if (!meta) {
    return {
      id: `${selection.mode}-model`,
      label: `${labelMode(selection.mode)} model route`,
      group: "routing",
      status: "blocked",
      summary: `Unknown model "${selection.id}".`,
      action: "check_model",
      metadata: { model: selection.id },
    };
  }
  if (!meta.modes.includes(selection.mode)) {
    return {
      id: `${selection.mode}-model`,
      label: `${labelMode(selection.mode)} model route`,
      group: "routing",
      status: "blocked",
      summary: `${meta.label} is not enabled for ${selection.mode} mode.`,
      action: "check_model",
      metadata: modelMetadata(meta),
    };
  }
  if (selection.missingEnv) {
    return {
      id: `${selection.mode}-model`,
      label: `${labelMode(selection.mode)} model route`,
      group: "routing",
      status: "blocked",
      summary: `${meta.provider} is missing ${selection.missingEnv}.`,
      action: "check_model",
      metadata: modelMetadata(meta),
    };
  }
  return {
    id: `${selection.mode}-model`,
    label: `${labelMode(selection.mode)} model route`,
    group: "routing",
    status: "ready",
    summary: `${meta.label} resolves to ${meta.provider}.`,
    action: "check_model",
    metadata: modelMetadata(meta),
  };
}

function describeSttSelection() {
  const provider = resolveSttProvider();
  const configured =
    provider === "kyutai"
      ? Boolean((process.env.KYUTAI_BASE_URL ?? "").trim())
      : Boolean((process.env.OPENAI_API_KEY ?? "").trim());
  return {
    provider,
    label: VOICE_PIPELINE_CONFIG.stt.full,
    configured,
  };
}

function sttCheck(selection: ReturnType<typeof describeSttSelection>): SandboxReadinessCheck {
  if (!selection.configured) {
    return {
      id: "stt-provider",
      label: "STT provider",
      group: "voice",
      status: "blocked",
      summary:
        selection.provider === "kyutai"
          ? "Kyutai STT selected but KYUTAI_BASE_URL is not configured."
          : "OpenAI STT selected but OPENAI_API_KEY is not configured.",
      action: "check_stt",
      metadata: selection,
    };
  }
  return {
    id: "stt-provider",
    label: "STT provider",
    group: "voice",
    status: "ready",
    summary: `${selection.provider} STT is configured.`,
    action: "check_stt",
    metadata: selection,
  };
}

function describeVoiceSelection(
  character: CharacterRecord,
  boundVoice: VoiceRecord | null,
): VoiceReadinessSelection {
  if (boundVoice?.status === "ready") {
    return {
      provider: boundVoice.provider as StreamingTtsProvider,
      slug: boundVoice.slug,
      name: boundVoice.name,
      status: boundVoice.status,
      boundVoiceId: boundVoice.id,
      sampleRate: POCKET_TTS_SAMPLE_RATE,
      fallback: false,
    };
  }
  return {
    provider: "pocket_tts",
    slug: character.slug || "abraham",
    name: null,
    status: boundVoice?.status ?? "fallback",
    boundVoiceId: boundVoice?.id ?? null,
    sampleRate: POCKET_TTS_SAMPLE_RATE,
    fallback: true,
  };
}

function ttsCheck(
  selection: VoiceReadinessSelection | undefined,
): SandboxReadinessCheck {
  if (!selection) {
    return {
      id: "tts-provider",
      label: "TTS provider",
      group: "voice",
      status: "unavailable",
      summary: "No voice pipeline is needed in chat mode.",
    };
  }
  const missingEnv = missingTtsEnv(selection.provider);
  if (missingEnv) {
    return {
      id: "tts-provider",
      label: "TTS provider",
      group: "voice",
      status: "blocked",
      summary: `${selection.provider} is missing ${missingEnv}.`,
      action: "check_tts",
      metadata: { ...selection, missingEnv },
    };
  }

  try {
    createStreamingTtsAdapterForVoice({
      provider: selection.provider,
      slug: selection.slug,
      embeddingUrl: null,
    });
  } catch (err) {
    return {
      id: "tts-provider",
      label: "TTS provider",
      group: "voice",
      status: "blocked",
      summary: err instanceof Error ? err.message : String(err),
      action: "check_tts",
      metadata: selection,
    };
  }

  return {
    id: "tts-provider",
    label: "TTS provider",
    group: "voice",
    status: selection.fallback ? "warning" : "ready",
    summary: selection.fallback
      ? `No ready voice binding; will fall back to Pocket slug "${selection.slug}".`
      : `${selection.provider} voice "${selection.slug}" is ready.`,
    action: "check_tts",
    metadata: selection,
  };
}

function audioGatewayCheck(
  selection: VoiceReadinessSelection | undefined,
): SandboxReadinessCheck {
  if (!selection || selection.provider !== "pocket_tts") {
    return {
      id: "audio-gateway",
      label: "Audio gateway",
      group: "voice",
      status: "not_checked",
      summary: "No Pocket audio gateway check required for this voice.",
      action: "check_tts",
      metadata: { provider: selection?.provider ?? null },
    };
  }
  const baseUrl = getPocketTtsBaseUrl();
  return {
    id: "audio-gateway",
    label: "Audio gateway",
    group: "voice",
    status: "not_checked",
    summary: `Pocket TTS gateway will use ${baseUrl}.`,
    detail: "Run the TTS warm-up to verify /speak from this environment.",
    action: "check_tts",
    metadata: { baseUrl, provider: selection.provider },
  };
}

async function contextChecks(
  character: CharacterRecord,
): Promise<SandboxReadinessCheck[]> {
  const bindings = await getWikisStore().listWikisForCharacter(character.id);
  const activeBindings = bindings.filter((b) => b.binding.isActive);
  const pageCounts = await Promise.all(
    activeBindings.map(async (binding) => ({
      id: binding.id,
      slug: binding.slug,
      title: binding.title,
      pageCount: (await getWikisStore().listPagesForWiki(binding.id)).length,
      priority: binding.binding.priority,
    })),
  );
  const examples = Array.isArray(character.directive?.exemplars)
    ? character.directive.exemplars.length
    : 0;

  return [
    {
      id: "identity",
      label: "Identity",
      group: "context",
      status: character.identity ? "ready" : "warning",
      summary: character.identity
        ? "Character identity is authored."
        : "Character identity is missing.",
      metadata: { present: Boolean(character.identity) },
    },
    {
      id: "directive",
      label: "Directive",
      group: "context",
      status: character.directive ? "ready" : "blocked",
      summary: character.directive
        ? `Directive is authored with ${examples} saved example${examples === 1 ? "" : "s"}.`
        : "Directive is missing; character behavior will be under-specified.",
      metadata: { present: Boolean(character.directive), examples },
    },
    {
      id: "voice-style",
      label: "Voice style",
      group: "context",
      status: character.voiceStyle ? "ready" : "warning",
      summary: character.voiceStyle
        ? "Voice style is authored."
        : "Voice style is missing; written and spoken style may be generic.",
      metadata: { present: Boolean(character.voiceStyle) },
    },
    {
      id: "brain-model",
      label: "Brain model",
      group: "context",
      status: character.brainModel ? "ready" : "warning",
      summary: character.brainModel
        ? "Brain/model config is authored."
        : "Brain/model config is missing; defaults will be used.",
      metadata: { present: Boolean(character.brainModel) },
    },
    {
      id: "wiki-bindings",
      label: "Knowledge bindings",
      group: "context",
      status:
        activeBindings.length === 0
          ? "warning"
          : pageCounts.some((b) => b.pageCount > 0)
            ? "ready"
            : "warning",
      summary:
        activeBindings.length === 0
          ? "No active wikis are bound."
          : `${activeBindings.length} active wiki${activeBindings.length === 1 ? "" : "s"} bound with ${pageCounts.reduce(
              (sum, b) => sum + b.pageCount,
              0,
            )} pages.`,
      metadata: {
        totalBindings: bindings.length,
        activeBindings: activeBindings.length,
        wikis: pageCounts,
      },
    },
  ];
}

function persistenceCheck(): SandboxReadinessCheck {
  const configured = Boolean((process.env.DATABASE_URL ?? "").trim());
  return {
    id: "world-session-persistence",
    label: "World-session persistence",
    group: "persistence",
    status: configured ? "not_checked" : "degraded",
    summary: configured
      ? "Database is configured; run the persistence check to create/end a probe session."
      : "DATABASE_URL is not configured; sandbox can run local-only but traces will not persist.",
    action: "check_persistence",
    metadata: { configured },
  };
}

function browserChecks(mode: SandboxReadinessMode): SandboxReadinessCheck[] {
  const checks: SandboxReadinessCheck[] = [
    {
      id: "browser-audio-output",
      label: "Browser audio output",
      group: "browser",
      status: "not_checked",
      summary: "Client should verify AudioContext support before playback.",
      metadata: { api: "AudioContext" },
    },
  ];
  if (mode === "voice") {
    checks.push({
      id: "browser-mic",
      label: "Browser mic permission",
      group: "browser",
      status: "not_checked",
      summary: "Client should verify getUserMedia and request mic permission.",
      metadata: { api: "navigator.mediaDevices.getUserMedia" },
    });
    checks.push({
      id: "browser-recorder",
      label: "Browser recorder",
      group: "browser",
      status: "not_checked",
      summary: "Client should verify MediaRecorder support for captured turns.",
      metadata: { api: "MediaRecorder" },
    });
  }
  return checks;
}

async function checkModelRoute(
  loaded: LoadedSandboxReadiness,
): Promise<SandboxReadinessCheck> {
  const modelId = loaded.mode === "voice" ? loaded.voiceModelId : loaded.chatModelId;
  const selection = describeModelSelection(modelId, loaded.mode);
  const staticCheck = modelCheck(selection);
  if (staticCheck.status === "blocked") {
    return { ...staticCheck, checkedAt: new Date().toISOString() };
  }

  const started = performance.now();
  try {
    const provider = getChatProviderForModel(modelId);
    const response = await provider.complete({
      model: modelId,
      system: [{ type: "text", text: "Return exactly: ready" }],
      messages: [{ role: "user", content: "ready check" }],
      maxTokens: 8,
      signal: AbortSignal.timeout(15000),
    });
    return {
      id: "model-warmup",
      label: "Model warm-up",
      group: "routing",
      status: "ready",
      summary: `${provider.id} responded in ${Math.round(performance.now() - started)}ms.`,
      checkedAt: new Date().toISOString(),
      metadata: {
        provider: provider.id,
        model: response.model,
        latencyMs: response.latencyMs,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        text: response.text.slice(0, 80),
      },
    };
  } catch (err) {
    return {
      id: "model-warmup",
      label: "Model warm-up",
      group: "routing",
      status: "blocked",
      summary: err instanceof Error ? err.message : String(err),
      checkedAt: new Date().toISOString(),
      metadata: { model: modelId, provider: selection.provider },
    };
  }
}

async function checkTtsRoute(
  loaded: LoadedSandboxReadiness,
): Promise<SandboxReadinessCheck> {
  const selection = describeVoiceSelection(loaded.character, loaded.boundVoice);
  const staticCheck = ttsCheck(selection);
  if (staticCheck.status === "blocked") {
    return { ...staticCheck, checkedAt: new Date().toISOString() };
  }

  const started = performance.now();
  try {
    const voiceForRouting = await buildVoiceForRouting(loaded.character, loaded.boundVoice);
    const routing = createStreamingTtsAdapterForVoice(voiceForRouting);
    let audioChunks = 0;
    let samples = 0;
    for await (const chunk of routing.adapter.stream({
      text: "Ready.",
      voice: routing.voiceContext,
      signal: AbortSignal.timeout(20000),
    })) {
      if (chunk.type === "error") throw new Error(chunk.message);
      if (chunk.type === "audio") {
        audioChunks += 1;
        samples += chunk.samples;
        break;
      }
    }
    return {
      id: "tts-warmup",
      label: "TTS warm-up",
      group: "voice",
      status: audioChunks > 0 ? "ready" : "warning",
      summary:
        audioChunks > 0
          ? `${selection.provider} produced first audio in ${Math.round(
              performance.now() - started,
            )}ms.`
          : `${selection.provider} completed without an audio chunk.`,
      checkedAt: new Date().toISOString(),
      metadata: {
        ...selection,
        audioChunks,
        samples,
        latencyMs: Math.round(performance.now() - started),
      },
    };
  } catch (err) {
    return {
      id: "tts-warmup",
      label: "TTS warm-up",
      group: "voice",
      status: "blocked",
      summary: err instanceof Error ? err.message : String(err),
      checkedAt: new Date().toISOString(),
      metadata: selection,
    };
  }
}

async function checkSttRoute(): Promise<SandboxReadinessCheck> {
  const selection = describeSttSelection();
  const staticCheck = sttCheck(selection);
  if (staticCheck.status === "blocked") {
    return { ...staticCheck, checkedAt: new Date().toISOString() };
  }

  const started = performance.now();
  try {
    const { provider, adapter } = createSpeechToTextAdapter();
    const transcript = await adapter.transcribe({
      audioBase64: createSilentWavBase64(350),
      mimeType: "audio/wav",
    });
    return {
      id: "stt-warmup",
      label: "STT warm-up",
      group: "voice",
      status: "ready",
      summary: `${provider} STT accepted a probe audio file in ${Math.round(
        performance.now() - started,
      )}ms.`,
      checkedAt: new Date().toISOString(),
      metadata: {
        provider,
        latencyMs: Math.round(performance.now() - started),
        transcript,
      },
    };
  } catch (err) {
    return {
      id: "stt-warmup",
      label: "STT warm-up",
      group: "voice",
      status: "blocked",
      summary: err instanceof Error ? err.message : String(err),
      checkedAt: new Date().toISOString(),
      metadata: selection,
    };
  }
}

async function checkPersistence(
  loaded: LoadedSandboxReadiness,
): Promise<SandboxReadinessCheck> {
  const started = performance.now();
  try {
    const session = await getWorldSessionStore().createSession({
      userId: null,
      characterId: loaded.character.id,
      mode: "sandbox-preflight",
      initialScene: {
        kind: "character-sandbox-preflight",
        characterSlug: loaded.character.slug,
      },
      currentScene: {
        kind: "character-sandbox-preflight",
        characterSlug: loaded.character.slug,
      },
      metadata: {
        source: "character-sandbox-readiness",
        mode: loaded.mode,
      },
    });
    await getWorldSessionStore().appendEvent({
      sessionId: session.id,
      type: "sandbox.preflight",
      source: "system",
      payload: { mode: loaded.mode },
    });
    await getWorldSessionStore().endSession(session.id, "ended", {
      source: "character-sandbox-readiness",
      probe: true,
    });
    return {
      id: "persistence-warmup",
      label: "Persistence warm-up",
      group: "persistence",
      status: "ready",
      summary: `Created and ended probe session ${session.id.slice(0, 8)} in ${Math.round(
        performance.now() - started,
      )}ms.`,
      checkedAt: new Date().toISOString(),
      metadata: {
        sessionId: session.id,
        latencyMs: Math.round(performance.now() - started),
      },
    };
  } catch (err) {
    return {
      id: "persistence-warmup",
      label: "Persistence warm-up",
      group: "persistence",
      status: "degraded",
      summary: err instanceof Error ? err.message : String(err),
      checkedAt: new Date().toISOString(),
    };
  }
}

async function buildVoiceForRouting(
  character: CharacterRecord,
  boundVoice: VoiceRecord | null,
): Promise<VoiceForRouting> {
  if (boundVoice?.status === "ready") {
    const embeddingUrl =
      boundVoice.provider === "pocket_tts" && boundVoice.embeddingPath
        ? await createEmbeddingSignedUrl(boundVoice.embeddingPath).catch(() => null)
        : null;
    return {
      provider: boundVoice.provider as StreamingTtsProvider,
      slug: boundVoice.slug,
      embeddingUrl,
      providerConfig: boundVoice.providerConfig,
      voiceSettings: character.voiceSettings ?? null,
    };
  }
  return {
    provider: "pocket_tts",
    slug: character.slug || "abraham",
    embeddingUrl: null,
  };
}

function createSilentWavBase64(durationMs: number): string {
  const sampleRate = 16000;
  const sampleCount = Math.round((durationMs / 1000) * sampleRate);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer.toString("base64");
}

function missingProviderEnv(provider: ProviderId): string | null {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY?.trim() ? null : "ANTHROPIC_API_KEY";
    case "openai":
      return process.env.OPENAI_API_KEY?.trim() ? null : "OPENAI_API_KEY";
    case "cerebras":
      return process.env.CEREBRAS_API_KEY?.trim() ? null : "CEREBRAS_API_KEY";
    case "groq":
      return process.env.GROQ_API_KEY?.trim() ? null : "GROQ_API_KEY";
  }
}

function missingTtsEnv(provider: StreamingTtsProvider): string | null {
  switch (provider) {
    case "pocket_tts":
      return null;
    case "elevenlabs":
      return process.env.ELEVENLABS_API_KEY?.trim() ? null : "ELEVENLABS_API_KEY";
    case "openai":
      return process.env.OPENAI_API_KEY?.trim() ? null : "OPENAI_API_KEY";
    case "cartesia":
      return process.env.CARTESIA_API_KEY?.trim() ? null : "CARTESIA_API_KEY";
  }
}

function aggregateStatus(checks: SandboxReadinessCheck[]): SandboxReadinessStatus {
  if (checks.some((c) => c.status === "blocked")) return "blocked";
  if (checks.some((c) => c.status === "degraded")) return "degraded";
  if (checks.some((c) => c.status === "warning")) return "warning";
  if (checks.some((c) => c.status === "not_checked")) return "not_checked";
  if (checks.some((c) => c.status === "unavailable")) return "unavailable";
  return "ready";
}

function summarizeGroups(checks: SandboxReadinessCheck[]): SandboxReadinessReport["groups"] {
  const groups: SandboxReadinessGroup[] = [
    "routing",
    "voice",
    "context",
    "persistence",
    "browser",
  ];
  return groups.map((group) => {
    const scoped = checks.filter((c) => c.group === group);
    return {
      id: group,
      status: scoped.length > 0 ? aggregateStatus(scoped) : "unavailable",
      ready: scoped.filter((c) => c.status === "ready").length,
      warnings: scoped.filter((c) => c.status === "warning").length,
      blocked: scoped.filter((c) => c.status === "blocked").length,
      total: scoped.length,
    };
  });
}

function modelMetadata(meta: ModelOption): Record<string, unknown> {
  return {
    id: meta.id,
    label: meta.label,
    provider: meta.provider,
    modes: meta.modes,
    contextWindow: meta.contextWindow,
    maxOutputTokens: meta.maxOutputTokens,
    streaming: meta.capabilities.streaming === true,
    latencyTier: meta.latencyTier,
    qualityTier: meta.qualityTier,
    pricing: meta.pricing,
  };
}

function labelMode(mode: "chat" | "voice"): string {
  return mode === "chat" ? "Chat" : "Voice";
}
