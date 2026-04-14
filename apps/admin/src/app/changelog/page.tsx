import { getChangelogStore, getPlatformVersionStore } from "@odyssey/db";
import ChangelogClient from "./changelog-client";

export const dynamic = "force-dynamic";

export default async function ChangelogPage() {
  const [entries, versions] = await Promise.all([
    getChangelogStore().list(),
    getPlatformVersionStore().list(),
  ]);

  return <ChangelogClient entries={entries} versions={versions} />;
}
