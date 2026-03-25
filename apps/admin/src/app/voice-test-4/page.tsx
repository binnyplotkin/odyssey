"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Line as ThreeLine,
  LineBasicMaterial,
  type Points,
} from "three";

/* ═══════════════════════════════════════════════════════════════════
   SHARED AUDIO DATA — module-scope global, no React props needed.
   DOM-side writes, r3f-side reads — bypasses reconciler boundary.
   ═══════════════════════════════════════════════════════════════════ */
interface AudioData {
  energy: number;
  bass: number;
  mid: number;
  treble: number;
  active: boolean;
}

const EMPTY_AUDIO: AudioData = { energy: 0, bass: 0, mid: 0, treble: 0, active: false };

/** Module-scope mutable audio state — both DOM and r3f read/write this directly */
const AUDIO: AudioData = { ...EMPTY_AUDIO };

/* ─── audio capture + analysis loop (writes to module-scope AUDIO) ─── */
function useAudioAnalysis() {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const freqBuf = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rafRef = useRef(0);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tick = useCallback(() => {
    const a = analyserRef.current;
    const buf = freqBuf.current;
    if (a && buf) {
      a.getByteFrequencyData(buf);
      const len = buf.length;
      const third = Math.floor(len / 3);
      let total = 0, bass = 0, mid = 0, treble = 0;
      for (let i = 0; i < len; i++) {
        total += buf[i];
        if (i < third) bass += buf[i];
        else if (i < third * 2) mid += buf[i];
        else treble += buf[i];
      }
      AUDIO.energy = total / (len * 255);
      AUDIO.bass = bass / (third * 255);
      AUDIO.mid = mid / (third * 255);
      AUDIO.treble = treble / ((len - third * 2) * 255);
      AUDIO.active = true;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      freqBuf.current = new Uint8Array(analyser.frequencyBinCount);
      setActive(true);
      setError(null);
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mic access denied");
    }
  }, [tick]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close();
    ctxRef.current = null;
    analyserRef.current = null;
    Object.assign(AUDIO, EMPTY_AUDIO);
    setActive(false);
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      ctxRef.current?.close();
    };
  }, []);

  return { active, error, start, stop };
}

/* ─── constants ─── */
const WAVE_POINTS = 256;
const WAVE_LAYERS = 40;
const LAYER_DEPTH = 0.1;
const WAVE_WIDTH = 12;
const PARTICLE_COUNT = 2000;
const GREEN_CORE = new Color("#44ff88");
const GREEN_BRIGHT = new Color("#88ffbb");
const GREEN_DIM = new Color("#115533");
const GREEN_HOT = new Color("#ccffdd");

/* ═══════════════════════════════════════════════════════════════════
   LAYERED WAVEFORM RIBBONS
   40 green wave lines stacked in Z, always animating,
   audio energy amplifies everything
   ═══════════════════════════════════════════════════════════════════ */
