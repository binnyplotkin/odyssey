import matter from "gray-matter";

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SourceFrontmatterResult =
  | {
      ok: true;
      raw: string;
      metadata: Record<string, JsonValue>;
    }
  | {
      ok: false;
      raw: string;
      error: string;
    };

const yamlEngine = (
  matter as unknown as {
    engines: { yaml: { parse(input: string): unknown } };
  }
).engines.yaml;

export function parseSourceFrontmatter(input: unknown): SourceFrontmatterResult {
  const raw = typeof input === "string" ? input : "";
  if (!raw.trim()) return { ok: true, raw, metadata: {} };

  try {
    const parsed = yamlEngine.parse(stripMatterDelimiters(raw));
    if (!isPlainRecord(parsed)) {
      return {
        ok: false,
        raw,
        error: "Frontmatter must be a YAML mapping.",
      };
    }

    return {
      ok: true,
      raw,
      metadata: toJsonRecord(parsed),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      raw,
      error: `Invalid YAML frontmatter: ${message}`,
    };
  }
}

function stripMatterDelimiters(raw: string) {
  const normalized = raw.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") return raw;

  const closingIndex = lines.findIndex((line, index) => {
    if (index === 0) return false;
    const marker = line.trim();
    return marker === "---" || marker === "...";
  });

  if (closingIndex === -1) return raw;
  return lines.slice(1, closingIndex).join("\n");
}

function toJsonRecord(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, toJsonValue(value, key)]),
  ) as Record<string, JsonValue>;
}

function toJsonValue(value: unknown, path: string): JsonValue {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} must be a finite number.`);
    }
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item, index) => toJsonValue(item, `${path}[${index}]`));
  }
  if (isPlainRecord(value)) {
    return toJsonRecord(value);
  }

  throw new Error(`${path} must be JSON-compatible.`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
