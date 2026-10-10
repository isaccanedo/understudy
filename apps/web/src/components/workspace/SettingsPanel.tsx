import { useEffect, useRef, useState, useTransition, type CSSProperties, type FormEvent } from "react";
import type { Brain, OwnerRule } from "@understudy/protocol";
import { updateAgentTools } from "@/app/actions/agents";
import { AgentFigure } from "@/components/AgentFigure";
import { AgentToolsFields, type AgentFormValues, type ServerOption } from "@/components/create/AgentForm";
import { BrainConnect } from "@/components/create/BrainConnect";
import { DeleteAgent } from "@/components/create/DeleteAgent";
import { LookSheet } from "@/components/create/LookPicker";
import { SharePanel } from "@/components/create/SharePanel";
import type { AgentLink } from "@/components/live/useAgentSocket";
import { ModelPicker } from "@/components/ModelPicker";
import { RulesEditor } from "@/components/RulesEditor";
import { Input } from "@/components/ui/controls";
import type { Look } from "@/lib/look";
import { messages } from "@/lib/messages";
import { PanelSection } from "./PanelSection";

export type SettingsData = {
  values: AgentFormValues & { id: string };
  slackAvailable: boolean;
  servers: ServerOption[];
  admin?: boolean;
  model: string | null;
  serverDefaultModel: string | null;
  rules: OwnerRule[];
  members: { userId: string; name: string; email: string; role: string }[];
};

function serialize(form: HTMLFormElement) {
  return new URLSearchParams(new FormData(form) as unknown as Record<string, string>).toString();
}

export function SettingsPanel({ link, data }: { link: Pick<AgentLink, "live" | "send">; data: SettingsData }) {
  const t = messages.setup;
  const { live, send } = link;
  const { values } = data;
  const [brain, setBrain] = useState<Brain>(values.brain);
  const [name, setName] = useState(values.name);
  const [look, setLook] = useState<Look>(values.look);
  const [lookOpen, setLookOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, start] = useTransition();
  const computerLine = live.online ? messages.home.computer.running : messages.home.computer[live.computerStatus] ?? "";

  const formRef = useRef<HTMLFormElement | null>(null);
  const snapshot = useRef<string | null>(null);

  useEffect(() => {
    if (formRef.current) snapshot.current = serialize(formRef.current);
  }, []);

  function check() {
    setTimeout(() => {
      const form = formRef.current;
      if (!form || snapshot.current === null) return;
      const changed = serialize(form) !== snapshot.current;
      setDirty(changed);
      if (changed) setSaved(false);
    }, 0);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    start(async () => {
      await updateAgentTools(values.id, form);
      snapshot.current = serialize(element);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    });
  }

  const slackMode = values.tools.slackMode === "off" || values.tools.slackMode === "free" ? values.tools.slackMode : "ask";
  const slackLabel = { ask: messages.create.slackAsk, free: messages.create.slackFree, off: messages.create.slackOff }[slackMode];
  const toolsSummary = [
    values.tools.notifyOwner ? t.notifySummary : null,
    data.slackAvailable ? t.slackSummary(slackLabel) : null,
    t.connectorsSummary(values.tools.servers?.length ?? 0),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="st-stack">
      <div className="st-lead">
        <p className="ws-lead">
          {computerLine}
          {live.computerMessage ? <span className="text-coral"> · {live.computerMessage}</span> : null}
        </p>
      </div>

      <form ref={formRef} onSubmit={save} onChange={check} onInput={check} onClick={check} className="flex flex-col gap-3">
        <PanelSection title={t.aboutTitle} hint={t.aboutHint}>
          <div className="st-hero">
            <div className="st-figure">
              <button
                type="button"
                className="figure-stage cursor-pointer border-0 p-0"
                style={{ "--tint": look.color } as CSSProperties}
                tabIndex={-1}
                aria-hidden
                onClick={() => setLookOpen(true)}
              >
                <AgentFigure state="calm" size={92} look={look} />
              </button>
              <button type="button" className="btn sec sm" onClick={() => setLookOpen(true)}>
                {t.changeLook}
              </button>
            </div>
            <div className="flex flex-col gap-3.5 min-w-0">
              <div className="fld">
                <label htmlFor="agent-name">{messages.create.name}</label>
                <Input id="agent-name" name="name" placeholder={messages.create.namePlaceholder} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
              </div>
              <div className="fld">
                <label htmlFor="agent-role">{messages.create.role}</label>
                <Input id="agent-role" name="role" placeholder={messages.create.rolePlaceholder} defaultValue={values.role} maxLength={200} />
              </div>
            </div>
          </div>
          <input type="hidden" name="look" value={JSON.stringify(look)} />
          <LookSheet
            open={lookOpen}
            look={look}
            onChange={(next) => {
              setLook(next);
              check();
            }}
            onClose={() => setLookOpen(false)}
          />
        </PanelSection>

        <PanelSection title={t.brainTitle} hint={t.brainHint}>
          <BrainConnect live={live} send={send} current={brain} onSelect={setBrain} />
          {values.brain === "claude" && (
            <div className="fld">
              <span className="fld-label">{messages.models.title}</span>
              <div className="max-w-[420px]">
                <ModelPicker agentId={values.id} initial={data.model} serverDefault={data.serverDefaultModel} />
              </div>
            </div>
          )}
          <p className="m-0 fld-hint">{messages.create.brainLock}</p>
        </PanelSection>

        <PanelSection title={t.toolsTitle} hint={toolsSummary} collapsible>
          <p className="m-0 fld-hint">{t.toolsHint}</p>
          <AgentToolsFields tools={values.tools} servers={data.servers} slackAvailable={data.slackAvailable} admin={Boolean(data.admin)} showLabel={false} />
        </PanelSection>

        {(dirty || saved) && (
          <div className="save-bar" role="status">
            <span className={dirty ? "" : "text-green"}>{dirty ? t.unsaved(name || values.name) : t.saved}</span>
            {dirty && (
              <button type="submit" className="btn pri sm" disabled={saving}>
                {t.saveChanges}
              </button>
            )}
          </div>
        )}
      </form>

      <PanelSection title={messages.rules.title} hint={t.rulesSummary(data.rules.length)} collapsible>
        <p className="m-0 fld-hint">{messages.rules.short}</p>
        <RulesEditor agentId={values.id} initial={data.rules} />
      </PanelSection>

      <PanelSection title={t.shareTitle} hint={t.shareSummary(data.members.length)} collapsible>
        <p className="m-0 fld-hint">{t.shareHint}</p>
        <SharePanel agentId={values.id} members={data.members} />
      </PanelSection>

      <PanelSection title={t.dangerTitle} hint={t.dangerHint} collapsible danger>
        <DeleteAgent agentId={values.id} name={values.name} />
      </PanelSection>
    </div>
  );
}
