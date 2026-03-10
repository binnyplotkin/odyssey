import { LandingPage } from "@/components/landing-page";
import { listWorlds } from "@/lib/simulation/service";

export default async function Home() {
  const worlds = await listWorlds();

  return <LandingPage worlds={worlds} />;
}
