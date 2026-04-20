import { listActiveWorlds } from "@/lib/worlds";
import { WorldsGrid } from "@/components/worlds-grid";

export const dynamic = "force-dynamic";

export default async function WorldsPage() {
  const worlds = await listActiveWorlds();

  return <WorldsGrid worlds={worlds} />;
}
