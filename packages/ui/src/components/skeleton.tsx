import type { CSSProperties, ReactNode } from "react";

export type SkeletonProps = {
  /** Visual shape — controls border-radius. Defaults to "rect". */
  variant?: "rect" | "circle" | "text";
  /** CSS width — number is treated as px. Defaults to 100%. */
  width?: number | string;
  /** CSS height — number is treated as px. Required for rect/circle; text defaults to 1em. */
  height?: number | string;
  /** Override border-radius. Defaults: rect=8, circle=50%, text=4. */
  radius?: number | string;
  /** Disable the shimmer animation (useful for nested grids to reduce GPU load). */
  static?: boolean;
  /** Extra style overrides (e.g. margin). */
  style?: CSSProperties;
  className?: string;
};

const toCss = (v: number | string | undefined): string | undefined =>
  typeof v === "number" ? `${v}px` : v;

export function Skeleton({
  variant = "rect",
  width,
  height,
  radius,
  static: isStatic = false,
  style,
  className,
}: SkeletonProps) {
  const borderRadius =
    radius !== undefined
      ? toCss(radius)
      : variant === "circle"
        ? "50%"
        : variant === "text"
          ? 4
          : 8;

  const resolvedWidth = toCss(width) ?? "100%";
  const resolvedHeight =
    height !== undefined ? toCss(height) : variant === "text" ? "1em" : "100%";

  return (
    <span
      aria-hidden
      className={`skeleton${isStatic ? " skeleton-static" : ""}${className ? ` ${className}` : ""}`}
      style={{
        display: "block",
        width: resolvedWidth,
        height: resolvedHeight,
        borderRadius,
        ...style,
      }}
    />
  );
}

/* ── Convenience containers ─────────────────────────────────────── */

/** Renders N skeleton lines stacked vertically — handy for paragraph-style placeholders. */
export function SkeletonText({
  lines = 3,
  lineHeight = 14,
  gap = 8,
  lastLineWidth = "60%",
  style,
}: {
  lines?: number;
  lineHeight?: number;
  gap?: number;
  /** Width of the final line so the block looks like wrapped prose. */
  lastLineWidth?: number | string;
  style?: CSSProperties;
}) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap, ...style }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          height={lineHeight}
          width={i === lines - 1 ? lastLineWidth : "100%"}
        />
      ))}
    </span>
  );
}

/** Card-shaped wrapper using the same panel tokens as the rest of the design system. */
export function SkeletonCard({
  children,
  height,
  padding = 16,
  style,
}: {
  children?: ReactNode;
  height?: number | string;
  padding?: number | string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--card-border)",
        borderRadius: 12,
        padding,
        height: toCss(height),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
