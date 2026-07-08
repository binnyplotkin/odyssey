export type VoiceStatus = "uploaded" | "processing" | "ready" | "failed";
export type VoiceAttemptStatus = "processing" | "succeeded" | "failed";
export type VoiceProvider = "pocket_tts" | "elevenlabs" | "openai" | "cartesia";
export type VoiceProviderConfig = {} | {
    voiceId: string;
    modelId?: string;
    stability?: number;
    similarityBoost?: number;
    style?: number;
} | {
    voice: string;
} | {
    voiceId: string;
    modelId?: string;
};
/**
 * Per-binding override of a bound voice's runtime knobs. Stored on the
 * character row (`characters.voice_settings`), provider-discriminated so the
 * resolver can narrow safely. Every field except `provider` is optional —
 * a sparse overlay applied on top of the voice's `providerConfig`. The
 * voice's identity (`voiceId` / `voice`) is intentionally never
 * overrideable here; that's what binding to a different voice is for.
 */
export type VoiceSettingsOverride = {
    provider: "pocket_tts";
} | {
    provider: "elevenlabs";
    modelId?: string;
    stability?: number;
    similarityBoost?: number;
    style?: number;
    speakerBoost?: boolean;
} | {
    provider: "openai";
} | {
    provider: "cartesia";
    modelId?: string;
};
export interface BoundCharacterPreview {
    id: string;
    title: string;
    thumbnailColor: string | null;
}
export interface VoiceRecord {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    provider: VoiceProvider;
    providerConfig: Record<string, unknown>;
    status: VoiceStatus;
    statusError: string | null;
    sourcePath: string | null;
    embeddingPath: string | null;
    previewPath: string | null;
    durationS: number | null;
    sampleRate: number | null;
    tags: string[];
    language: string | null;
    gender: string | null;
    license: string | null;
    attribution: string | null;
    archivedAt: string | null;
    createdBy: string | null;
    updatedBy: string | null;
    createdAt: string;
    updatedAt: string;
    boundCharacterCount?: number;
    boundCharacters?: BoundCharacterPreview[];
}
export interface CreateVoiceInput {
    slug: string;
    name: string;
    description?: string | null;
    provider?: VoiceProvider;
    providerConfig?: Record<string, unknown>;
    sourcePath?: string | null;
    durationS?: number | null;
    sampleRate?: number | null;
    tags?: string[];
    language?: string | null;
    gender?: string | null;
    license?: string | null;
    attribution?: string | null;
    createdBy?: string | null;
    status?: VoiceStatus;
}
export interface UpdateVoiceInput {
    name?: string;
    description?: string | null;
    provider?: VoiceProvider;
    providerConfig?: Record<string, unknown>;
    status?: VoiceStatus;
    statusError?: string | null;
    sourcePath?: string | null;
    embeddingPath?: string | null;
    previewPath?: string | null;
    durationS?: number | null;
    sampleRate?: number | null;
    tags?: string[];
    language?: string | null;
    gender?: string | null;
    license?: string | null;
    attribution?: string | null;
    archivedAt?: Date | string | null;
    updatedBy?: string | null;
}
export interface ListVoicesOptions {
    /** Include soft-deleted (archived) voices. Default false. */
    includeArchived?: boolean;
}
export interface VoicePreviewRecord {
    id: string;
    voiceId: string;
    label: string;
    path: string;
    /** Text the voice was asked to speak when this take was synthesized.
     * Null for legacy / imported takes registered via the `{label, path}`
     * payload (no synth, no prompt to record). */
    prompt: string | null;
    durationS: number | null;
    sampleRate: number | null;
    createdAt: string;
}
export interface CreatePreviewInput {
    label: string;
    path: string;
    prompt?: string | null;
    durationS?: number | null;
    sampleRate?: number | null;
}
export interface VoiceExtractionAttemptRecord {
    id: string;
    voiceId: string;
    attemptNumber: number;
    status: VoiceAttemptStatus;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
}
export interface FinishAttemptInput {
    status: Exclude<VoiceAttemptStatus, "processing">;
    error?: string | null;
}
/** Slim character row shape used by the voice detail page to render
 * bindings — just enough to render the avatar + title + slug + summary.
 */
export interface BoundCharacterSummary {
    id: string;
    slug: string;
    title: string;
    summary: string | null;
    image: string | null;
    thumbnailColor: string | null;
}
export interface VoiceStore {
    list(options?: ListVoicesOptions): Promise<VoiceRecord[]>;
    getById(id: string): Promise<VoiceRecord | null>;
    getBySlug(slug: string): Promise<VoiceRecord | null>;
    create(input: CreateVoiceInput): Promise<VoiceRecord>;
    update(id: string, input: UpdateVoiceInput): Promise<VoiceRecord | null>;
    /** Soft-delete — sets archivedAt. Characters bound to the voice keep
     * playing; the library UI filters them out. */
    archive(id: string, archivedBy?: string | null): Promise<VoiceRecord | null>;
    unarchive(id: string, unarchivedBy?: string | null): Promise<VoiceRecord | null>;
    /** Hard delete — cascades to previews + attempts. Prefer `archive`. */
    remove(id: string): Promise<boolean>;
    countCharactersUsing(voiceId: string): Promise<number>;
    listBoundCharacters(voiceId: string): Promise<BoundCharacterSummary[]>;
    listPreviews(voiceId: string): Promise<VoicePreviewRecord[]>;
    addPreview(voiceId: string, input: CreatePreviewInput): Promise<VoicePreviewRecord>;
    removePreview(previewId: string): Promise<boolean>;
    listAttempts(voiceId: string): Promise<VoiceExtractionAttemptRecord[]>;
    startAttempt(voiceId: string): Promise<VoiceExtractionAttemptRecord>;
    finishAttempt(attemptId: string, input: FinishAttemptInput): Promise<VoiceExtractionAttemptRecord | null>;
}
export declare function getVoiceStore(): VoiceStore;
export declare const VOICE_STATUS_FROM_ATTEMPT: Record<VoiceAttemptStatus, VoiceStatus>;
//# sourceMappingURL=voice-store.d.ts.map