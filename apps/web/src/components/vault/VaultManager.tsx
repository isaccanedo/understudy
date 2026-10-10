import { useState } from "react";
import type { AgentLink } from "@/components/live/useAgentSocket";
import type { CredentialInfo } from "@/lib/db/schema";
import { ConfirmButton } from "@/components/ConfirmButton";
import { messages } from "@/lib/messages";
import { Input } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Look } from "@/lib/look";

export function VaultManager({ link, credentials, look }: { link: Pick<AgentLink, "live" | "send">; credentials: CredentialInfo[]; look?: Look }) {
  const t = messages.vault;
  const { live, send } = link;
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="ws-panel">
      <p className="ws-lead">{t.subtitle}</p>
      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4 @max-[760px]:grid-cols-1">
        <div className="card p-[18px] flex flex-col self-start min-w-0">
          {credentials.length === 0 && <EmptyState size="sm" look={look} mood="calm" title={messages.empty.loginsTitle} body={messages.empty.loginsBody} />}
          {credentials.map((c) => (
            <div key={c.name} className="flex items-center gap-3 border-t border-graphite py-2.5 first:border-0 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="font-mono truncate">{c.name}</div>
                <div className="text-smoke text-[12px] truncate">
                  {c.username}
                  {c.site ? ` · ${c.site}` : ""} · ••••••••
                </div>
              </div>
              <ConfirmButton
                label={t.remove}
                question={t.confirmRemove(c.name)}
                disabled={!live.online}
                onConfirm={() => send({ type: "credential_delete", name: c.name })}
              />
            </div>
          ))}
        </div>
        <form
          className="card p-[18px] flex flex-col gap-2.5 self-start"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            const name = String(data.get("name") ?? "").trim();
            const secret = String(data.get("secret") ?? "");
            if (!name || !secret) return;
            const ok = send({
              type: "credential_set",
              name,
              username: String(data.get("username") ?? "").trim(),
              secret,
              site: String(data.get("site") ?? "").trim() || undefined,
            });
            if (ok) {
              form.reset();
              setNotice(t.saved(name));
            }
          }}
        >
          <Input name="name" className="font-mono" placeholder={t.namePlaceholder} aria-label={t.name} required pattern="[A-Za-z0-9 .@_\-]{1,64}" maxLength={64} />
          <Input name="username" placeholder={t.username} aria-label={t.username} autoComplete="off" />
          <Input name="secret" type="password" placeholder={t.secret} aria-label={t.secret} autoComplete="new-password" required />
          <Input name="site" placeholder={t.site} aria-label={t.site} required />
          <div className="text-[11.5px] text-smoke">{t.replaceHint}</div>
          <button type="submit" className="btn pri self-start" disabled={!live.online}>
            {t.add}
          </button>
          {!live.online && <div className="text-smoke text-[12px]">{t.offline}</div>}
          {notice && <div className="text-green text-[12.5px]">{notice}</div>}
        </form>
      </div>
    </div>
  );
}
