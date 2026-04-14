"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ── Palette ──────────────────────────────────────────────────── */

const C = {
  bg: "#0F0A06",
  panel: "#1A120B",
  border: "#2E2015",
  text: "#F4E4C1",
  muted: "#8B7355",
  accent: "#D4A574",
  glow: "#FF6B35",
  ember: "#FF6B35",
  sand: "#F4E4C1",
  deep: "#1A0F0A",
  sienna: "#A0522D",
};

/* ── Types ────────────────────────────────────────────────────── */

type TranscriptLine = {
  id: string;
  speaker: string;
  text: string;
  type: "narrator" | "dialogue" | "player";
};

type TurnResult = {
  transcript: string;
  narration: Array<{ id: string; speaker: string; text: string }>;
  dialogue: Array<{ id: string; speaker: string; role: string; text: string; emotion: string }>;
  audioDirectives: Array<{ type: string; voice: string; text: string }>;
  visibleState: {
    metricValues?: Record<string, number>;
    [key: string]: unknown;
  };
  event: { id: string; title: string; category: string; summary: string } | null;
};

/* ── Waveform Canvas ──────────────────────────────────────────── */

function WaveformCanvas({ analyserRef }: { analyserRef: React.RefObject<AnalyserNode | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function draw() {
      if (!canvas || !ctx) return;
      const w = canvas.width;
      const h = canvas.height;

      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, w, h);

      const analyser = analyserRef.current;
      if (!analyser) {
        // Ambient idle wave
        const t = Date.now() * 0.001;
        ctx.strokeStyle = C.sienna;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const y = h / 2 + Math.sin(x * 0.02 + t) * 8 + Math.sin(x * 0.005 + t * 0.3) * 15;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      const bufLen = analyser.frequencyBinCount;
      const data = new Uint8Array(bufLen);
      analyser.getByteTimeDomainData(data);

      // Main waveform
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const sliceWidth = w / bufLen;
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const v = data[i] / 128.0;
        const y = (v * h) / 2;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.stroke();

      // Glow layer
      ctx.strokeStyle = C.glow;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      x = 0;
      for (let i = 0; i < bufLen; i++) {
        const v = data[i] / 128.0;
        const y = (v * h) / 2;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      animRef.current = requestAnimationFrame(draw);
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);
    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [analyserRef]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        opacity: 0.5,
      }}
    />
  );
}

/* ── Console Component ────────────────────────────────────────── */

