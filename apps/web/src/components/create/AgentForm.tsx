"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { Brain } from "@understudy/protocol";
import { createAgent } from "@/app/actions/agents";
import { AgentFigure } from "@/components/AgentFigure";
import { ConnectorSignIn } from "@/components/approvals/ConnectorSignIn";
import { LookPicker } from "@/components/create/LookPicker";
import type { AgentTools } from "@/lib/db/schema";
import type { Look } from "@/lib/look";
import { messages } from "@/lib/messages";
import { Input, Switch } from "@/components/ui/controls";
import { Segmented } from "@/components/ui/Segmented";

const t = messages.create;

export type AgentFormValues = {
  id?: string;
  name: string;
  role: string;
  look: Look;
  brain: Brain;
  tools: AgentTools;
};

function Toggle({ name, label, defaultOn, disabled }: { name: string; label: string; defaultOn: boolean; disabled?: boolean }) {
  const [on, setOn] = useState(defaultOn && !disabled);
  return <Switch name={name} label={label} checked={on} onChange={(e) => setOn(e.target.checked)} disabled={disabled} />;
}

export type ServerOption = {
  id: string;
  name: string;
  askAll?: boolean;
  adminAsk?: string[];
  signIn?: { signedIn: boolean };
  tools: { name: string; description?: string }[] | null;
};

type SlackMode = NonNullable<AgentTools["slackMode"]>;

