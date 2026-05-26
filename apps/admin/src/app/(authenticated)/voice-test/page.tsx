"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MeshGradient } from "@paper-design/shaders-react";

// ── Color palette ───────────────────────────────────────────────────────

const BASE_COLORS = ["#0C0E14", "#0d2b2a", "#8fd1cb", "#1a3a38"];
const WARM_COLORS = ["#0f1410", "#2a3020", "#7abfa0", "#2e4a30"];
const COOL_COLORS = ["#0a0f1e", "#102848", "#8fd8ef", "#1a3060"];
const CONFIDENT_COLORS = ["#0f1f1e", "#14524e", "#8fe8df", "#2a5c57"];

// ── Utilities ───────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * clamp(t);
}

function lerpColor(hex1: string, hex2: string, t: number) {
  const tc = clamp(t);
  const p = (h: string, o: number) => parseInt(h.slice(o, o + 2), 16);
  const r = Math.round(lerp(p(hex1, 1), p(hex2, 1), tc));
  const g = Math.round(lerp(p(hex1, 3), p(hex2, 3), tc));
  const b = Math.round(lerp(p(hex1, 5), p(hex2, 5), tc));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function lerpColors(a: string[], b: string[], t: number) {
  return a.map((c, i) => lerpColor(c, b[i], t));
}

// ── Pitch detection ─────────────────────────────────────────────────────

function detectPitch(
  analyser: AnalyserNode,
  buf: Float32Array<ArrayBuffer>,
  sampleRate: number,
): number {
  analyser.getFloatTimeDomainData(buf);
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.01) return 0;

  const size = buf.length;
  const minLag = Math.floor(sampleRate / 500);
  const maxLag = Math.floor(sampleRate / 60);
  let bestCorr = 0;
  let bestLag = 0;

  for (let lag = minLag; lag <= Math.min(maxLag, size - 1); lag++) {
    let corr = 0;
    for (let i = 0; i < size - lag; i++) corr += buf[i] * buf[i + lag];
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag === 0 || bestCorr < 0.01) return 0;
  return sampleRate / bestLag;
}

// ── Voice analysis hook ─────────────────────────────────────────────────

const SILENCE_THRESHOLD = 0.015;

type VoiceMetrics = {
  amplitude: number;
  rmsShort: number;
  rmsLong: number;
  steadiness: number;
  pitch: number;
  pitchNorm: number;
  pitchVariation: number;
  isSpeaking: boolean;
  silenceDuration: number;
  speechDensity: number;
  confidence: number;
  bands: { low: number; mid: number; high: number };
};

const EMPTY_METRICS: VoiceMetrics = {
  amplitude: 0,
  rmsShort: 0,
  rmsLong: 0,
  steadiness: 0,
  pitch: 0,
  pitchNorm: 0.5,
  pitchVariation: 0,
  isSpeaking: false,
  silenceDuration: 0,
  speechDensity: 0,
  confidence: 0,
  bands: { low: 0, mid: 0, high: 0 },
};

