/**
 * Character version store — named snapshots of full character config state.
 *
 * Each save captures the current authorial state (identity, voiceStyle,
 * brainModel, directive, ingestionPrompt, eras, voiceIdentityPageId, title,
 * summary, image) plus the wiki bindings list (wikiId, priority, isActive).
 * Wiki page/edge/source content is *not* snapshotted — those are shared
 * resources with their own change history; only the character's pointer
 * to them is captured.
 *
 * Version numbers are monotonic per character, computed at save time as
 * `MAX(versionNumber) + 1`. Names are not user-authored — every version
 * is `v{N}` for stable ordinal identity. Restoring a version overwrites
 * the live character row and replaces the bindings list. To preserve
 * history, save a snapshot first.
 */
import { and, desc, eq, max, sql } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { characterKnowledgeBindingsTable, characterVersionsTable, charactersTable, } from "./schema";
function requireDb() {
    const db = getDb();
    if (!db)
        throw new Error("DATABASE_URL is not configured");
    return db;
}
function toIso(d) {
    return typeof d === "string" ? d : d.toISOString();
}
function normalize(row) {
    return {
        id: row.id,
        characterId: row.characterId,
        versionNumber: row.versionNumber,
        snapshot: row.snapshot,
        createdAt: toIso(row.createdAt),
        createdBy: row.createdBy,
    };
}
function normalizeCharacter(row) {
    var _a, _b, _c, _d, _e, _f, _g;
    // Mirrors character-store.normalize() — voiceIdentityPageId stays in the
    // DB column (and in the version snapshot) but isn't surfaced on
    // CharacterRecord yet.
    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        image: row.image,
        thumbnailColor: row.thumbnailColor,
        voiceId: (_a = row.voiceId) !== null && _a !== void 0 ? _a : null,
        voiceSettings: (_b = row.voiceSettings) !== null && _b !== void 0 ? _b : null,
        eras: (_c = row.eras) !== null && _c !== void 0 ? _c : [],
        ingestionPrompt: row.ingestionPrompt,
        identity: (_d = row.identity) !== null && _d !== void 0 ? _d : null,
        voiceStyle: (_e = row.voiceStyle) !== null && _e !== void 0 ? _e : null,
        brainModel: (_f = row.brainModel) !== null && _f !== void 0 ? _f : null,
        directive: (_g = row.directive) !== null && _g !== void 0 ? _g : null,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
    };
}
export function getCharacterVersionStore() {
    return {
        async listForCharacter(characterId) {
            const db = requireDb();
            const rows = await retryRead(() => db
                .select()
                .from(characterVersionsTable)
                .where(eq(characterVersionsTable.characterId, characterId))
                .orderBy(desc(characterVersionsTable.versionNumber)));
            return rows.map(normalize);
        },
        async getById(id) {
            const db = requireDb();
            const [row] = await retryRead(() => db
                .select()
                .from(characterVersionsTable)
                .where(eq(characterVersionsTable.id, id))
                .limit(1));
            return row ? normalize(row) : null;
        },
        async save({ characterId, createdBy }) {
            var _a, _b, _c, _d, _e, _f;
            const db = requireDb();
            // Look up the character + bindings together so the snapshot reflects
            // a consistent moment in time.
            const [characterRow] = await retryRead(() => db
                .select()
                .from(charactersTable)
                .where(eq(charactersTable.id, characterId))
                .limit(1));
            if (!characterRow)
                throw new Error(`character ${characterId} not found`);
            const bindingRows = await retryRead(() => db
                .select({
                wikiId: characterKnowledgeBindingsTable.wikiId,
                priority: characterKnowledgeBindingsTable.priority,
                isActive: characterKnowledgeBindingsTable.isActive,
            })
                .from(characterKnowledgeBindingsTable)
                .where(eq(characterKnowledgeBindingsTable.characterId, characterId)));
            const snapshot = {
                title: characterRow.title,
                summary: characterRow.summary,
                image: characterRow.image,
                eras: (_a = characterRow.eras) !== null && _a !== void 0 ? _a : [],
                ingestionPrompt: characterRow.ingestionPrompt,
                identity: (_b = characterRow.identity) !== null && _b !== void 0 ? _b : null,
                voiceStyle: (_c = characterRow.voiceStyle) !== null && _c !== void 0 ? _c : null,
                brainModel: (_d = characterRow.brainModel) !== null && _d !== void 0 ? _d : null,
                directive: (_e = characterRow.directive) !== null && _e !== void 0 ? _e : null,
                voiceIdentityPageId: characterRow.voiceIdentityPageId,
                bindings: bindingRows.map((b) => ({
                    wikiId: b.wikiId,
                    priority: b.priority,
                    isActive: b.isActive,
                })),
            };
            // Compute next version number atomically. A race here is benign
            // because (characterId, versionNumber) is unique — a duplicate
            // insert will fail and the caller can retry.
            const [maxRow] = await retryRead(() => db
                .select({ n: max(characterVersionsTable.versionNumber) })
                .from(characterVersionsTable)
                .where(eq(characterVersionsTable.characterId, characterId)));
            const nextNumber = ((_f = maxRow === null || maxRow === void 0 ? void 0 : maxRow.n) !== null && _f !== void 0 ? _f : 0) + 1;
            const [inserted] = await db
                .insert(characterVersionsTable)
                .values({
                characterId,
                versionNumber: nextNumber,
                snapshot,
                createdBy: createdBy !== null && createdBy !== void 0 ? createdBy : null,
            })
                .returning();
            return normalize(inserted);
        },
        async restore(versionId) {
            const db = requireDb();
            const [versionRow] = await retryRead(() => db
                .select()
                .from(characterVersionsTable)
                .where(eq(characterVersionsTable.id, versionId))
                .limit(1));
            if (!versionRow)
                return null;
            const snapshot = versionRow.snapshot;
            // Overwrite the live character row with the snapshot's authorial fields.
            // `slug` is intentionally NOT restored — slugs are URL-stable identity
            // and shouldn't time-travel.
            const [updated] = await db
                .update(charactersTable)
                .set({
                title: snapshot.title,
                summary: snapshot.summary,
                image: snapshot.image,
                eras: snapshot.eras,
                ingestionPrompt: snapshot.ingestionPrompt,
                identity: snapshot.identity,
                voiceStyle: snapshot.voiceStyle,
                brainModel: snapshot.brainModel,
                directive: snapshot.directive,
                voiceIdentityPageId: snapshot.voiceIdentityPageId,
                updatedAt: sql `now()`,
            })
                .where(eq(charactersTable.id, versionRow.characterId))
                .returning();
            if (!updated)
                return null;
            // Replace the bindings list. Drop everything for this character then
            // re-insert from the snapshot.
            await db
                .delete(characterKnowledgeBindingsTable)
                .where(eq(characterKnowledgeBindingsTable.characterId, versionRow.characterId));
            if (snapshot.bindings.length > 0) {
                await db.insert(characterKnowledgeBindingsTable).values(snapshot.bindings.map((b) => ({
                    characterId: versionRow.characterId,
                    wikiId: b.wikiId,
                    priority: b.priority,
                    isActive: b.isActive,
                })));
            }
            return normalizeCharacter(updated);
        },
        async delete(id) {
            const db = requireDb();
            const rows = await db
                .delete(characterVersionsTable)
                .where(eq(characterVersionsTable.id, id))
                .returning({ id: characterVersionsTable.id });
            return rows.length > 0;
        },
    };
}
// Avoid unused-import warning when the file shrinks.
void and;
