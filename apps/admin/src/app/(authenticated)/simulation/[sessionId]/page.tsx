import { InterviewSimulationConsole } from "@/components/interview-simulation-console";

export default async function SimulationSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  return <InterviewSimulationConsole sessionId={sessionId} />;
}
