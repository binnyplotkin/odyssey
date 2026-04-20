import { getWorldRepository } from "@odyssey/db";

export function getAdminWorldRepository() {
  return getWorldRepository([]);
}

export async function listActiveWorlds() {
  return getAdminWorldRepository().listWorlds();
}
