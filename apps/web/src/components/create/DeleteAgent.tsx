"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteAgent } from "@/app/actions/agents";
import { ConfirmButton } from "@/components/ConfirmButton";
import { messages } from "@/lib/messages";

export function DeleteAgent({ agentId, name }: { agentId: string; name: string }) {
  const t = messages.remove;
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <p className="m-0 min-w-0 flex-1 text-[12.5px] text-ash">{t.hint}</p>
      <ConfirmButton
        className="btn warn sm"
        label={t.button}
        question={t.confirm(name)}
        disabled={pending}
        onConfirm={() =>
          start(async () => {
            const result = await deleteAgent(agentId);
            router.push(result.redirectTo);
          })
        }
      />
    </div>
  );
}