function WaveformRibbons() {
  const groupRef = useRef<import("three").Group>(null);

  // Build line objects once, add them to the group imperatively
  const linesReady = useRef(false);
  const geos = useRef<BufferGeometry[]>([]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group || linesReady.current) return;
    linesReady.current = true;

    for (let l = 0; l < WAVE_LAYERS; l++) {
      const geo = new BufferGeometry();
      const positions = new Float32Array(WAVE_POINTS * 3);
      const colors = new Float32Array(WAVE_POINTS * 3);
      for (let i = 0; i < WAVE_POINTS; i++) {
        positions[i * 3] = (i / (WAVE_POINTS - 1) - 0.5) * WAVE_WIDTH;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = (l - WAVE_LAYERS / 2) * LAYER_DEPTH;
        colors[i * 3] = GREEN_DIM.r;
        colors[i * 3 + 1] = GREEN_DIM.g;
        colors[i * 3 + 2] = GREEN_DIM.b;
      }
      const posAttr = new BufferAttribute(positions, 3);
      posAttr.setUsage(35048); // THREE.DynamicDrawUsage
      const colAttr = new BufferAttribute(colors, 3);
      colAttr.setUsage(35048);
      geo.setAttribute("position", posAttr);
      geo.setAttribute("color", colAttr);

      const layerNorm = l / (WAVE_LAYERS - 1);
      const coreBlend = 1 - Math.abs(layerNorm - 0.5) * 2;
      const mat = new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.25 + coreBlend * 0.55,
        blending: AdditiveBlending,
      });
      const line = new ThreeLine(geo, mat);
      group.add(line);
      geos.current.push(geo);
    }
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const { energy, bass, mid, treble } = AUDIO;

    const tmpColor = new Color();

    for (let l = 0; l < geos.current.length; l++) {
      const geo = geos.current[l];
      const posArr = (geo.attributes.position as BufferAttribute).array as Float32Array;
      const colArr = (geo.attributes.color as BufferAttribute).array as Float32Array;

      const layerNorm = l / (WAVE_LAYERS - 1);
      const coreBlend = 1 - Math.abs(layerNorm - 0.5) * 2;
      const layerPhase = (layerNorm - 0.5) * Math.PI * 1.5;
      const layerAmp = 0.2 + 0.8 * (coreBlend ** 0.7);

      for (let i = 0; i < WAVE_POINTS; i++) {
        const normX = i / (WAVE_POINTS - 1);
        const envelope = Math.sin(normX * Math.PI) ** 0.5;

        // Base waves (3 harmonics + breathing)
        const wave1 = Math.sin(normX * Math.PI * 2 - t * 1.2 + layerPhase * 5);
        const wave2 = 0.5 * Math.sin(normX * Math.PI * 3.5 + t * 0.8 + layerPhase * 3);
        const wave3 = 0.25 * Math.sin(normX * Math.PI * 6 - t * 1.6 + layerPhase * 8);
        const breathe = Math.sin(t * 0.5 + layerNorm * Math.PI * 2);

        // Idle = subtle; audio drives real Y displacement
        let y =
          0.08 * layerAmp * envelope * (wave1 + wave2 + wave3) * (0.6 + 0.4 * breathe);

        // Energy scales the base wave up dramatically
        y *= 1.0 + energy * 12.0;

        // Bass: heavy slow undulation
        y += 4.0 * bass * layerAmp * envelope *
          Math.sin(normX * Math.PI * 1.5 - t * 0.8 + layerPhase * 2);

        // Mid: medium movement
        y += 2.5 * mid * layerAmp * envelope *
          Math.sin(normX * Math.PI * 3 + t * 2.0 + layerPhase * 4);

        // Treble: fast ripples
        y += 1.5 * treble * layerAmp * envelope *
          Math.sin(normX * Math.PI * 10 + t * 4.0 + layerPhase * 10);

        // Write Y directly into the Float32Array
        posArr[i * 3 + 1] = y;

        // Color: brighter at peaks
        const intensity = Math.min(1, Math.abs(y) / 2.0);
        tmpColor.copy(GREEN_DIM);
        tmpColor.lerp(GREEN_CORE, intensity * 0.7 + coreBlend * 0.3);
        tmpColor.lerp(GREEN_BRIGHT, intensity * coreBlend * 0.5);
        if (intensity > 0.6) {
          tmpColor.lerp(GREEN_HOT, (intensity - 0.6) * 2.0 * coreBlend);
        }
        colArr[i * 3] = tmpColor.r;
        colArr[i * 3 + 1] = tmpColor.g;
        colArr[i * 3 + 2] = tmpColor.b;
      }

      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.computeBoundingSphere();
    }
  });

  return <group ref={groupRef} />;
}

/* ═══════════════════════════════════════════════════════════════════
   FLOATING PARTICLES
   ═══════════════════════════════════════════════════════════════════ */
