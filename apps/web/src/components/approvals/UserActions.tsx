"use client";

import { useTransition } from "react";
import { setUserStatus } from "@/app/actions/accounts";
import { ConfirmButton } from "@/components/ConfirmButton";
import { messages } from "@/lib/messages";

const t = messages.admin;

export function UserActions({ userId, name, status, self }: { userId: string; name: string; status: string; self: boolean }) {
  const [pending, start] = useTransition();
  if (self) return null;
  return (
    <div className="flex gap-2 flex-wrap justify-end">
      {status !== "approved" && (
        <button className="btn ok sm" disabled={pending} onClick={() => start(() => setUserStatus(userId, "approved"))}>
          {t.approve}
        </button>
      )}
      {status === "pending" && (
        <button className="btn sec sm" disabled={pending} onClick={() => start(() => setUserStatus(userId, "rejected"))}>
          {t.reject}
        </button>
      )}
      {status === "approved" && (
        <ConfirmButton label={t.revoke} question={t.revokeConfirm(name)} disabled={pending} onConfirm={() => start(() => setUserStatus(userId, "rejected"))} />
      )}
    </div>
  );
}