export function AbrahamsTentConsole({ sessionId }: { sessionId: string }) {
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [activeCharacters, setActiveCharacters] = useState<string[]>(["Abraham", "Eliezer"]);
  const [metrics, setMetrics] = useState<Record<string, number>>({
    hospitality: 70, trust: 40, tension: 20, revelation: 10,
  });
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastInteractionRef = useRef(Date.now());
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnCountRef = useRef(0);

  // Character name map
  const charNames: Record<string, string> = {
    abraham: "Abraham", sarah: "Sarah", isaac: "Isaac",
    eliezer: "Eliezer", michael: "Michael", melchizedek: "Melchizedek",
    narrator: "Narrator",
  };

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 100);
  }, []);

  // Process a turn result
  const handleTurnResult = useCallback((result: TurnResult) => {
    const lines: TranscriptLine[] = [];

    for (const n of result.narration) {
      lines.push({ id: n.id, speaker: "Narrator", text: n.text, type: "narrator" });
    }
    for (const d of result.dialogue) {
      lines.push({ id: d.id, speaker: charNames[d.speaker] ?? d.speaker, text: d.text, type: "dialogue" });
    }

    setTranscript((prev) => [...prev, ...lines]);

    // Update metrics
    if (result.visibleState?.metricValues) {
      setMetrics(result.visibleState.metricValues as Record<string, number>);
    }

    // Update active characters from state
    // Characters mentioned in dialogue are active
    const active = new Set(activeCharacters.map((n) => n.toLowerCase()));
    for (const d of result.dialogue) {
      const name = charNames[d.speaker] ?? d.speaker;
      active.add(name.toLowerCase());
    }
    setActiveCharacters(Array.from(active).map((n) => charNames[n] ?? n.charAt(0).toUpperCase() + n.slice(1)));

    // Check ending
    if (result.event?.id === "the-departure") {
      setEnded(true);
    }

    scrollToBottom();

    // Play audio directives
    playAudioDirectives(result.audioDirectives);
  }, [activeCharacters, scrollToBottom]);

  // Play audio directives sequentially
  async function playAudioDirectives(directives: Array<{ type: string; voice: string; text: string }>) {
    const speakDirectives = directives.filter((d) => d.type === "speak");
    if (!speakDirectives.length) return;

    setPlaying(true);
    for (const directive of speakDirectives) {
      try {
        const res = await fetch("/api/audio/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: directive.text, voice: directive.voice }),
        });
        const data = await res.json();
        if (data.audioBase64) {
          await playBase64Audio(data.audioBase64, data.mimeType ?? "audio/mpeg");
        }
      } catch {
        // Skip failed audio
      }
    }
    setPlaying(false);
  }

  // Play base64 audio through AudioContext + AnalyserNode
  function playBase64Audio(base64: string, mimeType: string): Promise<void> {
    return new Promise((resolve) => {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
        analyserRef.current = audioCtxRef.current.createAnalyser();
        analyserRef.current.fftSize = 2048;
        analyserRef.current.connect(audioCtxRef.current.destination);
      }

      const ctx = audioCtxRef.current;
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      const source = ctx.createMediaElementSource(audio);
      source.connect(analyserRef.current!);

      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.play().catch(() => resolve());
    });
  }

  // Submit a turn
  const submitTurn = useCallback(async (text: string) => {
    if (processing || ended) return;
    lastInteractionRef.current = Date.now();
    setProcessing(true);

    // Add player line
    if (!text.startsWith("[")) {
      setTranscript((prev) => [
        ...prev,
        { id: `player-${Date.now()}`, speaker: "You", text, type: "player" as const },
      ]);
      scrollToBottom();
    }

    try {
      const res = await fetch(`/api/sessions/${sessionId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "voice",
          text,
          clientTimestamp: new Date().toISOString(),
        }),
      });
      const result: TurnResult = await res.json();
      if (!res.ok) throw new Error("Turn processing failed");
      turnCountRef.current += 1;
      handleTurnResult(result);
    } catch {
      setTranscript((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, speaker: "System", text: "Something went wrong. Try again.", type: "narrator" },
      ]);
    }
    setProcessing(false);
  }, [sessionId, processing, ended, handleTurnResult, scrollToBottom]);

  // Initialize session — load intro and submit first turn
  useEffect(() => {
    if (initialized) return;
    setInitialized(true);

    (async () => {
      try {
        // Get intro
        const res = await fetch(`/api/sessions/${sessionId}`);
        const intro: TurnResult = await res.json();
        if (res.ok) {
          handleTurnResult(intro);
        }

        // Submit first turn with player backstory if available
        const storedIntro = sessionStorage.getItem(`tent-intro-${sessionId}`);
        if (storedIntro) {
          sessionStorage.removeItem(`tent-intro-${sessionId}`);
          await submitTurn(storedIntro);
        }
      } catch {
        // Intro fetch failed, continue anyway
      }
    })();
  }, [sessionId, initialized, handleTurnResult, submitTurn]);

  // Idle timer
  useEffect(() => {
    idleTimerRef.current = setInterval(() => {
      if (processing || playing || ended) return;
      const elapsed = (Date.now() - lastInteractionRef.current) / 1000;
      if (elapsed > 30 && elapsed < 35) {
        submitTurn("[30 seconds of silence. The fire crackles.]");
      } else if (elapsed > 60 && elapsed < 65) {
        submitTurn("[A full minute passes. The wanderer has gone quiet.]");
      }
    }, 5000);

    return () => {
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    };
  }, [processing, playing, ended, submitTurn]);

  // Start recording
  async function startRecording() {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
        analyserRef.current = audioCtxRef.current.createAnalyser();
        analyserRef.current.fftSize = 2048;
        analyserRef.current.connect(audioCtxRef.current.destination);
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = audioCtxRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current!);

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      lastInteractionRef.current = Date.now();
    } catch {
      alert("Microphone access is required for voice input.");
    }
  }

  // Stop recording and transcribe
  async function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    setRecording(false);

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: "audio/webm;codecs=opus" }));
      recorder.stop();
    });

    // Stop mic tracks
    recorder.stream.getTracks().forEach((t) => t.stop());

    // Convert to base64
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    setProcessing(true);
    try {
      const res = await fetch("/api/audio/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: base64, mimeType: "audio/webm;codecs=opus" }),
      });
      const data = await res.json();
      if (data.transcript && data.transcript.trim()) {
        setProcessing(false);
        await submitTurn(data.transcript.trim());
        return;
      }
    } catch {
      // Transcription failed
    }
    setProcessing(false);
  }

  return (
    <div style={{ position: "relative", minHeight: "100vh", background: C.bg, color: C.text, overflow: "hidden" }}>
      {/* Background waveform */}
      <WaveformCanvas analyserRef={analyserRef} />

      {/* Content overlay */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100vh", padding: "1.5rem" }}>

        {/* Top bar: character presence + metrics */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
          {/* Character presence */}
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {activeCharacters.map((name) => (
              <div
                key={name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  fontSize: "0.75rem",
                  color: C.accent,
                  letterSpacing: "0.04em",
                }}
              >
                <div style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: C.ember,
                  boxShadow: `0 0 4px ${C.ember}`,
                }} />
                {name}
              </div>
            ))}
          </div>

          {/* Metrics (small) */}
          <div style={{ display: "flex", gap: "1rem" }}>
            {Object.entries(metrics).map(([key, val]) => (
              <div key={key} style={{ textAlign: "right" }}>
                <div style={{ fontSize: "0.6rem", color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {key}
                </div>
                <div style={{ fontSize: "0.8rem", color: C.accent, fontWeight: 600 }}>
                  {val}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Transcript (scrollable) */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "1rem",
            background: `${C.deep}AA`,
            borderRadius: "10px",
            border: `1px solid ${C.border}`,
            marginBottom: "1rem",
          }}
        >
          {transcript.map((line) => (
            <div
              key={line.id}
              style={{
                marginBottom: "0.75rem",
                lineHeight: 1.6,
                fontSize: "0.85rem",
              }}
            >
              <span style={{
                fontWeight: 600,
                color: line.type === "narrator" ? C.muted : line.type === "player" ? C.sand : C.accent,
                fontSize: "0.7rem",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginRight: "0.5rem",
              }}>
                {line.speaker}
              </span>
              <span style={{
                color: line.type === "narrator" ? C.muted : C.text,
                fontStyle: line.type === "narrator" ? "italic" : "normal",
              }}>
                {line.text}
              </span>
            </div>
          ))}
          {transcript.length === 0 && !processing && (
            <div style={{ color: C.muted, fontStyle: "italic", fontSize: "0.85rem" }}>
              The fire crackles. The tent is quiet.
            </div>
          )}
          {processing && (
            <div style={{ color: C.muted, fontSize: "0.8rem", fontStyle: "italic" }}>
              ...
            </div>
          )}
        </div>

        {/* Bottom controls */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "1rem", padding: "0.5rem 0" }}>
          {ended ? (
            <button
              onClick={() => window.location.href = "/abrahams-tent"}
              style={{
                padding: "0.75rem 2.5rem",
                fontSize: "0.9rem",
                fontWeight: 600,
                border: `1px solid ${C.accent}`,
                borderRadius: "8px",
                cursor: "pointer",
                background: "transparent",
                color: C.accent,
                letterSpacing: "0.06em",
              }}
            >
              Leave the Tent
            </button>
          ) : (
            <>
              {/* Mic button */}
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={() => recording && stopRecording()}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                disabled={processing || playing}
                style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "50%",
                  border: `2px solid ${recording ? C.glow : C.accent}`,
                  background: recording ? `${C.glow}30` : "transparent",
                  cursor: processing || playing ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 0.2s",
                  opacity: processing || playing ? 0.4 : 1,
                  boxShadow: recording ? `0 0 20px ${C.glow}40` : "none",
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={recording ? C.glow : C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10a7 7 0 0014 0" />
                  <path d="M12 18v4M8 22h8" />
                </svg>
              </button>
              <div style={{ fontSize: "0.7rem", color: C.muted, position: "absolute", bottom: "0.5rem" }}>
                {recording ? "Release to send" : processing ? "Processing..." : playing ? "Listening..." : "Hold to speak"}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
