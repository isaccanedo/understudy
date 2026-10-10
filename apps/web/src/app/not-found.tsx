import Link from "next/link";
import { messages } from "@/lib/messages";

export default function NotFound() {
  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="m-0 text-[20px] font-semibold">{messages.common.notFound}</h1>
        <Link href="/" className="btn sec">
          {messages.common.home}
        </Link>
      </div>
    </div>
  );
}
