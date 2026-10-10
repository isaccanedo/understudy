"use client";

import { authClient } from "@/lib/auth-client";
import { messages } from "@/lib/messages";

export function SignOut() {
  return (
    <button
      type="button"
      className="text-[11.5px] text-smoke hover:text-mist cursor-pointer bg-transparent border-0 p-0"
      onClick={async () => {
        await authClient.signOut();
        window.location.href = "/sign-in";
      }}
    >
      {messages.nav.signOut}
    </button>
  );
}
