"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  BoxGeometry,
  Color,
  Curve,
  Matrix4,
  MeshBasicMaterial,
  Vector3,
  DoubleSide,
  type InstancedMesh,
  type Points,
  type Mesh,
} from "three";

/* ─── brand palette ─── */
const PALETTES = {
  odyssey: ["#0d9488", "#06b6d4", "#8b5cf6", "#ec4899", "#f59e0b"],
  warm: ["#ef4444", "#f97316", "#eab308", "#f59e0b", "#dc2626"],
  cool: ["#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#0ea5e9"],
  neon: ["#22d3ee", "#a3e635", "#facc15", "#fb923c", "#f472b6"],
  mono: ["#e2e8f0", "#94a3b8", "#64748b", "#475569", "#334155"],
};

type PaletteKey = keyof typeof PALETTES;
type VisualizerMode =
  | "sphere"
  | "grid"
  | "dna"
  | "cube"
  | "swarm"
  | "ribbons";

/* ─── audio analysis hook ─── */
function useAudioAnalyser() {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const timeDomainRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      timeDomainRef.current = new Uint8Array(analyser.fftSize);
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

  const getFrequencyData = useCallback((): Uint8Array<ArrayBuffer> | null => {
    if (!analyserRef.current || !freqDataRef.current) return null;
    analyserRef.current.getByteFrequencyData(freqDataRef.current);
    return freqDataRef.current;
  }, []);

  const getTimeDomainData = useCallback((): Uint8Array<ArrayBuffer> | null => {
    if (!analyserRef.current || !timeDomainRef.current) return null;
    analyserRef.current.getByteTimeDomainData(timeDomainRef.current);
    return timeDomainRef.current;
  }, []);

  /** Normalized 0–1 amplitude for a frequency band (0=bass, 1=treble) */
  const mapFrequency = useCallback(
    (normPos: number, _time: number): number => {
      const freq = getFrequencyData();
      if (!freq) return 0;
      const idx = Math.floor(normPos * (freq.length - 1));
      return freq[idx] / 255;
    },
    [getFrequencyData],
  );

  /** Overall energy 0–1 */
  const getEnergy = useCallback((): number => {
    const freq = getFrequencyData();
    if (!freq) return 0;
    let sum = 0;
    for (let i = 0; i < freq.length; i++) sum += freq[i];
    return sum / (freq.length * 255);
  }, [getFrequencyData]);

  /** Waveform displacement at normalized position */
  const mapWaveform = useCallback(
    (normPos: number): number => {
      const td = getTimeDomainData();
      if (!td) return 0;
      const idx = Math.floor(normPos * (td.length - 1));
      return (td[idx] - 128) / 128;
    },
    [getTimeDomainData],
  );

  return {
    active,
    error,
    start,
    stop,
    mapFrequency,
    mapWaveform,
    getEnergy,
    getFrequencyData,
    getTimeDomainData,
  };
}

/* ─── color utilities ─── */
function lerpPaletteColor(palette: string[], t: number): Color {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (palette.length - 1);
  const idx = Math.floor(scaled);
  const frac = scaled - idx;
  const c1 = new Color(palette[Math.min(idx, palette.length - 1)]);
  const c2 = new Color(palette[Math.min(idx + 1, palette.length - 1)]);
  return c1.lerp(c2, frac);
}

/* ════════════════════════════════════════════════════════════════════
   VISUALIZER 1: SPHERE
   800 instanced cubes on a sphere, radius pulsing with frequency
   ════════════════════════════════════════════════════════════════════ */
