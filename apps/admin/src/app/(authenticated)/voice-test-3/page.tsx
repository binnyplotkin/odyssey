"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ─── constants ─── */
const ACCENT = "#0d9488";
const ACCENT_BRIGHT = "#14b8a6";
const BG = "#0C0E14";
const GRID_COLOR = "rgba(255,255,255,0.04)";
const GRID_ACCENT = "rgba(255,255,255,0.08)";
const WAVEFORM_HISTORY = 4; // seconds of scrolling history

/* ─── audio engine ─── */
function useAudioCapture() {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      setActive(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mic access denied");
    }
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close();
    ctxRef.current = null;
    analyserRef.current = null;
    setActive(false);
  }, []);

  return { active, error, start, stop, analyserRef };
}

/* ─── drawing helpers ─── */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  timeScale: number,
) {
  // Horizontal center line
  ctx.strokeStyle = GRID_ACCENT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  // Horizontal amplitude guides at 25%, 75%
  ctx.strokeStyle = GRID_COLOR;
  ctx.setLineDash([4, 4]);
  for (const frac of [0.25, 0.75]) {
    ctx.beginPath();
    ctx.moveTo(0, h * frac);
    ctx.lineTo(w, h * frac);
    ctx.stroke();
  }

  // Vertical time markers every 0.5s
  const pxPerSec = w / timeScale;
  const step = 0.5;
  for (let t = step; t < timeScale; t += step) {
    const x = w - t * pxPerSec;
    if (x < 0) break;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  timeScale: number,
) {
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.textAlign = "right";

  // Amplitude labels
  ctx.fillText("+1.0", w - 6, h * 0.25 - 4);
  ctx.fillText(" 0.0", w - 6, h * 0.5 - 4);
  ctx.fillText("-1.0", w - 6, h * 0.75 - 4);

  // Time labels
  ctx.textAlign = "center";
  const pxPerSec = w / timeScale;
  for (let t = 0.5; t < timeScale; t += 0.5) {
    const x = w - t * pxPerSec;
    if (x < 30) break;
    ctx.fillText(`-${t.toFixed(1)}s`, x, h - 6);
  }
}

/* ─── main waveform renderer ─── */
function WaveformCanvas({
  analyserRef,
  active,
}: {
  analyserRef: React.RefObject<AnalyserNode | null>;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<Float32Array[]>([]);
  const rafRef = useRef(0);
  const lastTimeRef = useRef(0);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    lastTimeRef.current = performance.now();

    function render() {
      if (!canvas || !ctx) return;
      const now = performance.now();
      const dt = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      // Sample audio
      const analyser = analyserRef.current;
      if (analyser && active) {
        const buffer = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buffer);
        historyRef.current.push(buffer);

        // Keep only WAVEFORM_HISTORY seconds worth
        const samplesPerSec = analyser.context.sampleRate;
        const maxChunks = Math.ceil(
          (WAVEFORM_HISTORY * samplesPerSec) / analyser.fftSize,
        );
        if (historyRef.current.length > maxChunks) {
          historyRef.current = historyRef.current.slice(-maxChunks);
        }
      }

      // Clear
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);

      // Grid + labels
      drawGrid(ctx, w, h, WAVEFORM_HISTORY);
      drawLabels(ctx, w, h, WAVEFORM_HISTORY);

      // Draw waveform history
      const history = historyRef.current;
      if (history.length === 0) {
        // Idle state — flat line
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // "Waiting" text
        ctx.font = "13px ui-monospace, monospace";
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.textAlign = "center";
        ctx.fillText(
          active ? "Listening..." : "Start microphone to begin",
          w / 2,
          h / 2 - 20,
        );
      } else {
        // Compute total samples and draw
        const analyser = analyserRef.current;
        const sampleRate = analyser?.context.sampleRate ?? 44100;
        const fftSize = analyser?.fftSize ?? 2048;
        const totalSamples = history.length * fftSize;
        const totalDuration = totalSamples / sampleRate;
        const pxPerSample = w / (WAVEFORM_HISTORY * sampleRate);

        // ─── glow layer ───
        ctx.save();
        ctx.shadowColor = ACCENT;
        ctx.shadowBlur = 12;
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 2;
        ctx.beginPath();

        let firstPoint = true;
        const startOffset = Math.max(
          0,
          totalSamples - WAVEFORM_HISTORY * sampleRate,
        );

        for (let ci = 0; ci < history.length; ci++) {
          const chunk = history[ci];
          for (let si = 0; si < chunk.length; si++) {
            const globalIdx = ci * fftSize + si;
            if (globalIdx < startOffset) continue;
            const visibleIdx = globalIdx - startOffset;
            const x = visibleIdx * pxPerSample;
            const y = h / 2 - chunk[si] * (h * 0.4);
            if (firstPoint) {
              ctx.moveTo(x, y);
              firstPoint = false;
            } else {
              ctx.lineTo(x, y);
            }
          }
        }
        ctx.stroke();
        ctx.restore();

        // ─── sharp line on top ───
        ctx.strokeStyle = ACCENT_BRIGHT;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        firstPoint = true;

        for (let ci = 0; ci < history.length; ci++) {
          const chunk = history[ci];
          for (let si = 0; si < chunk.length; si++) {
            const globalIdx = ci * fftSize + si;
            if (globalIdx < startOffset) continue;
            const visibleIdx = globalIdx - startOffset;
            const x = visibleIdx * pxPerSample;
            const y = h / 2 - chunk[si] * (h * 0.4);
            if (firstPoint) {
              ctx.moveTo(x, y);
              firstPoint = false;
            } else {
              ctx.lineTo(x, y);
            }
          }
        }
        ctx.stroke();

        // ─── filled area under waveform ───
        ctx.fillStyle = `${ACCENT}18`;
        ctx.beginPath();
        firstPoint = true;
        let lastX = 0;

        for (let ci = 0; ci < history.length; ci++) {
          const chunk = history[ci];
          for (let si = 0; si < chunk.length; si++) {
            const globalIdx = ci * fftSize + si;
            if (globalIdx < startOffset) continue;
            const visibleIdx = globalIdx - startOffset;
            const x = visibleIdx * pxPerSample;
            const y = h / 2 - chunk[si] * (h * 0.4);
            if (firstPoint) {
              ctx.moveTo(x, h / 2);
              ctx.lineTo(x, y);
              firstPoint = false;
            } else {
              ctx.lineTo(x, y);
            }
            lastX = x;
          }
        }
        ctx.lineTo(lastX, h / 2);
        ctx.closePath();
        ctx.fill();

        // ─── RMS envelope ───
        drawRMSEnvelope(ctx, history, fftSize, sampleRate, startOffset, pxPerSample, w, h);

        // ─── playhead line ───
        const headX =
          (totalSamples - startOffset) * pxPerSample;
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(headX, 0);
        ctx.lineTo(headX, h);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Overlay: "NOW" label at right edge
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.textAlign = "right";
      ctx.fillText("NOW", w - 6, 14);

      rafRef.current = requestAnimationFrame(render);
    }

    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, analyserRef]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}