function useVoiceAnalyser() {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyserRef = useRef<AnalyserNode | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const freqDataRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(0));
  const timeDomainRef = useRef<Float32Array<ArrayBuffer>>(new Float32Array(0));
  const timeDomainByteRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(0));

  const rmsHistoryRef = useRef<number[]>([]);
  const pitchHistoryRef = useRef<number[]>([]);
  const lastSpeechTimeRef = useRef(0);
  const speechBurstsRef = useRef(0);
  const speechWindowStartRef = useRef(0);
  const wasSpeakingRef = useRef(false);

  const start = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);

      analyserRef.current = analyser;
      contextRef.current = ctx;
      streamRef.current = stream;
      freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      timeDomainRef.current = new Float32Array(analyser.fftSize);
      timeDomainByteRef.current = new Uint8Array(analyser.fftSize);
      rmsHistoryRef.current = [];
      pitchHistoryRef.current = [];
      lastSpeechTimeRef.current = performance.now();
      speechBurstsRef.current = 0;
      speechWindowStartRef.current = performance.now();
      wasSpeakingRef.current = false;
      setIsRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone access denied");
    }
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    contextRef.current?.close();
    streamRef.current = null;
    contextRef.current = null;
    analyserRef.current = null;
    setIsRecording(false);
  }, []);

  const sample = useCallback((): VoiceMetrics => {
    const analyser = analyserRef.current;
    const ctx = contextRef.current;
    if (!analyser || !ctx) return EMPTY_METRICS;

    const now = performance.now();

    analyser.getByteFrequencyData(freqDataRef.current);
    const bins = freqDataRef.current;
    const third = Math.floor(bins.length / 3);
    let lowSum = 0, midSum = 0, highSum = 0;
    for (let i = 0; i < third; i++) lowSum += bins[i];
    for (let i = third; i < third * 2; i++) midSum += bins[i];
    for (let i = third * 2; i < bins.length; i++) highSum += bins[i];
    const bands = {
      low: lowSum / (third * 255),
      mid: midSum / (third * 255),
      high: highSum / (third * 255),
    };

    let rmsNow = 0;
    for (let i = 0; i < bins.length; i++) {
      const v = bins[i] / 255;
      rmsNow += v * v;
    }
    rmsNow = Math.sqrt(rmsNow / bins.length);

    const rmsHistory = rmsHistoryRef.current;
    rmsHistory.push(rmsNow);
    if (rmsHistory.length > 120) rmsHistory.shift();

    const rmsShort = rmsHistory.slice(-6).reduce((a, b) => a + b, 0) / Math.min(6, rmsHistory.length);
    const rmsLong = rmsHistory.reduce((a, b) => a + b, 0) / rmsHistory.length;
    const steadiness = rmsLong > 0.01 ? clamp(1 - Math.abs(rmsShort - rmsLong) / rmsLong) : 0;
    const amplitude = rmsShort;

    const pitch = detectPitch(analyser, timeDomainRef.current, ctx.sampleRate);
    const pitchHistory = pitchHistoryRef.current;
    if (pitch > 0) {
      pitchHistory.push(pitch);
      if (pitchHistory.length > 60) pitchHistory.shift();
    }
    const pitchNorm = pitch > 0 ? clamp((pitch - 100) / 300) : 0.5;

    let pitchVariation = 0;
    if (pitchHistory.length > 5) {
      const mean = pitchHistory.reduce((a, b) => a + b, 0) / pitchHistory.length;
      const variance = pitchHistory.reduce((a, b) => a + (b - mean) ** 2, 0) / pitchHistory.length;
      pitchVariation = clamp(Math.sqrt(variance) / 50);
    }

    const isSpeaking = rmsShort > SILENCE_THRESHOLD;
    const silenceDuration = isSpeaking ? 0 : now - lastSpeechTimeRef.current;

    if (isSpeaking) {
      lastSpeechTimeRef.current = now;
      if (!wasSpeakingRef.current) speechBurstsRef.current++;
    }
    wasSpeakingRef.current = isSpeaking;

    const windowElapsed = now - speechWindowStartRef.current;
    if (windowElapsed > 5000) {
      speechBurstsRef.current = 0;
      speechWindowStartRef.current = now;
    }
    const speechDensity = clamp(speechBurstsRef.current / (windowElapsed / 1000) / 3);

    const speakingFactor = isSpeaking ? 1 : clamp(1 - silenceDuration / 2000);
    const confidence = clamp(
      steadiness * 0.35 + pitchVariation * 0.35 + speakingFactor * 0.2 + clamp(amplitude / 0.15) * 0.1,
    );

    return {
      amplitude, rmsShort, rmsLong, steadiness,
      pitch, pitchNorm, pitchVariation,
      isSpeaking, silenceDuration, speechDensity, confidence, bands,
    };
  }, []);

  // Expose raw buffers for canvas drawing
  const getRawBuffers = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return null;
    // Refresh time domain bytes for waveform drawing
    analyser.getByteTimeDomainData(timeDomainByteRef.current);
    return {
      freqData: freqDataRef.current,
      timeDomainData: timeDomainByteRef.current,
      binCount: analyser.frequencyBinCount,
      fftSize: analyser.fftSize,
    };
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      contextRef.current?.close();
    };
  }, []);

  return { isRecording, error, start, stop, sample, getRawBuffers };
}

// ── Audio overlay canvas drawing ────────────────────────────────────────

function drawAudioOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  freqData: Uint8Array<ArrayBuffer>,
  timeDomainData: Uint8Array<ArrayBuffer>,
  binCount: number,
  fftSize: number,
  confidence: number,
  isSpeaking: boolean,
) {
  ctx.clearRect(0, 0, width, height);

  const accentR = 143, accentG = 209, accentB = 203; // #8fd1cb

  // ── 1. Spectrum analyzer (lower third) ──
  // Use only the first ~quarter of bins (voice-relevant frequencies)
  const specBins = Math.min(Math.floor(binCount * 0.35), 128);
  const specHeight = height * 0.35;
  const specY = height - specHeight;
  const barWidth = width / specBins;
  const gap = Math.max(1, barWidth * 0.2);

  for (let i = 0; i < specBins; i++) {
    const val = freqData[i] / 255;
    const barH = val * specHeight * 0.9;
    const x = i * barWidth;

    // Color: teal with intensity-based opacity
    const alpha = 0.15 + val * 0.55;
    ctx.fillStyle = `rgba(${accentR}, ${accentG}, ${accentB}, ${alpha})`;

    // Rounded bar from bottom
    const bx = x + gap / 2;
    const bw = barWidth - gap;
    const by = height - barH;
    const radius = Math.min(bw / 2, 2);

    ctx.beginPath();
    ctx.moveTo(bx + radius, by);
    ctx.lineTo(bx + bw - radius, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + radius);
    ctx.lineTo(bx + bw, height);
    ctx.lineTo(bx, height);
    ctx.lineTo(bx, by + radius);
    ctx.quadraticCurveTo(bx, by, bx + radius, by);
    ctx.fill();
  }

  // Spectrum glow line along tops of bars
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let i = 0; i < specBins; i++) {
    const val = freqData[i] / 255;
    const x = i * barWidth + barWidth / 2;
    const y = height - val * specHeight * 0.9;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = `rgba(${accentR}, ${accentG}, ${accentB}, 0.6)`;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = `rgba(${accentR}, ${accentG}, ${accentB}, 0.4)`;
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Fade gradient at spectrum top
  const specGrad = ctx.createLinearGradient(0, specY, 0, specY + specHeight * 0.3);
  specGrad.addColorStop(0, "rgba(0,0,0,0.4)");
  specGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = specGrad;
  ctx.fillRect(0, specY, width, specHeight * 0.3);

  // ── 2. Waveform oscilloscope (center band) ──
  const waveY = height * 0.35;
  const waveH = height * 0.3;
  const waveMid = waveY + waveH / 2;

  // Draw waveform line
  const step = Math.max(1, Math.floor(fftSize / width));
  ctx.beginPath();

  for (let x = 0; x < width; x++) {
    const dataIdx = Math.floor(x * step);
    if (dataIdx >= fftSize) break;
    const val = timeDomainData[dataIdx] / 128.0 - 1.0; // -1 to 1
    const y = waveMid + val * waveH * 0.45;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  // Waveform stroke with glow
  const waveAlpha = isSpeaking ? 0.8 : 0.25;
  ctx.strokeStyle = `rgba(255, 255, 255, ${waveAlpha})`;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = `rgba(${accentR}, ${accentG}, ${accentB}, ${isSpeaking ? 0.5 : 0.1})`;
  ctx.shadowBlur = isSpeaking ? 12 : 4;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Subtle center line
  ctx.beginPath();
  ctx.moveTo(0, waveMid);
  ctx.lineTo(width, waveMid);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── 3. Confidence horizon line (top area) ──
  const horizonY = height * 0.15;
  const horizonWidth = width * 0.6 * confidence;
  const horizonX = (width - horizonWidth) / 2;

  if (confidence > 0.05) {
    ctx.beginPath();
    ctx.moveTo(horizonX, horizonY);
    ctx.lineTo(horizonX + horizonWidth, horizonY);
    const confAlpha = 0.3 + confidence * 0.5;
    ctx.strokeStyle = `rgba(${accentR}, ${accentG}, ${accentB}, ${confAlpha})`;
    ctx.lineWidth = 2;
    ctx.shadowColor = `rgba(${accentR}, ${accentG}, ${accentB}, ${confAlpha * 0.6})`;
    ctx.shadowBlur = 16;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

// ── Mesh state ──────────────────────────────────────────────────────────

type MeshState = {
  colors: string[];
  distortion: number;
  swirl: number;
  speed: number;
};

const REST_MESH: MeshState = {
  colors: BASE_COLORS,
  distortion: 0.08,
  swirl: 0.03,
  speed: 0.2,
};

// ── Page component ──────────────────────────────────────────────────────

export default function VoiceTestPage() {
  const audio = useVoiceAnalyser();
  const [mesh, setMesh] = useState<MeshState>(REST_MESH);
  const [metrics, setMetrics] = useState<VoiceMetrics>(EMPTY_METRICS);
  const rafRef = useRef(0);
  const smoothMeshRef = useRef<MeshState>(REST_MESH);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Handle canvas resize
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.scale(dpr, dpr);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!audio.isRecording) {
      setMesh(REST_MESH);
      setMetrics(EMPTY_METRICS);
      smoothMeshRef.current = REST_MESH;
      // Clear canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    function tick() {
      const m = audio.sample();
      setMetrics(m);

      // ── Draw canvas overlay ──
      const raw = audio.getRawBuffers();
      const canvas = canvasRef.current;
      if (raw && canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          const w = canvas.width / dpr;
          const h = canvas.height / dpr;
          drawAudioOverlay(
            ctx, w, h,
            raw.freqData, raw.timeDomainData,
            raw.binCount, raw.fftSize,
            m.confidence, m.isSpeaking,
          );
        }
      }

      // ── Update mesh ──
      const silenceFade = clamp(m.silenceDuration / 1500);
      const speechPresence = 1 - silenceFade;

      const pitchColors = lerpColors(WARM_COLORS, COOL_COLORS, m.pitchNorm);
      const baseBlend = lerpColors(BASE_COLORS, pitchColors, speechPresence * 0.7);
      const targetColors = lerpColors(baseBlend, CONFIDENT_COLORS, m.confidence * speechPresence);

      const targetSwirl = lerp(0.03, 0.85, m.confidence * 0.6 + clamp(m.amplitude / 0.12) * 0.4);
      const instability = 1 - m.steadiness;
      const targetDistortion = lerp(0.08, 0.55, instability * speechPresence);
      const targetSpeed = lerp(0.2, 1.8, m.speechDensity * speechPresence);

      const target: MeshState = {
        colors: targetColors,
        distortion: lerp(REST_MESH.distortion, targetDistortion, speechPresence),
        swirl: lerp(REST_MESH.swirl, targetSwirl, speechPresence),
        speed: lerp(REST_MESH.speed, targetSpeed, speechPresence),
      };

      const rate = 0.12;
      const prev = smoothMeshRef.current;
      const next: MeshState = {
        colors: prev.colors.map((c, i) => lerpColor(c, target.colors[i], rate)),
        distortion: lerp(prev.distortion, target.distortion, rate),
        swirl: lerp(prev.swirl, target.swirl, rate),
        speed: lerp(prev.speed, target.speed, rate),
      };
      smoothMeshRef.current = next;
      setMesh(next);

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [audio.isRecording, audio.sample, audio.getRawBuffers]);

  const confidenceLabel =
    metrics.confidence > 0.7 ? "Strong"
      : metrics.confidence > 0.4 ? "Building"
        : metrics.confidence > 0.15 ? "Warming Up"
          : "Resting";

  const confidenceColor =
    metrics.confidence > 0.7 ? "var(--success, #8FD1CB)"
      : metrics.confidence > 0.4 ? "var(--accent, #8fd1cb)"
        : "var(--muted)";

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 700,
            marginBottom: "0.5rem",
            color: "var(--foreground)",
          }}
        >
          Voice Test
        </h1>
        <p style={{ fontSize: "0.9rem", color: "var(--muted)", lineHeight: 1.6 }}>
          Audio-reactive mesh with live spectrum and waveform overlay. Speak to
          see the visualization respond to your voice.
        </p>
      </div>

      {/* Visualization */}
      <div
        ref={containerRef}
        style={{
          position: "relative",
          borderRadius: "var(--radius-xl)",
          overflow: "hidden",
          border: "1px solid var(--border)",
          aspectRatio: "16 / 9",
        }}
      >
        {/* Ambient mesh background */}
        <MeshGradient
          style={{ width: "100%", height: "100%", display: "block" }}
          colors={mesh.colors}
          distortion={mesh.distortion}
          swirl={mesh.swirl}
          speed={mesh.speed}
          grainMixer={0.04}
          grainOverlay={0.02}
        />

        {/* Audio graph canvas overlay */}
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />

        {/* Confidence badge */}
        {audio.isRecording && (
          <div
            style={{
              position: "absolute",
              top: 16,
              left: 16,
              display: "flex",
              alignItems: "center",
              gap: "var(--space-8)",
              padding: "0.3rem 0.7rem",
              borderRadius: "var(--radius-pill)",
              background: "rgba(0,0,0,0.5)",
              backdropFilter: "blur(8px)",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="8" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
              <circle
                cx="10" cy="10" r="8" fill="none"
                stroke={confidenceColor} strokeWidth="2"
                strokeDasharray={`${metrics.confidence * 50.3} 50.3`}
                strokeLinecap="round" transform="rotate(-90 10 10)"
                style={{ transition: "stroke-dasharray 0.3s ease" }}
              />
            </svg>
            <span
              style={{
                fontSize: "0.7rem", fontWeight: 600, color: confidenceColor,
                letterSpacing: "0.06em", textTransform: "uppercase",
              }}
            >
              {confidenceLabel}
            </span>
          </div>
        )}

        {/* Speaking / silent indicator */}
        {audio.isRecording && (
          <div
            style={{
              position: "absolute", top: 16, right: 16,
              display: "flex", alignItems: "center", gap: "var(--space-6)",
              padding: "0.25rem 0.6rem", borderRadius: "var(--radius-pill)",
              background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)",
              fontSize: "0.7rem", fontWeight: 600, color: "white",
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}
          >
            <span
              style={{
                width: 6, height: 6, borderRadius: "50%",
                background: metrics.isSpeaking ? "#8fd1cb" : "#f87171",
                animation: metrics.isSpeaking ? undefined : "pulse-rec 1.5s ease-in-out infinite",
              }}
            />
            {metrics.isSpeaking ? "Speaking" : "Silent"}
          </div>
        )}

        {/* Pitch readout */}
        {audio.isRecording && metrics.pitch > 0 && (
          <div
            style={{
              position: "absolute", bottom: 16, right: 16,
              padding: "0.25rem 0.6rem", borderRadius: "var(--radius-pill)",
              background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)",
              fontSize: "0.7rem", fontWeight: 600, color: "rgba(255,255,255,0.7)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {Math.round(metrics.pitch)} Hz
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginTop: "1rem" }}>
        <button
          onClick={audio.isRecording ? audio.stop : audio.start}
          style={{
            padding: "0.5rem 1.5rem", borderRadius: "var(--radius-pill)", border: "none",
            background: audio.isRecording ? "var(--danger, #f87171)" : "var(--accent, #8fd1cb)",
            color: audio.isRecording ? "white" : "#0C0E14",
            fontSize: "0.85rem", fontWeight: 600, cursor: "pointer",
            transition: "opacity 0.15s",
          }}
        >
          {audio.isRecording ? "Stop" : "Start Microphone"}
        </button>
        {audio.error && (
          <span style={{ fontSize: "0.8rem", color: "var(--danger, #f87171)" }}>{audio.error}</span>
        )}
      </div>

      {/* Diagnostics */}
      {audio.isRecording && (
        <div style={{ marginTop: "1.25rem" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "0.75rem",
              marginBottom: "0.75rem",
            }}
          >
            {[
              { label: "Confidence", value: metrics.confidence, accent: true },
              { label: "Steadiness", value: metrics.steadiness },
              { label: "Pitch Range", value: metrics.pitchVariation },
              { label: "Speech Pace", value: metrics.speechDensity },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  background: "var(--panel)",
                  border: `1px solid ${stat.accent ? "var(--accent, #8fd1cb)" + "33" : "var(--border)"}`,
                  borderRadius: "var(--radius-md)",
                  padding: "0.6rem 0.75rem",
                }}
              >
                <div
                  style={{
                    fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.1em",
                    textTransform: "uppercase", marginBottom: "0.25rem",
                    color: stat.accent ? "var(--accent, #8fd1cb)" : "var(--muted)",
                  }}
                >
                  {stat.label}
                </div>
                <div
                  style={{
                    fontSize: "1.1rem", fontWeight: 700,
                    fontVariantNumeric: "tabular-nums", color: "var(--foreground)",
                  }}
                >
                  {Math.round(stat.value * 100)}%
                </div>
                <div
                  style={{
                    marginTop: "0.35rem", height: 3, borderRadius: "var(--radius-2xs)",
                    background: "rgba(255,255,255,0.06)", overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${clamp(stat.value) * 100}%`, height: "100%",
                      borderRadius: "var(--radius-2xs)", transition: "width 0.15s ease-out",
                      background: stat.accent ? "var(--accent, #8fd1cb)" : "var(--muted)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: "0.5rem",
            }}
          >
            {[
              { label: "Amplitude", value: metrics.amplitude.toFixed(3) },
              { label: "RMS Short", value: metrics.rmsShort.toFixed(3) },
              { label: "RMS Long", value: metrics.rmsLong.toFixed(3) },
              { label: "Pitch", value: metrics.pitch > 0 ? `${Math.round(metrics.pitch)} Hz` : "—" },
              { label: "Swirl", value: mesh.swirl.toFixed(3) },
              { label: "Distortion", value: mesh.distortion.toFixed(3) },
              { label: "Speed", value: mesh.speed.toFixed(3) },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: "0.5rem 0.6rem",
                }}
              >
                <div
                  style={{
                    fontSize: "0.55rem", fontWeight: 600, letterSpacing: "0.1em",
                    textTransform: "uppercase", color: "var(--muted)", marginBottom: "0.15rem",
                  }}
                >
                  {stat.label}
                </div>
                <div
                  style={{
                    fontSize: "0.9rem", fontWeight: 600,
                    fontVariantNumeric: "tabular-nums", color: "var(--foreground)",
                  }}
                >
                  {stat.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse-rec {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
