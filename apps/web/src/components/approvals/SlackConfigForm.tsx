"use client";

import { useActionState, useTransition } from "react";
import { removeSlackConfig, saveSlackConfig } from "@/app/actions/slack";
import { ConfirmButton } from "@/components/ConfirmButton";
import { messages } from "@/lib/messages";
import { Input } from "@/components/ui/controls";

const t = messages.slackAdmin;

export function SlackConfigForm({ connected }: { connected: boolean }) {
  const [state, action, saving] = useActionState(saveSlackConfig, null);
  const [removing, start] = useTransition();
  return (
    <div className="flex flex-col gap-2.5">
      <form action={action} className="flex flex-col gap-2.5" autoComplete="off">
        <Input name="botToken" type="password" className="font-mono" placeholder={t.botToken} aria-label={t.botToken} autoComplete="off" required />
        <Input name="signingSecret" type="password" className="font-mono" placeholder={t.signingSecret} aria-label={t.signingSecret} autoComplete="off" required />
        <div className="text-[11.5px] text-smoke">{t.storedSealed}</div>
        <button type="submit" className="btn pri self-start" disabled={saving}>
          {connected ? t.replace : t.save}
        </button>
        {state?.message && <div className={`text-[12.5px] ${state.ok ? "text-green" : "text-coral"}`}>{state.message}</div>}
      </form>
      {connected && <ConfirmButton label={t.remove} question={t.removeConfirm} disabled={removing} onConfirm={() => start(() => removeSlackConfig())} />}
    </div>
  );
}
