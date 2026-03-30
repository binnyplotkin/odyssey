import { getWorldRepository } from "@odyssey/db";
import { WorldEditorCanvas } from "@/components/world-editor-canvas";

export const dynamic = "force-dynamic";

export default async function WorldEditorPage() {
  const worlds = await getWorldRepository().listWorlds();
  const worldList = worlds.map((w) => ({ id: w.id, title: w.title }));

  return <WorldEditorCanvas worlds={worldList} />;
}
