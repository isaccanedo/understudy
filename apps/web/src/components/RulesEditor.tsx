"use client";

import { X } from "lucide-react";
import { useState, useTransition } from "react";
import { describeRule, type OwnerRule } from "@understudy/protocol";
import { setAgentRules } from "@/app/actions/agents";
import { messages } from "@/lib/messages";
import { Input } from "@/components/ui/controls";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";

const t = messages.rules;

type Kind = OwnerRule["kind"];

const KINDS: { kind: Kind; label: string; hint: string; inputMode?: "decimal" }[] = [
  { kind: "max_amount", label: t.maxAmount, hint: "1000", inputMode: "decimal" },
  { kind: "allowed_email_domains", label: t.emailDomains, hint: t.emailDomainsHint },
  { kind: "blocked_site", label: t.blockedSite, hint: t.blockedSiteHint },
  { kind: "custom", label: t.custom, hint: t.customHint },
];

function draftRule(kind: Kind, value: string): Record<string, unknown> {
  if (kind === "max_amount") return { kind, amount: Number(value.replace(/[^\d.]/g, "")) };
  if (kind === "allowed_email_domains") return { kind, domains: value.split(/[\s,;]+/).filter(Boolean) };
  if (kind === "blocked_site") return { kind, site: value };
  return { kind, text: value };
}

export function RulesEditor({ agentId, initial }: { agentId: string; initial: OwnerRule[] }) {
  const [rules, setRules] = useState<OwnerRule[]>(initial);
  const [kind, setKind] = useState<Kind>("max_amount");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "saved" | "invalid">("idle");
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const current = KINDS.find((entry) => entry.kind === kind) ?? KINDS[0];

  const save = (next: unknown[], after?: () => void) => {
    setStatus("idle");
    start(async () => {
      const result = await setAgentRules(agentId, next);
      if (!result.ok) {
        setStatus("invalid");
        return;
      }
      setRules(result.rules);
      setStatus("saved");
      after?.();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {rules.length === 0 ? (
        <EmptyState size="sm" mood="waiting" title={messages.empty.rulesTitle} body={messages.empty.rulesBody} />
      ) : (
        <ul className="st-list">
          {rules.map((rule) => (
            <li key={rule.id}>
              <span className="flex-1 min-w-0 break-words">{describeRule(rule)}</span>
              <button
                type="button"
                className="btn sec sm !px-2"
                aria-label={`${t.remove}: ${describeRule(rule)}`}
                disabled={pending}
                onClick={() => save(rules.filter((other) => other.id !== rule.id))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {status === "saved" && !adding && (
        <span className="text-[12.5px] text-green" role="status">
          {t.saved}
        </span>
      )}
      {!adding ? (
        <button type="button" className="btn sec sm self-start" onClick={() => setAdding(true)}>
          {t.addOpen}
        </button>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!value.trim()) return;
            save([...rules, draftRule(kind, value.trim())], () => {
              setValue("");
              setAdding(false);
            });
          }}
        >
          <label className="fld min-w-[200px] flex-1 max-[520px]:basis-full">
            <span className="fld-label">{current.label}</span>
            <span className="flex gap-2 max-[520px]:flex-col">
              <Select
                className="!w-[46%] flex-none max-[520px]:!w-full"
                value={kind}
                disabled={pending}
                onChange={(next) => setKind(next as Kind)}
                aria-label={t.title}
                options={KINDS.map((entry) => ({ value: entry.kind, label: entry.label }))}
              />
              <Input
                className="flex-1 min-w-0"
                value={value}
                placeholder={current.hint}
                inputMode={current.inputMode}
                maxLength={300}
                disabled={pending}
                onChange={(event) => setValue(event.target.value)}
                aria-label={current.label}
              />
            </span>
          </label>
          <button type="submit" className="btn pri" disabled={pending || !value.trim()}>
            {t.add}
          </button>
          <button type="button" className="btn sec" disabled={pending} onClick={() => setAdding(false)}>
            {messages.common.cancel}
          </button>
          {status === "invalid" && (
            <span role="alert" className="text-[12.5px] text-coral self-center basis-full">
              {t.invalid}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
