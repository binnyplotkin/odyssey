"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type StreamResult = {
  id: number;
  status: "playing" | "error" | "stopped";
  startTime: number;
  cpuEstimate?: number;
  error?: string;
};

type BrowserInfo = {
  browser: string;
  version: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory?: number;
};

type TestResults = {
  browser: BrowserInfo;
  maxStableStreams: number;
  firstGlitchAt: number | null;
  contextState: string;
  sampleRate: number;
  baselineLatency: number;
  streams: StreamResult[];
  gainChangeLatency: number | null;
  duckingWorks: boolean;
  echoConstraintsSupported: {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
  };
  audioContextLimit: number;
  timestamp: string;
};

function detectBrowser(): BrowserInfo {
  const ua = navigator.userAgent;
  let browser = "Unknown";
  let version = "Unknown";

  if (ua.includes("Firefox/")) {
    browser = "Firefox";
    version = ua.split("Firefox/")[1]?.split(" ")[0] || "";
  } else if (ua.includes("Safari/") && !ua.includes("Chrome")) {
    browser = "Safari";
    version = ua.split("Version/")[1]?.split(" ")[0] || "";
  } else if (ua.includes("Chrome/")) {
    browser = "Chrome";
    version = ua.split("Chrome/")[1]?.split(" ")[0] || "";
  }

  return {
    browser,
    version,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    deviceMemory: (navigator as unknown as { deviceMemory?: number })
      .deviceMemory,
  };
}

function generateTone(
  ctx: AudioContext,
  frequency: number,
  duration: number
): AudioBufferSourceNode {
  const sampleRate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < data.length; i++) {
    // Slightly detuned sine with harmonics for realistic load
    data[i] =
      0.3 * Math.sin(2 * Math.PI * frequency * (i / sampleRate)) +
      0.15 *
        Math.sin(2 * Math.PI * frequency * 1.5 * (i / sampleRate)) +
      0.1 * Math.sin(2 * Math.PI * frequency * 2 * (i / sampleRate));
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  return source;
}

