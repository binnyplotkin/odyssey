import { HomeConsole } from "@/components/home-console";
import { listWorlds } from "@/lib/simulation/service";

export default async function Home() {
  const worlds = await listWorlds();

  return <HomeConsole initialWorlds={worlds} />;
}
