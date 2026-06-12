import type { SceneDecisionRequest } from "@odyssey/orchestration/client";
import type { OrchestratorDecision } from "@odyssey/types";

export type OrchestratorProvider = "cerebras" | "groq";

export type OrchestratorExecutor = {
  provider: OrchestratorProvider;
  model: string;
  execute(request: SceneDecisionRequest): Promise<OrchestratorDecision>;
};

export type OrchestratorExecutorResolution = {
  executor: OrchestratorExecutor | null;
  reason?: string;
};

export type OrchestratorExecutorConfig = {
  provider?: string | null;
  cerebrasApiKey?: string | null;
  cerebrasModel?: string | null;
  groqApiKey?: string | null;
  groqModel?: string | null;
  fetchImpl?: typeof fetch;
};

const CEREBRAS_ENDPOINT = "https://api.cerebras.ai/v1/chat/completions";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const DEFAULT_CEREBRAS_MODEL = "gpt-oss-120b";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
const DEFAULT_MAX_COMPLETION_TOKENS = 1024;

export function resolveOrchestratorExecutor(
  config: OrchestratorExecutorConfig = {},
): OrchestratorExecutorResolution {
  const fetchImpl = config.fetchImpl ?? fetch;
  const provider = normalizeProvider(
    config.provider ?? process.env.ORCHESTRATOR_PROVIDER,
  );
  const cerebrasApiKey = normalizeString(
    config.cerebrasApiKey ?? process.env.CEREBRAS_API_KEY,
  );
  const groqApiKey = normalizeString(config.groqApiKey ?? process.env.GROQ_API_KEY);

  if (provider === "cerebras") {
    return resolveCerebrasExecutor({
      apiKey: cerebrasApiKey,
      model: config.cerebrasModel ?? process.env.CEREBRAS_ORCHESTRATOR_MODEL,
      fetchImpl,
    });
  }

  if (provider === "groq") {
    return resolveGroqExecutor({
      apiKey: groqApiKey,
      model: config.groqModel ?? process.env.GROQ_ORCHESTRATOR_MODEL,
      fetchImpl,
    });
  }

  if (provider) {
    return {
      executor: null,
      reason: `Unsupported ORCHESTRATOR_PROVIDER: ${provider}`,
    };
  }

  if (cerebrasApiKey) {
    return resolveCerebrasExecutor({
      apiKey: cerebrasApiKey,
      model: config.cerebrasModel ?? process.env.CEREBRAS_ORCHESTRATOR_MODEL,
      fetchImpl,
    });
  }

  if (groqApiKey) {
    return resolveGroqExecutor({
      apiKey: groqApiKey,
      model: config.groqModel ?? process.env.GROQ_ORCHESTRATOR_MODEL,
      fetchImpl,
    });
  }

  return {
    executor: null,
    reason:
      "No orchestrator provider key configured. Set CEREBRAS_API_KEY or GROQ_API_KEY.",
  };
}

function resolveCerebrasExecutor(opts: {
  apiKey: string | null;
  model?: string | null;
  fetchImpl: typeof fetch;
}): OrchestratorExecutorResolution {
  if (!opts.apiKey) {
    return { executor: null, reason: "CEREBRAS_API_KEY not configured" };
  }

  const model = normalizeString(opts.model) ?? DEFAULT_CEREBRAS_MODEL;
  return {
    executor: createOpenAiCompatibleExecutor({
      provider: "cerebras",
      endpoint: CEREBRAS_ENDPOINT,
      apiKey: opts.apiKey,
      model,
      fetchImpl: opts.fetchImpl,
    }),
  };
}

function resolveGroqExecutor(opts: {
  apiKey: string | null;
  model?: string | null;
  fetchImpl: typeof fetch;
}): OrchestratorExecutorResolution {
  if (!opts.apiKey) {
    return { executor: null, reason: "GROQ_API_KEY not configured" };
  }

  const model = normalizeString(opts.model) ?? DEFAULT_GROQ_MODEL;
  return {
    executor: createOpenAiCompatibleExecutor({
      provider: "groq",
      endpoint: GROQ_ENDPOINT,
      apiKey: opts.apiKey,
      model,
      fetchImpl: opts.fetchImpl,
    }),
  };
}

function createOpenAiCompatibleExecutor(opts: {
  provider: OrchestratorProvider;
  endpoint: string;
  apiKey: string;
  model: string;
  fetchImpl: typeof fetch;
}): OrchestratorExecutor {
  return {
    provider: opts.provider,
    model: opts.model,
    execute: (request) =>
      callOpenAiCompatibleOrchestrator({
        provider: opts.provider,
        endpoint: opts.endpoint,
        apiKey: opts.apiKey,
        model: opts.model,
        request,
        fetchImpl: opts.fetchImpl,
      }),
  };
}

async function callOpenAiCompatibleOrchestrator(opts: {
  provider: OrchestratorProvider;
  endpoint: string;
  apiKey: string;
  model: string;
  request: SceneDecisionRequest;
  fetchImpl: typeof fetch;
}): Promise<OrchestratorDecision> {
  const resp = await opts.fetchImpl(opts.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.request.messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "orchestrator_decision",
          strict: true,
          schema: opts.request.responseSchema,
        },
      },
      max_completion_tokens: readMaxCompletionTokens(),
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(
      `${providerLabel(opts.provider)} ${resp.status}: ${detail.slice(0, 300) || "no body"}`,
    );
  }

  const payload = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${providerLabel(opts.provider)} returned an empty completion.`);
  }

  try {
    return JSON.parse(content) as OrchestratorDecision;
  } catch (parseErr) {
    throw new Error(
      `Failed to parse orchestrator JSON: ${parseErr instanceof Error ? parseErr.message : parseErr}`,
    );
  }
}

function normalizeProvider(value?: string | null): OrchestratorProvider | string | null {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === "cerebras" || normalized === "groq") return normalized;
  return normalized;
}

function normalizeString(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function providerLabel(provider: OrchestratorProvider): string {
  return provider === "groq" ? "Groq" : "Cerebras";
}

function readMaxCompletionTokens(): number {
  const raw = process.env.ORCHESTRATOR_MAX_COMPLETION_TOKENS?.trim();
  if (!raw) return DEFAULT_MAX_COMPLETION_TOKENS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_COMPLETION_TOKENS;
  }
  return parsed;
}
