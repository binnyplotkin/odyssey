export function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function isoNow() {
  return new Date().toISOString();
}
