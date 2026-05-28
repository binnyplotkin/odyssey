"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { LoadingIndicator } from "@/components/loading-indicator";

const swatches = [
  { label: "Accent", color: "var(--accent)" },
  { label: "Cyan", color: "#8fd1cb" },
  { label: "White", color: "#f8fafc" },
  { label: "Violet", color: "#a78bfa" },
];

export function LoadingIndicatorTest() {
  const [speed, setSpeed] = useState(1.35);
  const [intensity, setIntensity] = useState(0.85);
  const [thickness, setThickness] = useState(1.7);
  const [pulseLength, setPulseLength] = useState(1.25);
  const [size, setSize] = useState(360);
  const [color, setColor] = useState(swatches[0].color);
  const [showBase, setShowBase] = useState(true);
  const [showPathOverlay, setShowPathOverlay] = useState(false);

  return (
    <main className="loading-lab">
      <section className="loading-lab-header">
        <div>
          <div className="loading-lab-kicker">UI Lab</div>
          <h1>Loading indicator</h1>
        </div>
        <div className="loading-lab-meta">/loading-indicator</div>
      </section>

      <section className="loading-lab-grid">
        <div className="loading-lab-stage">
          <LoadingIndicator
            size={size}
            speedSeconds={speed}
            intensity={intensity}
            thickness={thickness}
            pulseLength={pulseLength}
            showBase={showBase}
            showLoaderPathOverlay={showPathOverlay}
            style={{ color }}
          />
        </div>

        <aside className="loading-lab-controls" aria-label="Loading indicator controls">
          <RangeControl label="Size" value={size} min={160} max={560} step={10} suffix="px" onChange={setSize} />
          <RangeControl label="Speed" value={speed} min={0.6} max={4} step={0.05} suffix="s" onChange={setSpeed} />
          <RangeControl label="Intensity" value={intensity} min={0.25} max={1} step={0.05} suffix="" onChange={setIntensity} />
          <RangeControl label="Thickness" value={thickness} min={0.7} max={3.5} step={0.05} suffix="" onChange={setThickness} />
          <RangeControl label="Length" value={pulseLength} min={0.7} max={3} step={0.05} suffix="" onChange={setPulseLength} />

          <div className="loading-lab-control">
            <div className="loading-lab-control-label">Color</div>
            <div className="loading-lab-swatches">
              {swatches.map((swatch) => (
                <button
                  key={swatch.label}
                  type="button"
                  aria-label={swatch.label}
                  title={swatch.label}
                  className={color === swatch.color ? "active" : undefined}
                  onClick={() => setColor(swatch.color)}
                  style={{ background: swatch.color }}
                />
              ))}
            </div>
          </div>

          <label className="loading-lab-toggle">
            <input
              type="checkbox"
              checked={showBase}
              onChange={(event) => setShowBase(event.target.checked)}
            />
            <span>Base logo</span>
          </label>

          <label className="loading-lab-toggle">
            <input
              type="checkbox"
              checked={showPathOverlay}
              onChange={(event) => setShowPathOverlay(event.target.checked)}
            />
            <span>Loader path overlay</span>
          </label>
        </aside>
      </section>

      <section className="loading-lab-variants" aria-label="Loading indicator variants">
        <Preview title="Inline" color={color}>
          <LoadingIndicator size={132} speedSeconds={speed} intensity={intensity} thickness={thickness} pulseLength={pulseLength} showBase={showBase} />
        </Preview>
        <Preview title="Panel" color={color}>
          <LoadingIndicator size={220} speedSeconds={speed} intensity={intensity} thickness={thickness} pulseLength={pulseLength} showBase={showBase} />
        </Preview>
        <Preview title="Minimal" color={color}>
          <LoadingIndicator size={180} speedSeconds={speed} intensity={intensity} thickness={thickness} pulseLength={pulseLength} showBase={false} />
        </Preview>
      </section>

      <style>{`
        .loading-lab {
          min-height: 100%;
          padding: 28px;
          color: var(--foreground);
          background: var(--background);
        }

        .loading-lab-header {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 20px;
          max-width: 1180px;
          margin: 0 auto 24px;
        }

        .loading-lab-kicker,
        .loading-lab-meta,
        .loading-lab-control-label {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          font-weight: 650;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--text-tertiary);
        }

        .loading-lab h1 {
          margin: 6px 0 0;
          font-size: 32px;
          line-height: 1.1;
          letter-spacing: 0;
        }

        .loading-lab-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 320px;
          gap: 18px;
          max-width: 1180px;
          margin: 0 auto;
          align-items: stretch;
        }

        .loading-lab-stage {
          min-height: 480px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface-1);
          overflow: hidden;
        }

        .loading-lab-controls {
          display: flex;
          flex-direction: column;
          gap: 18px;
          padding: 18px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface-1);
        }

        .loading-lab-control {
          display: grid;
          gap: 9px;
        }

        .loading-lab-control-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .loading-lab-value {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 12px;
          color: var(--foreground);
          font-variant-numeric: tabular-nums;
        }

        .loading-lab input[type="range"] {
          width: 100%;
          accent-color: var(--accent);
        }

        .loading-lab-swatches {
          display: flex;
          gap: 8px;
        }

        .loading-lab-swatches button {
          width: 28px;
          height: 28px;
          border-radius: 999px;
          border: 1px solid var(--border);
          cursor: pointer;
          box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.18);
        }

        .loading-lab-swatches button.active {
          outline: 2px solid var(--foreground);
          outline-offset: 2px;
        }

        .loading-lab-toggle {
          display: flex;
          align-items: center;
          gap: 10px;
          color: var(--foreground);
          font-size: 13px;
          cursor: pointer;
        }

        .loading-lab-toggle input {
          width: 16px;
          height: 16px;
          accent-color: var(--accent);
        }

        .loading-lab-variants {
          max-width: 1180px;
          margin: 18px auto 0;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 18px;
        }

        .loading-lab-preview {
          min-height: 210px;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
          gap: 12px;
          padding: 16px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface-1);
        }

        .loading-lab-preview-title {
          color: var(--text-tertiary);
          font-size: 12px;
          font-weight: 650;
        }

        .loading-lab-preview-body {
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: inherit;
        }

        @media (max-width: 980px) {
          .loading-lab-grid,
          .loading-lab-variants {
            grid-template-columns: minmax(0, 1fr);
          }

          .loading-lab-stage {
            min-height: 360px;
          }
        }

        @media (max-width: 560px) {
          .loading-lab {
            padding: 18px;
          }

          .loading-lab-header {
            align-items: start;
            flex-direction: column;
          }

          .loading-lab h1 {
            font-size: 26px;
          }
        }
      `}</style>
    </main>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="loading-lab-control">
      <span className="loading-lab-control-row">
        <span className="loading-lab-control-label">{label}</span>
        <span className="loading-lab-value">
          {value.toFixed(step < 1 ? 2 : 0).replace(/0$/, "").replace(/\.$/, "")}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Preview({
  title,
  color,
  children,
}: {
  title: string;
  color: string;
  children: ReactNode;
}) {
  return (
    <div className="loading-lab-preview" style={{ color }}>
      <div className="loading-lab-preview-title">{title}</div>
      <div className="loading-lab-preview-body">{children}</div>
    </div>
  );
}
