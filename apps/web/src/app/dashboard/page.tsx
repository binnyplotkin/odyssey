import { auth } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await auth();
  const firstName = session?.user?.name?.split(" ")[0] ?? "Explorer";

  return (
    <div className="px-6 py-10 md:px-10">
      <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
        Welcome back, {firstName}
      </h1>
      <p className="mt-2 text-sm text-white/50">
        The experience is being rebuilt around scenes. Check back soon.
      </p>
    </div>
  );
}
