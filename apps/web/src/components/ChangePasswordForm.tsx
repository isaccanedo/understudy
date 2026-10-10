"use client";

import { useActionState, useEffect } from "react";
import { changeOwnPassword } from "@/app/actions/accounts";
import { messages } from "@/lib/messages";
import { Input } from "@/components/ui/controls";

export function ChangePasswordForm({ email }: { email: string }) {
  const t = messages.auth;
  const [state, action, pending] = useActionState(changeOwnPassword, null);
  useEffect(() => {
    if (state?.done) window.location.href = "/";
  }, [state]);
  return (
    <form action={action} className="card w-full p-6 flex flex-col gap-3">
      <h1 className="m-0 text-[17px] font-semibold">{t.changeTitle}</h1>
      <p className="m-0 text-ash text-[13px]">{t.changeBody}</p>
      <div className="text-smoke text-[12.5px]">{email}</div>
      <div className="fld">
        <label htmlFor="currentPassword">{t.currentPassword}</label>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
      </div>
      <div className="fld">
        <label htmlFor="newPassword">{t.newPassword}</label>
        <Input id="newPassword" name="newPassword" type="password" minLength={8} autoComplete="new-password" required />
      </div>
      {state?.error && <div className="err" role="alert">{state.error}</div>}
      <button type="submit" className="btn pri w-full" disabled={pending}>
        {t.changeSubmit}
      </button>
    </form>
  );
}
