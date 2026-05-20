import type { KnowledgeGraphData, WikiPageType } from "@odyssey/db";

/** Per-type dot color — matches the canvas palette. */
const TYPE_COLOR: Record<WikiPageType, string> = {
  entity: "#8CE7D2",
  event: "#F4A3B8",
  concept: "#B197FC",
  relationship: "#F7D26B",
  timeline: "#9AA4B2",
  voice_identity: "#A8C4E8",
};

/**
 * Tiny SVG fingerprint of a wiki's knowledge graph. Reads cached layout
 * coords (the kg-layout job already computes them) and renders the top-N
 * nodes as colored dots, with the strongest inter-node edges as faint
 * connecting lines.
 *
 * Dot color = page type so the icon at a glance shows the corpus's
 * makeup — a wiki that's mostly events looks pink, mostly concepts
 * looks purple, etc. Dot radius is degree-scaled but kept lean so the
 * shape reads as a graph (not a blob) even at 32px.
 *
 * Same coords drive the full /wikis/[id]/knowledge view, so the icon
 * and the canvas literally agree on positions.
 */
export function KnowledgeGraphIcon({
  data,
  size = 32,
  /** Hint that affects dot density only — doesn't change positions. */
  density = "compact",
}: {
  data: KnowledgeGraphData;
  size?: number;
  density?: "compact" | "spacious";
}) {
  if (data.nodes.length === 0) {
    return <KnowledgeGraphIconEmpty size={size} />;
  }

  // Normalize node positions to a (0, 1) box with a small inset.
  const inset = 0.1;
  const inner = 1 - inset * 2;

  const xs = data.nodes.map((n) => n.x);
  const ys = data.nodes.map((n) => n.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  // Lock aspect ratio so the graph isn't squashed when the embedding
  // happens to be tall-and-thin or wide-and-short.
  const range = Math.max(xRange, yRange);
  const xCenter = (xMin + xMax) / 2;
  const yCenter = (yMin + yMax) / 2;

  const project = (x: number, y: number) => ({
    x: inset + ((x - xCenter) / range + 0.5) * inner,
    y: inset + ((y - yCenter) / range + 0.5) * inner,
  });

  const projected = new Map(
    data.nodes.map((n) => [n.id, project(n.x, n.y)]),
  );

  // Dot radius scales with degree, gently. Smaller overall than before
  // so the graph "shape" reads at small sizes; high-degree nodes still
  // pop as the visual anchors.
  const maxDegree = Math.max(1, ...data.nodes.map((n) => n.degree));
  const baseR = density === "compact" ? 0.012 : 0.015;
  const maxR = density === "compact" ? 0.032 : 0.038;
  const dotR = (degree: number) =>
    baseR + (maxR - baseR) * Math.sqrt(degree / maxDegree);

  const maxStrength = Math.max(1, ...data.edges.map((e) => e.strength));

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1 1"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      {/* Edges first so dots paint over them. */}
      {data.edges.map((e, i) => {
        const a = projected.get(e.from);
        const b = projected.get(e.to);
        if (!a || !b) return null;
        const opacity = 0.12 + 0.3 * (e.strength / maxStrength);
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#FFFFFF"
            strokeWidth={0.005}
            strokeOpacity={opacity}
            strokeLinecap="round"
          />
        );
      })}

      {/* Dots — colored by page type. */}
      {data.nodes.map((n) => {
        const p = projected.get(n.id)!;
        return (
          <circle
            key={n.id}
            cx={p.x}
            cy={p.y}
            r={dotR(n.degree)}
            fill={TYPE_COLOR[n.type] ?? "#FFFFFF"}
          />
        );
      })}
    </svg>
  );
}

/**
 * Placeholder for graphs that have no cached layout yet (fresh ingest,
 * or no edges computed). Renders a faint 4-dot scatter so the slot
 * doesn't collapse.
 */
function KnowledgeGraphIconEmpty({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1 1"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0, opacity: 0.4 }}
    >
      {[
        [0.3, 0.3],
        [0.7, 0.35],
        [0.4, 0.7],
        [0.65, 0.7],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={0.03} fill="currentColor" />
      ))}
    </svg>
  );
}
