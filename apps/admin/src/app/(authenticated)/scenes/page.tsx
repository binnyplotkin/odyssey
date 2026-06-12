import { ScenesGrid } from "@/components/scenes-grid";
import { listSceneSummaries } from "@/lib/scenes-cache";

export const dynamic = "force-dynamic";

export type SceneSummary = {
  id: string;
  title: string;
  prompt: string;
  status: "draft" | "active" | "archived";
  openingBeat: string | null;
  characterCount: number;
  updatedAt: string;
};

export default async function ScenesPage() {
  const scenes = await listSceneSummaries();
  return <ScenesGrid scenes={scenes} />;
}
