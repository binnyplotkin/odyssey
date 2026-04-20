import { notFound } from "next/navigation";
import { getAdminWorldRepository } from "@/lib/worlds";
import { WorldSettingsPanel } from "@/components/world-settings-panel";

export const dynamic = "force-dynamic";

export default async function WorldSettingsPage({
  params,
}: {
  params: Promise<{ worldId: string }>;
}) {
  const { worldId } = await params;
  const detail = await getAdminWorldRepository().getWorldDetail(worldId);
  if (!detail) notFound();

  return <WorldSettingsPanel detail={detail} />;
}