function SphereVisualizer({
  mapFrequency,
  palette,
}: {
  mapFrequency: (norm: number, time: number) => number;
  palette: string[];
}) {
  const meshRef = useRef<InstancedMesh>(null);
  const tmpMatrix = useMemo(() => new Matrix4(), []);
  const nPoints = 800;
  const baseRadius = 2;
  const TWO_PI = Math.PI * 2;

  useEffect(() => {
    if (!meshRef.current) return;
    for (let i = 0; i < nPoints; i++) {
      const color = lerpPaletteColor(palette, i / nPoints);
      meshRef.current.setColorAt(i, color);
    }
    meshRef.current.instanceColor!.needsUpdate = true;
  }, [palette]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    for (let i = 0; i < nPoints; i++) {
      const k = i + 0.5;
      const phi = Math.acos(1 - (2 * k) / nPoints) % Math.PI;
      const theta = (Math.PI * (1 + Math.sqrt(5)) * k) % TWO_PI;
      const x = Math.cos(theta) * Math.sin(phi);
      const y = Math.sin(theta) * Math.sin(phi);
      const z = Math.cos(phi);

      const freqVal = mapFrequency(theta / TWO_PI, t);
      const effectiveRadius = baseRadius + 0.8 * baseRadius * freqVal;

      meshRef.current.setMatrixAt(
        i,
        tmpMatrix.setPosition(
          x * effectiveRadius,
          y * effectiveRadius,
          z * effectiveRadius,
        ),
      );
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[new BoxGeometry(), new MeshBasicMaterial(), nPoints]}
    >
      <boxGeometry args={[0.05, 0.05, 0.05]} />
      <meshBasicMaterial color="white" toneMapped={false} />
    </instancedMesh>
  );
}

/* ════════════════════════════════════════════════════════════════════
   VISUALIZER 2: GRID
   100×100 instanced cubes, height driven by frequency
   ════════════════════════════════════════════════════════════════════ */
function GridVisualizer({
  mapFrequency,
  palette,
}: {
  mapFrequency: (norm: number, time: number) => number;
  palette: string[];
}) {
  const meshRef = useRef<InstancedMesh>(null);
  const tmpMatrix = useMemo(() => new Matrix4(), []);
  const rows = 80;
  const cols = 80;
  const cubeSize = 0.025;
  const spacing = 5;

  useEffect(() => {
    if (!meshRef.current) return;
    const diagHalf = Math.hypot(0.5, 0.5);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const nx = r / (rows - 1);
        const ny = c / (cols - 1);
        const radial = Math.hypot(nx - 0.5, ny - 0.5) / diagHalf;
        const color = lerpPaletteColor(palette, radial);
        meshRef.current.setColorAt(idx, color);
      }
    }
    meshRef.current.instanceColor!.needsUpdate = true;
  }, [palette]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    const gridW = rows * spacing * cubeSize;
    const gridH = cols * spacing * cubeSize;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const nx = r / (rows - 1);
        const ny = c / (cols - 1);
        const radial = Math.hypot(nx - 0.5, ny - 0.5) / Math.hypot(0.5, 0.5);
        const freqVal = mapFrequency(radial, t);
        const x = gridW * (nx - 0.5);
        const y = gridH * (ny - 0.5);
        const z = 3 * freqVal;
        meshRef.current.setMatrixAt(idx, tmpMatrix.setPosition(x, y, z));
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[new BoxGeometry(), new MeshBasicMaterial(), rows * cols]}
    >
      <boxGeometry args={[cubeSize, cubeSize, cubeSize]} />
      <meshBasicMaterial color="white" toneMapped={false} />
    </instancedMesh>
  );
}

/* ════════════════════════════════════════════════════════════════════
   VISUALIZER 3: DNA DOUBLE HELIX
   Two helical strands with base pair rungs, animated by audio
   ════════════════════════════════════════════════════════════════════ */
