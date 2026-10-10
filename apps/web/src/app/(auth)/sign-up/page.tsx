import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/SignUpForm";
import { env } from "@/lib/env";
import { currentUser } from "@/lib/session";
import { bootstrapAllowed, hasAnyUser } from "@/lib/users";

export default async function SignUpPage() {
  const user = await currentUser();
  if (user) redirect(user.status !== "approved" ? "/pending" : "/");
  if (bootstrapAllowed() && !(await hasAnyUser())) redirect("/setup");
  if (env.allowedEmailDomains.length === 0) redirect("/sign-in");
  return <SignUpForm domains={env.allowedEmailDomains} />;
}
