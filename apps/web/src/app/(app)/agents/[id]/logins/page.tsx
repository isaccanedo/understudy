import { redirect } from "next/navigation";
import { agentTabPath } from "@/lib/workspace-tabs";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(agentTabPath(id, "logins"));
}
