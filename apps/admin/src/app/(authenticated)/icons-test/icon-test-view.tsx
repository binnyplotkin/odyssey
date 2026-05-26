"use client";

import { KnowledgeGraphIcon } from "@/components/knowledge-graph-icon";
import type { KnowledgeGraphData } from "@odyssey/db";

const FG = "#F1F5F9";
const TEXT_MUTED = "#FFFFFF8C";
const TEXT_FADED = "#FFFFFF73";
const BORDER = "#FFFFFF14";
const PANEL = "#0C0E14CC";
const HEAD = '"Space Grotesk", system-ui, sans-serif';
const MONO = '"JetBrains Mono", system-ui, sans-serif';

const TYPE_COLOR: Record<string, string> = {
  entity: "#8FD1CB",
  event: "#F4A3B8",
  concept: "#B197FC",
  relationship: "#F7D26B",
  timeline: "#9AA4B2",
  voice_identity: "#A8C4E8",
};

const SIZES = [16, 32, 64, 128];

export type IconStats = {
  nodeCount: number;
  edgeCount: number;
  typeCounts: Record<string, number>;
  dominantType: string;
  degreeValues: number[];
};

export function IconTestView({
  wikiId,
  wikiTitle,
  iconData,
  stats,
}: {
  wikiId: string;
  wikiTitle: string;
  iconData: KnowledgeGraphData;
  stats: IconStats;
}) {
  // Node-count comparison: same data, sliced to different sample sizes.
  // Same edges are preserved within the slice — we just drop the lower-
  // degree nodes (and any edges that would have connected to them).
  const sampleSizes = [5, 8, 12, 16, 20];
  const sampledIcons = sampleSizes.map((n) => {
    const nodes = iconData.nodes.slice(0, n);
    const keep = new Set(nodes.map((node) => node.id));
    const edges = iconData.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
    return { n, data: { nodes, edges } };
  });

  const variants = [
    {
      key: "current",
      label: "A · Current (real layout subsample)",
      description: `${iconData.nodes.length} top-degree nodes from cached layout, with their inter-node edges. Faithful — icon looks like the canvas. Limitation: can read as noise at 16px.`,
      render: (size: number) => (
        <KnowledgeGraphIcon data={iconData} size={size} density="spacious" />
      ),
    },
    {
      key: "rings",
      label: "C · Procedural rings (graph properties)",
      description:
        "Three concentric rings: outermost = edge density, middle = type diversity (entropy of type histogram), inner dot count = log(node count). Cheap, never empty.",
      render: (size: number) => <RingsFingerprint size={size} stats={stats} />,
    },
    {
      key: "bars",
      label: "D · Radial degree histogram",
      description:
        "Each spoke = one degree bucket; bar length = how many pages have that many connections. Compact signature of the wiki's connectedness profile.",
      render: (size: number) => <RadialBarsFingerprint size={size} stats={stats} />,
    },
    {
      key: "identicon",
      label: "E · Identicon (hash of wiki id)",
      description:
        "5×5 mirror-symmetric grid, cells from a hash of the wiki id. No graph data — pure branding. Tiny, scales to 8px cleanly.",
      render: (size: number) => <IdenticonFingerprint size={size} wikiId={wikiId} />,
    },
    {
      key: "layered",
      label: "F · Layered (real layout + type-tinted ring)",
      description:
        "Variant A inside a ring colored by dominant page type, ring thickness = edge density. Best for the overview card; reads as both 'this wiki' and 'these characteristics'.",
      render: (size: number) => (
        <LayeredFingerprint size={size} iconData={iconData} stats={stats} />
      ),
    },
  ];

  return (
    <div
      style={{
        padding: "28px 32px",
        fontFamily: '"Inter", system-ui, sans-serif',
        color: FG,
        background: "var(--background, #0A0A0A)",
        minHeight: "100%",
      }}
    >
      <header style={{ marginBottom: 22 }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: TEXT_FADED,
          }}
        >
          icon variants · {wikiTitle.toLowerCase()}
        </div>
        <h1
          style={{
            margin: "4px 0 8px",
            fontFamily: HEAD,
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          Wiki icon design variants
        </h1>
        <div
          style={{
            fontFamily: MONO,
            fontSize: "var(--font-size-sm)",
            color: TEXT_MUTED,
            display: "flex",
            gap: "var(--space-14)",
            flexWrap: "wrap",
          }}
        >
          <span>nodes: {stats.nodeCount}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>edges: {stats.edgeCount}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>
            dominant type: <span style={{ color: TYPE_COLOR[stats.dominantType] }}>{stats.dominantType}</span>
          </span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>icon node count (subsampled): {iconData.nodes.length}</span>
        </div>
      </header>

      {/* Node-count comparison — same algorithm, varied sample size. */}
      <section
        style={{
          padding: "20px 22px",
          borderRadius: "var(--radius-2xl)",
          border: `1px solid ${BORDER}`,
          background: PANEL,
          marginBottom: "var(--space-18)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "var(--space-16)",
            marginBottom: "var(--space-14)",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: HEAD,
              fontSize: 15,
              fontWeight: 600,
              color: FG,
            }}
          >
            Sample-size sweep · variant A at different node counts
          </h2>
          <span
            style={{
              fontFamily: MONO,
              fontSize: "var(--font-size-xs)",
              color: TEXT_FADED,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            shape vs density
          </span>
        </div>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: "var(--font-size-base)",
            lineHeight: 1.55,
            color: TEXT_MUTED,
            maxWidth: 720,
          }}
        >
          Same icon algorithm (top-degree subsample) at five node counts.
          Each row shows one count rendered at the four target sizes — find
          the smallest N where shape still reads cleanly at 32px (where
          the icon lives in list views).
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto repeat(4, auto)",
            gap: "16px 36px",
            alignItems: "center",
          }}
        >
          <div />
          {SIZES.map((s) => (
            <div
              key={`hdr-${s}`}
              style={{
                fontFamily: MONO,
                fontSize: "var(--font-size-xs)",
                color: TEXT_FADED,
                letterSpacing: "0.06em",
                textAlign: "center",
              }}
            >
              {s}px
            </div>
          ))}
          {sampledIcons.map(({ n, data }) => (
            <RowFragment key={n} n={n} data={data} />
          ))}
        </div>
      </section>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-18)" }}>
        {variants.map((v) => (
          <section
            key={v.key}
            style={{
              padding: "20px 22px",
              borderRadius: "var(--radius-2xl)",
              border: `1px solid ${BORDER}`,
              background: PANEL,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "var(--space-16)",
                marginBottom: "var(--space-14)",
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontFamily: HEAD,
                  fontSize: 15,
                  fontWeight: 600,
                  color: FG,
                }}
              >
                {v.label}
              </h2>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: "var(--font-size-xs)",
                  color: TEXT_FADED,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {v.key}
              </span>
            </div>
            <p
              style={{
                margin: "0 0 18px",
                fontSize: "var(--font-size-base)",
                lineHeight: 1.55,
                color: TEXT_MUTED,
                maxWidth: 720,
              }}
            >
              {v.description}
            </p>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 36,
                flexWrap: "wrap",
              }}
            >
              {SIZES.map((s) => (
                <div
                  key={s}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "var(--space-6)",
                  }}
                >
                  <div
                    style={{
                      width: s,
                      height: s,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {v.render(s)}
                  </div>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: "var(--font-size-2xs)",
                      color: TEXT_FADED,
                      letterSpacing: "0.06em",
                    }}
                  >
                    {s}px
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** One row of the sample-size sweep — label + four sizes. */
function RowFragment({
  n,
  data,
}: {
  n: number;
  data: KnowledgeGraphData;
}) {
  return (
    <>
      <div
        style={{
          fontFamily: MONO,
          fontSize: "var(--font-size-sm)",
          color: TEXT_MUTED,
          minWidth: 60,
        }}
      >
        N = {n}
      </div>
      {SIZES.map((s) => (
        <div
          key={s}
          style={{
            width: s,
            height: s,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <KnowledgeGraphIcon data={data} size={s} density="spacious" />
        </div>
      ))}
    </>
  );
}

/* ── Variant C: concentric rings from graph properties ─────────── */

function RingsFingerprint({ size, stats }: { size: number; stats: IconStats }) {
  // Three signature dimensions, each rendered as a ring whose thickness
  // reflects the value. Always-drawn baseline keeps even sparse wikis
  // from looking empty.
  const maxEdgeDensity = 0.4; // saturation ceiling for visual mapping
  const density =
    stats.edgeCount /
    Math.max(1, (stats.nodeCount * (stats.nodeCount - 1)) / 2);
  const densityNorm = Math.min(1, density / maxEdgeDensity);

  const typeEntropy = (() => {
    const total = Object.values(stats.typeCounts).reduce((a, b) => a + b, 0);
    if (total === 0) return 0;
    let h = 0;
    for (const c of Object.values(stats.typeCounts)) {
      const p = c / total;
      if (p > 0) h -= p * Math.log2(p);
    }
    return Math.min(1, h / Math.log2(6)); // 6 page types = max entropy
  })();

  const nodeNorm = Math.min(1, Math.log10(stats.nodeCount + 1) / 3); // ~1000 nodes = full

  const color = TYPE_COLOR[stats.dominantType] ?? "#8FD1CB";
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 1;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Outer ring — edge density */}
      <circle
        cx={cx}
        cy={cy}
        r={outerR}
        fill="none"
        stroke={color}
        strokeWidth={1 + densityNorm * 3}
        opacity={0.7 + densityNorm * 0.3}
      />
      {/* Middle ring — type entropy */}
      <circle
        cx={cx}
        cy={cy}
        r={outerR * 0.65}
        fill="none"
        stroke={color}
        strokeWidth={0.5 + typeEntropy * 1.5}
        opacity={0.4 + typeEntropy * 0.4}
      />
      {/* Inner dots — node count (log-scaled) */}
      {Array.from({ length: Math.max(3, Math.round(nodeNorm * 9)) }).map(
        (_, i, arr) => {
          const a = (i / arr.length) * Math.PI * 2;
          const r = outerR * 0.32;
          return (
            <circle
              key={i}
              cx={cx + Math.cos(a) * r}
              cy={cy + Math.sin(a) * r}
              r={Math.max(0.7, size * 0.025)}
              fill={color}
              opacity={0.9}
            />
          );
        },
      )}
    </svg>
  );
}

/* ── Variant D: radial bars from degree distribution ───────────── */

function RadialBarsFingerprint({
  size,
  stats,
}: {
  size: number;
  stats: IconStats;
}) {
  // Bucket the degree values into 16 logarithmic bins; each bin = one
  // spoke whose length = log(count + 1). Captures the "shape" of the
  // connectedness profile.
  const BUCKETS = 16;
  const maxDeg = Math.max(...stats.degreeValues, 1);
  const buckets = new Array(BUCKETS).fill(0);
  for (const d of stats.degreeValues) {
    const idx = Math.min(
      BUCKETS - 1,
      Math.floor((Math.log10(d + 1) / Math.log10(maxDeg + 1)) * BUCKETS),
    );
    buckets[idx]++;
  }
  const maxBucket = Math.max(...buckets, 1);

  const color = TYPE_COLOR[stats.dominantType] ?? "#8FD1CB";
  const cx = size / 2;
  const cy = size / 2;
  const innerR = size * 0.16;
  const outerR = size * 0.48;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={innerR} fill={color} opacity={0.25} />
      {buckets.map((count, i) => {
        const angle = (i / BUCKETS) * Math.PI * 2 - Math.PI / 2;
        const len = innerR + (count / maxBucket) * (outerR - innerR);
        const x1 = cx + Math.cos(angle) * innerR;
        const y1 = cy + Math.sin(angle) * innerR;
        const x2 = cx + Math.cos(angle) * len;
        const y2 = cy + Math.sin(angle) * len;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={color}
            strokeWidth={Math.max(1, size * 0.04)}
            strokeLinecap="round"
            opacity={0.4 + (count / maxBucket) * 0.5}
          />
        );
      })}
    </svg>
  );
}

