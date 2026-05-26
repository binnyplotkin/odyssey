import type {
  CharacterBrainModel,
  CharacterIdentity,
  CharacterVoiceStyle,
} from "@odyssey/db";
import { CharactersGrid } from "@/components/characters-grid";
import { listCharacterSummaries } from "@/lib/characters-cache";

export type CharacterSummary = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  image: string | null;
  thumbnailColor: string | null;
  identity: CharacterIdentity | null;
  brainModel: CharacterBrainModel | null;
  voiceStyle: CharacterVoiceStyle | null;
  eraCount: number;
  pageCount: number;
  sourceCount: number;
  worldCount: number;
  bindingCount: number;
  lastIngestAt: string | null;
  ingestionStatus: "succeeded" | "failed" | "running" | "queued" | "canceled" | null;
  status: "live" | "draft";
};

export default async function CharactersPage() {
  const summaries = await listCharacterSummaries();
  return <CharactersGrid characters={summaries} />;
}
