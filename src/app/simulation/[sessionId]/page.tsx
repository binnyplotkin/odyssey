import { notFound } from "next/navigation";
import { SimulationShell } from "@/components/simulation-shell";
import {
  createIntroResult,
  getSessionTurns,
  getVisibleWorldById,
  resumeSession,
} from "@/lib/simulation/service";

export default async function SimulationSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = await resumeSession(sessionId);

  if (!session) {
    notFound();
  }

  const world = await getVisibleWorldById(session.worldId);

  if (!world) {
    notFound();
  }

  const turns = await getSessionTurns(sessionId);
  const bootstrap = createIntroResult(session, world);

  return <SimulationShell initialData={{ ...bootstrap, turns }} />;
}
