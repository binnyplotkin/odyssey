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
const ROWS = 40;
const COLS = 78;
const TAU = Math.PI * 2;
const LINE_STEP = 4;
const SPARK_COUNT = 140;
const FLOAT_COUNT = 72;

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
  const modeRef = useRef({ activity: 0, loud: 0, presence: 0, engage: 0 });
  const rollRef = useRef({ offset: 0, speed: 0 });
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
    const lineStride = modeRef.current.activity < 0.02 ? 6 : 2;
    const updateLinesThisFrame = frameRef.current % lineStride === 0;

    const dt = Math.min(0.04, delta);
    const t = performance.now() * 0.001;

    const s = smoothRef.current;
    const m = modeRef.current;
    const micGate = AUDIO.active ? 1 : 0;
    m.presence += (micGate - m.presence) * 0.2;

    s.energy += ((AUDIO.active ? AUDIO.energy : 0) - s.energy) * (AUDIO.active ? 0.24 : 0.36);
    s.bass += ((AUDIO.active ? AUDIO.bass : 0) - s.bass) * (AUDIO.active ? 0.2 : 0.32);
    s.mid += ((AUDIO.active ? AUDIO.mid : 0) - s.mid) * (AUDIO.active ? 0.2 : 0.32);
    s.high += ((AUDIO.active ? AUDIO.high : 0) - s.high) * (AUDIO.active ? 0.2 : 0.32);
    s.peak += ((AUDIO.active ? AUDIO.peak : 0) - s.peak) * (AUDIO.active ? 0.3 : 0.45);

    const rawLoudness = clamp01(s.energy * 2.2 + s.peak * 1.15 + s.mid * 0.35);
    const loudness = rawLoudness > 0.018 ? rawLoudness : 0;
    m.activity += (loudness - m.activity) * (loudness > m.activity ? 0.24 : 0.34);
    const waveAmount = m.activity;
    const isFlat = waveAmount < 0.012;

    const tmp = new Color();
    const globalGlow = clamp01(0.12 + waveAmount * 0.88);

    for (let li = 0; li < ocean.layers.length; li++) {
      const layer = ocean.layers[li];
      const baseY = -0.03 - li * 0.05;
      const layerScale = (1 - li / Math.max(1, ocean.layers.length - 1)) * layer.amp;
      const amp = waveAmount * (2.2 + layerScale * 1.6);

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          const x = layer.positions[i * 3];
          const z = layer.positions[i * 3 + 2];
          const xn = c / (COLS - 1);
          const zn = r / (ROWS - 1);

          let yTarget = baseY;
          if (!isFlat) {
            const w1 = Math.sin(x * 0.12 + t * 1.5 + li * 0.42);
            const w2 = Math.sin(z * 0.1 - t * 1.18 + li * 0.7);
            const w3 = Math.sin((x + z) * 0.06 + t * 1.95 + li * 0.22);
            const composite = w1 * 0.54 + w2 * 0.34 + w3 * 0.12;
            yTarget += composite * amp;
          }

          const yPrev = layer.positions[i * 3 + 1];
          const follow = isFlat ? 0.34 : 0.18;
          const y = yPrev + (yTarget - yPrev) * follow;
          layer.positions[i * 3 + 1] = y;

          const deviation = Math.abs(y - baseY);
          const bright = clamp01(deviation * 2.4 + waveAmount * 0.36 + (1 - zn) * 0.16);
          tmp.copy(C_DEEP);
          tmp.lerp(C_BASE, 0.64 + bright * 0.2);
          tmp.lerp(C_GLOW, 0.08 + bright * 0.56);
          tmp.lerp(C_HIGHLIGHT, bright * 0.42);
          tmp.multiplyScalar((0.95 + (1 - zn) * 0.28) * layer.alpha);

          layer.colors[i * 3] = tmp.r;
          layer.colors[i * 3 + 1] = tmp.g;
          layer.colors[i * 3 + 2] = tmp.b;
          layer.sizes[i] = (0.46 + bright * 0.9) * layer.glow;
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
          const depthFade = 1 - li / Math.max(1, ocean.layers.length - 1);
          line.mat.opacity = (0.035 + globalGlow * 0.13) * layer.alpha * (0.68 + depthFade * 0.4);
        }
      }

      (layer.pointsGeo.attributes.position as BufferAttribute).needsUpdate = true;
      (layer.pointsGeo.attributes.color as BufferAttribute).needsUpdate = true;
      (layer.pointsGeo.attributes.aSize as BufferAttribute).needsUpdate = true;
      const depthFade = 1 - li / Math.max(1, ocean.layers.length - 1);
      layer.pointsMat.uniforms.uFade.value = (0.34 + globalGlow * 0.42) * layer.alpha * (0.7 + depthFade * 0.46);
    }

    const sparks = ocean.sparks;
    for (let i = 0; i < SPARK_COUNT; i++) {
      const i3 = i * 3;
      if (isFlat || waveAmount < 0.14) {
        sparks.alphas[i] *= 0.75;
        continue;
      }
      sparks.ages[i] += dt;
      if (sparks.ages[i] >= sparks.life[i]) {
        sparks.alphas[i] = 0;
        continue;
      }
      const lifeT = sparks.ages[i] / sparks.life[i];
      sparks.vel[i3] *= 0.986;
      sparks.vel[i3 + 2] *= 0.986;
      sparks.vel[i3 + 1] = sparks.vel[i3 + 1] * 0.968 - 0.004 * dt * 60;
      sparks.positions[i3] += sparks.vel[i3] * dt * 60;
      sparks.positions[i3 + 1] += sparks.vel[i3 + 1] * dt * 60;
      sparks.positions[i3 + 2] += sparks.vel[i3 + 2] * dt * 60;
      sparks.alphas[i] = (1 - lifeT) * (0.05 + waveAmount * 0.2);
    }
    (sparks.geo.attributes.position as BufferAttribute).needsUpdate = true;
    (sparks.geo.attributes.aAlpha as BufferAttribute).needsUpdate = true;
    sparks.mat.uniforms.uGlow.value = 0.06 + waveAmount * 0.34;

    const floats = ocean.floats;
    for (let i = 0; i < FLOAT_COUNT; i++) {
      const i3 = i * 3;
      const driftMul = isFlat ? 0.22 : 1;
      floats.positions[i3] += floats.drift[i3] * (dt * 60) * driftMul;
      floats.positions[i3 + 1] += floats.drift[i3 + 1] * (dt * 60) * driftMul;
      floats.positions[i3 + 2] += floats.drift[i3 + 2] * (dt * 60) * driftMul;
      if (floats.positions[i3 + 1] > 6.5) {
        floats.positions[i3] = (Math.random() - 0.5) * FIELD_WIDTH * 1.1;
        floats.positions[i3 + 1] = 0.8 + Math.random() * 0.8;
        floats.positions[i3 + 2] = -Math.random() * FIELD_DEPTH * 0.9 + 2;
      }
    }
    (floats.geo.attributes.position as BufferAttribute).needsUpdate = true;
    floats.mat.uniforms.uFade.value = 0.1 + waveAmount * 0.16;

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
        dpr={[1, 1.2]}
        camera={{ position: [0, 3.8, 18.6], fov: 42 }}
        style={{ width: "100%", height: "100%" }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
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
