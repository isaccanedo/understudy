import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { currentUser } from "@/lib/session";

export default async function ChangePasswordPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!user.mustChangePassword) redirect("/");
  return <ChangePasswordForm email={user.email} />;
}
