import type { SonarAggregate } from "./types";

/** Linear-interpolation percentile over an unsorted sample. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export function aggregate(values: number[]): SonarAggregate | null {
  const clean = values.filter((v) => Number.isFinite(v) && v >= 0);
  if (clean.length === 0) return null;
  const sum = clean.reduce((acc, v) => acc + v, 0);
  return {
    count: clean.length,
    min: round1(Math.min(...clean)),
    max: round1(Math.max(...clean)),
    mean: round1(sum / clean.length),
    p50: round1(percentile(clean, 50)),
    p90: round1(percentile(clean, 90)),
    p95: round1(percentile(clean, 95)),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
