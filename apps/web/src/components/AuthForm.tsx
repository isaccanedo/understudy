"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { messages } from "@/lib/messages";
import { Input } from "@/components/ui/controls";

export function AuthForm({ domains, google }: { domains: string[]; google: boolean }) {
  const t = messages.auth;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.email({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    });
    setBusy(false);
    if (result.error) {
      setError(t.failed);
      return;
    }
    window.location.href = "/";
  }

  return (
    <div className="card w-full p-6 flex flex-col gap-4">
      <h1 className="m-0 text-[17px] font-semibold">{t.signInTitle}</h1>
      {google && (
        <>
          <button
            type="button"
            className="btn sec w-full"
            onClick={() => authClient.signIn.social({ provider: "google", callbackURL: "/" })}
          >
            {t.google}
          </button>
          <div className="flex items-center gap-3 text-smoke text-[12px]">
            <span className="h-px flex-1 bg-graphite" />
            {t.or}
            <span className="h-px flex-1 bg-graphite" />
          </div>
        </>
      )}
      <form action={submit} className="flex flex-col gap-3">
        <div className="fld">
          <label htmlFor="email">{t.email}</label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
          {domains.length > 0 && <div className="text-smoke text-[11.5px] mt-1">{t.domainHint(domains)}</div>}
        </div>
        <div className="fld">
          <label htmlFor="password">{t.password}</label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {error && <div className="err" role="alert">{error}</div>}
        <button type="submit" className="btn pri w-full" disabled={busy}>
          {t.signIn}
        </button>
      </form>
      {domains.length > 0 ? (
        <div className="text-[12.5px] text-ash text-center">
          {t.noAccount}{" "}
          <Link href="/sign-up" className="text-mist">
            {t.createOne}
          </Link>
        </div>
      ) : (
        <div className="text-[12.5px] text-ash text-center">{t.signUpClosed}</div>
      )}
    </div>
  );
}
