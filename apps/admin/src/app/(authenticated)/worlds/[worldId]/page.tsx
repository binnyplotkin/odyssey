import { notFound } from "next/navigation";
import { getAdminWorldRepository } from "@/lib/worlds";
import { WorldOverview } from "@/components/world-overview";

export const dynamic = "force-dynamic";

export default async function WorldOverviewPage({
  params,
}: {
  params: Promise<{ worldId: string }>;
}) {
  const { worldId } = await params;
  const detail = await getAdminWorldRepository().getWorldDetail(worldId);
  if (!detail) notFound();

  return <WorldOverview detail={detail} />;
}
