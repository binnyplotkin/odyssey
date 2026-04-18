"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getCharacterStore,
  getWikiStore,
  isValidSlug,
  slugifyTitle,
  type Contradiction,
  type EraConfig,
  type Frontmatter,
  type Perspective,
  type TimeIndex,
  type UpdateCharacterInput,
  type WikiPageType,
} from "@odyssey/db";

/* ── Shared result shapes ──────────────────────────────────────── */

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/* ── Create ────────────────────────────────────────────────────── */

export async function createCharacter(input: {
  title: string;
  slug?: string;
  summary?: string;
  ingestionPrompt?: string;
  eras?: EraConfig[];
}): Promise<ActionResult<{ slug: string }>> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Title is required." };

  let slug = (input.slug?.trim() || slugifyTitle(title)).toLowerCase();
  if (!isValidSlug(slug)) {
    return {
      ok: false,
      error:
        "Slug must be lowercase kebab-case, start with a letter, 2–64 chars.",
    };
  }

  const store = getCharacterStore();
  const existing = await store.getBySlug(slug);
  if (existing) {
    return { ok: false, error: `Slug "${slug}" is already taken.` };
  }

  // Normalize eras: trim, dedupe keys, reindex order 0..N-1.
  const normalizedEras = normalizeEras(input.eras ?? []);

  await store.create({
    slug,
    title,
    summary: input.summary?.trim() || undefined,
    ingestionPrompt: input.ingestionPrompt?.trim() || undefined,
    eras: normalizedEras,
  });

  revalidatePath("/characters");
  redirect(`/characters/${slug}`);
}

function normalizeEras(eras: EraConfig[]): EraConfig[] {
  const seen = new Set<string>();
  const cleaned: EraConfig[] = [];
  for (const e of eras) {
    const key = e.key?.trim();
    const title = e.title?.trim();
    if (!key || !title) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ key, title, order: e.order ?? 0 });
  }
  return cleaned
    .sort((a, b) => a.order - b.order)
    .map((e, i) => ({ ...e, order: i }));
}

/* ── Update ────────────────────────────────────────────────────── */

export async function updateCharacterIngestionPrompt(
  id: string,
  ingestionPrompt: string,
): Promise<ActionResult> {
  const store = getCharacterStore();
  const existing = await store.getById(id);
  if (!existing) return { ok: false, error: "Character not found." };
  await store.update(id, { ingestionPrompt: ingestionPrompt.trim() || null } as UpdateCharacterInput);
  revalidatePath(`/characters/${existing.slug}`);
  revalidatePath("/characters");
  return { ok: true };
}

export async function updateCharacterEras(
  id: string,
  eras: EraConfig[],
): Promise<ActionResult> {
  const store = getCharacterStore();
  const existing = await store.getById(id);
  if (!existing) return { ok: false, error: "Character not found." };
  // Normalize: sort by order, reindex 0..N-1 to keep it dense.
  const normalized = [...eras]
    .sort((a, b) => a.order - b.order)
    .map((e, i) => ({ ...e, order: i }));
  await store.update(id, { eras: normalized });
  revalidatePath(`/characters/${existing.slug}`);
  return { ok: true };
}

export async function updateCharacterMeta(
  id: string,
  meta: { title?: string; summary?: string; image?: string | null },
): Promise<ActionResult> {
  const store = getCharacterStore();
  const existing = await store.getById(id);
  if (!existing) return { ok: false, error: "Character not found." };
  const patch: UpdateCharacterInput = {};
  if (meta.title !== undefined) {
    const t = meta.title.trim();
    if (!t) return { ok: false, error: "Title cannot be empty." };
    patch.title = t;
  }
  if (meta.summary !== undefined) patch.summary = meta.summary.trim() || null;
  if (meta.image !== undefined) patch.image = meta.image;
  await store.update(id, patch);
  revalidatePath(`/characters/${existing.slug}`);
  revalidatePath("/characters");
  return { ok: true };
}

/* ── Rebuild edges (safety valve) ──────────────────────────────── */

export async function rebuildCharacterEdges(
  id: string,
): Promise<ActionResult<{ added: number; removed: number }>> {
  const wiki = getWikiStore();
  const result = await wiki.rebuildEdges(id);
  const existing = await getCharacterStore().getById(id);
  if (existing) revalidatePath(`/characters/${existing.slug}`);
  return { ok: true, data: result };
}

/* ── Wiki pages ───────────────────────────────────────────────── */

export type UpdateWikiPageInput = {
  title: string;
  summary: string | null;
  body: string;
  /** Page type — reads only, cannot change (changing invalidates frontmatter). */
  type: WikiPageType;
  /** Immutable slug the caller supplies so the server can double-check identity. */
  slug: string;
  frontmatter: Frontmatter;
  perspective: Perspective;
  confidence: number;
  timeIndex: TimeIndex | null;
  knowsFuture: boolean;
  contradictions: Contradiction[];
};

export async function updateWikiPage(
  characterId: string,
  pageId: string,
  input: UpdateWikiPageInput,
): Promise<ActionResult<{ slug: string }>> {
  const wiki = getWikiStore();
  const existing = await wiki.getPage(pageId);
  if (!existing || existing.characterId !== characterId) {
    return { ok: false, error: "Page not found for this character." };
  }
  if (existing.slug !== input.slug) {
    return { ok: false, error: "Slug mismatch — reload and try again." };
  }
  if (existing.type !== input.type) {
    return { ok: false, error: "Page type can't change once the page exists." };
  }

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Title cannot be empty." };

  const confidence = Math.max(0, Math.min(1, input.confidence));

  // savePage handles material-change detection, version snapshotting, edge
  // reconciliation, and the authorKind / note fields. Pass authorKind:"human"
  // so the version history distinguishes user edits from LLM writes.
  await wiki.savePage({
    characterId,
    type: existing.type,
    slug: existing.slug,
    title,
    summary: input.summary?.trim() ?? null,
    body: input.body,
    frontmatter: input.frontmatter,
    perspective: input.perspective,
    confidence,
    timeIndex: input.timeIndex,
    knowsFuture: input.knowsFuture,
    contradictions: input.contradictions,
    authorKind: "human",
    note: "manual edit from admin UI",
  });

  const character = await getCharacterStore().getById(characterId);
  if (character) revalidatePath(`/characters/${character.slug}/wiki`);
  return { ok: true, data: { slug: existing.slug } };
}

/* ── Sources ───────────────────────────────────────────────────── */

export async function deleteSource(
  characterId: string,
  sourceId: string,
): Promise<ActionResult> {
  const wiki = getWikiStore();
  const source = await wiki.getSource(sourceId);
  if (!source || source.characterId !== characterId) {
    return { ok: false, error: "Source not found." };
  }
  const removed = await wiki.removeSource(sourceId);
  if (!removed) return { ok: false, error: "Delete failed." };
  const character = await getCharacterStore().getById(characterId);
  if (character) revalidatePath(`/characters/${character.slug}/sources`);
  return { ok: true };
}

/* ── Delete ────────────────────────────────────────────────────── */

export async function deleteCharacter(id: string): Promise<ActionResult> {
  const store = getCharacterStore();
  const existing = await store.getById(id);
  if (!existing) return { ok: false, error: "Character not found." };
  await store.remove(id);
  revalidatePath("/characters");
  redirect("/characters");
}
