import { listActiveWorlds } from "@/lib/worlds";
import { WorldEditor } from "@/components/world-editor";

export const dynamic = "force-dynamic";

export default async function EditorPage() {
  const worlds = await listActiveWorlds();
  const worldList = worlds.map((w) => ({ id: w.id, title: w.title }));

  return <WorldEditor worlds={worldList} />;
}