/* ─── RMS envelope overlay ─── */
function drawRMSEnvelope(
  ctx: CanvasRenderingContext2D,
  history: Float32Array[],
  fftSize: number,
  sampleRate: number,
  startOffset: number,
  pxPerSample: number,
  w: number,
  h: number,
) {
  // Compute RMS in windows of ~20ms
  const windowSize = Math.floor(sampleRate * 0.02);
  const rmsPoints: { x: number; rms: number }[] = [];

  let sampleBuf: number[] = [];
  for (let ci = 0; ci < history.length; ci++) {
    const chunk = history[ci];
    for (let si = 0; si < chunk.length; si++) {
      const globalIdx = ci * fftSize + si;
      if (globalIdx < startOffset) continue;
      sampleBuf.push(chunk[si]);
      if (sampleBuf.length >= windowSize) {
        let sum = 0;
        for (const s of sampleBuf) sum += s * s;
        const rms = Math.sqrt(sum / sampleBuf.length);
        const visibleIdx = globalIdx - startOffset;
        rmsPoints.push({ x: visibleIdx * pxPerSample, rms });
        sampleBuf = [];
      }
    }
  }

  if (rmsPoints.length < 2) return;

  // Upper envelope
  ctx.strokeStyle = "rgba(245,158,11,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < rmsPoints.length; i++) {
    const { x, rms } = rmsPoints[i];
    const y = h / 2 - rms * h * 0.8;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Lower envelope (mirror)
  ctx.beginPath();
  for (let i = 0; i < rmsPoints.length; i++) {
    const { x, rms } = rmsPoints[i];
    const y = h / 2 + rms * h * 0.8;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/* ─── spectrum mini-view ─── */
function SpectrumMini({
  analyserRef,
  active,
}: {
  analyserRef: React.RefObject<AnalyserNode | null>;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function render() {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);

      const analyser = analyserRef.current;
      if (!analyser || !active) {
        ctx.font = "10px ui-monospace, monospace";
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.textAlign = "center";
        ctx.fillText("Spectrum", w / 2, h / 2 + 4);
        rafRef.current = requestAnimationFrame(render);
        return;
      }

      const freqData = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(freqData);

      const barCount = 64;
      const barWidth = w / barCount - 1;
      const step = Math.floor(freqData.length / barCount);

      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += freqData[i * step + j];
        const avg = sum / step / 255;
        const barH = avg * h * 0.9;

        const hue = 170 + i * (40 / barCount);
        ctx.fillStyle = `hsla(${hue}, 70%, 55%, 0.8)`;
        ctx.fillRect(
          i * (barWidth + 1),
          h - barH,
          barWidth,
          barH,
        );
      }

      // Labels
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.textAlign = "left";
      ctx.fillText("20Hz", 2, h - 2);
      ctx.textAlign = "right";
      ctx.fillText("20kHz", w - 2, h - 2);

      rafRef.current = requestAnimationFrame(render);
    }

    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, analyserRef]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}

