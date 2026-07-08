import type { CharacterRecord, CreateCharacterInput, UpdateCharacterInput } from "./wiki-types";
export interface CharacterStore {
    list(): Promise<CharacterRecord[]>;
    getById(id: string): Promise<CharacterRecord | null>;
    getBySlug(slug: string): Promise<CharacterRecord | null>;
    create(input: CreateCharacterInput): Promise<CharacterRecord>;
    update(id: string, input: UpdateCharacterInput): Promise<CharacterRecord | null>;
    remove(id: string): Promise<boolean>;
    countWorldsFor(characterId: string): Promise<number>;
}
export declare function getCharacterStore(): CharacterStore;
//# sourceMappingURL=character-store.d.ts.map