"use client";

import { useState, useCallback } from "react";

type CharacterResponse = {
  characterName: string;
  archetype: string;
  response: string;
  tokenCount: number;
  latency: number;
  error?: string;
};

type DiffTestResult = {
  scenario: string;
  responses: CharacterResponse[];
  distinctivenessScore: number | null;
  analysis: string;
};

type BeliefTestResult = {
  characterName: string;
  belief: string;
  turnsUntilBreak: number | null;
  brokeCharacter: boolean;
  responses: { turn: number; input: string; response: string }[];
};

type MemoryTestResult = {
  characterName: string;
  eventsInjected: number;
  eventsRecalled: number;
  recallAccuracy: number;
  details: { event: string; recalled: boolean; response: string }[];
};

type TokenAuditResult = {
  component: string;
  tokens: number;
  percentage: number;
};

const SCENARIOS = [
  {
    id: "betrayal",
    label: "A trusted advisor is caught conspiring",
    prompt: "Your most trusted advisor has been caught sending secret messages to the provincial nobles. The evidence is undeniable. What do you say to the court?",
  },
  {
    id: "mercy",
    label: "A prisoner begs for clemency",
    prompt: "A captured rebel kneels before you, tears streaming. He claims he only joined the uprising to feed his starving family. The court watches your judgment.",
  },
  {
    id: "war",
    label: "Enemy forces approach the border",
    prompt: "Scouts report a large army massing at the northern border. You have three days before they reach the capital. Your generals await orders.",
  },
];

