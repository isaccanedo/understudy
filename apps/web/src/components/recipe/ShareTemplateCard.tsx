"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { exportTemplate } from "@/app/actions/templates";
import { messages } from "@/lib/messages";
import { Checkbox, Input, Textarea } from "@/components/ui/controls";

const t = messages.templates;

export function ShareTemplateCard({ recipeId, title, placeholders, beforeShare }: { recipeId: string; title: string; placeholders: string[]; beforeShare: () => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(title);
  const [description, setDescription] = useState("");
  const [schedule, setSchedule] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function share() {
    start(async () => {
      if (!(await beforeShare())) return;
      const result = await exportTemplate(recipeId, { title: name, description, includeSchedule: schedule });
      if (result.ok) setDone(true);
    });
  }

  return (
    <div className="card rp-card">
      <h3 className="m-0 text-[14px] font-semibold">{t.shareTitle}</h3>
      <p className="m-0 text-[12.5px] text-ash">{t.shareBody}</p>
      {done ? (
        <div className="text-[12.5px] text-green">
          {t.shared}{" "}
          <Link href="/templates" className="underline">
            {t.openGallery}
          </Link>
        </div>
      ) : open ? (
        <>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label={t.shareName} placeholder={t.shareName} />
          <Textarea
            size="sm"
            className="resize-none [field-sizing:content]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={600}
            placeholder={t.shareDescription}
            aria-label={t.shareDescription}
          />
          <Checkbox checked={schedule} onChange={(e) => setSchedule(e.target.checked)} label={t.shareSchedule} className="!text-[12.5px]" />
          <div className="text-[12px] text-smoke">{placeholders.length ? t.sharePlaceholders(placeholders) : t.shareNoPlaceholders}</div>
          <div className="flex gap-2">
            <button type="button" className="btn pri sm" disabled={pending} onClick={share}>
              {t.shareButton}
            </button>
            <button type="button" className="btn sec sm" onClick={() => setOpen(false)}>
              {messages.common.cancel}
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="btn sec sm self-start" onClick={() => setOpen(true)}>
          {t.shareOpen}
        </button>
      )}
    </div>
  );
}
