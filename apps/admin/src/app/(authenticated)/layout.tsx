import { cookies } from "next/headers";
import { AdminShell } from "@/components/admin-shell";

const SIDEBAR_COOKIE = "odyssey-sidebar-collapsed";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read the persisted sidebar state server-side so the first paint matches
  // the user's preference. Without this the sidebar always renders open and
  // then snaps closed once a useEffect reads localStorage post-hydration.
  const initialCollapsed =
    (await cookies()).get(SIDEBAR_COOKIE)?.value === "true";
  return <AdminShell initialCollapsed={initialCollapsed}>{children}</AdminShell>;
}
