import { requireUser } from "@/lib/session";

export default async function FocusLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <div className="min-h-screen bg-ink">{children}</div>;
}
