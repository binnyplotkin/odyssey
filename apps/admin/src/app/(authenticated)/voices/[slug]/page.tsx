import { notFound } from "next/navigation";
import {
  getVoiceStore,
  type BoundCharacterSummary,
  type VoiceStatus,
} from "@odyssey/db";
import {
  createEmbeddingSignedUrl,
  createSourceSignedUrl,
} from "@/lib/voices-storage";
import { VoiceDetail } from "@/components/voice-detail";

export const dynamic = "force-dynamic";

/** Mirror of VoiceSummary on the index page, plus the fields the detail
 * page needs (status_error, paths). Kept in the page file so the
 * server→client contract stays explicit. */
export type VoiceDetailData = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: VoiceStatus;
  statusError: string | null;
  sourcePath: string | null;
  embeddingPath: string | null;
  previewPath: string | null;
  durationS: number | null;
  sampleRate: number | null;
  createdAt: string;
  updatedAt: string;
};

export type VoiceDetailBindings = BoundCharacterSummary[];

type Params = Promise<{ slug: string }>;

export default async function VoiceDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const store = getVoiceStore();
  const voice = await store.getBySlug(slug);
  if (!voice) notFound();

  // Signed URLs are short-lived (1h default). Fetching them server-side keeps
  // the storage client out of the browser bundle and means the page hydrates
  // with playable URLs already in hand.
  const [bindings, sourceUrl, embeddingUrl, previewUrl] = await Promise.all([
    store.listBoundCharacters(voice.id),
    voice.sourcePath ? createSourceSignedUrl(voice.sourcePath).catch(() => null) : null,
    voice.embeddingPath
      ? createEmbeddingSignedUrl(voice.embeddingPath).catch(() => null)
      : null,
    voice.previewPath
      ? createEmbeddingSignedUrl(voice.previewPath).catch(() => null)
      : null,
  ]);

  const data: VoiceDetailData = {
    id: voice.id,
    slug: voice.slug,
    name: voice.name,
    description: voice.description,
    status: voice.status,
    statusError: voice.statusError,
    sourcePath: voice.sourcePath,
    embeddingPath: voice.embeddingPath,
    previewPath: voice.previewPath,
    durationS: voice.durationS,
    sampleRate: voice.sampleRate,
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
    />
  );
}
