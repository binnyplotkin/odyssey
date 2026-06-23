import type {
  SourceMetadataFilterField,
  SourceMetadataFilters,
  WikiSourceRecord,
} from "@odyssey/db";

export const SOURCE_METADATA_FILTER_FIELDS = [
  "character_focus",
  "canonicality",
  "knowledge_accessible",
  "location",
  "themes",
  "participants",
  "speaker",
  "time_period",
  "chronological_order",
] as const satisfies readonly SourceMetadataFilterField[];

export const SOURCE_METADATA_FILTER_LABELS: Record<
  SourceMetadataFilterField,
  string
> = {
  character_focus: "Character",
  canonicality: "Canonicality",
  knowledge_accessible: "Accessible",
  location: "Location",
  themes: "Theme",
  participants: "Participant",
  speaker: "Speaker",
  time_period: "Time period",
  chronological_order: "Chronology",
};

const QUERY_ALIASES: Record<string, SourceMetadataFilterField> = {
  character: "character_focus",
  character_focus: "character_focus",
  canonicality: "canonicality",
  accessible: "knowledge_accessible",
  knowledge_accessible: "knowledge_accessible",
  location: "location",
  theme: "themes",
  themes: "themes",
  participant: "participants",
  participants: "participants",
  speaker: "speaker",
  time_period: "time_period",
  chronology: "chronological_order",
  chronological_order: "chronological_order",
};

type SearchParamRecord = Record<
  string,
  string | string[] | undefined
>;

export function parseSourceMetadataFilters(
  params: URLSearchParams | SearchParamRecord,
): SourceMetadataFilters {
  const filters: SourceMetadataFilters = {};
  const valuesByField = new Map<SourceMetadataFilterField, string[]>();

  for (const [queryKey, field] of Object.entries(QUERY_ALIASES)) {
    const values = readValues(params, queryKey);
    if (values.length === 0) continue;
    valuesByField.set(field, [...(valuesByField.get(field) ?? []), ...values]);
  }

  for (const field of SOURCE_METADATA_FILTER_FIELDS) {
    const values = valuesByField.get(field) ?? [];
    if (values.length === 0) continue;
    if (field === "knowledge_accessible") {
      const parsed = parseBoolean(values[0]);
      if (parsed != null) filters[field] = parsed;
      continue;
    }
    if (field === "chronological_order") {
      const value = values[0];
      if (/^-?\d+(?:\.\d+)?$/.test(value)) filters[field] = Number(value);
      else filters[field] = value;
      continue;
    }

    filters[field] = values.length === 1 ? values[0] : values;
  }

  return filters;
}

export function serializeSourceMetadataFilters(
  filters: SourceMetadataFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const field of SOURCE_METADATA_FILTER_FIELDS) {
    const value = filters[field];
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) appendString(params, field, item);
      continue;
    }
    if (typeof value === "boolean") {
      params.set(field, value ? "true" : "false");
      continue;
    }
    if (typeof value === "number") {
      params.set(field, String(value));
      continue;
    }
    appendString(params, field, value);
  }
  return params;
}

export function sourceMetadataFilterCount(filters: SourceMetadataFilters) {
  return SOURCE_METADATA_FILTER_FIELDS.reduce(
    (count, field) => count + (filters[field] == null ? 0 : 1),
    0,
  );
}

export function sourceMetadataFilterText(
  filters: SourceMetadataFilters,
  field: SourceMetadataFilterField,
) {
  const value = filters[field];
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export function getSourceParsedMetadata(
  source: WikiSourceRecord,
): Record<string, unknown> {
  const frontmatter = source.metadata.frontmatter;
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    return {};
  }
  return frontmatter as Record<string, unknown>;
}

export function sourceMetadataPreview(source: WikiSourceRecord): string | null {
  const metadata = getSourceParsedMetadata(source);
  const parts = [
    metadata.canonicality,
    metadata.time_period,
    firstListValue(metadata.location),
    firstListValue(metadata.themes),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .slice(0, 4);

  return parts.length > 0 ? parts.join(" · ") : null;
}

function readValues(
  params: URLSearchParams | SearchParamRecord,
  key: string,
): string[] {
  const raw =
    params instanceof URLSearchParams
      ? params.getAll(key)
      : arrayify(params[key]);
  return raw
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function arrayify(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function appendString(params: URLSearchParams, field: string, value: string) {
  const trimmed = value.trim();
  if (trimmed) params.append(field, trimmed);
}

function parseBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return null;
}

function firstListValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }
  return typeof value === "string" ? value : null;
}