function Particles() {
  const pointsRef = useRef<Points>(null);

  const state = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    const lifetimes = new Float32Array(PARTICLE_COUNT);
    const ages = new Float32Array(PARTICLE_COUNT);
    const sizes = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * WAVE_WIDTH;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 4;
      positions[i * 3 + 2] = (Math.random() - 0.5) * WAVE_LAYERS * LAYER_DEPTH;
      lifetimes[i] = 1 + Math.random() * 3;
      ages[i] = Math.random() * lifetimes[i];
      sizes[i] = 0.02 + Math.random() * 0.06;
    }

    return { positions, colors, velocities, lifetimes, ages, sizes };
  }, []);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    const e = AUDIO.active ? AUDIO.energy : 0.05;

    const pos = pointsRef.current.geometry.attributes.position as BufferAttribute;
    const col = pointsRef.current.geometry.attributes.color as BufferAttribute;
    const size = pointsRef.current.geometry.attributes.size as BufferAttribute;
    const tmpColor = new Color();

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      state.ages[i] += delta;

      if (state.ages[i] >= state.lifetimes[i]) {
        state.ages[i] = 0;
        state.lifetimes[i] = 1 + Math.random() * 3;
        state.positions[i * 3] = (Math.random() - 0.5) * WAVE_WIDTH * 0.8;
        state.positions[i * 3 + 1] = (Math.random() - 0.5) * 0.5;
        state.positions[i * 3 + 2] =
          (Math.random() - 0.5) * WAVE_LAYERS * LAYER_DEPTH;

        const angle = Math.random() * Math.PI * 2;
        const speed = (0.2 + e * 2) * (0.3 + Math.random() * 0.7);
        state.velocities[i * 3] = Math.cos(angle) * speed * 0.3;
        state.velocities[i * 3 + 1] = (Math.random() - 0.3) * speed;
        state.velocities[i * 3 + 2] = Math.sin(angle) * speed * 0.5;
      }

      state.positions[i * 3] += state.velocities[i * 3] * delta;
      state.positions[i * 3 + 1] += state.velocities[i * 3 + 1] * delta;
      state.positions[i * 3 + 2] += state.velocities[i * 3 + 2] * delta;

      state.velocities[i * 3 + 1] -= 0.08 * delta;
      state.velocities[i * 3] *= 0.998;
      state.velocities[i * 3 + 1] *= 0.998;
      state.velocities[i * 3 + 2] *= 0.998;

      pos.setXYZ(
        i,
        state.positions[i * 3],
        state.positions[i * 3 + 1],
        state.positions[i * 3 + 2],
      );

      const life = state.ages[i] / state.lifetimes[i];
      const fade = 1 - life;
      const brightness = fade * (0.3 + e * 0.7);
      tmpColor.copy(GREEN_CORE);
      tmpColor.lerp(GREEN_BRIGHT, brightness * 0.5);
      col.setXYZ(
        i,
        tmpColor.r * brightness,
        tmpColor.g * brightness,
        tmpColor.b * brightness,
      );

      size.setX(i, state.sizes[i] * fade * (0.5 + e * 1.5));
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    size.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[state.positions, 3]}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[state.colors, 3]}
        />
        <bufferAttribute
          attach="attributes-size"
          args={[state.sizes, 1]}
        />
      </bufferGeometry>
      <pointsMaterial
        vertexColors
        size={0.05}
        sizeAttenuation
        transparent
        opacity={0.8}
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SCENE
   ═══════════════════════════════════════════════════════════════════ */