/* ── Variant E: identicon from wiki id hash ────────────────────── */

function IdenticonFingerprint({
  size,
  wikiId,
}: {
  size: number;
  wikiId: string;
}) {
  // FNV-style hash → 25-bit pattern. The 5x5 grid uses bits 0-14 as the
  // left-half cells (the right half mirrors), and bits 16-23 pick the
  // hue. Always symmetric, always identifiable per wiki.
  let h = 0x811c9dc5;
  for (const ch of wikiId) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const hue = h % 360;
  const color = `hsl(${hue} 60% 65%)`;
  const bgColor = `hsl(${hue} 30% 20%)`;

  const cells: boolean[] = [];
  for (let i = 0; i < 15; i++) {
    cells.push(((h >> i) & 1) === 1);
  }

  const cell = size / 5;
  const rects: React.ReactNode[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const on = cells[row * 3 + col];
      if (!on) continue;
      rects.push(
        <rect
          key={`${row}-${col}`}
          x={col * cell}
          y={row * cell}
          width={cell}
          height={cell}
          fill={color}
        />,
      );
      if (col < 2) {
        // mirror to the right half
        rects.push(
          <rect
            key={`${row}-m${col}`}
            x={(4 - col) * cell}
            y={row * cell}
            width={cell}
            height={cell}
            fill={color}
          />,
        );
      }
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ borderRadius: Math.max(2, size * 0.1), overflow: "hidden" }}
    >
      <rect width={size} height={size} fill={bgColor} />
      {rects}
    </svg>
  );
}

/* ── Variant F: layered (real layout + type ring) ──────────────── */

function LayeredFingerprint({
  size,
  iconData,
  stats,
}: {
  size: number;
  iconData: KnowledgeGraphData;
  stats: IconStats;
}) {
  const density =
    stats.edgeCount /
    Math.max(1, (stats.nodeCount * (stats.nodeCount - 1)) / 2);
  const densityNorm = Math.min(1, density / 0.4);
  const color = TYPE_COLOR[stats.dominantType] ?? "#8FD1CB";
  const ringWidth = 1 + densityNorm * 3;
  const innerSize = size - ringWidth * 2 - 4;

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: `${ringWidth}px solid ${color}`,
        background: `${color}10`,
      }}
    >
      {innerSize > 0 && (
        <KnowledgeGraphIcon
          data={iconData}
          size={Math.max(8, innerSize)}
          density="spacious"
        />
      )}
    </div>
  );
}
