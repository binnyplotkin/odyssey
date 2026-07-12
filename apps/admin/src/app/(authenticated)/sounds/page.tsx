import type { AudioAssetSource, AudioAssetStatus } from "@odyssey/db";
import { getAudioAssetStore } from "@odyssey/db";
import { SoundsGrid } from "@/components/sounds-grid";

/** Summary shape consumed by SoundsGrid. Co-located with the page so
 * server hydration and client rendering can't drift apart. */
export type SoundSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  tags: string[];
  loopable: boolean;
  source: AudioAssetSource;
  generationPrompt: string | null;
  status: AudioAssetStatus;
  statusError: string | null;
  durationS: number | null;
  rmsDb: number | null;
  peakDb: number | null;
  createdAt: string;
  updatedAt: string;
};

export const dynamic = "force-dynamic";

export default async function SoundsPage() {
  const assets = await getAudioAssetStore().list();
  const sounds: SoundSummary[] = assets.map((a) => ({
    id: a.id,
    slug: a.slug,
    name: a.name,
    description: a.description,
    tags: a.tags,
    loopable: a.loopable,
    source: a.source,
    generationPrompt: a.generationPrompt,
    status: a.status,
    statusError: a.statusError,
    durationS: a.durationS,
    rmsDb: a.rmsDb,
    peakDb: a.peakDb,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }));
  return <SoundsGrid sounds={sounds} />;
}
