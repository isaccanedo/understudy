"use client";

import { useActionState, useEffect } from "react";
import { createFirstAdmin } from "@/app/actions/accounts";
import { authClient } from "@/lib/auth-client";
import { messages } from "@/lib/messages";
import { Input } from "@/components/ui/controls";

export function SetupForm({ domains }: { domains: string[] }) {
  const t = messages.setupFirst;
  const [state, action, pending] = useActionState(createFirstAdmin, null);
  useEffect(() => {
    if (!state?.email || !state.password) return;
    authClient.signIn.email({ email: state.email, password: state.password }).then(() => {
      window.location.href = "/";
    });
  }, [state]);
  return (
    <form action={action} className="card w-full p-6 flex flex-col gap-3">
      <h1 className="m-0 text-[17px] font-semibold">{t.title}</h1>
      <p className="m-0 text-ash text-[13px]">{t.body}</p>
      <div className="fld">
        <label htmlFor="name">{messages.auth.name}</label>
        <Input id="name" name="name" autoComplete="name" required />
      </div>
      <div className="fld">
        <label htmlFor="email">{messages.auth.email}</label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
        {domains.length > 0 && <div className="text-smoke text-[11.5px] mt-1">{messages.auth.domainHint(domains)}</div>}
      </div>
      <div className="fld">
        <label htmlFor="password">{messages.auth.password}</label>
        <Input id="password" name="password" type="password" minLength={8} autoComplete="new-password" required />
      </div>
      {state?.error && <div className="err" role="alert">{state.error}</div>}
      <button type="submit" className="btn pri w-full" disabled={pending}>
        {t.submit}
      </button>
    </form>
  );
}
