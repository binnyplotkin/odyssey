import { notFound } from "next/navigation";
import { getWorldSessionStore } from "@odyssey/db";
import { SessionDetailWorkbench } from "@/components/session-detail-workbench";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const worldDetail = await getWorldSessionStore().getSessionDetail(sessionId);

  if (!worldDetail) notFound();

  return <SessionDetailWorkbench detail={worldDetail} />;
}
