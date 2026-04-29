"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Line as ThreeLine,
  LineBasicMaterial,
  Points,
  ShaderMaterial,
  type Group,
} from "three";

type AudioData = {
  energy: number;
  bass: number;
  mid: number;
  high: number;
  peak: number;
  active: boolean;
};

const EMPTY_AUDIO: AudioData = {
  energy: 0,
  bass: 0,
  mid: 0,
  high: 0,
  peak: 0,
  active: false,
};

const AUDIO: AudioData = { ...EMPTY_AUDIO };

const COLORS = {
  base: "#8FD1CB",
  glow: "#BFF5EF",
  highlight: "#8FEDE1",
  core: "#6FE0D2",
  deep: "#041215",
} as const;

const C_BASE = new Color(COLORS.base);
const C_GLOW = new Color(COLORS.glow);
const C_HIGHLIGHT = new Color(COLORS.highlight);
const C_CORE = new Color(COLORS.core);
const C_DEEP = new Color(COLORS.deep);
const C_AURORA = new Color("#7EEFFF");

const FIELD_WIDTH = 54;
const FIELD_DEPTH = 74;
const ROWS = 44;
const COLS = 92;
const TAU = Math.PI * 2;
const LINE_STEP = 5;
const SPARK_COUNT = 420;
const FLOAT_COUNT = 56;
const MAX_VOICE_WAVE_SCALE = 1.45;
const MIN_VOICE_WAVE_SCALE = 0.015;
const LOUDNESS_DB_FLOOR = -54;
const LOUDNESS_DB_CEIL = -2;
const LOUDNESS_CURVE_EXPONENT = 2.2;

const SURFACE_LAYERS = [
  { zShift: 2.2, amp: 1.14, glow: 1.2, alpha: 1.0 },
  { zShift: -3.4, amp: 0.98, glow: 0.98, alpha: 0.86 },
  { zShift: -9.6, amp: 0.84, glow: 0.8, alpha: 0.68 },
  { zShift: -16.8, amp: 0.72, glow: 0.66, alpha: 0.54 },
  { zShift: -24.0, amp: 0.58, glow: 0.52, alpha: 0.4 },
] as const;

const BROAD_WAVES = [
  { nx: 0.88, nz: 0.47, freq: 0.014, speed: 0.082, amp: 1.12, phase: 0.1 },
  { nx: -0.75, nz: 0.66, freq: 0.016, speed: 0.072, amp: 1.0, phase: 1.2 },
  { nx: 0.56, nz: -0.83, freq: 0.018, speed: 0.066, amp: 0.92, phase: 2.1 },
  { nx: -0.41, nz: -0.91, freq: 0.012, speed: 0.058, amp: 0.84, phase: 2.9 },
  { nx: 0.22, nz: 0.98, freq: 0.01, speed: 0.048, amp: 0.72, phase: 3.6 },
  { nx: -0.15, nz: 0.99, freq: 0.011, speed: 0.054, amp: 0.66, phase: 4.4 },
] as const;

const MID_WAVES = [
  { nx: 0.93, nz: 0.35, freq: 0.03, speed: 0.115, amp: 0.24, phase: 0.4 },
  { nx: -0.53, nz: 0.85, freq: 0.034, speed: 0.104, amp: 0.2, phase: 1.6 },
  { nx: 0.34, nz: -0.94, freq: 0.028, speed: 0.096, amp: 0.17, phase: 2.6 },
] as const;

const EMITTERS = [
  { ox: 0.72, oz: 0.56, radius: 0.28, speed: 0.13, phase: 0.2 },
  { ox: -0.68, oz: 0.54, radius: 0.3, speed: 0.11, phase: 0.9 },
  { ox: 0.66, oz: -0.5, radius: 0.27, speed: 0.1, phase: 1.6 },
  { ox: -0.62, oz: -0.56, radius: 0.29, speed: 0.09, phase: 2.3 },
  { ox: 0.0, oz: 0.0, radius: 0.34, speed: 0.08, phase: 3.0 },
] as const;

type BroadWave = (typeof BROAD_WAVES)[number];
type MidWave = (typeof MID_WAVES)[number];
type Emitter = (typeof EMITTERS)[number];

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function useAudioAnalysis() {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const tRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rafRef = useRef(0);
  const prevRef = useRef(0);
  const smoothRef = useRef<AudioData>({ ...EMPTY_AUDIO });
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    const f = fRef.current;
    const td = tRef.current;

    if (analyser && f && td) {
      analyser.getByteFrequencyData(f);
      analyser.getByteTimeDomainData(td);

      let rms = 0;
      for (let i = 0; i < td.length; i++) {
        const v = (td[i] - 128) / 128;
        rms += v * v;
      }
      rms = Math.sqrt(rms / td.length);

      const n = f.length;
      const bEnd = Math.floor(n * 0.16);
      const mEnd = Math.floor(n * 0.56);
      let bass = 0;
      let mid = 0;
      let high = 0;

      for (let i = 0; i < n; i++) {
        const v = f[i] / 255;
        if (i < bEnd) bass += v;
        else if (i < mEnd) mid += v;
        else high += v;
      }

      bass /= Math.max(1, bEnd);
      mid /= Math.max(1, mEnd - bEnd);
      high /= Math.max(1, n - mEnd);

      const spectral = (bass + mid + high) / 3;
      const targetEnergy = clamp01(rms * 6.8 + spectral * 1.35);
      const s = smoothRef.current;
      s.energy += (targetEnergy - s.energy) * 0.24;
      s.bass += (bass - s.bass) * 0.16;
      s.mid += (mid - s.mid) * 0.18;
      s.high += (high - s.high) * 0.21;
      const rise = Math.max(0, s.energy - prevRef.current);
      s.peak = Math.max(s.peak * 0.86, clamp01(rise * 8 + s.high * 0.24));
      prevRef.current = s.energy;

      AUDIO.energy = s.energy;
      AUDIO.bass = s.bass;
      AUDIO.mid = s.mid;
      AUDIO.high = s.high;
      AUDIO.peak = s.peak;
      AUDIO.active = true;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext();
      await ctx.resume();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;

      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser);

      const mute = ctx.createGain();
      mute.gain.value = 0;
      analyser.connect(mute);
      mute.connect(ctx.destination);

      ctxRef.current = ctx;
      analyserRef.current = analyser;
      fRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      tRef.current = new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>;
      setError(null);
      setActive(true);
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Microphone access failed");
    }
  }, [tick]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close();
    ctxRef.current = null;
    analyserRef.current = null;
    smoothRef.current = { ...EMPTY_AUDIO };
    prevRef.current = 0;
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

type LineLayer = {
  row: number;
  geo: BufferGeometry;
  positions: Float32Array;
  colors: Float32Array;
  mat: LineBasicMaterial;
};

type SurfaceLayer = {
  zShift: number;
  amp: number;
  glow: number;
  alpha: number;
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  prevY: Float32Array;
  prevRise: Float32Array;
  pointsGeo: BufferGeometry;
  pointsMat: ShaderMaterial;
  lines: LineLayer[];
};

type SparkSystem = {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  vel: Float32Array;
  ages: Float32Array;
  life: Float32Array;
  geo: BufferGeometry;
  mat: ShaderMaterial;
};

type FloatSystem = {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  drift: Float32Array;
  geo: BufferGeometry;
  mat: ShaderMaterial;
};

