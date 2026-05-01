import { notFound } from "next/navigation";
import { getAdminWorldRepository } from "@/lib/worlds";
import { WorldHeader } from "@/components/world-header";

// Async server shell — owns the world-detail lookup so the parent layout
// can stay synchronous. Wrapping THIS in <Suspense> keeps the suspense
// boundary inside the [worldId] segment, instead of falling back to the
// parent /worlds list loader. Mirrors the character-header-shell pattern.

function inferStatus(
  world: { roles: unknown[]; characters: unknown[]; groups: unknown[]; eventTemplates: unknown[] },
): "live" | "draft" | "archived" {
  if (world.roles.length > 0 && world.characters.length > 0 && world.groups.length > 0 && world.eventTemplates.length > 0) {
    return "live";
  }
  return "draft";
}

export async function WorldHeaderShell({ worldId }: { worldId: string }) {
  const detail = await getAdminWorldRepository().getWorldDetail(worldId);
  if (!detail) notFound();

  const status = inferStatus(detail.world);

  return <WorldHeader world={{ id: detail.world.id, title: detail.world.title, status }} />;
}
