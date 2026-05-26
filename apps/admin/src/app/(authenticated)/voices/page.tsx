import type {
  BoundCharacterPreview,
  VoiceProvider,
  VoiceStatus,
} from "@odyssey/db";
import { VoicesGrid } from "@/components/voices-grid";
import { listVoiceSummaries } from "@/lib/voices-cache";

/** Summary shape consumed by VoicesGrid. Keeps the type co-located with the
 * page so server hydration and client rendering can't drift apart. */
export type VoiceSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  provider: VoiceProvider;
  status: VoiceStatus;
  statusError: string | null;
  durationS: number | null;
  sampleRate: number | null;
  boundCharacterCount: number;
  /* First 4 bound characters for the library card's avatar stack + name
   * pills. Empty array when unbound. The total count for the overflow
   * indicator lives on `boundCharacterCount`. */
  boundCharacters: BoundCharacterPreview[];
  createdAt: string;
  updatedAt: string;
};

export default async function VoicesPage() {
  const summaries = await listVoiceSummaries();
  return <VoicesGrid voices={summaries} />;
}
