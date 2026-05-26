import { notFound } from "next/navigation";
import {
  getVoiceStore,
  type BoundCharacterSummary,
  type VoiceProvider,
  type VoiceStatus,
  type VoicePreviewRecord,
  type VoiceExtractionAttemptRecord,
} from "@odyssey/db";
import {
  createEmbeddingSignedUrl,
  createSourceSignedUrl,
} from "@/lib/voices-storage";
import { VoiceDetail } from "@/components/voice-detail";

export const dynamic = "force-dynamic";

/** Mirror of VoiceSummary on the index page, plus every field the detail
 * page needs (curation metadata, audit fields, child collections). Kept
 * in the page file so the server→client contract stays explicit. */
export type VoiceDetailData = {
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
};

export type VoiceDetailBindings = BoundCharacterSummary[];

export type VoicePreviewWithUrl = VoicePreviewRecord & {
  playbackUrl: string | null;
};

export type VoiceAttemptRecord = VoiceExtractionAttemptRecord;

type Params = Promise<{ slug: string }>;

export default async function VoiceDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const store = getVoiceStore();
  const voice = await store.getBySlug(slug);
  if (!voice) notFound();

  // Signed URLs are short-lived (1h default). Fetching them server-side keeps
  // the storage client out of the browser bundle and means the page hydrates
  // with playable URLs already in hand. Previews + attempts are pulled in
  // the same Promise.all so the page renders in a single round-trip.
  const [
    bindings,
    sourceUrl,
    embeddingUrl,
    previewUrl,
    previewsRaw,
    attempts,
  ] = await Promise.all([
    store.listBoundCharacters(voice.id),
    voice.sourcePath ? createSourceSignedUrl(voice.sourcePath).catch(() => null) : null,
    voice.embeddingPath
      ? createEmbeddingSignedUrl(voice.embeddingPath).catch(() => null)
      : null,
    voice.previewPath
      ? createEmbeddingSignedUrl(voice.previewPath).catch(() => null)
      : null,
    store.listPreviews(voice.id),
    store.listAttempts(voice.id),
  ]);

  const previews: VoicePreviewWithUrl[] = await Promise.all(
    previewsRaw.map(async (p) => ({
      ...p,
      playbackUrl: await createEmbeddingSignedUrl(p.path).catch(() => null),
    })),
  );

  const data: VoiceDetailData = {
    id: voice.id,
    slug: voice.slug,
    name: voice.name,
    description: voice.description,
    provider: voice.provider,
    providerConfig: voice.providerConfig,
    status: voice.status,
    statusError: voice.statusError,
    sourcePath: voice.sourcePath,
    embeddingPath: voice.embeddingPath,
    previewPath: voice.previewPath,
    durationS: voice.durationS,
    sampleRate: voice.sampleRate,
    tags: voice.tags,
    language: voice.language,
    gender: voice.gender,
    license: voice.license,
    attribution: voice.attribution,
    archivedAt: voice.archivedAt,
    createdBy: voice.createdBy,
    updatedBy: voice.updatedBy,
    createdAt: voice.createdAt,
    updatedAt: voice.updatedAt,
  };

  return (
    <VoiceDetail
      voice={data}
      bindings={bindings}
      sourceUrl={sourceUrl}
      embeddingUrl={embeddingUrl}
      previewUrl={previewUrl}
      previews={previews}
      attempts={attempts}
    />
  );
}
