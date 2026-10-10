"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteTemplate, installTemplate } from "@/app/actions/templates";
import { ConfirmButton } from "@/components/ConfirmButton";
import { messages } from "@/lib/messages";
import { Input } from "@/components/ui/controls";
import { Select } from "@/components/ui/Select";

const t = messages.templates;

type TemplateView = {
  id: string;
  title: string;
  description: string;
  steps: { text: string; ask: boolean }[];
  placeholders: string[];
  scheduled: boolean;
  uses: number;
  author: string;
};

export function TemplateCard({ template, agents, canDelete }: { template: TemplateView; agents: { id: string; name: string }[]; canDelete: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function install() {
    setError(null);
    start(async () => {
      const result = await installTemplate(template.id, agentId, values);
      if (!result.ok || !("redirectTo" in result) || !result.redirectTo) {
        setError(("error" in result && result.error) || messages.common.error);
        return;
      }
      router.push(result.redirectTo);
    });
  }

  return (
    <section className="card p-[18px] flex flex-col gap-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[15px] font-semibold">{template.title}</h3>
          {template.description && <p className="m-0 mt-1 text-[13px] text-ash">{template.description}</p>}
          <div className="text-smoke text-[12px] mt-1">{t.meta(template.steps.length, template.uses, template.author, template.scheduled)}</div>
        </div>
        {!open && (
          <button type="button" className="btn pri sm" onClick={() => setOpen(true)} disabled={agents.length === 0}>
            {t.use}
          </button>
        )}
      </div>
      <ol className="m-0 pl-5 list-decimal text-[13px] flex flex-col gap-0.5">
        {template.steps.slice(0, open ? 100 : 4).map((step, i) => (
          <li key={i} className={step.ask ? "font-semibold" : "text-ash"}>
            {step.text}
            {step.ask && <span className="pill c ml-2 !text-[10.5px]">{t.asks}</span>}
          </li>
        ))}
        {!open && template.steps.length > 4 && <li className="text-smoke list-none">{t.more(template.steps.length - 4)}</li>}
      </ol>
      {agents.length === 0 && <div className="text-smoke text-[12.5px]">{t.noAgents}</div>}
      {open && (
        <div className="flex flex-col gap-2.5 border-t border-graphite pt-3">
          <label className="fld">
            <span className="fld-label">{t.into}</span>
            <Select aria-label={t.into} value={agentId} onChange={setAgentId} options={agents.map((agent) => ({ value: agent.id, label: agent.name }))} />
          </label>
          {template.placeholders.length > 0 && <div className="text-[12.5px] text-ash">{t.fillHint}</div>}
          {template.placeholders.map((name) => (
            <label key={name} className="fld">
              <span className="fld-label">{name}</span>
              <Input value={values[name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))} maxLength={300} />
            </label>
          ))}
          <p className="m-0 text-[12px] text-smoke">{t.safety}</p>
          <div className="flex gap-2 flex-wrap items-center">
            <button type="button" className="btn pri" disabled={pending || !agentId} onClick={install}>
              {t.install}
            </button>
            <button type="button" className="btn sec" onClick={() => setOpen(false)}>
              {messages.common.cancel}
            </button>
            {error && <span className="text-coral text-[12.5px]">{error}</span>}
          </div>
        </div>
      )}
      {canDelete && !open && (
        <div className="self-end">
          <ConfirmButton label={t.remove} question={t.removeConfirm} onConfirm={() =>
              start(async () => {
                await deleteTemplate(template.id);
                router.refresh();
              })
            }
          />
        </div>
      )}
    </section>
  );
}
