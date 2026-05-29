import { notFound } from "next/navigation";
import { getSceneSessionStore } from "@odyssey/db";
import { SessionDetailWorkbench } from "@/components/session-detail-workbench";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const sceneDetail = await getSceneSessionStore().getSessionDetail(sessionId);

  if (!sceneDetail) notFound();

  return <SessionDetailWorkbench detail={sceneDetail} />;
}
