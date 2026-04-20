import { notFound } from "next/navigation";
import { getAdminWorldRepository } from "@/lib/worlds";
import { WorldHeader } from "@/components/world-header";

type Params = Promise<{ worldId: string }>;

function inferStatus(
  world: { roles: unknown[]; characters: unknown[]; groups: unknown[]; eventTemplates: unknown[] },
): "live" | "draft" | "archived" {
  if (world.roles.length > 0 && world.characters.length > 0 && world.groups.length > 0 && world.eventTemplates.length > 0) {
    return "live";
  }
  return "draft";
}

export default async function WorldLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Params;
}) {
  const { worldId } = await params;
  const detail = await getAdminWorldRepository().getWorldDetail(worldId);
  if (!detail) notFound();

  const status = inferStatus(detail.world);

  return (
    <>
      <WorldHeader world={{ id: detail.world.id, title: detail.world.title, status }} />
      {children}
    </>
  );
}