function DNAVisualizer({
  mapFrequency,
  palette,
}: {
  mapFrequency: (norm: number, time: number) => number;
  palette: string[];
}) {
  const baseMeshRef = useRef<InstancedMesh>(null);
  const strandARef = useRef<Mesh>(null);
  const strandBRef = useRef<Mesh>(null);
  const tmpMatrix = useMemo(() => new Matrix4(), []);
  const tmpVec = useMemo(() => new Vector3(), []);

  const helixLength = 20;
  const helixRadius = 1.2;
  const windingSep = 8;
  const nBasePairs = 60;
  const strandOffset = Math.PI / 2;
  const TWO_PI = Math.PI * 2;

  function helixPoint(t: number, offset: number): Vector3 {
    const nt = t - 0.5;
    const nWindings = helixLength / windingSep;
    const tPerWinding = 1 / nWindings;
    const tRad = TWO_PI * ((nt % tPerWinding) / tPerWinding);
    return new Vector3(
      helixRadius * Math.cos(tRad + offset),
      helixRadius * Math.sin(tRad + offset),
      helixLength * nt,
    );
  }

  useEffect(() => {
    if (!baseMeshRef.current) return;
    for (let i = 0; i < nBasePairs * 2; i++) {
      const color = lerpPaletteColor(palette, (i % nBasePairs) / nBasePairs);
      baseMeshRef.current.setColorAt(i, color);
    }
    baseMeshRef.current.instanceColor!.needsUpdate = true;
  }, [palette]);

  useFrame(({ clock }) => {
    if (!baseMeshRef.current) return;
    const t = clock.getElapsedTime();

    // Rotate the whole structure
    if (strandARef.current) strandARef.current.rotation.z = t * 0.15;
    if (strandBRef.current) strandBRef.current.rotation.z = t * 0.15;
    if (baseMeshRef.current) baseMeshRef.current.rotation.z = t * 0.15;

    for (let bp = 0; bp < nBasePairs; bp++) {
      const normBp = bp / (nBasePairs - 1);
      const pA = helixPoint(normBp, 0);
      const pB = helixPoint(normBp, strandOffset);

      const freqVal = mapFrequency(
        2 * Math.abs(normBp - 0.5),
        t,
      );
      const scale = 0.3 + 0.7 * freqVal;

      // Rung A side
      tmpVec.copy(pA);
      const midpoint = new Vector3().addVectors(pA, pB).multiplyScalar(0.5);
      tmpMatrix.setPosition(tmpVec);
      tmpMatrix.lookAt(pA, pB, new Vector3(0, 0, 1));
      tmpMatrix.elements[0] = scale;
      tmpMatrix.elements[5] = scale;
      tmpMatrix.elements[10] = scale;
      baseMeshRef.current.setMatrixAt(bp * 2, tmpMatrix);

      // Rung B side
      tmpMatrix.setPosition(pB);
      tmpMatrix.lookAt(pB, pA, new Vector3(0, 0, 1));
      tmpMatrix.elements[0] = scale;
      tmpMatrix.elements[5] = scale;
      tmpMatrix.elements[10] = scale;
      baseMeshRef.current.setMatrixAt(bp * 2 + 1, tmpMatrix);
    }
    baseMeshRef.current.instanceMatrix.needsUpdate = true;
  });

  // Proper Curve subclass for TubeGeometry
  class HelixCurve extends Curve<Vector3> {
    private offset: number;
    constructor(offset: number) {
      super();
      this.offset = offset;
    }
    getPoint(t: number, optionalTarget = new Vector3()): Vector3 {
      const nt = t - 0.5;
      const nWindings = helixLength / windingSep;
      const tPerWinding = 1 / nWindings;
      const tRad = TWO_PI * ((nt % tPerWinding) / tPerWinding);
      return optionalTarget.set(
        helixRadius * Math.cos(tRad + this.offset),
        helixRadius * Math.sin(tRad + this.offset),
        helixLength * nt,
      );
    }
  }

  const curveA = useMemo(() => new HelixCurve(0), []);
  const curveB = useMemo(() => new HelixCurve(strandOffset), []);

  return (
    <group>
      {/* Strand A */}
      <mesh ref={strandARef}>
        <tubeGeometry args={[curveA, 200, 0.08, 8, false]} />
        <meshBasicMaterial color={palette[0]} toneMapped={false} />
      </mesh>
      {/* Strand B */}
      <mesh ref={strandBRef}>
        <tubeGeometry args={[curveB, 200, 0.08, 8, false]} />
        <meshBasicMaterial color={palette[2]} toneMapped={false} />
      </mesh>
      {/* Base pair rungs */}
      <instancedMesh
        ref={baseMeshRef}
        args={[new BoxGeometry(), new MeshBasicMaterial(), nBasePairs * 2]}
      >
        <boxGeometry args={[0.06, 0.06, 0.4]} />
        <meshBasicMaterial color="white" toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

/* ════════════════════════════════════════════════════════════════════
   VISUALIZER 4: CUBE (volume of instanced cubes, scale by frequency)
   ════════════════════════════════════════════════════════════════════ */
function CubeVisualizer({
  mapFrequency,
  palette,
}: {
  mapFrequency: (norm: number, time: number) => number;
  palette: string[];
}) {
  const meshRef = useRef<InstancedMesh>(null);
  const tmpMatrix = useMemo(() => new Matrix4(), []);
  const nPerSide = 10;
  const cubeSize = 0.4;
  const spacingScalar = 0.15;

  useEffect(() => {
    if (!meshRef.current) return;
    const diagHalf = Math.hypot(0.5, 0.5);
    for (let r = 0; r < nPerSide; r++) {
      for (let c = 0; c < nPerSide; c++) {
        for (let d = 0; d < nPerSide; d++) {
          const idx = r * nPerSide * nPerSide + c * nPerSide + d;
          const nx = r / (nPerSide - 1);
          const ny = c / (nPerSide - 1);
          const nz = d / (nPerSide - 1);
          const radial =
            Math.hypot(nx - 0.5, ny - 0.5, nz - 0.5) /
            Math.hypot(0.5, 0.5, 0.5);
          const color = lerpPaletteColor(palette, radial);
          meshRef.current.setColorAt(idx, color);
        }
      }
    }
    meshRef.current.instanceColor!.needsUpdate = true;
  }, [palette]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    const faceSize = nPerSide * (1 + spacingScalar) * cubeSize;

    for (let r = 0; r < nPerSide; r++) {
      for (let c = 0; c < nPerSide; c++) {
        for (let d = 0; d < nPerSide; d++) {
          const idx = r * nPerSide * nPerSide + c * nPerSide + d;
          const nx = r / (nPerSide - 1);
          const ny = c / (nPerSide - 1);
          const nz = d / (nPerSide - 1);

          const x = faceSize * (nx - 0.5);
          const y = faceSize * (ny - 0.5);
          const z = faceSize * (nz - 0.5);

          const radial =
            Math.hypot(nx - 0.5, ny - 0.5, nz - 0.5) /
            Math.hypot(0.5, 0.5, 0.5);
          const freqVal = mapFrequency(radial, t);
          const scale = 0.1 + 0.9 * freqVal;

          tmpMatrix.setPosition(x, y, z);
          tmpMatrix.elements[0] = scale;
          tmpMatrix.elements[5] = scale;
          tmpMatrix.elements[10] = scale;
          meshRef.current.setMatrixAt(idx, tmpMatrix);
        }
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[
        new BoxGeometry(),
        new MeshBasicMaterial(),
        nPerSide * nPerSide * nPerSide,
      ]}
    >
      <boxGeometry args={[cubeSize, cubeSize, cubeSize]} />
      <meshBasicMaterial color="white" toneMapped={false} />
    </instancedMesh>
  );
}

/* ════════════════════════════════════════════════════════════════════
   VISUALIZER 5: SWARM (particle cloud driven by audio + noise)
   ════════════════════════════════════════════════════════════════════ */
function SwarmVisualizer({
  mapFrequency,
  getEnergy,
  palette,
}: {
  mapFrequency: (norm: number, time: number) => number;
  getEnergy: () => number;
  palette: string[];
}) {
  const pointsRef = useRef<Points>(null);
  const nPerSide = 12;
  const nPoints = nPerSide ** 3;
  const maxDim = 3;

  const velocities = useMemo(
    () => new Float32Array(nPoints * 3),
    [nPoints],
  );

  useEffect(() => {
    if (!pointsRef.current) return;
    const pos = pointsRef.current.geometry.attributes.position;
    const spacing = maxDim / nPerSide;
    for (let x = 0; x < nPerSide; x++) {
      for (let y = 0; y < nPerSide; y++) {
        for (let z = 0; z < nPerSide; z++) {
          const i = x * nPerSide * nPerSide + y * nPerSide + z;
          pos.setXYZ(
            i,
            -maxDim / 2 + x * spacing,
            -maxDim / 2 + y * spacing,
            -maxDim / 2 + z * spacing,
          );
        }
      }
    }
    pos.needsUpdate = true;
  }, []);

  useFrame(({ clock }) => {
    if (!pointsRef.current) return;
    const t = clock.getElapsedTime();
    const energy = getEnergy();
    const pos = pointsRef.current.geometry.attributes.position;
    const force = 0.02 + energy * 0.15;

    for (let i = 0; i < nPoints; i++) {
      let px = pos.getX(i);
      let py = pos.getY(i);
      let pz = pos.getZ(i);

      // Audio-driven noise field
      const freqVal = mapFrequency(
        (Math.atan2(py, px) / (2 * Math.PI) + 0.5),
        t,
      );

      velocities[i * 3] +=
        force * Math.sin(t * 0.5 + pz * 0.3) * freqVal;
      velocities[i * 3 + 1] +=
        force * Math.cos(t * 0.3 + px * 0.3) * freqVal;
      velocities[i * 3 + 2] +=
        force * Math.sin(t * 0.4 + py * 0.3) * freqVal;

      // Damping
      velocities[i * 3] *= 0.96;
      velocities[i * 3 + 1] *= 0.96;
      velocities[i * 3 + 2] *= 0.96;

      // Attract back to origin
      const dist = Math.sqrt(px * px + py * py + pz * pz);
      if (dist > maxDim) {
        const attract = 0.02;
        velocities[i * 3] -= px * attract;
        velocities[i * 3 + 1] -= py * attract;
        velocities[i * 3 + 2] -= pz * attract;
      }

      px += velocities[i * 3];
      py += velocities[i * 3 + 1];
      pz += velocities[i * 3 + 2];

      pos.setXYZ(i, px, py, pz);
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[new Float32Array(nPoints * 3), 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color={palette[0]}
        size={0.08}
        sizeAttenuation
        transparent
        opacity={0.9}
      />
    </points>
  );
}

/* ════════════════════════════════════════════════════════════════════
   VISUALIZER 6: RIBBONS (5 ribbon planes deformed by audio)
   ════════════════════════════════════════════════════════════════════ */
function RibbonsVisualizer({
  mapFrequency,
  palette,
}: {
  mapFrequency: (norm: number, time: number) => number;
  palette: string[];
}) {
  const ribbonCount = 5;
  const ribbonRefs = [
    useRef<Mesh>(null),
    useRef<Mesh>(null),
    useRef<Mesh>(null),
    useRef<Mesh>(null),
    useRef<Mesh>(null),
  ];
  const ribbonWidth = 1;
  const ribbonHeight = 10;
  const widthSegs = 1;
  const heightSegs = 64;
  const zScale = 2.5;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    ribbonRefs.forEach((ref, ribbonIdx) => {
      if (!ref.current) return;
      const posBuffer = ref.current.geometry.attributes.position;
      for (let h = 0; h <= heightSegs; h++) {
        const alpha =
          1 - Math.abs(h - heightSegs / 2) / (heightSegs / 2);
        for (let w = 0; w <= widthSegs; w++) {
          const normX = (ribbonIdx + 0.5) / ribbonCount;
          const normY = (h + 0.5) / heightSegs;
          const freqVal = mapFrequency(normX, t);
          const vIdx = h * (widthSegs + 1) + w;
          const z =
            zScale *
            freqVal *
            alpha *
            Math.sin(normY * Math.PI + t * 2);
          posBuffer.setZ(vIdx, z);
        }
      }
      posBuffer.needsUpdate = true;
    });
  });

  const gridHalfWidth = (ribbonWidth * ribbonCount) / 2;

  return (
    <group>
      <ambientLight intensity={0.5} />
      <pointLight position={[2, 2, 5]} intensity={100} />
      {ribbonRefs.map((ref, i) => (
        <mesh
          key={i}
          ref={ref}
          position={[
            gridHalfWidth - ribbonWidth * i - ribbonWidth / 2,
            0,
            0,
          ]}
        >
          <planeGeometry args={[ribbonWidth, ribbonHeight, widthSegs, heightSegs]} />
          <meshStandardMaterial
            color={palette[i % palette.length]}
            roughness={0.25}
            metalness={0.25}
            side={DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ════════════════════════════════════════════════════════════════════
   SCENE WRAPPER — selects visualizer, provides orbit controls
   ════════════════════════════════════════════════════════════════════ */
function Scene({
  mode,
  audio,
  palette,
  autoOrbit,
}: {
  mode: VisualizerMode;
  audio: ReturnType<typeof useAudioAnalyser>;
  palette: string[];
  autoOrbit: boolean;
}) {
  const { mapFrequency, getEnergy } = audio;

  return (
    <>
      <color attach="background" args={["#0C0E14"]} />
      <OrbitControls
        autoRotate={autoOrbit}
        autoRotateSpeed={1.5}
        enableDamping
        dampingFactor={0.05}
      />
      {mode === "sphere" && (
        <SphereVisualizer mapFrequency={mapFrequency} palette={palette} />
      )}
      {mode === "grid" && (
        <GridVisualizer mapFrequency={mapFrequency} palette={palette} />
      )}
      {mode === "dna" && (
        <DNAVisualizer mapFrequency={mapFrequency} palette={palette} />
      )}
      {mode === "cube" && (
        <CubeVisualizer mapFrequency={mapFrequency} palette={palette} />
      )}
      {mode === "swarm" && (
        <SwarmVisualizer
          mapFrequency={mapFrequency}
          getEnergy={getEnergy}
          palette={palette}
        />
      )}
      {mode === "ribbons" && (
        <RibbonsVisualizer mapFrequency={mapFrequency} palette={palette} />
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════
   ENERGY METER — shows live energy bar
   ════════════════════════════════════════════════════════════════════ */
function EnergyMeter({ getEnergy }: { getEnergy: () => number }) {
  const barRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    function tick() {
      const e = getEnergy();
      if (barRef.current) barRef.current.style.width = `${e * 100}%`;
      if (labelRef.current) labelRef.current.textContent = `${Math.round(e * 100)}%`;
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [getEnergy]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
      <span style={{ fontSize: "var(--font-size-sm)", opacity: 0.6, width: 50 }}>Energy</span>
      <div
        style={{
          flex: 1,
          height: 4,
          background: "rgba(255,255,255,0.1)",
          borderRadius: "var(--radius-2xs)",
          overflow: "hidden",
        }}
      >
        <div
          ref={barRef}
          style={{
            height: "100%",
            background: "var(--accent, #0d9488)",
            borderRadius: "var(--radius-2xs)",
            transition: "width 0.05s linear",
          }}
        />
      </div>
      <span ref={labelRef} style={{ fontSize: "var(--font-size-sm)", opacity: 0.6, width: 32, textAlign: "right" }}>
        0%
      </span>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   PAGE
   ════════════════════════════════════════════════════════════════════ */
const MODES: { key: VisualizerMode; label: string; icon: string }[] = [
  { key: "sphere", label: "Sphere", icon: "◉" },
  { key: "grid", label: "Grid", icon: "▦" },
  { key: "dna", label: "DNA", icon: "🧬" },
  { key: "cube", label: "Cube", icon: "▣" },
  { key: "swarm", label: "Swarm", icon: "✦" },
  { key: "ribbons", label: "Ribbons", icon: "≋" },
];

export default function VoiceTest2Page() {
  const audio = useAudioAnalyser();
  const [mode, setMode] = useState<VisualizerMode>("sphere");
  const [paletteKey, setPaletteKey] = useState<PaletteKey>("odyssey");
  const [autoOrbit, setAutoOrbit] = useState(true);
  const palette = PALETTES[paletteKey];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        left: "var(--sidebar-width, 240px)",
        background: "#0C0E14",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 3D Canvas */}
      <div style={{ flex: 1, position: "relative" }}>
        <Canvas
          camera={{ position: [0, 0, 8], fov: 60 }}
          style={{ width: "100%", height: "100%" }}
        >
          <Scene
            mode={mode}
            audio={audio}
            palette={palette}
            autoOrbit={autoOrbit}
          />
        </Canvas>

        {/* Top-left title */}
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 20,
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          <h1
            style={{
              fontSize: "var(--font-size-2xl)",
              fontWeight: 700,
              color: "white",
              margin: 0,
              letterSpacing: "-0.02em",
            }}
          >
            Voice Test 2
          </h1>
          <p style={{ fontSize: "var(--font-size-base)", color: "rgba(255,255,255,0.5)", margin: "2px 0 0" }}>
            r3f Audio Visualizer
          </p>
        </div>
      </div>

      {/* Bottom control bar */}
      <div
        style={{
          background: "rgba(10,10,10,0.95)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          padding: "12px 20px",
          display: "flex",
          gap: "var(--space-16)",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {/* Mic toggle */}
        <button
          onClick={audio.active ? audio.stop : audio.start}
          style={{
            padding: "6px 16px",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: audio.active ? "#dc2626" : "#0d9488",
            color: "white",
            fontSize: "var(--font-size-md)",
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-6)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            {audio.active ? (
              <rect x="4" y="4" width="16" height="16" rx="2" />
            ) : (
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z" />
            )}
          </svg>
          {audio.active ? "Stop" : "Start Mic"}
        </button>

        {/* Divider */}
        <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.1)" }} />

        {/* Visualizer mode selector */}
        <div style={{ display: "flex", gap: "var(--space-4)" }}>
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              title={m.label}
              style={{
                padding: "5px 10px",
                borderRadius: "var(--radius-sm)",
                border:
                  mode === m.key
                    ? "1px solid rgba(255,255,255,0.3)"
                    : "1px solid rgba(255,255,255,0.06)",
                background:
                  mode === m.key
                    ? "rgba(255,255,255,0.12)"
                    : "rgba(255,255,255,0.03)",
                color: mode === m.key ? "white" : "rgba(255,255,255,0.5)",
                fontSize: "var(--font-size-base)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-4)",
              }}
            >
              <span style={{ fontSize: "var(--font-size-lg)" }}>{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.1)" }} />

        {/* Palette selector */}
        <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "center" }}>
          <span style={{ fontSize: "var(--font-size-sm)", color: "rgba(255,255,255,0.4)", marginRight: "var(--space-4)" }}>
            Palette
          </span>
          {(Object.keys(PALETTES) as PaletteKey[]).map((pk) => (
            <button
              key={pk}
              onClick={() => setPaletteKey(pk)}
              title={pk}
              style={{
                width: 22,
                height: 22,
                borderRadius: "var(--radius-xs)",
                border:
                  paletteKey === pk
                    ? "2px solid white"
                    : "1px solid rgba(255,255,255,0.1)",
                background: `linear-gradient(135deg, ${PALETTES[pk][0]}, ${PALETTES[pk][2]}, ${PALETTES[pk][4]})`,
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.1)" }} />

        {/* Auto orbit toggle */}
        <button
          onClick={() => setAutoOrbit(!autoOrbit)}
          style={{
            padding: "5px 10px",
            borderRadius: "var(--radius-sm)",
            border: autoOrbit
              ? "1px solid rgba(255,255,255,0.3)"
              : "1px solid rgba(255,255,255,0.06)",
            background: autoOrbit
              ? "rgba(255,255,255,0.12)"
              : "rgba(255,255,255,0.03)",
            color: autoOrbit ? "white" : "rgba(255,255,255,0.5)",
            fontSize: "var(--font-size-base)",
            cursor: "pointer",
          }}
        >
          Auto Orbit
        </button>

        {/* Energy meter (flex grows) */}
        <div style={{ flex: 1, minWidth: 120 }}>
          <EnergyMeter getEnergy={audio.getEnergy} />
        </div>
      </div>

      {/* Error display */}
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
            borderRadius: "var(--radius-md)",
            fontSize: "var(--font-size-md)",
            zIndex: 20,
          }}
        >
          {audio.error}
        </div>
      )}
    </div>
  );
}
