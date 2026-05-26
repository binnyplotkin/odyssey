"use client";

import { useState, useRef, useCallback } from "react";

type TTSResult = {
  provider: string;
  model: string;
  voice: string;
  text: string;
  textLength: number;
  ttfb: number;
  totalTime: number;
  audioSize: number;
  format: string;
  streaming: boolean;
  playbackStarted: number | null;
  error?: string;
};

type STTResult = {
  provider: string;
  inputDuration: number;
  transcriptionTime: number;
  text: string;
  confidence?: number;
  error?: string;
};

type LatencyBudget = {
  sttLatency: number | null;
  llmLatency: number | null;
  ttsLatency: number | null;
  totalPipeline: number | null;
};

const TEST_TEXTS = {
  short: "The throne room fell silent.",
  medium:
    "The throne room fell silent as the courier burst through the doors. Every noble turned, their whispered conversations dying on their lips. The message would change everything.",
  long: "The throne room fell silent as the courier burst through the doors, mud-splattered and gasping for breath. Every noble turned from their gilded conversations, wine goblets frozen mid-gesture. The young king rose slowly from the stone throne, his crown catching the torchlight. He already knew, from the messenger's hollow eyes, that the northern border had fallen. The war they had spent three years avoiding had finally arrived at their gates, and with it, the end of everything they had built.",
};

const VOICES = {
  openai: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
};

