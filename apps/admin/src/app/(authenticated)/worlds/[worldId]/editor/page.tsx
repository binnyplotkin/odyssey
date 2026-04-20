import { notFound } from "next/navigation";
import { getAdminWorldRepository } from "@/lib/worlds";
import { WorldEditorCanvas } from "@/components/world-editor-canvas";

export const dynamic = "force-dynamic";

export default async function WorldEditorPage({
  params,
}: {
  params: Promise<{ worldId: string }>;
}) {
  const { worldId } = await params;
  const detail = await getAdminWorldRepository().getWorldDetail(worldId);
  if (!detail) notFound();

  return <WorldEditorCanvas fixedWorldId={detail.world.id} />;
}
