"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HarnessCharacter } from "./harness-types";
import { PromptSkeleton } from "./harness-skeletons";

/**
 * The persistent right rail. Two responsibilities:
 *   1. Show the live compiled system prompt the model will receive.
 *   2. Run a turn against the real chat API and show the streamed reply.
 *
 * Both call the existing endpoints (no new backend yet):
 *   - POST /api/characters/:id/system-prompt → assembled prompt + curator trace
 *   - POST /api/characters/:id/chat          → SSE stream (curator, token, done)
 */

const T = {
  fontHeading: "'Space Grotesk', sans-serif",
  fontBody: "'Inter', sans-serif",
  fontMono: "var(--font-mono, 'JetBrains Mono', monospace)",
};

type PreviewTab = "system" | "per-turn" | "trace";

type SystemPromptResponse = {
  systemPrompt: string;
  promptChunk: string;
  tokensUsed: number;
  tokensBudget: number;
  elapsedMs: number;
};

type SandboxTurn = {
  id: string;
  user: string;
  assistant: string;
  status: "pending" | "curator-done" | "streaming" | "done" | "error";
  error: string | null;
  curator: { tokensUsed: number; tokensBudget: number; elapsedMs: number } | null;
  inputTokens: number;
  outputTokens: number;
  /** Anthropic prompt-cache telemetry — set on `done`. See chat route.
   * `ignored` = we sent cache_control but the block was under Anthropic's
   * minimum size so caching wasn't applied. */
  cacheState: "hit" | "write" | "ignored" | "off" | null;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Model id that actually ran this turn (e.g. "claude-sonnet-4-5"). */
  model: string | null;
  latencyMs: number | null;
  startedAt: number;
};

type Props = {
  character: HarnessCharacter;
};