export default function CharacterDiffPage() {
  const [isRunning, setIsRunning] = useState(false);
  const [phase, setPhase] = useState("");
  const [diffResults, setDiffResults] = useState<DiffTestResult[]>([]);
  const [beliefResults, setBeliefResults] = useState<BeliefTestResult[]>([]);
  const [memoryResults, setMemoryResults] = useState<MemoryTestResult[]>([]);
  const [tokenAudit, setTokenAudit] = useState<TokenAuditResult[]>([]);
  const [log, setLog] = useState<string[]>([]);

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [
      ...prev,
      `[${new Date().toISOString().slice(11, 23)}] ${msg}`,
    ]);
  }, []);

  const generateCharacterResponse = useCallback(
    async (
      characterName: string,
      archetype: string,
      personality: string,
      scenario: string
    ): Promise<CharacterResponse> => {
      const startTime = performance.now();

      try {
        const response = await fetch("/api/debug/character-test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            characterName,
            archetype,
            personality,
            scenario,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const latency = performance.now() - startTime;

        return {
          characterName,
          archetype,
          response: data.response,
          tokenCount: data.tokenCount || 0,
          latency,
        };
      } catch (e) {
        return {
          characterName,
          archetype,
          response: "",
          tokenCount: 0,
          latency: performance.now() - startTime,
          error: String(e),
        };
      }
    },
    []
  );

  const runTests = useCallback(async () => {
    setIsRunning(true);
    setDiffResults([]);
    setBeliefResults([]);
    setMemoryResults([]);
    setTokenAudit([]);
    setLog([]);

    const CHARACTERS = [
      {
        name: "Marcell",
        archetype: "advisor",
        personality:
          "Cautious, institutional, speaks in measured diplomatic language. Values stability above all. Uses formal address and historical precedent in arguments.",
      },
      {
        name: "Elan",
        archetype: "priest",
        personality:
          "Pious, moralistic, speaks in religious metaphor. Values mercy and divine order. Frequently references scripture and spiritual duty.",
      },
      {
        name: "Lady Cassandra",
        archetype: "noble",
        personality:
          "Ambitious, calculating, speaks with veiled threats and double meanings. Values power and family legacy. Uses courtly pleasantries that mask sharp political moves.",
      },
      {
        name: "General Theron",
        archetype: "military",
        personality:
          "Direct, tactical, speaks in short declarative sentences. Values strength and loyalty. Impatient with political maneuvering, prefers action.",
      },
    ];

    // --- Test 1: Character Differentiation ---
    setPhase("Testing character differentiation...");
    addLog("=== Character Differentiation Test ===");

    const allDiffResults: DiffTestResult[] = [];

    for (const scenario of SCENARIOS) {
      addLog(`\nScenario: ${scenario.label}`);
      const responses: CharacterResponse[] = [];

      for (const char of CHARACTERS) {
        addLog(`  Generating response for ${char.name}...`);
        const result = await generateCharacterResponse(
          char.name,
          char.archetype,
          char.personality,
          scenario.prompt
        );
        responses.push(result);

        if (result.error) {
          addLog(`    ERROR: ${result.error}`);
        } else {
          addLog(
            `    ${result.latency.toFixed(0)}ms | ${result.tokenCount} tokens`
          );
          addLog(`    "${result.response.slice(0, 100)}..."`);
        }
      }

      // Simple distinctiveness analysis
      const validResponses = responses.filter((r) => !r.error);
      let distinctScore: number | null = null;
      let analysis = "";

      if (validResponses.length >= 2) {
        // Compare word overlap between responses
        const wordSets = validResponses.map(
          (r) =>
            new Set(
              r.response
                .toLowerCase()
                .split(/\s+/)
                .filter((w) => w.length > 3)
            )
        );

        let totalOverlap = 0;
        let comparisons = 0;

        for (let i = 0; i < wordSets.length; i++) {
          for (let j = i + 1; j < wordSets.length; j++) {
            const intersection = new Set(
              [...wordSets[i]].filter((w) => wordSets[j].has(w))
            );
            const union = new Set([...wordSets[i], ...wordSets[j]]);
            totalOverlap += intersection.size / union.size;
            comparisons++;
          }
        }

        const avgOverlap = totalOverlap / comparisons;
        distinctScore = Math.round((1 - avgOverlap) * 100);
        analysis =
          distinctScore > 70
            ? "Strong differentiation — characters use distinct vocabulary"
            : distinctScore > 50
              ? "Moderate differentiation — some vocabulary overlap"
              : "Weak differentiation — responses are too similar";
      } else {
        analysis = "Insufficient responses to analyze";
      }

      allDiffResults.push({
        scenario: scenario.label,
        responses,
        distinctivenessScore: distinctScore,
        analysis,
      });
      setDiffResults([...allDiffResults]);
    }

    // --- Test 2: Token Budget Audit (estimated) ---
    setPhase("Running token budget audit...");
    addLog("\n=== Token Budget Audit ===");

    const tokenEstimates: TokenAuditResult[] = [
      { component: "World Core (setting, premise, norms)", tokens: 350, percentage: 0 },
      { component: "Narrator Config (voice, style, perspective)", tokens: 120, percentage: 0 },
      { component: "Current Metrics State", tokens: 80, percentage: 0 },
      { component: "Active Event Context", tokens: 200, percentage: 0 },
      { component: "Character Injection (x8 NPCs)", tokens: 4000, percentage: 0 },
      { component: "Relationship State (x8 NPCs)", tokens: 640, percentage: 0 },
      { component: "Memory / History (last 5 turns)", tokens: 1500, percentage: 0 },
      { component: "Group State (x4 factions)", tokens: 320, percentage: 0 },
      { component: "Player Role Context", tokens: 250, percentage: 0 },
      { component: "System Instructions", tokens: 400, percentage: 0 },
      { component: "Player Input (current turn)", tokens: 100, percentage: 0 },
    ];

    const totalTokens = tokenEstimates.reduce((sum, t) => sum + t.tokens, 0);
    tokenEstimates.forEach((t) => {
      t.percentage = Math.round((t.tokens / totalTokens) * 100);
    });

    setTokenAudit(tokenEstimates);

    // Cost calculation
    const inputCostPer1M = 0.15; // GPT-4o-mini input
    const outputCostPer1M = 0.60; // GPT-4o-mini output
    const outputTokensPerTurn = 500;
    const turnsPerSession = 20;

    const inputCostPerTurn = (totalTokens / 1_000_000) * inputCostPer1M;
    const outputCostPerTurn =
      (outputTokensPerTurn / 1_000_000) * outputCostPer1M;
    const costPerTurn = inputCostPerTurn + outputCostPerTurn;
    const costPerSession = costPerTurn * turnsPerSession;

    addLog(`Total prompt tokens per turn: ${totalTokens}`);
    addLog(`Estimated output tokens per turn: ${outputTokensPerTurn}`);
    addLog(`Cost per turn (GPT-4o-mini): $${costPerTurn.toFixed(5)}`);
    addLog(`Cost per 20-turn session: $${costPerSession.toFixed(4)}`);
    addLog(`Cost per 1000 sessions: $${(costPerSession * 1000).toFixed(2)}`);

    // Character injection is the biggest cost
    const charPercentage = Math.round((4000 / totalTokens) * 100);
    addLog(`Character injection is ${charPercentage}% of prompt budget`);

    setPhase("Complete");
    addLog("\n--- ALL TESTS COMPLETE ---");
    setIsRunning(false);
  }, [addLog, generateCharacterResponse]);

  return (
    <div
      style={{
        fontFamily: "JetBrains Mono, monospace",
        background: "#0A0A0A",
        color: "#E8E8E0",
        minHeight: "100vh",
        padding: "32px",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              fontSize: 10,
              color: "#7B6DB0",
              letterSpacing: "0.15em",
              textTransform: "uppercase" as const,
              marginBottom: 8,
            }}
          >
            Pillar 03 — Character Agents
          </div>
          <h1
            style={{
              fontFamily: "Space Grotesk, sans-serif",
              fontSize: 36,
              fontWeight: 700,
              margin: 0,
              marginBottom: 8,
            }}
          >
            Character Differentiation & Token Audit
          </h1>
          <p style={{ color: "#5A5A5A", fontSize: 13, margin: 0 }}>
            Tests whether LLM-generated character responses are meaningfully
            distinct, and audits the per-turn token cost of full character
            injection.
          </p>
        </div>

        <button
          onClick={runTests}
          disabled={isRunning}
          style={{
            background: isRunning ? "#1A1A1A" : "#7B6DB0",
            color: "#FAFAF8",
            border: "none",
            padding: "12px 32px",
            borderRadius: 6,
            fontSize: 13,
            fontFamily: "Space Grotesk, sans-serif",
            fontWeight: 600,
            cursor: isRunning ? "not-allowed" : "pointer",
            marginBottom: 24,
          }}
        >
          {isRunning ? `Running: ${phase}` : "Run Character Tests"}
        </button>

        {/* Token Audit */}
        {tokenAudit.length > 0 && (
          <div
            style={{
              background: "#111111",
              border: "1px solid #1E1E1E",
              borderRadius: 8,
              padding: 24,
              marginBottom: 24,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "#5A5A5A",
                letterSpacing: "0.12em",
                textTransform: "uppercase" as const,
                marginBottom: 16,
              }}
            >
              Token Budget Per Turn
            </div>
            <div style={{ display: "flex", gap: 2, marginBottom: 16, height: 24 }}>
              {tokenAudit.map((t, i) => {
                const colors = [
                  "#C8553D", "#C8953D", "#2D8F6A", "#7B6DB0",
                  "#C8553D", "#C8953D", "#2D8F6A", "#7B6DB0",
                  "#5A5A5A", "#3A3A3A", "#2A2A2A",
                ];
                return (
                  <div
                    key={i}
                    style={{
                      flex: t.tokens,
                      background: colors[i % colors.length] + "40",
                      borderRadius: 2,
                      position: "relative" as const,
                    }}
                    title={`${t.component}: ${t.tokens} tokens (${t.percentage}%)`}
                  />
                );
              })}
            </div>
            {tokenAudit.map((t, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "4px 0",
                  borderBottom: "1px solid #151515",
                  fontSize: 12,
                }}
              >
                <span style={{ color: "#7A7A72" }}>{t.component}</span>
                <span>
                  <span style={{ color: "#5A5A5A", marginRight: 12 }}>
                    {t.percentage}%
                  </span>
                  <span style={{ color: "#E8E8E0" }}>
                    {t.tokens.toLocaleString()}
                  </span>
                </span>
              </div>
            ))}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "8px 0 0",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <span>Total per turn</span>
              <span style={{ color: "#C8553D" }}>
                {tokenAudit
                  .reduce((sum, t) => sum + t.tokens, 0)
                  .toLocaleString()}{" "}
                tokens
              </span>
            </div>
          </div>
        )}

        {/* Differentiation Results */}
        {diffResults.map((result, ri) => (
          <div
            key={ri}
            style={{
              background: "#111111",
              border: "1px solid #1E1E1E",
              borderRadius: 8,
              padding: 24,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#5A5A5A",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase" as const,
                    marginBottom: 4,
                  }}
                >
                  Scenario
                </div>
                <div style={{ fontSize: 14, fontFamily: "Space Grotesk", fontWeight: 600 }}>
                  {result.scenario}
                </div>
              </div>
              {result.distinctivenessScore !== null && (
                <div style={{ textAlign: "right" as const }}>
                  <div style={{ fontSize: 10, color: "#5A5A5A" }}>
                    Distinctiveness
                  </div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      fontFamily: "Space Grotesk",
                      color:
                        result.distinctivenessScore > 70
                          ? "#2D8F6A"
                          : result.distinctivenessScore > 50
                            ? "#C8953D"
                            : "#C8553D",
                    }}
                  >
                    {result.distinctivenessScore}%
                  </div>
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: "#5A5A5A", marginBottom: 16 }}>
              {result.analysis}
            </div>
            {result.responses.map((r, ci) => (
              <div
                key={ci}
                style={{
                  padding: "12px 16px",
                  background: "#0A0A0A",
                  borderRadius: 6,
                  marginBottom: 8,
                  borderLeft: `2px solid ${r.error ? "#C8553D" : "#7B6DB0"}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: 12, color: "#7B6DB0", fontWeight: 600 }}>
                    {r.characterName}
                    <span
                      style={{
                        color: "#3A3A3A",
                        fontWeight: 400,
                        marginLeft: 8,
                      }}
                    >
                      {r.archetype}
                    </span>
                  </span>
                  <span style={{ fontSize: 11, color: "#3A3A3A" }}>
                    {r.latency.toFixed(0)}ms
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#7A7A72", lineHeight: "18px" }}>
                  {r.error
                    ? `Error: ${r.error}`
                    : `"${r.response.slice(0, 200)}${r.response.length > 200 ? "..." : ""}"`}
                </div>
              </div>
            ))}
          </div>
        ))}

        {/* Log */}
        <div
          style={{
            background: "#080808",
            border: "1px solid #1A1A1A",
            borderRadius: 8,
            padding: 16,
            maxHeight: 300,
            overflow: "auto",
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "#5A5A5A",
              letterSpacing: "0.12em",
              textTransform: "uppercase" as const,
              marginBottom: 8,
            }}
          >
            Test Log
          </div>
          {log.map((entry, i) => (
            <div
              key={i}
              style={{
                fontSize: 11,
                color: entry.includes("ERROR")
                  ? "#C8553D"
                  : entry.includes("COMPLETE")
                    ? "#2D8F6A"
                    : "#4A4A4A",
                lineHeight: "20px",
                whiteSpace: "pre-wrap" as const,
              }}
            >
              {entry}
            </div>
          ))}
          {log.length === 0 && (
            <div style={{ fontSize: 11, color: "#2A2A2A" }}>
              Click &quot;Run Character Tests&quot; to begin...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
