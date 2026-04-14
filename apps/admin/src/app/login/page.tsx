import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/admin-login-form";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.role === "admin") redirect("/");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "url(/landing-hero.jpg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "brightness(0.4)",
        }}
      />
      <AdminLoginForm />
    </div>
  );
}
