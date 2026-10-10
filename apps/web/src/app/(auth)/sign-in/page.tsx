import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { env } from "@/lib/env";
import { currentUser } from "@/lib/session";
import { bootstrapAllowed, hasAnyUser } from "@/lib/users";

export default async function SignInPage() {
  const user = await currentUser();
  if (user) redirect(user.status !== "approved" ? "/pending" : user.mustChangePassword ? "/change-password" : "/");
  if (bootstrapAllowed() && !(await hasAnyUser())) redirect("/setup");
  return <AuthForm domains={env.allowedEmailDomains} google={env.googleEnabled} />;
}
