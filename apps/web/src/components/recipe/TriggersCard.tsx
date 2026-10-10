"use client";

import { CalendarClock, ChevronDown, Eye, Mail, Webhook, type LucideIcon } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { EmailCard } from "@/components/recipe/EmailCard";
import { WatchCard, type WatchState } from "@/components/recipe/WatchCard";
import { WebhookCard } from "@/components/recipe/WebhookCard";
import { formatNext, nextRun, WhenCard } from "@/components/recipe/WhenCard";
import { messages } from "@/lib/messages";

const t = messages.recipe;

type Trigger = "schedule" | "watch" | "email" | "webhook";

export type EmailTrigger = { domain: string; localPart: string | null; senders: string; ownerDomain: string } | null;

function TriggerRow({
  icon: Icon,
  label,
  summary,
  on,
  open,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  label: string;
  summary: string;
  on: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <li className={`rp-trigger ${open ? "is-open" : ""}`}>
      <button type="button" className="rp-trigger-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <Icon size={17} strokeWidth={1.9} className="rp-trigger-icon" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium">{label}</span>
          <span className="block text-[12px] text-smoke truncate">{summary}</span>
        </span>
        <span className={`pill ${on ? "g" : ""}`}>{on ? t.triggerOn : t.triggerOff}</span>
        <ChevronDown size={16} className="rp-trigger-chev" aria-hidden />
      </button>
      <div id={bodyId} hidden={!open} className="rp-trigger-body">
        {children}
      </div>
    </li>
  );
}

export function TriggersCard({
  recipeId,
  cron,
  timezone,
  onCron,
  onTimezone,
  watch,
  webhookEnabled,
  email,
}: {
  recipeId: string;
  cron: string;
  timezone: string;
  onCron: (value: string) => void;
  onTimezone: (value: string) => void;
  watch: WatchState;
  webhookEnabled: boolean;
  email: EmailTrigger;
}) {
  const [open, setOpen] = useState<Trigger | null>(null);
  const [watching, setWatching] = useState(Boolean(watch));
  const [webhookOn, setWebhookOn] = useState(webhookEnabled);
  const [emailOn, setEmailOn] = useState(Boolean(email?.localPart));
  const next = useMemo(() => nextRun(cron, timezone), [cron, timezone]);
  const toggle = (trigger: Trigger) => setOpen((current) => (current === trigger ? null : trigger));

  return (
    <section className="card rp-card" aria-labelledby="rp-when">
      <div>
        <h2 id="rp-when" className="rp-h2">
          {t.whenTitle}
        </h2>
        <p className="rp-hint">{t.whenHint}</p>
      </div>
      <ul className="rp-triggers">
        <TriggerRow
          icon={CalendarClock}
          label={t.triggers.schedule}
          summary={next ? t.nextRun(formatNext(next, timezone)) : next === undefined ? t.cronInvalid : t.manualOnly}
          on={Boolean(next)}
          open={open === "schedule"}
          onToggle={() => toggle("schedule")}
        >
          <WhenCard cron={cron} timezone={timezone} onCron={onCron} onTimezone={onTimezone} />
        </TriggerRow>
        <TriggerRow
          icon={Eye}
          label={t.triggers.watch}
          summary={watching ? watch?.url ?? t.triggerOn : t.triggers.watchHint}
          on={watching}
          open={open === "watch"}
          onToggle={() => toggle("watch")}
        >
          <WatchCard recipeId={recipeId} initial={watch} onState={setWatching} />
        </TriggerRow>
        {email && (
          <TriggerRow
            icon={Mail}
            label={t.triggers.email}
            summary={t.triggers.emailHint}
            on={emailOn}
            open={open === "email"}
            onToggle={() => toggle("email")}
          >
            <EmailCard recipeId={recipeId} domain={email.domain} initialLocalPart={email.localPart} initialSenders={email.senders} ownerDomain={email.ownerDomain} onState={setEmailOn} />
          </TriggerRow>
        )}
        <TriggerRow
          icon={Webhook}
          label={t.triggers.webhook}
          summary={t.triggers.webhookHint}
          on={webhookOn}
          open={open === "webhook"}
          onToggle={() => toggle("webhook")}
        >
          <WebhookCard recipeId={recipeId} initialEnabled={webhookEnabled} onState={setWebhookOn} />
        </TriggerRow>
      </ul>
    </section>
  );
}
