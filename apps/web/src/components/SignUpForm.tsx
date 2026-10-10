"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { messages } from "@/lib/messages";
import { Input } from "@/components/ui/controls";

export function SignUpForm({ domains }: { domains: string[] }) {
  const t = messages.auth;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    const email = String(form.get("email") ?? "").trim();
    const result = await authClient.signUp.email({
      email,
      password: String(form.get("password") ?? ""),
      name: String(form.get("name") ?? "").trim() || email.split("@")[0],
    });
    setBusy(false);
    if (result.error) {
      setError(result.error.message || t.signUpFailed);
      return;
    }
    window.location.href = "/";
  }

  return (
    <div className="card w-full p-6 flex flex-col gap-4">
      <h1 className="m-0 text-[17px] font-semibold">{t.signUpTitle}</h1>
      <form action={submit} className="flex flex-col gap-3">
        <div className="fld">
          <label htmlFor="name">{t.name}</label>
          <Input id="name" name="name" autoComplete="name" required />
        </div>
        <div className="fld">
          <label htmlFor="email">{t.email}</label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
          {domains.length > 0 && <div className="text-smoke text-[11.5px] mt-1">{t.domainHint(domains)}</div>}
        </div>
        <div className="fld">
          <label htmlFor="password">{t.password}</label>
          <Input id="password" name="password" type="password" minLength={8} autoComplete="new-password" required />
        </div>
        {error && <div className="err" role="alert">{error}</div>}
        <button type="submit" className="btn pri w-full" disabled={busy}>
          {t.signUp}
        </button>
      </form>
      <div className="text-[12.5px] text-ash text-center">
        {t.haveAccount}{" "}
        <Link href="/sign-in" className="text-mist">
          {t.signInLink}
        </Link>
      </div>
    </div>
  );
}
