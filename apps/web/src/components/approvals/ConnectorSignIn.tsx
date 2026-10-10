"use client";

import { useState, useTransition } from "react";
import { LogIn } from "lucide-react";
import { signInToConnector } from "@/app/actions/servers";
import { messages } from "@/lib/messages";

export function ConnectorSignIn({ id, returnTo, label }: { id: string; returnTo: string; label: string }) {
  const t = messages.admin;
  const [going, start] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        className="btn pri sm"
        disabled={going}
        onClick={() =>
          start(async () => {
            const result = await signInToConnector(id, returnTo);
            if (result?.ok) window.location.assign(result.to);
            else setFailure(result?.message ?? t.signInFailed);
          })
        }
      >
        <LogIn size={13} aria-hidden />
        {going ? t.signInGoing : label}
      </button>
      {failure && (
        <p role="alert" className="m-0 text-[12.5px] text-coral">
          {failure}
        </p>
      )}
    </div>
  );
}
