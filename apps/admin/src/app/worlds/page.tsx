import { getWorldRepository } from "@odyssey/db";
import { WorldsGrid } from "@/components/worlds-grid";

export const dynamic = "force-dynamic";

export default async function WorldsPage() {
  const worlds = await getWorldRepository().listWorlds();

  return <WorldsGrid worlds={worlds} />;
}
