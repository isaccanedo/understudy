"use client";

import { useState, useTransition } from "react";
import { setRecipeWebhook } from "@/app/actions/recipes";
import { messages } from "@/lib/messages";
import { Input } from "@/components/ui/controls";

const t = messages.recipe;

export function WebhookCard({ recipeId, initialEnabled, onState }: { recipeId: string; initialEnabled: boolean; onState?: (on: boolean) => void }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [webhook, setWebhook] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle(enabled: boolean) {
    startTransition(async () => {
      const result = await setRecipeWebhook(recipeId, enabled);
      setWebhook(result.url);
      setEnabled(Boolean(result.url));
      onState?.(Boolean(result.url));
      setCopied(false);
    });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-[12.5px] text-ash">{t.webhookBody}</p>
      {enabled ? (
        <>
          {webhook ? (
            <>
              <div className="flex gap-2">
                <Input size="sm" className="font-mono" readOnly value={webhook} onFocus={(e) => e.target.select()} />
                <button
                  type="button"
                  className="btn sec sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(webhook).then(() => setCopied(true), () => undefined);
                  }}
                >
                  {copied ? t.webhookCopied : t.webhookCopy}
                </button>
              </div>
              <p className="m-0 text-[11.5px] text-smoke">{t.webhookShownOnce}</p>
            </>
          ) : (
            <p className="m-0 text-[12.5px] text-mist">{t.webhookOn}</p>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn sec sm" disabled={pending} onClick={() => toggle(true)}>
              {t.webhookRotate}
            </button>
            <button type="button" className="btn sec sm" disabled={pending} onClick={() => toggle(false)}>
              {t.webhookDisable}
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="btn sec sm self-start" disabled={pending} onClick={() => toggle(true)}>
          {t.webhookEnable}
        </button>
      )}
    </div>
  );
}
