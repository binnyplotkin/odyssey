import { getVoiceStore, type VoiceStatus } from "@odyssey/db";
import { VoicesGrid } from "@/components/voices-grid";

export const dynamic = "force-dynamic";

/** Summary shape consumed by VoicesGrid. Keeps the type co-located with the
 * page so server hydration and client rendering can't drift apart. */
export type VoiceSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: VoiceStatus;
  statusError: string | null;
  durationS: number | null;
  sampleRate: number | null;
  boundCharacterCount: number;
  createdAt: string;
  updatedAt: string;
};

export default async function VoicesPage() {
  const voices = await getVoiceStore().list();
  const summaries: VoiceSummary[] = voices.map((v) => ({
    id: v.id,
    slug: v.slug,
    name: v.name,
    description: v.description,
    status: v.status,
    statusError: v.statusError,
    durationS: v.durationS,
    sampleRate: v.sampleRate,
    boundCharacterCount: v.boundCharacterCount ?? 0,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  }));

  return <VoicesGrid voices={summaries} />;
}