type OceanRef = {
  layers: SurfaceLayer[];
  sparks: SparkSystem;
  floats: FloatSystem;
};

function OceanField() {
  const groupRef = useRef<Group>(null);
  const oceanRef = useRef<OceanRef | null>(null);
  const smoothRef = useRef({ energy: 0, bass: 0, mid: 0, high: 0, peak: 0 });
  const modeRef = useRef({
    activity: 0,
    loud: 0,
    presence: 0,
    engage: 0,
    volume: 0,
    voiceLevel: 0,
    waveScale: 1,
    motionScale: 1,
  });
  const gateRef = useRef({ floor: 0.012 });
  const rollRef = useRef({ offset: 0, speed: 0, drift: 0.00044 });
  const topologyRef = useRef(0);
  const audioGateRef = useRef({ presence: 0, micOnAt: 0, prevMicOn: false });
  const phaseRef = useRef({ a: Math.random() * TAU, b: Math.random() * TAU });
  const sparkCursorRef = useRef(0);
  const frameRef = useRef(0);

  useEffect(() => {
    const group = groupRef.current;
    if (!group || oceanRef.current) return;

    const layers: SurfaceLayer[] = [];
    for (let li = 0; li < SURFACE_LAYERS.length; li++) {
      const cfg = SURFACE_LAYERS[li];
      const count = ROWS * COLS;
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const sizes = new Float32Array(count);
      const prevY = new Float32Array(count);
      const prevRise = new Float32Array(count);

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          const xn = c / (COLS - 1);
          const zn = r / (ROWS - 1);
          const x = (xn - 0.5) * FIELD_WIDTH;
          const z = -zn * FIELD_DEPTH + 4 + cfg.zShift;
          positions[i * 3] = x;
          positions[i * 3 + 1] = -0.02;
          positions[i * 3 + 2] = z;
          prevY[i] = -0.02;
          prevRise[i] = 0;
          colors[i * 3] = C_BASE.r;
          colors[i * 3 + 1] = C_BASE.g;
          colors[i * 3 + 2] = C_BASE.b;
          sizes[i] = 1;
        }
      }

      const pointsGeo = new BufferGeometry();
      const pAttr = new BufferAttribute(positions, 3);
      const cAttr = new BufferAttribute(colors, 3);
      const sAttr = new BufferAttribute(sizes, 1);
      pAttr.setUsage(DynamicDrawUsage);
      cAttr.setUsage(DynamicDrawUsage);
      sAttr.setUsage(DynamicDrawUsage);
      pointsGeo.setAttribute("position", pAttr);
      pointsGeo.setAttribute("color", cAttr);
      pointsGeo.setAttribute("aSize", sAttr);

      const pointsMat = new ShaderMaterial({
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        vertexColors: true,
        uniforms: {
          uFade: { value: 0.9 },
          uGlow: { value: cfg.glow },
        },
        vertexShader: `
          attribute float aSize;
          varying vec3 vColor;
          varying float vFade;
          varying float vGlow;
          uniform float uFade;
          uniform float uGlow;
          void main() {
            vColor = color;
            vFade = uFade;
            vGlow = uGlow;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = clamp(aSize * (125.0 / max(1.0, -mv.z)), 0.55, 5.4);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          varying float vFade;
          varying float vGlow;
          void main() {
            vec2 uv = gl_PointCoord * 2.0 - 1.0;
            float d = length(uv);
            float halo = smoothstep(1.0, 0.0, d);
            float core = smoothstep(0.35, 0.0, d) * (0.72 + vGlow * 0.4);
            gl_FragColor = vec4(vColor, (halo * 0.85 + core) * vFade);
          }
        `,
      });

      group.add(new Points(pointsGeo, pointsMat));

      const lines: LineLayer[] = [];
      for (let r = 0; r < ROWS; r += LINE_STEP) {
        const lp = new Float32Array(COLS * 3);
        const lc = new Float32Array(COLS * 3);
        for (let c = 0; c < COLS; c++) {
          const src = r * COLS + c;
          lp[c * 3] = positions[src * 3];
          lp[c * 3 + 1] = positions[src * 3 + 1];
          lp[c * 3 + 2] = positions[src * 3 + 2];
          lc[c * 3] = colors[src * 3];
          lc[c * 3 + 1] = colors[src * 3 + 1];
          lc[c * 3 + 2] = colors[src * 3 + 2];
        }

        const lgeo = new BufferGeometry();
        const lpAttr = new BufferAttribute(lp, 3);
        const lcAttr = new BufferAttribute(lc, 3);
        lpAttr.setUsage(DynamicDrawUsage);
        lcAttr.setUsage(DynamicDrawUsage);
        lgeo.setAttribute("position", lpAttr);
        lgeo.setAttribute("color", lcAttr);

        const lmat = new LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.08 * cfg.alpha,
          blending: AdditiveBlending,
          depthWrite: false,
        });

        group.add(new ThreeLine(lgeo, lmat));
        lines.push({ row: r, geo: lgeo, positions: lp, colors: lc, mat: lmat });
      }

      layers.push({
        zShift: cfg.zShift,
        amp: cfg.amp,
        glow: cfg.glow,
        alpha: cfg.alpha,
        positions,
        colors,
        sizes,
        prevY,
        prevRise,
        pointsGeo,
        pointsMat,
        lines,
      });
    }

    const sparkPositions = new Float32Array(SPARK_COUNT * 3);
    const sparkColors = new Float32Array(SPARK_COUNT * 3);
    const sparkSizes = new Float32Array(SPARK_COUNT);
    const sparkAlphas = new Float32Array(SPARK_COUNT);
    const sparkVel = new Float32Array(SPARK_COUNT * 3);
    const sparkAges = new Float32Array(SPARK_COUNT);
    const sparkLife = new Float32Array(SPARK_COUNT);
    for (let i = 0; i < SPARK_COUNT; i++) {
      sparkPositions[i * 3] = (Math.random() - 0.5) * FIELD_WIDTH;
      sparkPositions[i * 3 + 1] = -0.1;
      sparkPositions[i * 3 + 2] = -Math.random() * FIELD_DEPTH + 4;
      sparkColors[i * 3] = C_GLOW.r;
      sparkColors[i * 3 + 1] = C_GLOW.g;
      sparkColors[i * 3 + 2] = C_GLOW.b;
      sparkSizes[i] = 0.6;
      sparkAlphas[i] = 0;
      sparkVel[i * 3] = 0;
      sparkVel[i * 3 + 1] = 0;
      sparkVel[i * 3 + 2] = 0;
      sparkAges[i] = 1;
      sparkLife[i] = 1;
    }

    const sparksGeo = new BufferGeometry();
    const spPos = new BufferAttribute(sparkPositions, 3);
    const spCol = new BufferAttribute(sparkColors, 3);
    const spSize = new BufferAttribute(sparkSizes, 1);
    const spAlpha = new BufferAttribute(sparkAlphas, 1);
    spPos.setUsage(DynamicDrawUsage);
    spCol.setUsage(DynamicDrawUsage);
    spSize.setUsage(DynamicDrawUsage);
    spAlpha.setUsage(DynamicDrawUsage);
    sparksGeo.setAttribute("position", spPos);
    sparksGeo.setAttribute("color", spCol);
    sparksGeo.setAttribute("aSize", spSize);
    sparksGeo.setAttribute("aAlpha", spAlpha);

    const sparksMat = new ShaderMaterial({
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
      uniforms: { uGlow: { value: 0.2 } },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uGlow;
        void main() {
          vColor = color;
          vAlpha = aAlpha * (0.55 + uGlow);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * (120.0 / max(1.0, -mv.z)), 0.5, 6.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord * 2.0 - 1.0;
          float d = length(uv);
          float halo = smoothstep(1.0, 0.0, d);
          float core = smoothstep(0.28, 0.0, d) * 0.92;
          gl_FragColor = vec4(vColor, (halo + core) * vAlpha);
        }
      `,
    });
    group.add(new Points(sparksGeo, sparksMat));

    const floatPositions = new Float32Array(FLOAT_COUNT * 3);
    const floatColors = new Float32Array(FLOAT_COUNT * 3);
    const floatSizes = new Float32Array(FLOAT_COUNT);
    const floatDrift = new Float32Array(FLOAT_COUNT * 3);

    for (let i = 0; i < FLOAT_COUNT; i++) {
      floatPositions[i * 3] = (Math.random() - 0.5) * FIELD_WIDTH * 1.1;
      floatPositions[i * 3 + 1] = 1 + Math.random() * 5;
      floatPositions[i * 3 + 2] = -Math.random() * FIELD_DEPTH * 0.9 + 2;
      floatDrift[i * 3] = (Math.random() - 0.5) * 0.01;
      floatDrift[i * 3 + 1] = 0.002 + Math.random() * 0.004;
      floatDrift[i * 3 + 2] = (Math.random() - 0.5) * 0.012;
      floatSizes[i] = 0.35 + Math.random() * 0.85;
      floatColors[i * 3] = C_GLOW.r;
      floatColors[i * 3 + 1] = C_GLOW.g;
      floatColors[i * 3 + 2] = C_GLOW.b;
    }

    const floatsGeo = new BufferGeometry();
    const fp = new BufferAttribute(floatPositions, 3);
    const fc = new BufferAttribute(floatColors, 3);
    const fs = new BufferAttribute(floatSizes, 1);
    fp.setUsage(DynamicDrawUsage);
    fc.setUsage(DynamicDrawUsage);
    fs.setUsage(DynamicDrawUsage);
    floatsGeo.setAttribute("position", fp);
    floatsGeo.setAttribute("color", fc);
    floatsGeo.setAttribute("aSize", fs);

    const floatsMat = new ShaderMaterial({
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
      uniforms: { uFade: { value: 0.25 } },
      vertexShader: `
        attribute float aSize;
        varying vec3 vColor;
        varying float vFade;
        uniform float uFade;
        void main() {
          vColor = color;
          vFade = uFade;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * (96.0 / max(1.0, -mv.z)), 0.35, 3.4);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vFade;
        void main() {
          vec2 uv = gl_PointCoord * 2.0 - 1.0;
          float d = length(uv);
          float halo = smoothstep(1.0, 0.0, d);
          gl_FragColor = vec4(vColor, halo * vFade);
        }
      `,
    });

    group.add(new Points(floatsGeo, floatsMat));

    oceanRef.current = {
      layers,
      sparks: {
        positions: sparkPositions,
        colors: sparkColors,
        sizes: sparkSizes,
        alphas: sparkAlphas,
        vel: sparkVel,
        ages: sparkAges,
        life: sparkLife,
        geo: sparksGeo,
        mat: sparksMat,
      },
      floats: {
        positions: floatPositions,
        colors: floatColors,
        sizes: floatSizes,
        drift: floatDrift,
        geo: floatsGeo,
        mat: floatsMat,
      },
    };

    return () => {
      const ocean = oceanRef.current;
      if (!ocean) return;
      for (const layer of ocean.layers) {
        layer.pointsGeo.dispose();
        layer.pointsMat.dispose();
        for (const line of layer.lines) {
          line.geo.dispose();
          line.mat.dispose();
        }
      }
      ocean.sparks.geo.dispose();
      ocean.sparks.mat.dispose();
      ocean.floats.geo.dispose();
      ocean.floats.mat.dispose();
      group.clear();
      oceanRef.current = null;
    };
  }, []);

  useFrame((_, delta) => {
    const ocean = oceanRef.current;
    if (!ocean) return;
    frameRef.current += 1;

    const dt = Math.min(0.04, delta);
    const t = performance.now() * 0.001;

    const s = smoothRef.current;
    const m = modeRef.current;
    const micOn = AUDIO.active;
    m.presence += ((micOn ? 1 : 0) - m.presence) * (micOn ? 0.09 : 0.05);

    const gate = gateRef.current;
    const rawSignal = micOn ? clamp01(AUDIO.energy * 0.9 + AUDIO.peak * 0.68) : 0;
    if (micOn) {
      const floorTarget = rawSignal * 0.72 + 0.003;
      const floorLerp = rawSignal < gate.floor * 1.2 ? 0.1 : 0.02;
      gate.floor += (floorTarget - gate.floor) * floorLerp;
    } else {
      gate.floor += (0.012 - gate.floor) * 0.06;
    }
    gate.floor = Math.max(0.004, Math.min(0.045, gate.floor));

    const gatedSignal = Math.max(0, rawSignal - gate.floor * 1.15);
    const audioGate = audioGateRef.current;
    if (micOn && !audioGate.prevMicOn) audioGate.micOnAt = t;
    audioGate.prevMicOn = micOn;
    const micOnAge = micOn ? t - audioGate.micOnAt : 0;
    const detectedTarget = micOn ? smoothstep(0.012, 0.115, gatedSignal + AUDIO.mid * 0.06 + AUDIO.bass * 0.04) : 0;
    const loudTarget = micOn ? smoothstep(0.03, 0.32, gatedSignal * 2.0 + AUDIO.peak * 0.34) : 0;
    const voiceTarget = micOn ? smoothstep(0.014, 0.18, gatedSignal + AUDIO.peak * 0.12 + AUDIO.energy * 0.08) : 0;
    m.activity += (detectedTarget - m.activity) * (detectedTarget > m.activity ? 0.115 : 0.048);
    m.loud += (loudTarget - m.loud) * (loudTarget > m.loud ? 0.095 : 0.045);
    m.engage += (voiceTarget - m.engage) * (voiceTarget > m.engage ? 0.105 : 0.042);
    const volumeTarget = micOn
      ? smoothstep(0.01, 0.34, gatedSignal * 2.35 + AUDIO.peak * 0.26 + AUDIO.energy * 0.12)
      : 0;
    m.volume += (volumeTarget - m.volume) * (volumeTarget > m.volume ? 0.09 : 0.035);
    const dbSignal = micOn
      ? Math.max(1e-4, gatedSignal * 1.2 + AUDIO.energy * 0.18 + AUDIO.peak * 0.08)
      : 1e-4;
    const loudnessDb = micOn ? 20 * Math.log10(dbSignal) : -60;
    const loudnessDbNormRaw = micOn ? smoothstep(LOUDNESS_DB_FLOOR, LOUDNESS_DB_CEIL, loudnessDb) : 0;
    // Keep normal speaking in mid-range and reserve peak height for very loud/yelling speech.
    const loudnessDbNorm = Math.pow(loudnessDbNormRaw, LOUDNESS_CURVE_EXPONENT);
    m.voiceLevel +=
      (loudnessDbNorm - m.voiceLevel) *
      (loudnessDbNorm > m.voiceLevel ? 0.1 : 0.035);
    const voiceLevel = clamp01(m.voiceLevel);
    const waveScaleTarget = micOn
      ? MIN_VOICE_WAVE_SCALE + voiceLevel * (MAX_VOICE_WAVE_SCALE - MIN_VOICE_WAVE_SCALE)
      : 1;
    m.waveScale += (waveScaleTarget - m.waveScale) * (waveScaleTarget > m.waveScale ? 0.1 : 0.03);
    const motionScaleTarget = micOn ? 0.6 + voiceLevel * 1.45 : 1;
    m.motionScale +=
      (motionScaleTarget - m.motionScale) *
      (motionScaleTarget > m.motionScale ? 0.11 : 0.05);

    const response = clamp01(m.activity);
    const loudness = clamp01(m.loud);
    const waveDrive = clamp01(m.engage);
    const volumeStrength = Math.pow(clamp01(m.volume), 1.28);
    const rollActivityRaw = micOn
      ? smoothstep(
          0.08,
          0.92,
          voiceLevel * 1.2 + waveDrive * 0.24 + response * 0.18 + loudness * 0.14 + volumeStrength * 0.4,
        ) * (0.2 + voiceLevel * 0.8)
      : 0;
    const audioPresenceTarget = micOn
      ? smoothstep(0.026, 0.22, gatedSignal + AUDIO.mid * 0.04 + AUDIO.bass * 0.03 + AUDIO.peak * 0.06)
      : 0;
    audioGate.presence +=
      (audioPresenceTarget - audioGate.presence) *
      (audioPresenceTarget > audioGate.presence ? 0.16 : 0.05);
    const audioPresence = clamp01(audioGate.presence);
    const startupGate = micOn ? smoothstep(0.28, 0.72, micOnAge) : 0;
    const rollGate = micOn
      ? smoothstep(0.16, 0.72, audioPresence * 0.82 + volumeStrength * 0.95 + loudness * 0.18) * startupGate
      : 0;
    const rollActivity = rollActivityRaw * rollGate;
    const audioActive = rollActivity > 0.05;
    const peakActive = rollActivity > 0.26;
    const idleOnly = !audioActive;

    const lineStride = !micOn ? 2 : idleOnly ? 2 : peakActive ? 2 : 3;
    const updateLinesThisFrame = frameRef.current % lineStride === 0;

    const activityGate = smoothstep(0, 1, waveDrive * 0.9 + response * 0.1);
    s.energy += (((micOn ? AUDIO.energy : 0) * activityGate) - s.energy) * 0.12;
    s.bass += (((micOn ? AUDIO.bass : 0) * activityGate) - s.bass) * 0.1;
    s.mid += (((micOn ? AUDIO.mid : 0) * activityGate) - s.mid) * 0.11;
    s.high += (((micOn ? AUDIO.high : 0) * activityGate) - s.high) * 0.12;
    s.peak += (((micOn ? AUDIO.peak : 0) * activityGate) - s.peak) * 0.15;

    const energy = s.energy;
    const bass = 0.05 + s.bass * 0.95;
    const mid = 0.05 + s.mid * 0.95;
    const high = 0.04 + s.high * 0.96;
    const peak = s.peak;

    const roll = rollRef.current;
    const targetRollSpeed =
      rollActivity *
      (0.00085 + waveDrive * 0.0038 + volumeStrength * 0.015 + loudness * 0.004 + energy * 0.0032) *
      m.motionScale;
    roll.speed += (targetRollSpeed - roll.speed) * (audioActive ? 0.14 : 0.008);
    if (roll.speed < 0.00002) roll.speed = 0;
    // Keep a subtle baseline movement so calm states never feel frozen.
    const targetDrift = !micOn ? 0.0038 : audioActive ? 0.00022 : 0.00009;
    roll.drift += (targetDrift - roll.drift) * (!micOn ? 0.08 : 0.05);
    roll.offset += (roll.speed + roll.drift) * (dt * 60);

    const globalShimmer = clamp01(
      (!micOn ? 0.7 : 0.12) +
        (1 - response) * 0.13 +
        response * 0.32 +
        loudness * 0.3 +
        peak * 0.18,
    );
    const lowDrive = bass * (0.26 + waveDrive * 0.9 + loudness * 0.7);
    const midDrive = mid * (0.24 + waveDrive * 0.78 + loudness * 0.56);
    const highDrive = high * (0.2 + waveDrive * 0.68 + loudness * 0.5);

    const tmp = new Color();
    const { a } = phaseRef.current;

    for (let li = 0; li < ocean.layers.length; li++) {
      const layer = ocean.layers[li];
      const layerTime = t * (1 + li * 0.1);
      const distanceFade = 1 - li / Math.max(1, ocean.layers.length - 1);
      // Calm baseline (pre-mic + silence) stays mostly flat/subtle; audio progressively grows topology.
      const calmScale = !micOn ? 0.26 : 0.04;
      const activeScale = 2.22;
      const topologyTarget =
        micOn && audioPresence > 0.05
          ? smoothstep(0.04, 1, voiceLevel) * (0.2 + rollActivity * 0.8)
          : 0;
      topologyRef.current +=
        (topologyTarget - topologyRef.current) *
        (topologyTarget > topologyRef.current ? 0.085 : 0.014);
      const ambientScale = calmScale + (activeScale - calmScale) * topologyRef.current;
      const loudCurve = Math.pow(clamp01(volumeStrength), 1.06);
      const audioAmp = (0.05 + volumeStrength * 1.04 + energy * 0.26) * layer.amp * rollActivity;
      const rollShift = roll.offset * (0.44 + li * 0.07);
      const activeBlend = rollActivity;
      const idleBlend = 1 - activeBlend;
      const usePeakShape = (peakActive || audioActive) && li === 0;

      const broadRuntime = usePeakShape
        ? BROAD_WAVES.map((w: BroadWave, wi) => {
            const e1: Emitter = EMITTERS[(wi + li * 2) % EMITTERS.length];
            const e2: Emitter = EMITTERS[(wi + li * 3 + 2) % EMITTERS.length];
            const speedMul = 0.74 + loudness * 1.15 + li * 0.05;
            return {
              w,
              wi,
              speedMul,
              bandBias: 0.5 + 0.5 * Math.sin(layerTime * (0.12 + wi * 0.02) + w.phase * 1.6 + li * 0.7),
              e1x: e1.ox + Math.sin(layerTime * e1.speed + e1.phase) * 0.2,
              e1z: e1.oz + Math.cos(layerTime * (e1.speed * 0.84) + e1.phase * 1.1) * 0.2,
              e2x: e2.ox + Math.cos(layerTime * e2.speed + e2.phase) * 0.18,
              e2z: e2.oz + Math.sin(layerTime * (e2.speed * 0.86) + e2.phase) * 0.18,
            };
          })
        : null;

      const midRuntime = usePeakShape
        ? MID_WAVES.map((w: MidWave, mi) => {
            const e: Emitter = EMITTERS[(mi * 2 + li + 1) % EMITTERS.length];
            const speedMul = 0.8 + loudness * 0.9;
            return {
              w,
              mi,
              speedMul,
              bandBias: 0.5 + 0.5 * Math.sin(layerTime * (0.16 + mi * 0.03) + w.phase * 1.5 + li * 0.5),
              ex: e.ox + Math.cos(layerTime * e.speed + e.phase) * 0.18,
              ez: e.oz + Math.sin(layerTime * (e.speed * 0.92) + e.phase * 1.03) * 0.17,
              radius: e.radius,
            };
          })
        : null;

      const emitterRuntime = usePeakShape
        ? EMITTERS.map((e: Emitter) => ({
            e,
            ex: e.ox + Math.sin(layerTime * (e.speed * 0.8) + e.phase) * 0.22,
            ez: e.oz + Math.cos(layerTime * (e.speed * 0.74) + e.phase * 1.1) * 0.18,
          }))
        : null;

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          const xn = c / (COLS - 1);
          const zn = r / (ROWS - 1);
          const x = (xn - 0.5) * FIELD_WIDTH;
          const z = -zn * FIELD_DEPTH + 6 + layer.zShift;
          const xw = x / (FIELD_WIDTH * 0.5);
          const zw = zn * 2 - 1 + li * 0.28;
          layer.positions[i * 3] = x;
          layer.positions[i * 3 + 2] = z;
          const baseY = -0.03 - li * 0.05;
          const ridge1 = Math.sin(x * 0.38 - roll.offset) * Math.sin(z * 0.18 + roll.offset * 0.55);
          const ridge2 = Math.sin(x * 0.22 - roll.offset * 1.3 + 1.4) * Math.sin(z * 0.28 + roll.offset * 0.7);
          const micro =
            Math.sin(x * 0.9 - roll.offset * 2.1) * Math.sin(z * 0.7 + roll.offset * 1.4) * 0.15;
          const ambientWave = ridge1 * 0.62 + ridge2 * 0.38 + micro;

          let audioWave = 0;
          const useLegacyAudioSculpt = false;
          if (useLegacyAudioSculpt && activeBlend > 0.01) {
            const xr =
              xw -
              rollShift +
              Math.sin(layerTime * (0.12 + li * 0.03) + zw * 0.9) * idleBlend * 0.08;
            const zr =
              zw +
              rollShift * 0.16 +
              Math.cos(layerTime * (0.1 + li * 0.02) + xw * 1.1) * idleBlend * 0.06;
            const regionHash = Math.sin((xw * 17.13 + zw * 23.91 + li * 3.7) * 12.9898) * 43758.5453;
            const regionRand = 0.68 + (regionHash - Math.floor(regionHash)) * 0.74;

            if (usePeakShape && broadRuntime && midRuntime && emitterRuntime) {
              let broad = 0;
              let audioBroad = 0;
              for (let bi = 0; bi < broadRuntime.length; bi++) {
                const state = broadRuntime[bi];
                const { w, wi, speedMul, bandBias, e1x, e1z, e2x, e2z } = state;
                const q = xr * w.nx + zr * w.nz;
                const phase =
                  q * TAU * w.freq * 30 -
                  layerTime * (w.speed * speedMul) +
                  w.phase +
                  a * 0.2;
                const comp =
                  Math.sin(phase) +
                  Math.sin(phase * 0.58 + w.phase * 1.5 + li * 0.35) * 0.3 +
                  Math.sin(phase * 0.36 + wi * 1.2) * 0.1;

                const d1x = xr - e1x;
                const d1z = zr - e1z;
                const d2x = xr - e2x;
                const d2z = zr - e2z;
                const f1 = Math.exp(-(d1x * d1x + d1z * d1z) / 0.034);
                const f2 = Math.exp(-(d2x * d2x + d2z * d2z) / 0.034);
                const travel = Math.sin(
                  (xr * w.nz + zr * w.nx) * TAU * 0.4 - layerTime * (w.speed * 1.7 * speedMul) + w.phase,
                );

                const packet =
                  Math.sin(
                    (xr * (0.34 + wi * 0.06) + zr * (0.22 - wi * 0.03)) * TAU -
                      layerTime * (0.16 + wi * 0.03) +
                      w.phase,
                  ) *
                    0.5 +
                  0.5;
                const bandLocal = clamp01(packet * 0.72 + f1 * 0.42 - f2 * 0.18);
                const bandBase =
                  (wi < 2
                    ? lowDrive * 1.24
                    : wi < 4
                      ? midDrive * 1.1
                      : lowDrive * 0.62 + midDrive * 0.5) * (0.34 + bandLocal * 0.92);
                const delta = bandBase * (0.3 + bandBias * 0.7) * ((f1 - f2) * 1.02 + travel * 0.28) * 0.5;

                broad += comp * w.amp;
                audioBroad += comp * w.amp * delta;
              }

              let midField = 0;
              let audioMid = 0;
              for (let mi = 0; mi < midRuntime.length; mi++) {
                const state = midRuntime[mi];
                const { w, speedMul, bandBias, ex, ez, radius } = state;
                const q = xr * w.nx + zr * w.nz;
                const phase = q * TAU * w.freq * 22 - layerTime * (w.speed * speedMul) + w.phase;
                const comp = Math.sin(phase) + Math.sin(phase * 0.66 + w.phase * 1.3) * 0.26;

                const dx = xr - ex;
                const dz = zr - ez;
                const falloff = Math.exp(-(dx * dx + dz * dz) / ((radius * 0.6) * (radius * 0.6)));
                const detail = Math.sin(
                  (xr * w.nz + zr * w.nx) * TAU * 0.58 - layerTime * (w.speed * 1.42 * speedMul) + w.phase,
                );

                const packet =
                  Math.sin(
                    (xr * (0.26 + mi * 0.08) + zr * (0.4 - mi * 0.05)) * TAU -
                      layerTime * (0.18 + mi * 0.03) +
                      w.phase,
                  ) *
                    0.5 +
                  0.5;
                const bandLocal = clamp01(packet * 0.7 + falloff * 0.46);
                const delta =
                  (midDrive * 0.95 + highDrive * 0.9) *
                  (0.24 + bandBias * 0.44 + bandLocal * 0.72) *
                  ((falloff - 0.36) * 0.96 + detail * 0.34) *
                  0.42;

                midField += comp * w.amp;
                audioMid += comp * w.amp * delta;
              }

              let localEnergy = 0;
              let audioDrive = 0;
              for (let ei = 0; ei < emitterRuntime.length; ei++) {
                const state = emitterRuntime[ei];
                const { e, ex, ez } = state;
                const dx = xr - ex;
                const dz = zr - ez;
                const d2 = dx * dx + dz * dz;
                const falloff = Math.exp(-d2 / ((e.radius * 0.8) * (e.radius * 0.8)));
                const travel = (dx * 0.48 + dz * 0.6) * TAU - layerTime * (e.speed + 0.08) + e.phase;
                localEnergy += falloff;
                audioDrive +=
                  falloff * Math.sin(travel * 0.86 + 0.45) * (0.02 + highDrive * 0.28 + peak * 0.12);
              }
              localEnergy = clamp01(localEnergy * 0.42);

              const packetA = Math.sin((xr * 0.64 + zr * 0.36) * TAU - layerTime * 0.28 + li * 0.7) * 0.5 + 0.5;
              const packetB = Math.sin((xr * -0.48 + zr * 0.26) * TAU - layerTime * 0.22 + li * 0.4) * 0.5 + 0.5;
              const packetC = Math.sin((xr * 0.28 - zr * 0.58) * TAU - layerTime * 0.2 + li * 0.9) * 0.5 + 0.5;
              const packetD = Math.sin((xr * -0.34 + zr * -0.18) * TAU - layerTime * 0.25 + li * 0.6) * 0.5 + 0.5;
              const packetField = clamp01(packetA * 0.42 + packetB * 0.28 + packetC * 0.24 + packetD * 0.22 - 0.18);
              const localAudioField = clamp01(localEnergy * 0.52 + packetField * 0.76);

              const depthBand = 0.88 + 0.18 * Math.sin(zn * Math.PI * 0.52 + li * 0.42);
              const terrainVariance =
                0.62 +
                0.24 * Math.sin((xr * 0.34 + zr * 0.24) * TAU + a * 0.2 + li * 0.3) +
                0.18 * Math.sin((xr * -0.22 + zr * 0.4) * TAU + li * 0.2);
              const majorSwellA = Math.sin((xr * 0.92 + zr * 0.34) * TAU * 1.04 - layerTime * 0.2 + li * 0.74);
              const majorSwellB = Math.sin((xr * -0.62 + zr * 0.48) * TAU * 0.94 - layerTime * 0.17 + li * 0.52 + 1.1);
              const majorSwellC = Math.sin((xr * 0.34 - zr * 0.82) * TAU * 0.82 - layerTime * 0.14 + li * 0.4 + 2.0);
              const driftSwell =
                Math.sin((xr * 0.22 + zr * 0.26) * TAU * 0.66 - layerTime * 0.11 + li * 0.3) +
                Math.sin((xr * -0.17 + zr * 0.31) * TAU * 0.54 - layerTime * 0.085 + li * 0.47) * 0.62;
              const backFamily =
                Math.sin((xr * 0.24 + zr * 0.9) * TAU - layerTime * 0.1 + li * 0.86) * 0.36 +
                Math.sin((xr * -0.16 + zr * 0.72) * TAU - layerTime * 0.09 + li * 0.62) * 0.3;
              const tideRoll =
                Math.sin((xr * 0.12 + zr * 0.86) * TAU - layerTime * 0.12 + li * 0.28) * 0.56 +
                Math.sin((xr * -0.08 + zr * 0.64) * TAU - layerTime * 0.09 + li * 0.44) * 0.3;
              const baseWave =
                majorSwellA * 0.96 +
                majorSwellB * 0.8 +
                majorSwellC * 0.62 +
                driftSwell * 0.38 +
                broad * 0.4 +
                midField * 0.26 +
                backFamily * 0.88;
              const audioField =
                (audioBroad * 0.78 + audioMid * 1.02 + audioDrive * (0.3 + localAudioField * 0.54)) * depthBand;
              const mountainField =
                Math.max(0, majorSwellA) * 0.64 +
                Math.max(0, majorSwellB) * 0.54 +
                Math.max(0, majorSwellC) * 0.44;
              const rippleTopA = Math.max(0, Math.sin((xr * 1.38 + zr * 0.52) * TAU - layerTime * 0.56 + li * 0.7));
              const rippleTopB = Math.max(0, Math.sin((xr * -1.14 + zr * 0.68) * TAU - layerTime * 0.5 + li * 0.9 + 1.1));
              const rippleTopC = Math.max(0, Math.sin((xr * 0.94 - zr * 1.16) * TAU - layerTime * 0.46 + li * 0.5 + 2.0));
              const rippleTopD = Math.max(0, Math.sin((xr * -0.8 - zr * 0.98) * TAU - layerTime * 0.41 + li * 0.8 + 0.6));
              const rippleCanyon =
                Math.max(0, Math.sin((xr * 0.94 + zr * 0.84) * TAU - layerTime * 0.36 + li * 0.6 + 2.7)) * 0.64 +
                Math.max(0, Math.sin((xr * -0.66 + zr * 1.12) * TAU - layerTime * 0.31 + li * 0.4 + 1.9)) * 0.44;
              const myriadTops =
                (rippleTopA * 0.58 + rippleTopB * 0.52 + rippleTopC * 0.49 + rippleTopD * 0.44) - rippleCanyon * 0.24;
              const pointedTops = Math.pow(Math.max(0, myriadTops), 1.48);
              const thickShoulder = Math.pow(Math.max(0, myriadTops), 0.92);
              const peakMask = Math.pow(clamp01((regionRand - 0.72) / 0.32), 1.42);
              const peakVariance = Math.pow(clamp01((regionRand - 0.55) / 0.4), 1.12);
              const audioEnvelope = clamp01(localAudioField * 0.9 + packetField * 0.42);
              const peakShape = Math.pow(Math.max(0, baseWave), 1.8);
              const canyonShape = Math.pow(Math.max(0, -baseWave), 1.42);
              const sculpted = peakShape * (0.42 + audioEnvelope * 0.88) - canyonShape * (0.3 + audioEnvelope * 0.66);

              const baseAmp =
                (0.044 + terrainVariance * 0.04) * (0.84 + waveDrive * 0.74 + loudness * 0.42) * layer.amp;
              const topoAmp =
                (0.064 + localAudioField * (0.3 + loudCurve * 0.44) + loudCurve * 0.24) * layer.amp;
              const peakLift =
                mountainField *
                (0.052 + localAudioField * 0.2 + loudCurve * 0.2) *
                (0.9 + regionRand * 0.62);
              const spikeLift =
                pointedTops *
                  (0.02 + localAudioField * 0.18 + loudCurve * 0.15 + waveDrive * 0.11) *
                  (0.44 + regionRand * 0.54 + peakMask * 1.62 + peakVariance * 1.34) +
                thickShoulder *
                  (0.02 + localAudioField * 0.2 + loudCurve * 0.16 + waveDrive * 0.1) *
                  (0.58 + regionRand * 0.7 + peakMask * 1.28 + peakVariance * 1.18);
              const driftLift = driftSwell * (0.012 + (1 - response) * 0.045) * idleBlend;
              const tideLift = tideRoll * (0.018 + waveDrive * 0.06);

              audioWave =
                (baseWave * baseAmp +
                  audioField * topoAmp +
                  peakLift +
                  spikeLift +
                  sculpted * (0.038 + localAudioField * 0.24 + loudness * 0.2) +
                  driftLift +
                  tideLift) *
                activeBlend;
            } else {
              const primary = Math.sin((zr * 1.08 + xr * 0.56) * TAU - layerTime * (0.42 + loudness * 0.9) + li * 0.4);
              const secondary = Math.sin((zr * 0.78 - xr * 0.94) * TAU - layerTime * (0.34 + loudness * 0.68) + li * 0.7);
              const chop = Math.sin((zr * 2.12 + xr * 1.64) * TAU - layerTime * (0.84 + loudness * 1.22) + li * 0.3);
              audioWave =
                (primary * (0.54 + lowDrive * 0.12) +
                  secondary * (0.36 + midDrive * 0.08) +
                  chop * (0.18 + highDrive * 0.06)) *
                audioAmp *
                (0.72 + activeBlend * 0.28);
            }
          }

          const bandW1 = 0.5 + 0.5 * Math.sin((xw * 1.62 + zw * 0.97 + li * 0.43) * TAU);
          const bandW2 = 0.5 + 0.5 * Math.sin((xw * -1.14 + zw * 1.28 + li * 0.61 + 1.3) * TAU);
          const bandW3 = 0.5 + 0.5 * Math.sin((xw * 0.88 - zw * 1.44 + li * 0.37 + 2.2) * TAU);
          const bandMix = (bandW1 * bass + bandW2 * mid + bandW3 * high) / (bandW1 + bandW2 + bandW3 + 1e-6);
          const bandNorm = clamp01((bandMix - 0.04) / 0.92);
          const bandVariance = 0.72 + bandNorm * 0.56;
          const localWaveScale = micOn
            ? Math.min(MAX_VOICE_WAVE_SCALE, Math.max(0.02, m.waveScale * bandVariance))
            : 1;
          const yTarget = baseY + ambientWave * ambientScale * localWaveScale;
          const yPrev = layer.positions[i * 3 + 1];
          const followBase = !micOn ? 0.205 : audioActive ? 0.27 + waveDrive * 0.09 : 0.082;
          const follow = Math.min(0.28, followBase * (dt * 60));
          const y = yPrev + (yTarget - yPrev) * follow;
          layer.positions[i * 3 + 1] = y;

          const rise = y - layer.prevY[i];
          const prevRise = layer.prevRise[i];
          layer.prevY[i] = y;
          layer.prevRise[i] = rise;
          const motion = Math.abs(rise);
          const calmState = !micOn || !audioActive;
          const ambientPulse = calmState
            ? 0.58 + 0.46 * Math.sin(t * 0.72 + li * 0.4 + zn * 2.2)
            : 0.22 + 0.16 * idleBlend;
          const bright = clamp01(
            (calmState ? 0.62 : 0.26) +
              (1 - zn) * 0.32 +
              motion * (audioActive ? 176 : 30) +
              loudness * 0.5 +
              ambientPulse * 0.12,
          );
          const crest = clamp01(
            motion * 220 +
              Math.max(0, rise - prevRise * 0.38) * 320 +
              loudness * 0.42 +
              activeBlend * 0.2 +
              waveDrive * 0.2,
          );
          const activeWaveGlowDim = micOn && audioActive ? 0.62 : 1;

          tmp.copy(C_DEEP);
          tmp.lerp(C_BASE, calmState ? 0.92 : 0.75);
          tmp.lerp(
            C_GLOW,
            ((calmState ? 0.39 : 0.34) + bright * (audioActive ? 0.5 : 0.36) + crest * 0.16) *
              activeWaveGlowDim,
          );
          tmp.lerp(
            C_HIGHLIGHT,
            (bright * (audioActive ? 0.68 : 0.47) + crest * 0.35) * activeWaveGlowDim,
          );
          tmp.lerp(C_CORE, bright * (audioActive ? 0.3 : 0.2) + peak * 0.1 + crest * 0.18);
          tmp.multiplyScalar((calmState ? 1.14 : 1.0) * (1.02 + (1 - zn) * 0.54) * layer.alpha);

          layer.colors[i * 3] = tmp.r;
          layer.colors[i * 3 + 1] = tmp.g;
          layer.colors[i * 3 + 2] = tmp.b;
          const foregroundBoost = 1 + Math.pow(1 - zn, 1.7) * 0.58;
          layer.sizes[i] =
            (0.64 + bright * (audioActive ? 1.42 : 0.86 + globalShimmer * 0.45)) *
            (0.88 + (1 - zn) * 0.22) *
            layer.glow *
            foregroundBoost *
            (1 + crest * (audioActive ? 0.9 : 0.2));

          const crestWindow = rise > 0.0006 && rise < Math.max(0.0034, prevRise * 0.92);
          if (
            micOn &&
            audioActive &&
            li === 0 &&
            crestWindow &&
            ambientWave > 0.28 &&
            Math.random() < 0.0012 + volumeStrength * 0.0042 + loudness * 0.0016
          ) {
            const sparks = ocean.sparks;
            const slot = sparkCursorRef.current;
            sparkCursorRef.current = (sparkCursorRef.current + 1) % SPARK_COUNT;
            const s3 = slot * 3;
            sparks.positions[s3] = x;
            sparks.positions[s3 + 1] = y + 0.04;
            sparks.positions[s3 + 2] = z;
            sparks.vel[s3] = 0;
            sparks.vel[s3 + 1] = 0.1 + Math.random() * 0.08;
            sparks.vel[s3 + 2] = 0;
            sparks.ages[slot] = 0;
            sparks.life[slot] = 90 + Math.random() * 70;
            sparks.sizes[slot] = 1.2 + Math.random() * 1.6;
            sparks.alphas[slot] = 1;
            tmp.copy(C_GLOW).lerp(C_HIGHLIGHT, Math.random());
            sparks.colors[s3] = tmp.r;
            sparks.colors[s3 + 1] = tmp.g;
            sparks.colors[s3 + 2] = tmp.b;
          }
        }
      }

      if (updateLinesThisFrame) {
        for (let li2 = 0; li2 < layer.lines.length; li2++) {
          const line = layer.lines[li2];
          const row = line.row;
          for (let c = 0; c < COLS; c++) {
            const src = row * COLS + c;
            line.positions[c * 3] = layer.positions[src * 3];
            line.positions[c * 3 + 1] = layer.positions[src * 3 + 1];
            line.positions[c * 3 + 2] = layer.positions[src * 3 + 2];
            line.colors[c * 3] = layer.colors[src * 3];
            line.colors[c * 3 + 1] = layer.colors[src * 3 + 1];
            line.colors[c * 3 + 2] = layer.colors[src * 3 + 2];
          }
          (line.geo.attributes.position as BufferAttribute).needsUpdate = true;
          (line.geo.attributes.color as BufferAttribute).needsUpdate = true;
          line.mat.opacity =
            (0.075 + globalShimmer * 0.14 + loudness * 0.18 + activeBlend * 0.08) *
            layer.alpha *
            (0.72 + distanceFade * 0.48) *
            (micOn && audioActive ? 0.72 : 1);
        }
      }

      (layer.pointsGeo.attributes.position as BufferAttribute).needsUpdate = true;
      (layer.pointsGeo.attributes.color as BufferAttribute).needsUpdate = true;
      (layer.pointsGeo.attributes.aSize as BufferAttribute).needsUpdate = true;
      layer.pointsMat.uniforms.uFade.value =
        (0.58 + globalShimmer * 0.26 + loudness * 0.2 + peak * 0.1) *
        layer.alpha *
        (0.74 + distanceFade * 0.56) *
        (micOn && audioActive ? 0.68 : 1);
    }

    const sparks = ocean.sparks;
    const frameScale = dt * 60;
    for (let i = 0; i < SPARK_COUNT; i++) {
      sparks.ages[i] += frameScale;
      if (sparks.ages[i] >= sparks.life[i]) {
        sparks.alphas[i] = 0;
        continue;
      }
      const framesLeft = sparks.life[i] - sparks.ages[i];
      const alpha = framesLeft <= 40 ? clamp01(framesLeft / 40) : 1;
      const i3 = i * 3;
      sparks.positions[i3] += (Math.random() * 0.024 - 0.012) * frameScale;
      sparks.positions[i3 + 1] += sparks.vel[i3 + 1] * frameScale;
      sparks.positions[i3 + 2] += (Math.random() * 0.024 - 0.012) * frameScale;
      sparks.alphas[i] = alpha;
    }
    (sparks.geo.attributes.position as BufferAttribute).needsUpdate = true;
    (sparks.geo.attributes.color as BufferAttribute).needsUpdate = true;
    (sparks.geo.attributes.aSize as BufferAttribute).needsUpdate = true;
    (sparks.geo.attributes.aAlpha as BufferAttribute).needsUpdate = true;
    sparks.mat.uniforms.uGlow.value = 0.28 + response * 0.3 + loudness * 0.42;

    const floats = ocean.floats;
    for (let i = 0; i < FLOAT_COUNT; i++) {
      const i3 = i * 3;
      const driftMul = !micOn ? 1 : audioActive ? 0.9 : 0.55;
      floats.positions[i3] += floats.drift[i3] * (dt * 60) * driftMul;
      floats.positions[i3 + 1] += floats.drift[i3 + 1] * (dt * 60) * driftMul;
      floats.positions[i3 + 2] += floats.drift[i3 + 2] * (dt * 60) * driftMul;
      if (floats.positions[i3 + 1] > 6.5) {
        floats.positions[i3] = (Math.random() - 0.5) * FIELD_WIDTH * 1.1;
        floats.positions[i3 + 1] = 0.8 + Math.random() * 0.8;
        floats.positions[i3 + 2] = -Math.random() * FIELD_DEPTH * 0.9 + 2;
      }
      if (Math.abs(floats.positions[i3]) > FIELD_WIDTH * 0.62) floats.drift[i3] *= -1;
      if (floats.positions[i3 + 2] > 5 || floats.positions[i3 + 2] < -FIELD_DEPTH) floats.drift[i3 + 2] *= -1;
    }
    (floats.geo.attributes.position as BufferAttribute).needsUpdate = true;
    floats.mat.uniforms.uFade.value = !micOn || !audioActive ? 0.28 : 0.2 + response * 0.16 + loudness * 0.2;

    if (groupRef.current) {
      groupRef.current.position.y = -0.32;
      groupRef.current.rotation.x = -0.31;
      groupRef.current.rotation.y = 0;
    }
  });

  return <group ref={groupRef} />;
}

function Scene() {
  return (
    <>
      <fog attach="fog" args={["#081120", 8, 66]} />
      <OrbitControls
        enableRotate
        enablePan
        enableZoom
        target={[0, -0.62, -24]}
        minDistance={8}
        maxDistance={38}
        rotateSpeed={0.48}
        panSpeed={0.68}
        zoomSpeed={0.64}
      />
      <OceanField />
    </>
  );
}

export default function VoiceTest4Page() {
  const audio = useAudioAnalysis();
  const micOn = audio.active;
  const atmosphere = micOn ? 1 : 0.14;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        left: "var(--sidebar-width, 240px)",
        backgroundColor: "#03060D",
        overflow: "hidden",
      }}
    >
      <style>
        {`
          @keyframes waveform-airflow-a {
            0% { transform: translate3d(-1.0%, -0.7%, 0) scale(1.0); }
            50% { transform: translate3d(0.9%, 0.8%, 0) scale(1.03); }
            100% { transform: translate3d(-1.0%, -0.7%, 0) scale(1.0); }
          }
          @keyframes waveform-airflow-b {
            0% { transform: translate3d(0.7%, 0.5%, 0) scale(1.0); }
            50% { transform: translate3d(-0.8%, -0.6%, 0) scale(1.025); }
            100% { transform: translate3d(0.7%, 0.5%, 0) scale(1.0); }
          }
          @keyframes waveform-airflow-c {
            0% { transform: translate3d(0, 0, 0) scale(1.0); }
            50% { transform: translate3d(0.6%, -0.4%, 0) scale(1.018); }
            100% { transform: translate3d(0, 0, 0) scale(1.0); }
          }
        `}
      </style>

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `
            radial-gradient(140% 92% at 50% -10%, rgba(11,42,91,0.22) 0%, rgba(11,42,91,0.10) 30%, rgba(3,6,13,0) 68%),
            radial-gradient(120% 84% at 50% 8%, rgba(18,61,143,0.16) 0%, rgba(18,61,143,0.07) 34%, rgba(3,6,13,0) 68%),
            radial-gradient(130% 86% at 52% 13%, rgba(31,175,156,0.10) 0%, rgba(31,175,156,0.045) 30%, rgba(3,6,13,0) 66%)
          `,
          opacity: 0.1 + atmosphere * 0.5,
          transition: "opacity 1400ms ease",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: "-16%",
          right: "-16%",
          top: "-36%",
          height: "72%",
          background:
            "radial-gradient(66% 84% at 50% 52%, rgba(111,224,210,0.40) 0%, rgba(31,175,156,0.24) 25%, rgba(18,61,143,0.12) 50%, rgba(3,6,13,0) 79%)",
          filter: "blur(68px)",
          mixBlendMode: "screen",
          opacity: 0.02 + atmosphere * 0.56,
          animation: "waveform-airflow-a 28s ease-in-out infinite",
          transition: "opacity 1600ms ease",
          pointerEvents: "none",
          zIndex: 2,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: "-18%",
          right: "-18%",
          top: "-30%",
          height: "66%",
          background:
            "radial-gradient(58% 76% at 52% 48%, rgba(31,175,156,0.24) 0%, rgba(111,224,210,0.16) 24%, rgba(11,42,91,0.10) 52%, rgba(3,6,13,0) 80%)",
          filter: "blur(78px)",
          mixBlendMode: "screen",
          opacity: 0.014 + atmosphere * 0.4,
          animation: "waveform-airflow-b 34s ease-in-out infinite",
          transition: "opacity 1700ms ease",
          pointerEvents: "none",
          zIndex: 2,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: "-22%",
          right: "-22%",
          top: "-46%",
          height: "80%",
          background:
            "radial-gradient(72% 92% at 50% 50%, rgba(111,224,210,0.30) 0%, rgba(31,175,156,0.16) 28%, rgba(18,61,143,0.07) 58%, rgba(3,6,13,0) 84%)",
          filter: "blur(106px)",
          mixBlendMode: "screen",
          opacity: 0.01 + atmosphere * 0.32,
          animation: "waveform-airflow-c 44s ease-in-out infinite",
          transition: "opacity 2200ms ease",
          pointerEvents: "none",
          zIndex: 2,
        }}
      />

      <Canvas
        frameloop="always"
        dpr={[0.75, 1]}
        camera={{ position: [0, 3.8, 18.6], fov: 42 }}
        style={{ width: "100%", height: "100%", position: "relative", zIndex: 3 }}
        gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
      >
        <Scene />
      </Canvas>

      <div
        style={{
          position: "absolute",
          right: 20,
          bottom: 18,
          display: "flex",
          alignItems: "center",
          gap: 8,
          zIndex: 4,
        }}
      >
        <button
          onClick={audio.active ? audio.stop : audio.start}
          style={{
            padding: "7px 14px",
            borderRadius: 999,
            border: audio.active ? "1px solid rgba(255,130,130,0.42)" : "1px solid rgba(191,245,239,0.48)",
            background: audio.active ? "rgba(255,100,100,0.12)" : "rgba(143,209,203,0.12)",
            color: audio.active ? "#ffc2c2" : COLORS.highlight,
            fontSize: 10,
            letterSpacing: "0.08em",
            fontWeight: 700,
            cursor: "pointer",
            backdropFilter: "blur(6px)",
          }}
        >
          {audio.active ? "STOP MIC" : "START MIC"}
        </button>
      </div>

      {audio.error && (
        <div
          style={{
            position: "absolute",
            top: 58,
            left: "50%",
            transform: "translateX(-50%)",
            borderRadius: 10,
            border: "1px solid rgba(255,110,110,0.6)",
            background: "rgba(90,8,8,0.9)",
            color: "#ffd7d7",
            fontSize: 12,
            padding: "8px 12px",
          }}
        >
          {audio.error}
        </div>
      )}
    </div>
  );
}
