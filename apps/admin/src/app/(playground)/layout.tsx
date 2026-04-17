import { SessionProvider } from "next-auth/react";

/**
 * Minimal layout for playground routes — no AdminShell, no sidebar, no tab
 * bar. Auth is still enforced by middleware (see apps/admin/src/middleware.ts).
 * SessionProvider is here so client components can still read session.
 */
export default function PlaygroundLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionProvider>
      <div style={{ minHeight: "100vh", background: "var(--background)" }}>
        {children}
      </div>
    </SessionProvider>
  );
}