function Scene({
  showParticles,
  autoOrbit,
}: {
  showParticles: boolean;
  autoOrbit: boolean;
}) {
  return (
    <>
      <color attach="background" args={["#020808"]} />
      <fog attach="fog" args={["#020808", 10, 22]} />
      <OrbitControls
        autoRotate={autoOrbit}
        autoRotateSpeed={0.3}
        enableDamping
        dampingFactor={0.05}
        minDistance={4}
        maxDistance={16}
        target={[0, 0, 0]}
      />
      <WaveformRibbons />
      {showParticles && <Particles />}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ENERGY HUD
   ═══════════════════════════════════════════════════════════════════ */
function EnergyHud() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const historyRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = 160;
    const H = 40;
    const dpr = 2;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;

    function draw() {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      historyRef.current.push(AUDIO.energy);
      if (historyRef.current.length > W) historyRef.current.shift();

      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "#44ff88";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const hist = historyRef.current;
      for (let i = 0; i < hist.length; i++) {
        const x = W - hist.length + i;
        const y = H - hist[i] * H * 0.9;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(68,255,136,0.08)";
      ctx.lineTo(W, H);
      ctx.lineTo(W - hist.length, H);
      ctx.closePath();
      ctx.fill();
      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return <canvas ref={canvasRef} style={{ display: "block" }} />;
}

/* ═══════════════════════════════════════════════════════════════════
   DEBUG PANEL — editable sliders that write directly to AUDIO global
   ═══════════════════════════════════════════════════════════════════ */
function DebugPanel({
  micActive,
  showParticles,
  onToggleParticles,
  autoOrbit,
  onToggleOrbit,
}: {
  micActive: boolean;
  showParticles: boolean;
  onToggleParticles: () => void;
  autoOrbit: boolean;
  onToggleOrbit: () => void;
}) {
  const [override, setOverride] = useState(false);
  const [vals, setVals] = useState({ energy: 0, bass: 0, mid: 0, treble: 0 });
  const liveRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  // When override is on, write slider values into AUDIO global every frame
  useEffect(() => {
    if (!override) return;
    function tick() {
      AUDIO.energy = vals.energy;
      AUDIO.bass = vals.bass;
      AUDIO.mid = vals.mid;
      AUDIO.treble = vals.treble;
      AUDIO.active = true;
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [override, vals]);

  // Show live readout from AUDIO global
  useEffect(() => {
    let id = 0;
    function tick() {
      if (liveRef.current) {
        liveRef.current.textContent =
          `active=${AUDIO.active}  energy=${AUDIO.energy.toFixed(3)}  bass=${AUDIO.bass.toFixed(3)}  mid=${AUDIO.mid.toFixed(3)}  treble=${AUDIO.treble.toFixed(3)}`;
      }
      id = requestAnimationFrame(tick);
    }
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  const sliderRow = (label: string, key: keyof typeof vals) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <label style={{ width: 50, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
        {label}
      </label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={vals[key]}
        onChange={(e) => setVals((v) => ({ ...v, [key]: parseFloat(e.target.value) }))}
        style={{ flex: 1, accentColor: "#44ff88" }}
      />
      <span style={{ width: 36, fontSize: 11, textAlign: "right", color: "#44ff88" }}>
        {vals[key].toFixed(2)}
      </span>
    </div>
  );

  return (
    <div
      style={{
        position: "absolute",
        top: 20,
        right: 24,
        zIndex: 20,
        background: "rgba(0,0,0,0.85)",
        border: "1px solid rgba(68,255,136,0.3)",
        borderRadius: 8,
        padding: "12px 16px",
        fontSize: 11,
        color: "white",
        width: 280,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 12, color: "#44ff88" }}>
        Debug Controls
      </div>

      {/* Live readout */}
      <div
        ref={liveRef}
        style={{
          fontSize: 9,
          color: "rgba(255,255,255,0.4)",
          fontFamily: "ui-monospace, monospace",
          marginBottom: 10,
          padding: "4px 6px",
          background: "rgba(255,255,255,0.04)",
          borderRadius: 4,
          whiteSpace: "pre",
        }}
      />

      {/* Override toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <button
          onClick={() => setOverride(!override)}
          style={{
            padding: "4px 12px",
            borderRadius: 4,
            border: override
              ? "1px solid #f59e0b"
              : "1px solid rgba(255,255,255,0.2)",
            background: override ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.05)",
            color: override ? "#f59e0b" : "rgba(255,255,255,0.6)",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {override ? "OVERRIDE ON" : "OVERRIDE OFF"}
        </button>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
          {override ? "Sliders control waves" : micActive ? "Mic controls waves" : "Idle animation"}
        </span>
      </div>

      {/* Sliders */}
      {sliderRow("Energy", "energy")}
      {sliderRow("Bass", "bass")}
      {sliderRow("Mid", "mid")}
      {sliderRow("Treble", "treble")}

      {/* Particles toggle */}
      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onToggleParticles}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: showParticles
                ? "1px solid rgba(68,255,136,0.4)"
                : "1px solid rgba(255,255,255,0.15)",
              background: showParticles
                ? "rgba(68,255,136,0.15)"
                : "rgba(255,255,255,0.05)",
              color: showParticles ? "#44ff88" : "rgba(255,255,255,0.4)",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Particles {showParticles ? "ON" : "OFF"}
          </button>
          <button
            onClick={onToggleOrbit}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: autoOrbit
                ? "1px solid rgba(68,255,136,0.4)"
                : "1px solid rgba(255,255,255,0.15)",
              background: autoOrbit
                ? "rgba(68,255,136,0.15)"
                : "rgba(255,255,255,0.05)",
              color: autoOrbit ? "#44ff88" : "rgba(255,255,255,0.4)",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Orbit {autoOrbit ? "ON" : "OFF"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════════════════════════════ */
export default function VoiceTest4Page() {
  const audio = useAudioAnalysis();
  const [showParticles, setShowParticles] = useState(true);
  const [autoOrbit, setAutoOrbit] = useState(true);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        left: "var(--sidebar-width, 240px)",
        background: "#020808",
        display: "flex",
        flexDirection: "column",
        color: "white",
        fontFamily: "ui-monospace, monospace",
      }}
    >
      <div style={{ flex: 1, position: "relative" }}>
        <Canvas
          camera={{ position: [0, 2, 7], fov: 55 }}
          style={{ width: "100%", height: "100%" }}
          gl={{ antialias: true, alpha: false }}
        >
          <Scene showParticles={showParticles} autoOrbit={autoOrbit} />
        </Canvas>

        {/* Debug overlay */}
        <DebugPanel micActive={audio.active} showParticles={showParticles} onToggleParticles={() => setShowParticles(p => !p)} autoOrbit={autoOrbit} onToggleOrbit={() => setAutoOrbit(o => !o)} />

        {/* Top-left label */}
        <div
          style={{
            position: "absolute",
            top: 20,
            left: 24,
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          <h1
            style={{
              fontSize: 16,
              fontWeight: 700,
              margin: 0,
              letterSpacing: "-0.02em",
              color: "rgba(255,255,255,0.8)",
            }}
          >
            3D Waveform
          </h1>
          <p
            style={{
              fontSize: 10,
              margin: "3px 0 0",
              color: "rgba(68,255,136,0.5)",
              letterSpacing: "0.05em",
            }}
          >
            AUDIO VISUALIZER
          </p>
        </div>

        {/* Bottom-left energy mini-graph */}
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 24,
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: "rgba(68,255,136,0.4)",
              letterSpacing: "0.08em",
              marginBottom: 4,
            }}
          >
            ENERGY
          </div>
          <div
            style={{
              border: "1px solid rgba(68,255,136,0.15)",
              borderRadius: 4,
              overflow: "hidden",
              background: "rgba(0,0,0,0.3)",
            }}
          >
            <EnergyHud />
          </div>
        </div>

        {/* Bottom-right controls */}
        <div
          style={{
            position: "absolute",
            bottom: 20,
            right: 24,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {audio.active && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 10,
                color: "#44ff88",
                letterSpacing: "0.05em",
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#44ff88",
                  boxShadow: "0 0 8px #44ff88",
                  animation: "pulse 1.5s ease-in-out infinite",
                }}
              />
              LIVE
            </div>
          )}
          <button
            onClick={audio.active ? audio.stop : audio.start}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: audio.active
                ? "1px solid rgba(255,68,68,0.4)"
                : "1px solid rgba(68,255,136,0.3)",
              background: audio.active
                ? "rgba(255,68,68,0.15)"
                : "rgba(68,255,136,0.1)",
              color: audio.active ? "#ff6666" : "#44ff88",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              letterSpacing: "0.03em",
              backdropFilter: "blur(8px)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              {audio.active ? (
                <rect x="4" y="4" width="16" height="16" rx="2" />
              ) : (
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z" />
              )}
            </svg>
            {audio.active ? "STOP" : "START MIC"}
          </button>
        </div>
      </div>

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

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
