import { SweepsRoutePage } from "@/components/harness/eval-routes/sweeps-route-page";

type Params = Promise<{ slug: string; sweepId: string }>;

export default async function Page({ params }: { params: Params }) {
  const { sweepId } = await params;
  return <SweepsRoutePage selectedSweepId={sweepId} />;
}
