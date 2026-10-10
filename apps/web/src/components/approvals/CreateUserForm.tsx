"use client";

import { useActionState, useEffect, useRef } from "react";
import { createUserAccount } from "@/app/actions/accounts";
import { messages } from "@/lib/messages";
import { Field, Input } from "@/components/ui/controls";

function generate() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function CreateUserForm() {
  const t = messages.admin;
  const [state, action, pending] = useActionState(createUserAccount, null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (passwordRef.current && !passwordRef.current.value) passwordRef.current.value = generate();
  }, [state]);
  return (
    <form action={action} className="card p-5 flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 max-[640px]:grid-cols-1">
        <Field label={t.createName}>
          <Input name="name" autoComplete="off" />
        </Field>
        <Field label={t.createEmail}>
          <Input name="email" type="email" autoComplete="off" required />
        </Field>
      </div>
      <div className="flex items-end gap-2">
        <Field label={t.createPassword} className="flex-1">
          <Input ref={passwordRef} name="password" className="font-mono" autoComplete="off" minLength={8} required />
        </Field>
        <button
          type="button"
          className="btn sec flex-none"
          onClick={() => {
            if (passwordRef.current) passwordRef.current.value = generate();
          }}
        >
          {t.generate}
        </button>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn pri" disabled={pending}>
          {t.createSubmit}
        </button>
        {state?.message && <span className={`text-[12.5px] ${state.ok ? "text-green" : "text-coral"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