function uint8ArrayToBlobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export default function TTSLatencyPage() {
  const [isRunning, setIsRunning] = useState(false);
  const [phase, setPhase] = useState("");
  const [ttsResults, setTtsResults] = useState<TTSResult[]>([]);
  const [sttResults, setSttResults] = useState<STTResult[]>([]);
  const [budget, setBudget] = useState<LatencyBudget>({
    sttLatency: null,
    llmLatency: null,
    ttsLatency: null,
    totalPipeline: null,
  });
  const [log, setLog] = useState<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [
      ...prev,
      `[${new Date().toISOString().slice(11, 23)}] ${msg}`,
    ]);
  }, []);

  const testTTS = useCallback(
    async (
      voice: string,
      text: string,
      textLabel: string
    ): Promise<TTSResult> => {
      const startTime = performance.now();
      let ttfb = 0;
      let playbackStarted: number | null = null;

      try {
        const response = await fetch("/api/audio/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice }),
        });

        ttfb = performance.now() - startTime;

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const contentType =
          response.headers.get("content-type") || "unknown";

        // Try streaming playback
        if (response.body) {
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let firstChunk = true;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              if (firstChunk) {
                ttfb = performance.now() - startTime;
                firstChunk = false;
              }
              chunks.push(value);
            }
          }

          const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
          const totalTime = performance.now() - startTime;

          // Try to play audio
          const blob = new Blob(chunks.map(uint8ArrayToBlobPart), { type: contentType });
          const url = URL.createObjectURL(blob);

          if (audioRef.current) {
            audioRef.current.src = url;
            const playStart = performance.now();
            try {
              await audioRef.current.play();
              playbackStarted = performance.now() - playStart;
            } catch {
              // autoplay may be blocked
            }
            // Stop after 1 second
            setTimeout(() => {
              if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
              }
              URL.revokeObjectURL(url);
            }, 1000);
          }

          return {
            provider: "OpenAI",
            model: "tts-1",
            voice,
            text: textLabel,
            textLength: text.length,
            ttfb,
            totalTime,
            audioSize: totalSize,
            format: contentType,
            streaming: true,
            playbackStarted,
          };
        }

        // Non-streaming fallback
        const blob = await response.blob();
        const totalTime = performance.now() - startTime;

        return {
          provider: "OpenAI",
          model: "tts-1",
          voice,
          text: textLabel,
          textLength: text.length,
          ttfb,
          totalTime,
          audioSize: blob.size,
          format: contentType,
          streaming: false,
          playbackStarted,
        };
      } catch (e) {
        return {
          provider: "OpenAI",
          model: "tts-1",
          voice,
          text: textLabel,
          textLength: text.length,
          ttfb,
          totalTime: performance.now() - startTime,
          audioSize: 0,
          format: "error",
          streaming: false,
          playbackStarted: null,
          error: String(e),
        };
      }
    },
    []
  );

  const testSTT = useCallback(async (): Promise<STTResult | null> => {
    try {
      // Create a short test audio buffer
      const ctx = new AudioContext();
      const sampleRate = ctx.sampleRate;
      const duration = 2;
      const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
      const data = buffer.getChannelData(0);

      // Generate a simple tone (this won't transcribe to real speech,
      // but lets us measure the round-trip latency)
      for (let i = 0; i < data.length; i++) {
        data[i] = 0.5 * Math.sin(2 * Math.PI * 440 * (i / sampleRate));
      }

      // Convert to WAV
      const wavBuffer = audioBufferToWav(buffer);
      const blob = new Blob([wavBuffer], { type: "audio/wav" });

      const formData = new FormData();
      formData.append("file", blob, "test.wav");

      const startTime = performance.now();
      const response = await fetch("/api/audio/transcribe", {
        method: "POST",
        body: formData,
      });
      const elapsed = performance.now() - startTime;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      await ctx.close();

      return {
        provider: "OpenAI Whisper",
        inputDuration: duration * 1000,
        transcriptionTime: elapsed,
        text: result.text || "(empty)",
        confidence: result.confidence,
      };
    } catch (e) {
      return {
        provider: "OpenAI Whisper",
        inputDuration: 2000,
        transcriptionTime: 0,
        text: "",
        error: String(e),
      };
    }
  }, []);

  const runTests = useCallback(async () => {
    setIsRunning(true);
    setTtsResults([]);
    setSttResults([]);
    setLog([]);
    setBudget({ sttLatency: null, llmLatency: null, ttsLatency: null, totalPipeline: null });

    const allTtsResults: TTSResult[] = [];

    // Test TTS across voices and text lengths
    setPhase("Testing TTS latency...");
    addLog("=== TTS Latency Tests ===");

    for (const voice of VOICES.openai.slice(0, 3)) {
      for (const [label, text] of Object.entries(TEST_TEXTS)) {
        addLog(`Testing ${voice} / ${label} (${text.length} chars)...`);
        const result = await testTTS(voice, text, label);
        allTtsResults.push(result);
        setTtsResults([...allTtsResults]);

        if (result.error) {
          addLog(`  ERROR: ${result.error}`);
        } else {
          addLog(
            `  TTFB: ${result.ttfb.toFixed(0)}ms | Total: ${result.totalTime.toFixed(0)}ms | Size: ${(result.audioSize / 1024).toFixed(1)}KB`
          );
        }

        // Brief pause between tests
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Test STT
    setPhase("Testing STT latency...");
    addLog("\n=== STT Latency Tests ===");
    const sttResult = await testSTT();
    if (sttResult) {
      setSttResults([sttResult]);
      if (sttResult.error) {
        addLog(`STT ERROR: ${sttResult.error}`);
      } else {
        addLog(`STT: ${sttResult.transcriptionTime.toFixed(0)}ms for ${sttResult.inputDuration}ms audio`);
      }
    }

    // Calculate latency budget
    setPhase("Calculating latency budget...");
    addLog("\n=== Latency Budget ===");

    const successfulTts = allTtsResults.filter((r) => !r.error);
    const avgTtfb =
      successfulTts.length > 0
        ? successfulTts.reduce((sum, r) => sum + r.ttfb, 0) / successfulTts.length
        : null;
    const sttLat = sttResult?.error ? null : sttResult?.transcriptionTime ?? null;
    // Estimate LLM latency (we'll use a conservative estimate)
    const llmEstimate = 800; // GPT-4o-mini typical first-token ~200ms, full response ~800ms

    const totalPipeline =
      sttLat !== null && avgTtfb !== null
        ? sttLat + llmEstimate + avgTtfb
        : null;

    const latencyBudget: LatencyBudget = {
      sttLatency: sttLat,
      llmLatency: llmEstimate,
      ttsLatency: avgTtfb,
      totalPipeline,
    };
    setBudget(latencyBudget);

    addLog(`STT: ${sttLat?.toFixed(0) ?? "N/A"}ms`);
    addLog(`LLM (estimated): ${llmEstimate}ms`);
    addLog(`TTS TTFB: ${avgTtfb?.toFixed(0) ?? "N/A"}ms`);
    addLog(`Total Pipeline: ${totalPipeline?.toFixed(0) ?? "N/A"}ms`);

    setPhase("Complete");
    addLog("\n--- TEST COMPLETE ---");
    setIsRunning(false);
  }, [addLog, testTTS, testSTT]);

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
      <audio ref={audioRef} />
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              fontSize: 10,
              color: "#C8553D",
              letterSpacing: "0.15em",
              textTransform: "uppercase" as const,
              marginBottom: 8,
            }}
          >
            Pillar 01 — Audio Ingestion Pipeline
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
            TTS / STT Latency Benchmark
          </h1>
          <p style={{ color: "#5A5A5A", fontSize: 13, margin: 0 }}>
            Measures time-to-first-byte for TTS, STT transcription latency, and
            calculates the full voice pipeline budget.
          </p>
        </div>

        <button
          onClick={runTests}
          disabled={isRunning}
          style={{
            background: isRunning ? "#1A1A1A" : "#C8553D",
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
          {isRunning ? `Running: ${phase}` : "Run Latency Tests"}
        </button>

        {/* Latency budget */}
        {budget.totalPipeline !== null && (
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
              End-to-End Latency Budget
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "flex-end" }}>
              {[
                { label: "STT", value: budget.sttLatency, color: "#C8553D" },
                { label: "LLM", value: budget.llmLatency, color: "#C8953D" },
                {
                  label: "TTS TTFB",
                  value: budget.ttsLatency,
                  color: "#2D8F6A",
                },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  style={{
                    flex: value || 1,
                    background: color + "20",
                    borderTop: `2px solid ${color}`,
                    padding: "12px 16px",
                    borderRadius: 4,
                  }}
                >
                  <div style={{ fontSize: 10, color: "#5A5A5A" }}>
                    {label}
                  </div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      fontFamily: "Space Grotesk",
                      color,
                    }}
                  >
                    {value?.toFixed(0) ?? "—"}ms
                  </div>
                </div>
              ))}
              <div
                style={{
                  padding: "12px 24px",
                  background: "#1A1A1A",
                  borderRadius: 4,
                  borderTop: "2px solid #FAFAF8",
                  flexShrink: 0,
                }}
              >
                <div style={{ fontSize: 10, color: "#5A5A5A" }}>Total</div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    fontFamily: "Space Grotesk",
                    color:
                      budget.totalPipeline! < 2000
                        ? "#2D8F6A"
                        : budget.totalPipeline! < 4000
                          ? "#C8953D"
                          : "#C8553D",
                  }}
                >
                  {budget.totalPipeline?.toFixed(0)}ms
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TTS results table */}
        {ttsResults.length > 0 && (
          <div
            style={{
              background: "#111111",
              border: "1px solid #1E1E1E",
              borderRadius: 8,
              padding: 24,
              marginBottom: 24,
              overflow: "auto",
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
              TTS Results
            </div>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse" as const,
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid #1E1E1E" }}>
                  {[
                    "Voice",
                    "Text",
                    "Chars",
                    "TTFB",
                    "Total",
                    "Size",
                    "Status",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left" as const,
                        padding: "8px 12px",
                        color: "#5A5A5A",
                        fontWeight: 500,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ttsResults.map((r, i) => (
                  <tr
                    key={i}
                    style={{ borderBottom: "1px solid #151515" }}
                  >
                    <td style={{ padding: "8px 12px", color: "#7B6DB0" }}>
                      {r.voice}
                    </td>
                    <td style={{ padding: "8px 12px" }}>{r.text}</td>
                    <td style={{ padding: "8px 12px", color: "#5A5A5A" }}>
                      {r.textLength}
                    </td>
                    <td
                      style={{
                        padding: "8px 12px",
                        color: r.error ? "#C8553D" : "#2D8F6A",
                      }}
                    >
                      {r.error ? "ERR" : `${r.ttfb.toFixed(0)}ms`}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {r.error ? "—" : `${r.totalTime.toFixed(0)}ms`}
                    </td>
                    <td style={{ padding: "8px 12px", color: "#5A5A5A" }}>
                      {r.error
                        ? "—"
                        : `${(r.audioSize / 1024).toFixed(1)}KB`}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {r.error ? (
                        <span style={{ color: "#C8553D" }}>FAIL</span>
                      ) : (
                        <span style={{ color: "#2D8F6A" }}>OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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
                color: entry.includes("ERROR") || entry.includes("FAIL")
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
              Click &quot;Run Latency Tests&quot; to begin...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// WAV encoder utility
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const data = buffer.getChannelData(0);
  const dataLength = data.length * bytesPerSample;
  const headerLength = 44;
  const totalLength = headerLength + dataLength;
  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  // WAV header
  writeString(view, 0, "RIFF");
  view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  // Write samples
  let offset = 44;
  for (let i = 0; i < data.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return arrayBuffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
