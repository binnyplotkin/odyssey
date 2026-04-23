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
  highlight: "#D9FFFB",
  core: "#FFFFFF",
  deep: "#041215",
} as const;

const C_BASE = new Color(COLORS.base);
const C_GLOW = new Color(COLORS.glow);
const C_HIGHLIGHT = new Color(COLORS.highlight);
const C_CORE = new Color(COLORS.core);
const C_DEEP = new Color(COLORS.deep);

const FIELD_WIDTH = 54;
const FIELD_DEPTH = 74;
const ROWS = 58;
const COLS = 118;
const TAU = Math.PI * 2;
const LINE_STEP = 3;
const SPARK_COUNT = 520;
const FLOAT_COUNT = 150;

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
          autoGainControl: true,
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
  xBase: Float32Array;
  zBase: Float32Array;
  xNorm: Float32Array;
  zNorm: Float32Array;
  regionRand: Float32Array;
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
  const modeRef = useRef({ activity: 0, loud: 0, presence: 0, engage: 0, idle: 1 });
  const rollRef = useRef({ offset: 0, speed: 0 });
  const phaseRef = useRef({ a: Math.random() * TAU, b: Math.random() * TAU });
  const sparkCursorRef = useRef(0);
  const frameRef = useRef(0);
  const simAccumRef = useRef(0);

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
      const xBase = new Float32Array(count);
      const zBase = new Float32Array(count);
      const xNorm = new Float32Array(count);
      const zNorm = new Float32Array(count);
      const regionRand = new Float32Array(count);

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          const xn = c / (COLS - 1);
          const zn = r / (ROWS - 1);
          const x = (xn - 0.5) * FIELD_WIDTH;
          const z = -zn * FIELD_DEPTH + 4 + cfg.zShift;
          const xw = x / (FIELD_WIDTH * 0.5);
          const zw = zn * 2 - 1 + li * 0.28;
          positions[i * 3] = x;
          positions[i * 3 + 1] = -0.02;
          positions[i * 3 + 2] = z;
          xBase[i] = x;
          zBase[i] = z;
          xNorm[i] = xw;
          zNorm[i] = zw;
          regionRand[i] = 0.68 + (((Math.sin((xw * 17.13 + zw * 23.91 + li * 3.7) * 12.9898) * 43758.5453) % 1 + 1) % 1) * 0.74;
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
        xBase,
        zBase,
        xNorm,
        zNorm,
        regionRand,
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

    // Run the expensive wave simulation at a stable fixed step to avoid
    // bursty CPU spikes when mic is enabled.
    simAccumRef.current += delta;
    const simStep = AUDIO.active ? 1 / 30 : 1 / 24;
    if (simAccumRef.current < simStep) return;

    frameRef.current += 1;
    const updateLinesThisFrame = (frameRef.current & 1) === 0;
    const dt = Math.min(0.05, simAccumRef.current);
    simAccumRef.current = 0;
    const t = performance.now() * 0.001;

    const s = smoothRef.current;
    const m = modeRef.current;
    m.presence += ((AUDIO.active ? 1 : 0) - m.presence) * 0.07;
    m.engage += ((AUDIO.active ? 1 : 0) - m.engage) * (AUDIO.active ? 0.075 : 0.06);
    const activeGate = smoothstep(0, 1, m.engage) ** 1.5;

    s.energy += (((AUDIO.active ? AUDIO.energy : 0) * activeGate) - s.energy) * 0.08;
    s.bass += (((AUDIO.active ? AUDIO.bass : 0) * activeGate) - s.bass) * 0.06;
    s.mid += (((AUDIO.active ? AUDIO.mid : 0) * activeGate) - s.mid) * 0.07;
    s.high += (((AUDIO.active ? AUDIO.high : 0) * activeGate) - s.high) * 0.08;
    s.peak += (((AUDIO.active ? AUDIO.peak : 0) * activeGate) - s.peak) * 0.1;

    const energy = s.energy;
    const bass = 0.05 + s.bass * 0.95;
    const mid = 0.05 + s.mid * 0.95;
    const high = 0.04 + s.high * 0.96;
    const peak = s.peak;

    const detected = smoothstep(0.003, 0.05, energy + peak * 0.26) * activeGate;
    const loudTarget = smoothstep(0.05, 0.22, energy + peak * 0.58) * activeGate;
    m.activity += (detected - m.activity) * 0.12;
    m.loud += (loudTarget - m.loud) * 0.1;

    const response = m.activity;
    const loudness = m.loud;
    const idleCondition = !AUDIO.active && m.presence < 0.04 && response < 0.04 && energy < 0.03 && peak < 0.02;
    m.idle += ((idleCondition ? 1 : 0) - m.idle) * (idleCondition ? 0.05 : 0.14);
    const idleBlend = clamp01(m.idle);
    const idleMode = idleBlend > 0.92;
    const geomDrive = clamp01(response * 0.22 + energy * 1.85 + peak * 0.52);
    const seaDrive = 0.64 + geomDrive * 0.48;
    const roll = rollRef.current;
    const volumeFactor = clamp01(energy * 1.35 + peak * 0.65);
    const shapedVolume = Math.pow(volumeFactor, 1.2);
    const targetRollSpeed = response * (0.003 + shapedVolume * 0.018);
    roll.speed += (targetRollSpeed - roll.speed) * 0.06;
    if (roll.speed < 0) roll.speed = 0;
    roll.offset += roll.speed * (dt * 60);

    const lowDrive = bass * (0.24 + geomDrive * (1.36 + loudness * 1.12));
    const midDrive = mid * (0.2 + geomDrive * (1.02 + loudness * 0.84));
    const highDrive = high * (0.14 + geomDrive * (0.78 + loudness * 0.62));
    const activeBlend = m.presence;
    const globalShimmer = clamp01(0.18 + (1 - response) * 0.12 + activeBlend * 0.14 + response * 0.38 + loudness * 0.24 + peak * 0.14);

    const tmp = new Color();
    const { a, b } = phaseRef.current;

    for (let li = 0; li < ocean.layers.length; li++) {
      const layer = ocean.layers[li];
      const layerTime = t * (1 + li * 0.13);
      const layerDepthNorm = li / Math.max(1, ocean.layers.length - 1);
      const idleSpeedBoost = 1 + (1 - response) * 3.7;

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          const xn = c / (COLS - 1);
          const zn = r / (ROWS - 1);
          const x = layer.xBase[i];
          const z = layer.zBase[i] + 2;
          const xw = layer.xNorm[i];
          const zw = layer.zNorm[i];
          const idleBlend = 1 - activeGate;
          const idleFactor = 1 - response;
          const idleFlow = layerTime * (0.076 + idleFactor * (0.17 + li * 0.018));
          const idleSway = Math.sin(layerTime * (0.27 + li * 0.024) + zw * 1.6 + li * 0.4) * (0.028 + idleFactor * 0.05);
          const acrossRippleA = Math.sin((zw * 0.92 + xw * 0.28) * TAU - layerTime * (0.36 * idleSpeedBoost) + li * 0.31);
          const acrossRippleB = Math.sin((zw * 1.24 - xw * 0.18) * TAU - layerTime * (0.31 * idleSpeedBoost) + li * 0.57);
          const rippleDrift = (acrossRippleA * 0.03 + acrossRippleB * 0.024) * (0.56 + idleFactor * 1.05);
          const xFlow = xw + roll.offset * (0.58 + li * 0.08) + (idleFlow + idleSway + rippleDrift) * idleBlend;
          const zwFlow =
            zw +
            (Math.sin(layerTime * (0.22 + li * 0.022) + xw * 1.8 + li * 0.35) * (0.011 + idleFactor * 0.018) +
              acrossRippleB * (0.006 + idleFactor * 0.01)) *
              idleBlend;
          const regionRand = layer.regionRand[i];

          layer.positions[i * 3] = x;
          layer.positions[i * 3 + 2] = z;

          if (idleMode) {
            const idleFlow = layerTime * (0.16 + li * 0.03);
            const swellA = Math.sin((xw * 0.86 + zw * 1.08) * TAU - idleFlow + li * 0.52);
            const swellB = Math.sin((xw * -0.62 + zw * 0.74) * TAU - idleFlow * 0.82 + li * 0.83 + 0.9);
            const swellC = Math.sin((xw * 0.28 - zw * 0.52) * TAU - idleFlow * 0.68 + li * 0.37 + 1.8);
            const yTarget = -0.03 - li * 0.05 + (swellA * 0.075 + swellB * 0.058 + swellC * 0.036) * layer.amp;

            const yPrev = layer.positions[i * 3 + 1];
            const y = yPrev + (yTarget - yPrev) * 0.12;
            layer.positions[i * 3 + 1] = y;
            layer.prevRise[i] = y - layer.prevY[i];
            layer.prevY[i] = y;

            const idleShimmer = Math.sin(layerTime * 0.62 + xw * 1.8 + zw * 1.2 + li * 0.5) * 0.5 + 0.5;
            tmp.copy(C_DEEP);
            tmp.lerp(C_BASE, 0.72 + (1 - zn) * 0.14 + idleShimmer * 0.08);
            tmp.lerp(C_GLOW, 0.28 + (1 - zn) * 0.12 + idleShimmer * 0.1);
            tmp.lerp(C_HIGHLIGHT, 0.06 + idleShimmer * 0.08);
            tmp.multiplyScalar((1.0 + (1 - zn) * 0.3) * layer.alpha);

            layer.colors[i * 3] = tmp.r;
            layer.colors[i * 3 + 1] = tmp.g;
            layer.colors[i * 3 + 2] = tmp.b;
            layer.sizes[i] = (0.54 + (1 - zn) * 0.16 + idleShimmer * 0.08) * layer.glow;
            continue;
          }

          let broad = 0;
          let audioBroad = 0;
          for (let wi = 0; wi < BROAD_WAVES.length; wi++) {
            const w = BROAD_WAVES[wi];
            const q = xFlow * w.nx + zwFlow * w.nz;
            const speedScale = seaDrive * (0.74 + wi * 0.06 + li * 0.04);
            const phase = q * TAU * w.freq * 30 - layerTime * (w.speed * speedScale) + w.phase + a * 0.2;
            const comp =
              Math.sin(phase) +
              Math.sin(phase * 0.58 + w.phase * 1.5 + li * 0.35) * 0.3 +
              Math.sin(phase * 0.36 + wi * 1.2) * 0.1;

            const e1 = EMITTERS[(wi + li * 2) % EMITTERS.length];
            const e2 = EMITTERS[(wi + li * 3 + 2) % EMITTERS.length];
            const e1x = e1.ox + Math.sin(layerTime * e1.speed + e1.phase) * 0.2;
            const e1z = e1.oz + Math.cos(layerTime * (e1.speed * 0.84) + e1.phase * 1.1) * 0.2;
            const e2x = e2.ox + Math.cos(layerTime * e2.speed + e2.phase) * 0.18;
            const e2z = e2.oz + Math.sin(layerTime * (e2.speed * 0.86) + e2.phase) * 0.18;

            const d1x = xFlow - e1x;
            const d1z = zwFlow - e1z;
            const d2x = xFlow - e2x;
            const d2z = zwFlow - e2z;
            const f1 = Math.exp(-(d1x * d1x + d1z * d1z) / ((e1.radius * 0.66) * (e1.radius * 0.66)));
            const f2 = Math.exp(-(d2x * d2x + d2z * d2z) / ((e2.radius * 0.66) * (e2.radius * 0.66)));
            const travel = Math.sin(
              (xFlow * w.nz + zwFlow * w.nx) * TAU * 0.4 - layerTime * (w.speed * 1.7 * speedScale) + w.phase,
            );

            const compPacket =
              Math.sin((xFlow * (0.34 + wi * 0.06) + zwFlow * (0.22 - wi * 0.03)) * TAU - layerTime * (0.16 + wi * 0.03) + w.phase) *
                0.5 +
              0.5;
            const bandLocal = clamp01(compPacket * 0.72 + f1 * 0.42 - f2 * 0.18);
            const bandBase = (wi < 2 ? lowDrive * 1.24 : wi < 4 ? midDrive * 1.1 : lowDrive * 0.62 + midDrive * 0.5) * (0.34 + bandLocal * 0.92);
            const bandBias = 0.5 + 0.5 * Math.sin(layerTime * (0.12 + wi * 0.02) + w.phase * 1.6 + li * 0.7);
            const delta = bandBase * (0.3 + bandBias * 0.7) * ((f1 - f2) * 1.02 + travel * 0.28) * 0.5;

            broad += comp * w.amp;
            audioBroad += comp * w.amp * delta;
          }

          let midField = 0;
          let audioMid = 0;
          for (let mi = 0; mi < MID_WAVES.length; mi++) {
            const w = MID_WAVES[mi];
            const q = xFlow * w.nx + zwFlow * w.nz;
            const speedScale = seaDrive * (0.76 + mi * 0.07 + li * 0.05);
            const phase = q * TAU * w.freq * 22 - layerTime * (w.speed * speedScale) + w.phase + b * 0.16;
            const comp = Math.sin(phase) + Math.sin(phase * 0.66 + w.phase * 1.3) * 0.26;

            const e = EMITTERS[(mi * 2 + li + 1) % EMITTERS.length];
            const ex = e.ox + Math.cos(layerTime * e.speed + e.phase) * 0.18;
            const ez = e.oz + Math.sin(layerTime * (e.speed * 0.92) + e.phase * 1.03) * 0.17;
            const dx = xFlow - ex;
            const dz = zwFlow - ez;
            const falloff = Math.exp(-(dx * dx + dz * dz) / ((e.radius * 0.6) * (e.radius * 0.6)));
            const detail = Math.sin(
              (xFlow * w.nz + zwFlow * w.nx) * TAU * 0.58 - layerTime * (w.speed * 1.42 * speedScale) + w.phase,
            );

            const compPacket =
              Math.sin((xFlow * (0.26 + mi * 0.08) + zwFlow * (0.4 - mi * 0.05)) * TAU - layerTime * (0.18 + mi * 0.03) + w.phase) *
                0.5 +
              0.5;
            const bandLocal = clamp01(compPacket * 0.7 + falloff * 0.46);
            const bandBias = 0.5 + 0.5 * Math.sin(layerTime * (0.16 + mi * 0.03) + w.phase * 1.5 + li * 0.5);
            const delta = (midDrive * 0.95 + highDrive * 0.9) * (0.24 + bandBias * 0.44 + bandLocal * 0.72) * ((falloff - 0.36) * 0.96 + detail * 0.34) * 0.42;

            midField += comp * w.amp;
            audioMid += comp * w.amp * delta;
          }

          let localEnergy = 0;
          let audioDrive = 0;
          for (let ei = 0; ei < EMITTERS.length; ei++) {
            const e = EMITTERS[ei];
            const ex = e.ox + Math.sin(layerTime * (e.speed * 0.8) + e.phase) * 0.22;
            const ez = e.oz + Math.cos(layerTime * (e.speed * 0.74) + e.phase * 1.1) * 0.18;
            const dx = xFlow - ex;
            const dz = zwFlow - ez;
            const d2 = dx * dx + dz * dz;
            const falloff = Math.exp(-d2 / ((e.radius * 0.8) * (e.radius * 0.8)));
            const travel = (dx * 0.48 + dz * 0.6) * TAU - layerTime * (e.speed + 0.08) + e.phase;
            localEnergy += falloff;
            audioDrive += falloff * Math.sin(travel * 0.86 + 0.45) * (0.02 + highDrive * 0.28 + peak * 0.12);
          }
          localEnergy = clamp01(localEnergy * 0.46);

          const depthBand = 0.88 + 0.2 * Math.sin(zn * Math.PI * 0.52 + b * 0.1 + li * 0.42);
          const terrainVariance =
            0.62 +
            0.22 * Math.sin((xFlow * 0.34 + zwFlow * 0.24) * TAU + a * 0.2 + li * 0.3) +
            0.16 * Math.sin((xFlow * -0.22 + zwFlow * 0.4) * TAU + b * 0.18 - li * 0.2);

          const majorSwellA = Math.sin((xFlow * 0.92 + zwFlow * 0.34) * TAU * (1.04 + layerDepthNorm * 0.08) - layerTime * (0.2 - layerDepthNorm * 0.03) + li * 0.74);
          const majorSwellB = Math.sin((xFlow * -0.62 + zwFlow * 0.48) * TAU * (0.92 + layerDepthNorm * 0.14) - layerTime * (0.17 - layerDepthNorm * 0.025) + li * 0.52 + 1.1);
          const majorSwellC = Math.sin((xFlow * 0.34 - zwFlow * 0.82) * TAU * (0.78 + layerDepthNorm * 0.2) - layerTime * (0.14 - layerDepthNorm * 0.02) + li * 0.4 + 2.0);
          const driftSwell =
            Math.sin((xFlow * 0.22 + zwFlow * 0.26) * TAU * 0.66 - layerTime * (0.11 * idleSpeedBoost) + li * 0.3) +
            Math.sin((xFlow * -0.17 + zwFlow * 0.31) * TAU * 0.54 - layerTime * (0.085 * idleSpeedBoost) + li * 0.47) * 0.62;
          const backFamily =
            Math.sin((xFlow * (0.18 + layerDepthNorm * 0.46) + zwFlow * (0.94 - layerDepthNorm * 0.22)) * TAU - layerTime * (0.1 + layerDepthNorm * 0.05) + li * 0.9) * 0.4 +
            Math.sin((xFlow * (-0.14 - layerDepthNorm * 0.38) + zwFlow * (0.72 + layerDepthNorm * 0.2)) * TAU - layerTime * (0.09 + layerDepthNorm * 0.04) + li * 0.6) * 0.32;
          const tideRoll =
            Math.sin((xFlow * 0.12 + zwFlow * 0.86) * TAU - layerTime * (0.12 * idleSpeedBoost) + li * 0.28) * 0.58 +
            Math.sin((xFlow * -0.08 + zwFlow * 0.64) * TAU - layerTime * (0.09 * idleSpeedBoost) + li * 0.44) * 0.32;
          const baseWave = (majorSwellA * 0.92 + majorSwellB * 0.76 + majorSwellC * 0.56 + driftSwell * 0.34 + broad * 0.34 + midField * 0.22 + backFamily) * depthBand;
          const audioWave = (audioBroad * 0.72 + audioMid) * depthBand;

          const packetA = Math.sin((xFlow * 0.64 + zwFlow * 0.36) * TAU - layerTime * 0.28 + li * 0.7) * 0.5 + 0.5;
          const packetB = Math.sin((xFlow * -0.48 + zwFlow * 0.26) * TAU - layerTime * 0.22 + li * 0.4) * 0.5 + 0.5;
          const packetC = Math.sin((xFlow * 0.28 - zwFlow * 0.58) * TAU - layerTime * 0.2 + li * 0.9) * 0.5 + 0.5;
          const packetD = Math.sin((xFlow * -0.34 + zwFlow * -0.18) * TAU - layerTime * 0.25 + li * 0.6) * 0.5 + 0.5;
          const packetField = clamp01(packetA * 0.42 + packetB * 0.28 + packetC * 0.24 + packetD * 0.22 - 0.18);
          const localAudioField = clamp01(localEnergy * 0.54 + packetField * 0.78);
          const mountainField =
            Math.max(0, majorSwellA) * 0.64 +
            Math.max(0, majorSwellB) * 0.54 +
            Math.max(0, majorSwellC) * 0.44;
          const rippleTopA = Math.max(0, Math.sin((xFlow * 1.28 + zwFlow * 0.46) * TAU - layerTime * 0.42 + li * 0.7));
          const rippleTopB = Math.max(0, Math.sin((xFlow * -1.02 + zwFlow * 0.62) * TAU - layerTime * 0.36 + li * 0.9 + 1.1));
          const rippleTopC = Math.max(0, Math.sin((xFlow * 0.86 - zwFlow * 1.08) * TAU - layerTime * 0.33 + li * 0.5 + 2.0));
          const rippleTopD = Math.max(0, Math.sin((xFlow * -0.72 - zwFlow * 0.92) * TAU - layerTime * 0.28 + li * 0.8 + 0.6));
          const rippleCanyon =
            Math.max(0, Math.sin((xFlow * 0.94 + zwFlow * 0.84) * TAU - layerTime * 0.31 + li * 0.6 + 2.7)) * 0.7 +
            Math.max(0, Math.sin((xFlow * -0.66 + zwFlow * 1.12) * TAU - layerTime * 0.26 + li * 0.4 + 1.9)) * 0.5;
          const myriadTops = (rippleTopA * 0.42 + rippleTopB * 0.34 + rippleTopC * 0.3 + rippleTopD * 0.24) - rippleCanyon * 0.36;
          const pointedTops = Math.pow(Math.max(0, myriadTops), 2.35);
          const peakMask = Math.pow(clamp01((regionRand - 0.74) / 0.46), 1.4);

          const baseAmp =
            (0.054 + terrainVariance * 0.04) * layer.amp +
            geomDrive * (0.042 + terrainVariance * 0.046) * layer.amp;
          const localAudioAmp =
            (0.06 + geomDrive * (0.22 + localAudioField * 0.46) + loudness * (0.1 + localAudioField * 0.2)) * layer.amp;

          const swellTravel =
            Math.sin((xFlow * 0.42 + zwFlow * 0.2) * TAU - layerTime * 0.21 + li * 0.7) * lowDrive * 0.46 +
            Math.sin((xFlow * -0.24 + zwFlow * 0.38) * TAU - layerTime * 0.18 + li * 0.4) * midDrive * 0.36;
          const idleMotionGain = (0.17 + (1 - response) * 0.22) * idleBlend;
          const audioEnvelope = clamp01(localAudioField * 0.9 + packetField * 0.42);
          const peakShape = Math.pow(Math.max(0, baseWave), 1.74);
          const canyonShape = Math.pow(Math.max(0, -baseWave), 1.42);
          const sculpted = peakShape * (0.4 + audioEnvelope * 0.84) - canyonShape * (0.3 + audioEnvelope * 0.66);

          const audioTopoDrive = clamp01(localAudioField * 0.74 + response * 0.28 + loudness * 0.24);
          const micPeakBoost = smoothstep(0.04, 0.4, response + loudness * 0.7) * activeGate;
          const windLift =
            Math.sin((xFlow * 0.16 + zwFlow * 0.22) * TAU - layerTime * (0.072 * idleSpeedBoost) + li * 0.22) *
            (0.004 + idleFactor * 0.008) *
            idleBlend;
          const idleBackWash =
            Math.sin((xFlow * 0.11 - zwFlow * 0.19) * TAU - layerTime * (0.066 * idleSpeedBoost) + li * 0.31) *
            (0.003 + idleFactor * 0.007) *
            idleBlend;
          const yTarget =
            -0.03 - li * 0.05 +
            (baseWave * baseAmp +
              mountainField * (localAudioField * (0.08 + micPeakBoost * (0.5 + loudness * 0.44))) * (0.76 + regionRand * 0.44) +
              pointedTops * (audioTopoDrive * (0.1 + micPeakBoost * (0.9 + layer.amp * 0.5))) * (0.64 + regionRand * 0.52 + peakMask * 1.2) +
              sculpted * (0.03 + micPeakBoost * (0.22 + localAudioField * 0.38 + loudness * 0.24)) +
              driftSwell * idleMotionGain +
              windLift +
              idleBackWash +
              tideRoll * (0.08 + geomDrive * 0.12) +
              audioWave * localAudioAmp +
              swellTravel +
              audioDrive * (0.04 + localAudioField * 0.22 + loudness * 0.1)) *
              (0.84 + Math.sin((zn * 0.78 + xw * 0.08) * Math.PI) * 0.2);

          const yPrev = layer.positions[i * 3 + 1];
          const follow = Math.min(0.28, (0.11 + localAudioField * 0.08 + localEnergy * 0.04 + peak * 0.025) * (dt * 60));
          const y = yPrev + (yTarget - yPrev) * follow;
          layer.positions[i * 3 + 1] = y;

          const rise = y - layer.prevY[i];
          const prevRise = layer.prevRise[i];
          layer.prevY[i] = y;
          layer.prevRise[i] = rise;

          const motionGlow = clamp01(
            Math.abs(rise) * 210 +
              Math.max(0, rise - prevRise * 0.42) * 320 +
              Math.abs(yTarget - y) * 34,
          );
          const crest = clamp01(
            motionGlow * (0.78 + globalShimmer * 0.42) +
              localEnergy * (lowDrive + midDrive) * (0.12 + response * 0.18) +
              peak * (0.08 + loudness * 0.16),
          );
          const bright = clamp01(
            crest * (0.56 + globalShimmer * 0.82) + motionGlow * (0.24 + response * 0.26) + loudness * 0.09,
          );

          tmp.copy(C_DEEP);
          tmp.lerp(C_BASE, 0.6 + bright * 0.22);
          tmp.lerp(C_GLOW, bright * (0.66 + response * 0.26) + motionGlow * 0.16 + 0.16);
          tmp.lerp(C_HIGHLIGHT, bright * (0.46 + response * 0.34 + loudness * 0.22) + motionGlow * 0.2);
          tmp.lerp(C_CORE, bright * (0.12 + response * 0.32 + loudness * 0.26) + motionGlow * 0.12 + peak * 0.1);
          tmp.multiplyScalar((1.04 + (1 - zn) * (0.94 + response * 0.22)) * layer.alpha);

          layer.colors[i * 3] = tmp.r;
          layer.colors[i * 3 + 1] = tmp.g;
          layer.colors[i * 3 + 2] = tmp.b;
          const foregroundBoost = 1 + Math.pow(1 - zn, 1.7) * 0.62;
          layer.sizes[i] =
            (0.52 + bright * (0.92 + globalShimmer * 1.26 + loudness * 0.58)) *
            (0.88 + (1 - zn) * 0.22) *
            layer.glow *
            foregroundBoost;

          const crestWindow = rise > 0.0015 && rise < Math.max(0.0024, prevRise * 0.64);
          const sparkSampleGate = ((r + c + frameRef.current) & 1) === 0;
          if (
            activeGate > 0.35 &&
            li <= 1 &&
            response > 0.06 &&
            geomDrive > 0.08 &&
            sparkSampleGate &&
            crestWindow &&
            y > -0.006 &&
            Math.random() < 0.00006 + response * 0.00028 + loudness * 0.0007
          ) {
            const sparks = ocean.sparks;
            const slot = sparkCursorRef.current;
            sparkCursorRef.current = (sparkCursorRef.current + 1) % SPARK_COUNT;
            const s3 = slot * 3;
            sparks.positions[s3] = x;
            sparks.positions[s3 + 1] = y + 0.03;
            sparks.positions[s3 + 2] = z;
            sparks.vel[s3] = (Math.random() - 0.5) * (0.08 + loudness * 0.14);
            sparks.vel[s3 + 1] = 0.04 + Math.random() * (0.06 + loudness * 0.16);
            sparks.vel[s3 + 2] = (Math.random() - 0.5) * (0.1 + loudness * 0.18);
            sparks.ages[slot] = 0;
            sparks.life[slot] = 0.45 + Math.random() * (0.6 + loudness * 0.45);
            sparks.sizes[slot] = 0.42 + Math.random() * (0.72 + loudness * 0.9);
            sparks.alphas[slot] = 0.05 + response * 0.18 + loudness * 0.28;
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
          const distanceFade = 1 - li / (ocean.layers.length - 1);
          const idleOpacity = (0.06 + distanceFade * 0.07) * layer.alpha;
          const liveOpacity =
            (0.08 + globalShimmer * 0.2 + loudness * 0.1) * layer.alpha * (0.72 + distanceFade * 0.48);
          line.mat.opacity = idleOpacity * idleBlend + liveOpacity * (1 - idleBlend);
        }
      }

      (layer.pointsGeo.attributes.position as BufferAttribute).needsUpdate = true;
      (layer.pointsGeo.attributes.color as BufferAttribute).needsUpdate = true;
      (layer.pointsGeo.attributes.aSize as BufferAttribute).needsUpdate = true;
      const distanceFade = 1 - li / (ocean.layers.length - 1);
      const idleFade = (0.52 + distanceFade * 0.2) * layer.alpha;
      const liveFade =
        (0.52 + globalShimmer * 0.28 + loudness * 0.14 + peak * 0.1) * layer.alpha * (0.74 + distanceFade * 0.56);
      layer.pointsMat.uniforms.uFade.value = idleFade * idleBlend + liveFade * (1 - idleBlend);
    }

    const sparks = ocean.sparks;
    if (idleMode) {
      for (let i = 0; i < SPARK_COUNT; i++) {
        sparks.alphas[i] = 0;
      }
    } else {
      for (let i = 0; i < SPARK_COUNT; i++) {
        sparks.ages[i] += dt;
        if (sparks.ages[i] >= sparks.life[i]) {
          sparks.alphas[i] = 0;
          continue;
        }
        const lifeT = sparks.ages[i] / sparks.life[i];
        const i3 = i * 3;
        sparks.vel[i3] *= 0.985;
        sparks.vel[i3 + 2] *= 0.985;
        sparks.vel[i3 + 1] = sparks.vel[i3 + 1] * 0.968 - (0.004 + loudness * 0.004) * dt * 60;

        sparks.positions[i3] += sparks.vel[i3] * dt * 60;
        sparks.positions[i3 + 1] += sparks.vel[i3 + 1] * dt * 60;
        sparks.positions[i3 + 2] += sparks.vel[i3 + 2] * dt * 60;
        sparks.alphas[i] = (1 - lifeT) * (0.04 + response * 0.2 + loudness * 0.34);
      }
    }
    (sparks.geo.attributes.position as BufferAttribute).needsUpdate = true;
    (sparks.geo.attributes.color as BufferAttribute).needsUpdate = true;
    (sparks.geo.attributes.aSize as BufferAttribute).needsUpdate = true;
    (sparks.geo.attributes.aAlpha as BufferAttribute).needsUpdate = true;
    const sparkIdleGlow = 0.08;
    const sparkLiveGlow = 0.08 + response * 0.26 + loudness * 0.4;
    sparks.mat.uniforms.uGlow.value = sparkIdleGlow * idleBlend + sparkLiveGlow * (1 - idleBlend);
    if (!idleMode && idleBlend > 0.05) {
      const damp = 1 - idleBlend;
      for (let i = 0; i < SPARK_COUNT; i++) {
        sparks.alphas[i] *= damp;
      }
    }

    const floats = ocean.floats;
    const floatStride = idleBlend > 0.8 ? 2 : 1;
    for (let i = 0; i < FLOAT_COUNT; i += floatStride) {
      const i3 = i * 3;
      floats.positions[i3] += floats.drift[i3] * (dt * 60);
      floats.positions[i3 + 1] += floats.drift[i3 + 1] * (dt * 60);
      floats.positions[i3 + 2] += floats.drift[i3 + 2] * (dt * 60);
      if (floats.positions[i3 + 1] > 6.5) {
        floats.positions[i3] = (Math.random() - 0.5) * FIELD_WIDTH * 1.1;
        floats.positions[i3 + 1] = 0.8 + Math.random() * 0.8;
        floats.positions[i3 + 2] = -Math.random() * FIELD_DEPTH * 0.9 + 2;
      }
      if (Math.abs(floats.positions[i3]) > FIELD_WIDTH * 0.62) floats.drift[i3] *= -1;
      if (floats.positions[i3 + 2] > 5 || floats.positions[i3 + 2] < -FIELD_DEPTH) floats.drift[i3 + 2] *= -1;
    }
    (floats.geo.attributes.position as BufferAttribute).needsUpdate = true;
    floats.mat.uniforms.uFade.value = 0.2 + response * 0.18 + loudness * 0.2;

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
      <color attach="background" args={["#041215"]} />
      <fog attach="fog" args={["#052229", 8, 66]} />
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

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        left: "var(--sidebar-width, 240px)",
        background:
          "radial-gradient(132% 92% at 52% 12%, rgba(191,245,239,0.22) 0%, rgba(143,209,203,0.13) 20%, rgba(4,18,21,0) 56%), linear-gradient(180deg, #0a2631 0%, #07222b 32%, #051a21 58%, #041215 100%)",
      }}
    >
      <Canvas
        frameloop="always"
        camera={{ position: [0, 3.8, 18.6], fov: 42 }}
        style={{ width: "100%", height: "100%" }}
        dpr={[1, 1.25]}
        gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
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
