"use client";

import { Check } from "lucide-react";
import { useState, useTransition } from "react";
import { setAgentModel } from "@/app/actions/agents";
import { Select } from "@/components/ui/Select";
import { messages } from "@/lib/messages";
import { MODELS } from "@/lib/models";

const t = messages.models;

export function modelOptions(serverDefault: string | null) {
  return [
    { value: "", label: serverDefault ? t.defaultNamed(t.names[serverDefault]) : t.defaultBrain, description: t.defaultHint },
    ...MODELS.map((model) => ({ value: model, label: t.names[model], meta: t.meta[model], description: t.hints[model] })),
  ];
}

export function ModelPicker({ agentId, initial, serverDefault }: { agentId: string; initial: string | null; serverDefault: string | null }) {
  const [model, setModel] = useState(initial ?? "");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <span className="flex items-center gap-2 min-w-0 w-full">
      <Select
        value={model}
        aria-label={t.title}
        disabled={pending}
        options={modelOptions(serverDefault)}
        onChange={(next) => {
          setModel(next);
          setSaved(false);
          start(async () => {
            await setAgentModel(agentId, next);
            setSaved(true);
          });
        }}
      />
      <span className="w-4 flex-none" aria-live="polite">
        {saved && <Check size={16} className="text-green" aria-label={t.saved} />}
      </span>
    </span>
  );
}