export function HarnessPreviewRail({ character }: Props) {
  const [tab, setTab] = useState<PreviewTab>("system");
  const [systemPrompt, setSystemPrompt] = useState<SystemPromptResponse | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  const [turns, setTurns] = useState<SandboxTurn[]>([]);
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  /** Refresh the compiled system prompt. Re-runs whenever the active character
   * changes; in later phases we'll re-run on every layer edit. */
  const refreshPrompt = useCallback(async () => {
    setPromptLoading(true);
    setPromptError(null);
    try {
      const res = await fetch(`/api/characters/${character.id}/system-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "tell me about yourself" }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body.slice(0, 200)}`);
      }
      const json = (await res.json()) as SystemPromptResponse;
      setSystemPrompt(json);
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : String(err));
    } finally {
      setPromptLoading(false);
    }
  }, [character.id]);

  useEffect(() => {
    void refreshPrompt();
  }, [refreshPrompt]);

  // Listen for cross-pane save events from layer editors. Avoids dragging
  // a store/context into the harness for what is really one signal: "a
  // layer changed; recompile the preview". Each layer editor dispatches
  // its own event so we can attribute changes later if needed. Add to
  // the array as new editors land (L03 voice, L04 model, etc.).
  useEffect(() => {
    const onSaved = () => void refreshPrompt();
    const events = [
      "harness:identity-saved",
      "harness:directive-saved",
      "harness:voice-style-saved",
      "harness:brain-model-saved",
    ];
    for (const ev of events) window.addEventListener(ev, onSaved);
    return () => {
      for (const ev of events) window.removeEventListener(ev, onSaved);
    };
  }, [refreshPrompt]);

  /** Send a sandbox turn — same SSE protocol as the existing chat page. */
  const sendTurn = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    const turnId = `t_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    setInput("");

    const turn: SandboxTurn = {
      id: turnId,
      user: text,
      assistant: "",
      status: "pending",
      error: null,
      curator: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheState: null,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      model: null,
      latencyMs: null,
      startedAt: Date.now(),
    };
    setTurns((ts) => [...ts, turn]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/characters/${character.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let frameEnd: number;
        while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);

          let eventName: string | null = null;
          let dataLine = "";
          for (const line of raw.split("\n")) {
            if (line.startsWith("event: ")) eventName = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataLine += line.slice(6);
          }
          if (!eventName || !dataLine) continue;
          let payload: unknown;
          try {
            payload = JSON.parse(dataLine);
          } catch {
            continue;
          }
          applyEvent(turnId, eventName, payload);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTurns((ts) =>
        ts.map((t) => (t.id === turnId ? { ...t, status: "error", error: msg } : t)),
      );
    }

    function applyEvent(id: string, name: string, data: unknown) {
      setTurns((ts) =>
        ts.map((t) => {
          if (t.id !== id) return t;
          switch (name) {
            case "curator": {
              const cur = data as {
                tokensUsed: number;
                tokensBudget: number;
                elapsedMs: number;
              };
              return {
                ...t,
                curator: {
                  tokensUsed: cur.tokensUsed,
                  tokensBudget: cur.tokensBudget,
                  elapsedMs: cur.elapsedMs,
                },
                status: "curator-done",
              };
            }
            case "token": {
              const d = data as { delta: string };
              return { ...t, assistant: t.assistant + d.delta, status: "streaming" };
            }
            case "done": {
              const d = data as {
                inputTokens?: number;
                outputTokens?: number;
                cacheReadInputTokens?: number;
                cacheCreationInputTokens?: number;
                cacheState?: "hit" | "write" | "off";
                model?: string;
              };
              return {
                ...t,
                status: "done",
                inputTokens: d.inputTokens ?? 0,
                outputTokens: d.outputTokens ?? 0,
                cacheReadTokens: d.cacheReadInputTokens ?? 0,
                cacheCreationTokens: d.cacheCreationInputTokens ?? 0,
                cacheState: d.cacheState ?? null,
                model: d.model ?? null,
                latencyMs: Date.now() - t.startedAt,
              };
            }
            case "error": {
              const d = data as { message: string };
              return { ...t, status: "error", error: d.message };
            }
          }
          return t;
        }),
      );
    }
  }, [character.id, input]);

  return (
    <aside
      style={{
        // Owns its own dimensions — the shell clips via an outer wrapper
        // when collapsed, but doesn't dictate sizing.
        width: 480,
        height: "100%",
        flexShrink: 0,
        background: "var(--sidebar-glass)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <PreviewHeader tab={tab} onChange={setTab} onRefresh={refreshPrompt} refreshing={promptLoading} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {tab === "system" && (
          <PromptView
            prompt={systemPrompt?.systemPrompt ?? null}
            loading={promptLoading}
            error={promptError}
          />
        )}
        {tab === "per-turn" && (
          <PromptView
            prompt={systemPrompt?.promptChunk ?? null}
            loading={promptLoading}
            error={promptError}
            placeholder="Per-turn curator chunk will appear here."
          />
        )}
        {tab === "trace" && (
          <PromptView
            prompt={null}
            loading={false}
            error={null}
            placeholder="Trace view — wired in Phase 1 with the per-layer probe results."
          />
        )}

        {systemPrompt && tab !== "trace" && (
          <TokenBudgetBar
            tokensUsed={systemPrompt.tokensUsed}
            tokensBudget={systemPrompt.tokensBudget}
            elapsedMs={systemPrompt.elapsedMs}
          />
        )}

        <Sandbox
          turns={turns}
          input={input}
          onInput={setInput}
          onSend={sendTurn}
        />
      </div>
    </aside>
  );
}

/* ── Header ─────────────────────────────────────────────────── */

function PreviewHeader({
  tab,
  onChange,
  onRefresh,
  refreshing,
}: {
  tab: PreviewTab;
  onChange: (t: PreviewTab) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div
      style={{
        padding: "18px 20px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-12)",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: T.fontMono,
          fontSize: "var(--font-size-xs)",
          letterSpacing: "0.14em",
          color: "var(--text-secondary)",
          textTransform: "uppercase",
        }}
      >
        ▸ what the model sees
      </span>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", gap: "var(--space-4)" }}>
        {(["system", "per-turn", "trace"] as PreviewTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            style={{
              padding: "5px 10px",
              fontFamily: T.fontMono,
              fontSize: 9.5,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: t === tab ? "var(--accent-strong)" : "var(--text-tertiary)",
              background: t === tab ? "rgba(140,231,210,0.08)" : "transparent",
              border: `1px solid ${t === tab ? "rgba(140,231,210,0.20)" : "transparent"}`,
              borderRadius: "var(--radius-xs)",
              cursor: "pointer",
            }}
          >
            {t}
          </button>
        ))}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          style={{
            padding: "5px 10px",
            fontFamily: T.fontMono,
            fontSize: 9.5,
            letterSpacing: "0.1em",
            color: "var(--text-tertiary)",
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: "var(--radius-xs)",
            cursor: refreshing ? "wait" : "pointer",
          }}
          title="Refresh compiled prompt"
        >
          ↻
        </button>
      </div>
    </div>
  );
}

/* ── Prompt view ────────────────────────────────────────────── */

function PromptView({
  prompt,
  loading,
  error,
  placeholder,
}: {
  prompt: string | null;
  loading: boolean;
  error: string | null;
  placeholder?: string;
}) {
  return (
    <div
      style={{
        padding: "var(--space-20)",
        fontFamily: T.fontMono,
        fontSize: 10.5,
        lineHeight: 1.65,
        color: "var(--text-secondary)",
        whiteSpace: "pre-wrap",
        overflow: "auto",
        flex: 1,
        minHeight: 200,
      }}
    >
      {error && (
        <div style={{ color: "var(--status-error)" }}>
          <strong>preview error:</strong> {error}
        </div>
      )}
      {loading && !prompt && (
        <PromptSkeleton />
      )}
      {!loading && !error && prompt && prompt}
      {!loading && !error && !prompt && (
        <div style={{ color: "var(--text-tertiary)" }}>
          {placeholder ?? "No prompt to show."}
        </div>
      )}
    </div>
  );
}

/* ── Token budget bar ───────────────────────────────────────── */

function TokenBudgetBar({
  tokensUsed,
  tokensBudget,
  elapsedMs,
}: {
  tokensUsed: number;
  tokensBudget: number;
  elapsedMs: number;
}) {
  const pct = Math.min(100, Math.round((tokensUsed / Math.max(1, tokensBudget)) * 100));
  return (
    <div
      style={{
        padding: "12px 20px",
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: 9.5,
            letterSpacing: "0.12em",
            color: "var(--text-tertiary)",
            textTransform: "uppercase",
          }}
        >
          token budget · {elapsedMs} ms
        </span>
        <span style={{ fontFamily: T.fontMono, fontSize: 10.5, color: "var(--text-secondary)" }}>
          {tokensUsed.toLocaleString()} / {tokensBudget.toLocaleString()}
        </span>
      </div>
      <div
        style={{
          height: 6,
          background: "rgba(255,255,255,0.04)",
          borderRadius: "var(--radius-xs)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "var(--accent-strong)",
          }}
        />
      </div>
    </div>
  );
}

/* ── Sandbox ────────────────────────────────────────────────── */

function Sandbox({
  turns,
  input,
  onInput,
  onSend,
}: {
  turns: SandboxTurn[];
  input: string;
  onInput: (s: string) => void;
  onSend: () => void;
}) {
  return (
    <div
      style={{
        padding: "var(--space-20)",
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-12)",
        background: "rgba(0,0,0,0.20)",
        minHeight: 280,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.14em",
            color: "var(--accent-strong)",
            textTransform: "uppercase",
          }}
        >
          ▸ test sandbox
        </span>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-2xs)",
            letterSpacing: "0.1em",
            color: "var(--text-tertiary)",
            textTransform: "uppercase",
          }}
        >
          draft · live
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-10)",
          maxHeight: 320,
          overflowY: "auto",
        }}
      >
        {turns.length === 0 && (
          <div
            style={{
              fontFamily: T.fontBody,
              fontSize: "var(--font-size-base)",
              color: "var(--text-tertiary)",
              fontStyle: "italic",
            }}
          >
            no turns yet — try a message below.
          </div>
        )}
        {turns.map((t) => (
          <TurnView key={t.id} turn={t} />
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-8)",
          padding: "8px 10px",
          background: "var(--control-bg)",
          border: "1px solid var(--control-border)",
          borderRadius: "var(--radius-sm)",
          marginTop: "auto",
        }}
      >
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-sm)", color: "var(--text-quaternary)" }}>
          ⏵
        </span>
        <input
          value={input}
          onChange={(e) => onInput(e.target.value)}
          placeholder="Ask anything…"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--foreground)",
            fontFamily: T.fontBody,
            fontSize: 12.5,
          }}
        />
        <span style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: "var(--text-quaternary)" }}>
          ⌘ ↵
        </span>
      </form>
    </div>
  );
}

function TurnView({ turn }: { turn: SandboxTurn }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <div
        style={{
          padding: "8px 12px",
          background: "rgba(255,255,255,0.03)",
          borderRadius: "var(--radius-sm)",
        }}
      >
        <div
          style={{
            fontFamily: T.fontMono,
            fontSize: "var(--font-size-2xs)",
            letterSpacing: "0.1em",
            color: "var(--text-tertiary)",
            textTransform: "uppercase",
            marginBottom: "var(--space-4)",
          }}
        >
          you
        </div>
        <div style={{ fontFamily: T.fontBody, fontSize: 12.5, color: "var(--foreground)" }}>
          {turn.user}
        </div>
      </div>
      <div
        style={{
          padding: "8px 12px",
          background: turn.status === "error" ? "rgba(248,113,113,0.06)" : "rgba(140,231,210,0.04)",
          border: turn.status === "error"
            ? "1px solid rgba(248,113,113,0.20)"
            : "1px solid rgba(140,231,210,0.10)",
          borderRadius: "var(--radius-sm)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-8)",
            marginBottom: "var(--space-4)",
          }}
        >
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: "var(--font-size-2xs)",
              letterSpacing: "0.1em",
              color: turn.status === "error" ? "var(--status-error)" : "var(--accent-strong)",
              textTransform: "uppercase",
            }}
          >
            {turn.status === "error" ? "error" : "character"}
          </span>
          {turn.latencyMs != null && (
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-2xs)",
                color: "var(--text-tertiary)",
              }}
            >
              · {turn.latencyMs} ms
            </span>
          )}
          {turn.outputTokens > 0 && (
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-2xs)",
                color: "var(--text-tertiary)",
              }}
            >
              · {turn.outputTokens} tok
            </span>
          )}
          {turn.cacheState && turn.cacheState !== "off" && (
            <CacheBadge
              state={turn.cacheState as "hit" | "write" | "ignored"}
              readTokens={turn.cacheReadTokens}
              creationTokens={turn.cacheCreationTokens}
            />
          )}
          {turn.model && (
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: "var(--font-size-2xs)",
                color: "var(--text-quaternary)",
              }}
              title="model that ran this turn"
            >
              · {shortenModel(turn.model)}
            </span>
          )}
        </div>
        <div
          style={{
            fontFamily: T.fontBody,
            fontSize: 12.5,
            color: "var(--foreground)",
            whiteSpace: "pre-wrap",
            fontStyle: turn.status === "error" ? "normal" : "italic",
          }}
        >
          {turn.error
            ? turn.error
            : turn.assistant || (turn.status === "pending" || turn.status === "curator-done"
              ? "…thinking…"
              : "")}
        </div>
      </div>
    </div>
  );
}

/* ── Cache + model badges ──────────────────────────────────── */

/**
 * Compact cache-state badge.
 *   - HIT     = phosphor, shows cached input tokens reused
 *   - WRITE   = amber, cold-start; cached tokens just persisted
 *   - IGNORED = red-orange; we asked for caching but the block was under
 *               Anthropic's minimum (1024 tok Sonnet · 2048 Haiku) and
 *               caching was skipped silently
 */
function CacheBadge({
  state,
  readTokens,
  creationTokens,
}: {
  state: "hit" | "write" | "ignored";
  readTokens: number;
  creationTokens: number;
}) {
  if (state === "hit") {
    return (
      <span
        style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: "var(--accent-strong)" }}
        title={`Anthropic prompt cache returned ${readTokens.toLocaleString()} cached input tokens for this turn (~90% off list price).`}
      >
        · cache hit · {readTokens.toLocaleString()}
      </span>
    );
  }
  if (state === "write") {
    return (
      <span
        style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: "rgba(255,184,112,0.95)" }}
        title={`Cold-start: Anthropic just persisted ${creationTokens.toLocaleString()} input tokens to cache. Subsequent turns within 5 min hit cache.`}
      >
        · cache wrote · {creationTokens.toLocaleString()}
      </span>
    );
  }
  // ignored
  return (
    <span
      style={{ fontFamily: T.fontMono, fontSize: "var(--font-size-2xs)", color: "rgba(248,113,113,0.85)" }}
      title="cache_control was sent but Anthropic returned no cache tokens — usually because the cached block is below the model's minimum (1024 tok for Sonnet 4.5, 2048 for Haiku). Either expand the cached block or accept no caching for this character's directive."
    >
      · cache ignored
    </span>
  );
}

/** Trim the long Anthropic model id to something readable in a one-line meta row. */
function shortenModel(model: string): string {
  return model
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, ""); // drop training-date suffix when present
}