function SlackAccess({ available, initial, admin }: { available: boolean; initial: AgentTools; admin: boolean }) {
  const [mode, setMode] = useState<SlackMode>(initial.slackMode === "off" || initial.slackMode === "free" ? initial.slackMode : "ask");
  if (!available) {
    return (
      <div className="fld-hint">
        {t.slackDisabled}
        {admin && (
          <>
            {" "}
            <Link href="/admin/slack" className="underline">
              {t.slackSetUp}
            </Link>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name="slackMode" value={mode} />
      <Segmented
        label={t.slackLabel}
        options={[
          { value: "ask", label: t.slackAsk },
          { value: "free", label: t.slackFree },
          { value: "off", label: t.slackOff },
        ]}
        value={mode}
        onChange={setMode}
      />
      <div className={`fld-hint ${mode === "free" ? "!text-amber" : ""}`}>{t.slackModeHint[mode]}</div>
    </div>
  );
}

function here() {
  return typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;
}

function ServerPicker({ servers, initial, admin }: { servers: ServerOption[]; initial: AgentTools; admin: boolean }) {
  const [on, setOn] = useState(new Set(initial.servers ?? []));
  const [ask, setAsk] = useState(new Set(initial.askTools ?? []));
  const flip = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };
  if (servers.length === 0) {
    return (
      <div className="rounded-[14px] border border-graphite px-3.5 py-3 flex flex-col gap-1.5 text-[12.5px]">
        <span className="text-ash">{t.noServersWhat}</span>
        {admin ? (
          <Link href="/admin#connected-tools" className="btn sec sm self-start">
            {t.addConnector}
          </Link>
        ) : (
          <span className="text-smoke">{t.noServersAskAdmin}</span>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {servers.map((server) => {
        const enabled = on.has(server.id);
        const adminAsk = new Set(server.adminAsk ?? []);
        return (
          <div key={server.id} className="rounded-[14px] border border-graphite px-3.5 py-3 flex flex-col gap-2.5">
            <Switch
              plain
              name="servers"
              value={server.id}
              checked={enabled}
              onChange={() => setOn((s) => flip(s, server.id))}
              label={<span className="font-medium">{server.name}</span>}
              hint={server.signIn && !server.signIn.signedIn ? t.serverNeedsYourSignIn(server.name) : server.tools === null ? t.serverUnreachable : t.serverToolCount(server.tools.length)}
            />
            {server.signIn && !server.signIn.signedIn && <ConnectorSignIn id={server.id} returnTo={here()} label={messages.admin.signInGo(server.name)} />}
            {server.signIn?.signedIn && <div className="fld-hint">{t.serverSignedInAsYou(server.name)}</div>}
            {enabled && server.askAll && <div className="fld-hint">{t.serverAdminAsksAll}</div>}
            {enabled && !server.askAll && server.tools && server.tools.length > 0 && (
              <div className="flex flex-col">
                <div className="flex items-center justify-between text-[11.5px] text-smoke pb-1 border-b border-graphite">
                  <span>{t.toolColumn}</span>
                  <span>{t.askFirst}</span>
                </div>
                {server.tools.map((tool) => {
                  const key = `${server.id}:${tool.name}`;
                  const locked = adminAsk.has(tool.name);
                  return (
                    <div key={key} className="flex items-center gap-3 py-1.5 border-b border-graphite last:border-b-0">
                      {locked ? (
                        <>
                          <div className="flex-1 min-w-0">
                            <div className="font-mono text-[12.5px] truncate">{tool.name}</div>
                            {tool.description && <div className="text-smoke text-[11.5px] line-clamp-2">{tool.description}</div>}
                          </div>
                          <span className="pill" title={t.serverAdminAsks}>
                            {t.alwaysAsks}
                          </span>
                        </>
                      ) : (
                        <Switch
                          plain
                          name="askTools"
                          value={key}
                          checked={ask.has(key)}
                          onChange={() => setAsk((s) => flip(s, key))}
                          label={<span className="font-mono text-[12.5px]">{tool.name}</span>}
                          hint={tool.description ? <span className="line-clamp-2">{tool.description}</span> : undefined}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AgentToolsFields({ tools, servers, slackAvailable, admin, showLabel = true }: { tools: AgentTools; servers: ServerOption[]; slackAvailable: boolean; admin: boolean; showLabel?: boolean }) {
  return (
    <>
      <div className="fld">
        {showLabel && <span className="fld-label">{t.toolsLabel}</span>}
        <div className="flex flex-col gap-2">
          <Toggle name="notifyOwner" label={t.toolNotify} defaultOn={tools.notifyOwner} />
        </div>
      </div>

      <div className="fld">
        <span className="fld-label">{t.toolSlack}</span>
        <SlackAccess available={slackAvailable} initial={tools} admin={admin} />
      </div>

      <div className="fld">
        <span className="fld-label">{t.toolServers}</span>
        <div className="fld-hint">{t.toolServersHint}</div>
        <ServerPicker servers={servers} initial={tools} admin={admin} />
      </div>
    </>
  );
}

export function AgentForm({ initial, slackAvailable, servers = [], admin = false }: { initial: AgentFormValues; slackAvailable: boolean; servers?: ServerOption[]; admin?: boolean }) {
  const [name, setName] = useState(initial.name);
  const [look, setLook] = useState<Look>(initial.look);
  const [brain, setBrain] = useState<Brain>(initial.brain);
  const router = useRouter();
  const [state, action, pending] = useActionState(createAgent, null);

  useEffect(() => {
    if (state?.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  return (
    <form action={action} className="grid grid-cols-[300px_1fr] gap-7 py-[22px] max-[900px]:grid-cols-1">
      <div className="card p-[26px] flex flex-col items-center gap-3.5 text-center self-start">
        <AgentFigure state="calm" size={140} look={look} />
        <div className="font-semibold text-[17px] break-words max-w-full">{name || t.namePlaceholder}</div>
        <LookPicker look={look} onChange={setLook} />
        <input type="hidden" name="look" value={JSON.stringify(look)} />
        <div className="muted text-[12px]">{t.lookHint}</div>
      </div>

      <div className="flex flex-col gap-[18px] min-w-0">
        <div className="fld">
          <label htmlFor="name">{t.name}</label>
          <Input
            id="name"
            name="name"
            placeholder={t.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
          />
        </div>
        <div className="fld">
          <label htmlFor="role">{t.role}</label>
          <Input id="role" name="role" placeholder={t.rolePlaceholder} defaultValue={initial.role} maxLength={200} />
        </div>

        <div className="fld">
          <span className="fld-label">{t.brainLabel}</span>
          <div className="grid grid-cols-2 gap-2.5 max-[600px]:grid-cols-1" role="radiogroup" aria-label={t.brainLabel}>
            {(["claude"] as Brain[]).map((b) => (
              <button key={b} type="button" role="radio" onClick={() => setBrain(b)} aria-checked={brain === b} className="choice">
                <b className="font-semibold">{messages.brains[b].name}</b>
                <span className="text-[11.5px] text-smoke">{messages.brains[b].plan}</span>
              </button>
            ))}
          </div>
          <input type="hidden" name="brain" value={brain} />
          <div className="fld-hint">{t.brainLock}</div>
        </div>

        <AgentToolsFields tools={initial.tools} servers={servers} slackAvailable={slackAvailable} admin={admin} />

        {state?.error && <div className="err" role="alert">{state.error}</div>}

        <div className="flex justify-end gap-2.5 flex-wrap items-center">
          <Link href="/" className="btn sec">
            {t.cancel}
          </Link>
          <button type="submit" className="btn pri" disabled={pending}>
            {t.submit}
          </button>
        </div>
      </div>
    </form>
  );
}