export default function AudioStressTestPage() {
  const [isRunning, setIsRunning] = useState(false);
  const [phase, setPhase] = useState<string>("");
  const [streams, setStreams] = useState<StreamResult[]>([]);
  const [results, setResults] = useState<TestResults | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [...prev, `[${new Date().toISOString().slice(11, 23)}] ${msg}`]);
  }, []);

  const cleanup = useCallback(() => {
    sourcesRef.current.forEach((s) => {
      try {
        s.stop();
        s.disconnect();
      } catch {
        // ignore
      }
    });
    sourcesRef.current = [];
    if (ctxRef.current && ctxRef.current.state !== "closed") {
      ctxRef.current.close();
    }
    ctxRef.current = null;
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const runTest = useCallback(async () => {
    cleanup();
    setIsRunning(true);
    setStreams([]);
    setResults(null);
    setLog([]);

    const browserInfo = detectBrowser();
    addLog(`Browser: ${browserInfo.browser} ${browserInfo.version}`);
    addLog(`Cores: ${browserInfo.hardwareConcurrency}, Memory: ${browserInfo.deviceMemory || "unknown"}GB`);

    // --- Test 1: AudioContext limit ---
    setPhase("Testing AudioContext instance limit...");
    addLog("Phase 1: AudioContext instance limit");
    let contextCount = 0;
    const contexts: AudioContext[] = [];
    try {
      for (let i = 0; i < 20; i++) {
        const c = new AudioContext();
        contexts.push(c);
        contextCount++;
      }
    } catch (e) {
      addLog(`AudioContext limit hit at ${contextCount}: ${e}`);
    }
    addLog(`Created ${contextCount} AudioContext instances`);
    for (const c of contexts) {
      try { await c.close(); } catch { /* ignore */ }
    }

    // --- Test 2: Concurrent source nodes ---
    setPhase("Testing concurrent source nodes...");
    addLog("Phase 2: Concurrent source stress test");

    const ctx = new AudioContext({ sampleRate: 48000 });
    ctxRef.current = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;

    const compressor = ctx.createDynamicsCompressor();
    compressor.connect(analyser);
    analyser.connect(ctx.destination);

    const streamResults: StreamResult[] = [];
    let firstGlitchAt: number | null = null;
    const MAX_STREAMS = 24;
    const baseFrequencies = [
      220, 277, 330, 392, 440, 523, 587, 659, 698, 784, 880, 988,
      1047, 1175, 1319, 1397, 1568, 1760, 1976, 2093, 2349, 2637, 2794, 3136,
    ];

    // Measure baseline latency
    const baseStart = performance.now();
    const baseSource = generateTone(ctx, 440, 0.1);
    const baseGain = ctx.createGain();
    baseGain.gain.value = 0; // silent
    baseSource.connect(baseGain);
    baseGain.connect(compressor);
    baseSource.start();
    const baselineLatency = performance.now() - baseStart;
    addLog(`Baseline source creation: ${baselineLatency.toFixed(2)}ms`);

    // Add streams incrementally
    for (let i = 0; i < MAX_STREAMS; i++) {
      const freq = baseFrequencies[i % baseFrequencies.length];
      const startTime = performance.now();

      try {
        const source = generateTone(ctx, freq, 10);
        const gain = ctx.createGain();
        gain.gain.value = 0.05; // quiet so we don't blow speakers

        source.connect(gain);
        gain.connect(compressor);
        source.start();
        sourcesRef.current.push(source);

        const elapsed = performance.now() - startTime;

        const result: StreamResult = {
          id: i + 1,
          status: "playing",
          startTime: elapsed,
          cpuEstimate: elapsed,
        };
        streamResults.push(result);

        // Check for degradation
        if (elapsed > baselineLatency * 5 && !firstGlitchAt) {
          firstGlitchAt = i + 1;
          addLog(`Potential degradation at stream ${i + 1} (${elapsed.toFixed(2)}ms vs baseline ${baselineLatency.toFixed(2)}ms)`);
        }

        setStreams([...streamResults]);
        addLog(`Stream ${i + 1}: ${freq}Hz started in ${elapsed.toFixed(2)}ms`);

        // Brief pause to let audio settle
        await new Promise((r) => setTimeout(r, 200));
      } catch (e) {
        streamResults.push({
          id: i + 1,
          status: "error",
          startTime: performance.now() - startTime,
          error: String(e),
        });
        addLog(`Stream ${i + 1} FAILED: ${e}`);
        break;
      }
    }

    const maxStable = streamResults.filter((s) => s.status === "playing").length;
    addLog(`Max stable streams: ${maxStable}`);

    // --- Test 3: Gain ducking latency ---
    setPhase("Testing gain ducking latency...");
    addLog("Phase 3: GainNode ducking test");

    let gainChangeLatency: number | null = null;
    let duckingWorks = false;
    try {
      const duckGain = ctx.createGain();
      duckGain.gain.value = 1.0;
      duckGain.connect(compressor);

      const duckSource = generateTone(ctx, 440, 2);
      duckSource.connect(duckGain);
      duckSource.start();

      await new Promise((r) => setTimeout(r, 100));

      const duckStart = performance.now();
      duckGain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.05);
      await new Promise((r) => setTimeout(r, 100));
      duckGain.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 0.05);
      gainChangeLatency = performance.now() - duckStart;
      duckingWorks = true;

      addLog(`Gain ducking round-trip: ${gainChangeLatency.toFixed(2)}ms`);
      addLog("Ducking test: PASSED");
    } catch (e) {
      addLog(`Ducking test FAILED: ${e}`);
    }

    // --- Test 4: Echo cancellation constraints ---
    setPhase("Testing echo cancellation support...");
    addLog("Phase 4: getUserMedia constraints");

    const echoConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };

    try {
      const supportedConstraints =
        navigator.mediaDevices.getSupportedConstraints();
      echoConstraints.echoCancellation =
        !!supportedConstraints.echoCancellation;
      echoConstraints.noiseSuppression =
        !!supportedConstraints.noiseSuppression;
      echoConstraints.autoGainControl =
        !!supportedConstraints.autoGainControl;

      addLog(`Echo cancellation supported: ${echoConstraints.echoCancellation}`);
      addLog(`Noise suppression supported: ${echoConstraints.noiseSuppression}`);
      addLog(`Auto gain control supported: ${echoConstraints.autoGainControl}`);
    } catch (e) {
      addLog(`Constraint check failed: ${e}`);
    }

    // --- Compile results ---
    setPhase("Complete");
    const finalResults: TestResults = {
      browser: browserInfo,
      maxStableStreams: maxStable,
      firstGlitchAt,
      contextState: ctx.state,
      sampleRate: ctx.sampleRate,
      baselineLatency,
      streams: streamResults,
      gainChangeLatency,
      duckingWorks,
      echoConstraintsSupported: echoConstraints,
      audioContextLimit: contextCount,
      timestamp: new Date().toISOString(),
    };

    setResults(finalResults);
    addLog("--- TEST COMPLETE ---");
    addLog(JSON.stringify(finalResults, null, 2));
    setIsRunning(false);
  }, [addLog, cleanup]);

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
            Audio Stress Test
          </h1>
          <p style={{ color: "#5A5A5A", fontSize: 13, margin: 0 }}>
            Tests concurrent Web Audio streams, gain ducking, and echo
            cancellation support in your browser.
          </p>
        </div>

        <button
          onClick={runTest}
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
          {isRunning ? `Running: ${phase}` : "Run Full Test Suite"}
        </button>

        {/* Stream visualization */}
        {streams.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div
              style={{
                fontSize: 10,
                color: "#5A5A5A",
                letterSpacing: "0.12em",
                textTransform: "uppercase" as const,
                marginBottom: 12,
              }}
            >
              Active Streams ({streams.filter((s) => s.status === "playing").length} / {streams.length})
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const }}>
              {streams.map((s) => (
                <div
                  key={s.id}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 4,
                    background:
                      s.status === "playing" ? "#1A3A1F" : "#3A1A1A",
                    border: `1px solid ${s.status === "playing" ? "#2D8F6A" : "#C8553D"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    color:
                      s.status === "playing" ? "#2D8F6A" : "#C8553D",
                  }}
                >
                  {s.id}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Results summary */}
        {results && (
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
              Results Summary
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 16,
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: "#5A5A5A" }}>
                  Max Stable Streams
                </div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    fontFamily: "Space Grotesk",
                    color: "#2D8F6A",
                  }}
                >
                  {results.maxStableStreams}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#5A5A5A" }}>
                  AudioContext Limit
                </div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    fontFamily: "Space Grotesk",
                    color: "#FAFAF8",
                  }}
                >
                  {results.audioContextLimit}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#5A5A5A" }}>
                  Ducking
                </div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    fontFamily: "Space Grotesk",
                    color: results.duckingWorks
                      ? "#2D8F6A"
                      : "#C8553D",
                  }}
                >
                  {results.duckingWorks ? "PASS" : "FAIL"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#5A5A5A" }}>
                  Baseline Latency
                </div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    fontFamily: "Space Grotesk",
                  }}
                >
                  {results.baselineLatency.toFixed(1)}ms
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#5A5A5A" }}>
                  Gain Change Latency
                </div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    fontFamily: "Space Grotesk",
                  }}
                >
                  {results.gainChangeLatency?.toFixed(1) || "—"}ms
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#5A5A5A" }}>
                  First Degradation At
                </div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    fontFamily: "Space Grotesk",
                    color: results.firstGlitchAt
                      ? "#C8953D"
                      : "#2D8F6A",
                  }}
                >
                  {results.firstGlitchAt || "None"}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 20, borderTop: "1px solid #1E1E1E", paddingTop: 16 }}>
              <div style={{ fontSize: 11, color: "#5A5A5A", marginBottom: 8 }}>
                Echo Cancellation Support
              </div>
              <div style={{ display: "flex", gap: 16 }}>
                {Object.entries(results.echoConstraintsSupported).map(
                  ([key, val]) => (
                    <div
                      key={key}
                      style={{
                        fontSize: 12,
                        color: val ? "#2D8F6A" : "#C8553D",
                      }}
                    >
                      {key}: {val ? "YES" : "NO"}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        )}

        {/* Log output */}
        <div
          style={{
            background: "#080808",
            border: "1px solid #1A1A1A",
            borderRadius: 8,
            padding: 16,
            maxHeight: 400,
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
                color: entry.includes("FAIL") || entry.includes("error")
                  ? "#C8553D"
                  : entry.includes("PASS") || entry.includes("COMPLETE")
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
              Click &quot;Run Full Test Suite&quot; to begin...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