/* ─── live stats ─── */
function LiveStats({
  analyserRef,
  active,
}: {
  analyserRef: React.RefObject<AnalyserNode | null>;
  active: boolean;
}) {
  const rmsRef = useRef<HTMLSpanElement>(null);
  const peakRef = useRef<HTMLSpanElement>(null);
  const freqRef = useRef<HTMLSpanElement>(null);
  const dbRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    function tick() {
      const analyser = analyserRef.current;
      if (!analyser || !active) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const buffer = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buffer);

      // RMS
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i];
        if (Math.abs(buffer[i]) > peak) peak = Math.abs(buffer[i]);
      }
      const rms = Math.sqrt(sum / buffer.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -100;

      // Dominant frequency via autocorrelation
      const sampleRate = analyser.context.sampleRate;
      let bestCorr = 0;
      let bestLag = 0;
      const minLag = Math.floor(sampleRate / 800); // 800Hz max
      const maxLag = Math.floor(sampleRate / 60); // 60Hz min
      for (let lag = minLag; lag < maxLag && lag < buffer.length; lag++) {
        let corr = 0;
        for (let i = 0; i < buffer.length - lag; i++) {
          corr += buffer[i] * buffer[i + lag];
        }
        if (corr > bestCorr) {
          bestCorr = corr;
          bestLag = lag;
        }
      }
      const freq = bestLag > 0 ? sampleRate / bestLag : 0;

      if (rmsRef.current) rmsRef.current.textContent = rms.toFixed(4);
      if (peakRef.current) peakRef.current.textContent = peak.toFixed(4);
      if (freqRef.current)
        freqRef.current.textContent = freq > 60 ? `${Math.round(freq)} Hz` : "---";
      if (dbRef.current) dbRef.current.textContent = `${db.toFixed(1)} dB`;

      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, analyserRef]);

  const statStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    padding: "6px 0",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    fontSize: 12,
  };
  const labelStyle: React.CSSProperties = { color: "rgba(255,255,255,0.4)" };
  const valueStyle: React.CSSProperties = {
    color: "white",
    fontFamily: "ui-monospace, monospace",
    fontWeight: 600,
  };

  return (
    <div style={{ padding: "12px 16px" }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase" as const,
          letterSpacing: "0.08em",
          color: "rgba(255,255,255,0.3)",
          marginBottom: 8,
        }}
      >
        Live Analysis
      </div>
      <div style={statStyle}>
        <span style={labelStyle}>RMS Level</span>
        <span ref={rmsRef} style={valueStyle}>
          {active ? "0.0000" : "---"}
        </span>
      </div>
      <div style={statStyle}>
        <span style={labelStyle}>Peak</span>
        <span ref={peakRef} style={valueStyle}>
          {active ? "0.0000" : "---"}
        </span>
      </div>
      <div style={statStyle}>
        <span style={labelStyle}>Level</span>
        <span ref={dbRef} style={valueStyle}>
          {active ? "-100.0 dB" : "---"}
        </span>
      </div>
      <div style={{ ...statStyle, borderBottom: "none" }}>
        <span style={labelStyle}>Pitch</span>
        <span ref={freqRef} style={valueStyle}>
          {active ? "---" : "---"}
        </span>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   PAGE
   ════════════════════════════════════════════════════════════════════ */
