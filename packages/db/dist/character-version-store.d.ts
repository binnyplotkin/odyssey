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
import type { BindingPriority, CharacterDirective, CharacterIdentity, CharacterBrainModel, CharacterRecord, CharacterVoiceStyle, EraConfig } from "./wiki-types";
/** Wiki binding row inside a version snapshot. */
export type CharacterVersionBindingSnapshot = {
    wikiId: string;
    priority: BindingPriority;
    isActive: boolean;
};
/** The full character config captured by a saved version. */
export type CharacterVersionSnapshot = {
    title: string;
    summary: string | null;
    image: string | null;
    eras: EraConfig[];
    ingestionPrompt: string | null;
    identity: CharacterIdentity | null;
    voiceStyle: CharacterVoiceStyle | null;
    brainModel: CharacterBrainModel | null;
    directive: CharacterDirective | null;
    voiceIdentityPageId: string | null;
    bindings: CharacterVersionBindingSnapshot[];
};
export type CharacterVersionRecord = {
    id: string;
    characterId: string;
    versionNumber: number;
    snapshot: CharacterVersionSnapshot;
    createdAt: string;
    createdBy: string | null;
};
export interface CharacterVersionStore {
    /** Versions for a character, newest first. */
    listForCharacter(characterId: string): Promise<CharacterVersionRecord[]>;
    /** Lookup a single version by id. */
    getById(id: string): Promise<CharacterVersionRecord | null>;
    /**
     * Snapshot the character's current state into a new version row. Returns
     * the new version with the auto-assigned `versionNumber`. Throws if the
     * character doesn't exist.
     */
    save(input: {
        characterId: string;
        createdBy?: string | null;
    }): Promise<CharacterVersionRecord>;
    /**
     * Apply a version's snapshot to the live character row + replace its
     * bindings with the snapshot's bindings list. Returns the updated
     * character or null when the version (or its character) is missing.
     */
    restore(versionId: string): Promise<CharacterRecord | null>;
    delete(id: string): Promise<boolean>;
}
export declare function getCharacterVersionStore(): CharacterVersionStore;
//# sourceMappingURL=character-version-store.d.ts.map