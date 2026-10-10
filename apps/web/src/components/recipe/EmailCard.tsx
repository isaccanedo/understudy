"use client";

import { useState, useTransition } from "react";
import { setRecipeEmail, setRecipeEmailSenders } from "@/app/actions/recipes";
import { ConfirmButton } from "@/components/ConfirmButton";
import { messages } from "@/lib/messages";
import { Field, Input } from "@/components/ui/controls";

const t = messages.recipe;

export function EmailCard({
  recipeId,
  domain,
  initialLocalPart,
  initialSenders,
  ownerDomain,
  onState,
}: {
  recipeId: string;
  onState?: (on: boolean) => void;
  domain: string;
  initialLocalPart: string | null;
  initialSenders: string;
  ownerDomain: string;
}) {
  const [localPart, setLocalPart] = useState(initialLocalPart);
  const [senders, setSenders] = useState(initialSenders);
  const [saved, setSaved] = useState(initialSenders);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const address = localPart ? `${localPart}@${domain}` : null;

  function toggle(enabled: boolean) {
    start(async () => {
      const result = await setRecipeEmail(recipeId, enabled);
      setLocalPart(result.localPart);
      onState?.(Boolean(result.localPart));
      setCopied(false);
    });
  }

  function saveSenders() {
    start(async () => {
      const result = await setRecipeEmailSenders(recipeId, senders);
      setSenders(result.allowed);
      setSaved(result.allowed);
    });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-[12.5px] text-ash">{t.emailBody}</p>
      {address ? (
        <>
          <div className="flex gap-2">
            <Input size="sm" className="font-mono" readOnly value={address} onFocus={(e) => e.target.select()} aria-label={t.emailTitle} />
            <button
              type="button"
              className="btn sec sm"
              onClick={() => {
                navigator.clipboard?.writeText(address).then(() => setCopied(true), () => undefined);
              }}
            >
              {copied ? t.webhookCopied : t.webhookCopy}
            </button>
          </div>
          <Field label={t.emailSenders} hint={t.emailSendersHint(ownerDomain)}>
            <Input size="sm" value={senders} placeholder={ownerDomain} onChange={(e) => setSenders(e.target.value)} />
          </Field>
          <div className="flex gap-2 flex-wrap">
            {senders !== saved && (
              <button type="button" className="btn pri sm" disabled={pending} onClick={saveSenders}>
                {t.emailSaveSenders}
              </button>
            )}
            <ConfirmButton label={t.webhookRotate} question={t.emailRotateConfirm} confirmClassName="btn pri sm" disabled={pending} onConfirm={() => toggle(true)} />
            <button type="button" className="btn sec sm" disabled={pending} onClick={() => toggle(false)}>
              {t.webhookDisable}
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="btn sec sm self-start" disabled={pending} onClick={() => toggle(true)}>
          {t.emailEnable}
        </button>
      )}
    </div>
  );
}