export default function VoiceTest3Page() {
  const audio = useAudioCapture();

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        left: "var(--sidebar-width, 240px)",
        background: BG,
        display: "flex",
        flexDirection: "column",
        color: "white",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          padding: "14px 24px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 17,
              fontWeight: 700,
              margin: 0,
              letterSpacing: "-0.02em",
            }}
          >
            Waveform Visualizer
          </h1>
          <p
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.4)",
              margin: "2px 0 0",
            }}
          >
            Real-time audio waveform with scrolling history, RMS envelope, and
            spectrum analysis
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {audio.active && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: ACCENT_BRIGHT,
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#ef4444",
                  animation: "pulse 1.5s ease-in-out infinite",
                }}
              />
              Recording
            </div>
          )}
          <button
            onClick={audio.active ? audio.stop : audio.start}
            style={{
              padding: "7px 18px",
              borderRadius: 6,
              border: "none",
              background: audio.active ? "#dc2626" : ACCENT,
              color: "white",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              {audio.active ? (
                <rect x="4" y="4" width="16" height="16" rx="2" />
              ) : (
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z" />
              )}
            </svg>
            {audio.active ? "Stop" : "Start Mic"}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Waveform area */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          {/* Primary waveform — takes most space */}
          <div
            style={{
              flex: 1,
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              position: "relative",
            }}
          >
            <WaveformCanvas
              analyserRef={audio.analyserRef}
              active={audio.active}
            />
          </div>

          {/* Spectrum strip at bottom */}
          <div style={{ height: 120, flexShrink: 0 }}>
            <SpectrumMini
              analyserRef={audio.analyserRef}
              active={audio.active}
            />
          </div>
        </div>

        {/* Right sidebar — stats */}
        <div
          style={{
            width: 200,
            flexShrink: 0,
            borderLeft: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <LiveStats analyserRef={audio.analyserRef} active={audio.active} />

          {/* Legend */}
          <div
            style={{
              marginTop: "auto",
              padding: "12px 16px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              fontSize: 10,
              color: "rgba(255,255,255,0.3)",
              lineHeight: 1.8,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase" as const,
                letterSpacing: "0.08em",
                marginBottom: 6,
              }}
            >
              Legend
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                style={{
                  width: 12,
                  height: 2,
                  background: ACCENT_BRIGHT,
                  borderRadius: 1,
                }}
              />
              Waveform
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                style={{
                  width: 12,
                  height: 2,
                  background: "rgba(245,158,11,0.5)",
                  borderRadius: 1,
                }}
              />
              RMS Envelope
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                style={{
                  width: 12,
                  height: 2,
                  background: "rgba(255,255,255,0.15)",
                  borderRadius: 1,
                  borderTop: "1px dashed rgba(255,255,255,0.3)",
                }}
              />
              Grid / Center
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {audio.error && (
        <div
          style={{
            position: "absolute",
            top: 60,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(220,38,38,0.9)",
            color: "white",
            padding: "8px 16px",
            borderRadius: 8,
            fontSize: 13,
            zIndex: 20,
          }}
        >
          {audio.error}
        </div>
      )}

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
