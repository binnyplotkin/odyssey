import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CredentialsAuthForm } from "@/components/credentials-auth-form";

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0C0E14]">
      <CredentialsAuthForm />
    </div>
  );
}
