/**
 * "3m ago" / "2h ago" / "5d ago" / "Mar 14" formatting for ISO
 * timestamps. Used by the HISTORY tabs (L01 / L02 / L03 / L04 brain-model
 * / future layers) to display first-seen / last-seen in a way that
 * doesn't require an absolute date-time visual.
 *
 * Tiny — no date-fns dependency for one helper that the harness uses
 * in five places.
 */
export function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - t);
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
