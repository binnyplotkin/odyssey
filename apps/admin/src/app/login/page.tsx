import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/admin-login-form";
import { CoreBackground } from "@/components/core-background";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.role === "admin") redirect("/");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "row",
        overflow: "hidden",
        background: "#000a0f",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "relative",
          flex: "1 1 auto",
          minWidth: 0,
          height: "100%",
          overflow: "hidden",
        }}
      >
        <CoreBackground />
      </div>
      <aside
        style={{
          position: "relative",
          zIndex: 1,
          flex: "0 0 min(100vw, 460px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "min(100vw, 460px)",
          height: "100%",
          padding: "clamp(1.5rem, 4vw, 3rem)",
          background: "color-mix(in srgb, var(--panel) 92%, transparent)",
          backdropFilter: "blur(28px) saturate(1.2)",
          WebkitBackdropFilter: "blur(28px) saturate(1.2)",
          borderLeft: "1px solid rgba(223, 255, 245, 0.18)",
          boxShadow: "-28px 0 90px rgba(0, 0, 0, 0.42)",
        }}
      >
        <span aria-hidden="true" style={{ ...panelCornerPlusStyle, top: 18, left: 18 }}>
          +
        </span>
        <span aria-hidden="true" style={{ ...panelCornerPlusStyle, top: 18, right: 18 }}>
          +
        </span>
        <span aria-hidden="true" style={{ ...panelCornerPlusStyle, bottom: 18, left: 18 }}>
          +
        </span>
        <span aria-hidden="true" style={{ ...panelCornerPlusStyle, bottom: 18, right: 18 }}>
          +
        </span>
        <AdminLoginForm variant="side-panel" />
      </aside>
    </div>
  );
}

const panelCornerPlusStyle = {
  position: "absolute" as const,
  zIndex: 2,
  color: "rgba(223, 255, 245, 0.62)",
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "0.82rem",
  fontWeight: 500,
  lineHeight: 1,
  pointerEvents: "none" as const,
};
