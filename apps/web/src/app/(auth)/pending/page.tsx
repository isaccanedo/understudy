import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOut } from "@/components/SignOut";
import { messages } from "@/lib/messages";
import { currentUser } from "@/lib/session";

export default async function PendingPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (user.status === "approved") redirect("/");
  const rejected = user.status === "rejected";
  return (
    <div className="card w-full p-6 flex flex-col gap-3 text-center">
      <h1 className="m-0 text-[17px] font-semibold">{rejected ? messages.auth.rejectedTitle : messages.auth.pendingTitle}</h1>
      <p className="m-0 text-ash text-[13px]">{rejected ? messages.auth.rejectedBody : messages.auth.pendingBody}</p>
      <div className="text-smoke text-[12.5px]">{user.email}</div>
      {!rejected && (
        <Link href="/pending" className="btn sec">
          {messages.auth.checkAgain}
        </Link>
      )}
      <div>
        <SignOut />
      </div>
    </div>
  );
}
