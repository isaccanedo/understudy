import { redirect } from "next/navigation";
import { SetupForm } from "@/components/SetupForm";
import { env } from "@/lib/env";
import { bootstrapAllowed, hasAnyUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!bootstrapAllowed() || (await hasAnyUser())) redirect("/sign-in");
  return <SetupForm domains={env.allowedEmailDomains} />;
}
