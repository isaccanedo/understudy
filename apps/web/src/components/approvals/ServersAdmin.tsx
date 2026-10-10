"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { checkMcpServer, removeMcpServer, setServerAccess, setServerApprovals } from "@/app/actions/servers";
import { featuredFor } from "@/lib/connector-showcase";
import { messages } from "@/lib/messages";
import { Checkbox, Input } from "@/components/ui/controls";
import { Segmented } from "@/components/ui/Segmented";
import { ConnectorLogo, ConnectorShowcase } from "./ConnectorShowcase";

type ServerRow = { id: string; name: string; url: string; tools: string[] | null; askAll: boolean; askTools: string[]; allowedEmails: string[] | null };

function ApprovalRules({ server }: { server: ServerRow }) {
  const t = messages.admin;
  const [askAll, setAskAll] = useState(server.askAll);
  const [askTools, setAskTools] = useState(new Set(server.askTools));
  const [, start] = useTransition();
  const save = (all: boolean, tools: Set<string>) => start(() => setServerApprovals(server.id, all, [...tools]));
  return (
    <div className="flex flex-col gap-2 text-[12.5px]">
      <Checkbox
        className="!text-[12.5px]"
        checked={askAll}
        onChange={(e) => {
          setAskAll(e.target.checked);
          save(e.target.checked, askTools);
        }}
        label={t.serverAskAll}
      />
      {!askAll && server.tools && server.tools.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-2 pl-7">
          {server.tools.map((tool) => (
            <Checkbox
              key={tool}
              className="!text-[12.5px]"
              checked={askTools.has(tool)}
              onChange={() => {
                const next = new Set(askTools);
                if (next.has(tool)) next.delete(tool);
                else next.add(tool);
                setAskTools(next);
                save(askAll, next);
              }}
              label={<span className="font-mono">{tool}</span>}
            />
          ))}
        </div>
      )}
      {!askAll && server.tools && server.tools.length > 0 && <div className="fld-hint pl-7">{t.serverAskHint}</div>}
    </div>
  );
}

function AccessRules({ server }: { server: ServerRow }) {
  const t = messages.admin;
  const [everyone, setEveryone] = useState(server.allowedEmails === null);
  const [emails, setEmails] = useState((server.allowedEmails ?? []).join(", "));
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const save = (all: boolean, list: string) =>
    start(async () => {
      await setServerAccess(server.id, all, list);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  return (
    <div className="flex flex-col gap-2 text-[12.5px]">
      <div className="flex gap-3 flex-wrap items-center">
        <Segmented
          label={t.serverAccess}
          options={[
            { value: "all", label: t.serverEveryone },
            { value: "some", label: t.serverOnly },
          ]}
          value={everyone ? "all" : "some"}
          onChange={(choice) => {
            if (choice === "all") {
              setEveryone(true);
              save(true, emails);
            } else setEveryone(false);
          }}
        />
        {saved && <span className="text-green">{t.serverSaved}</span>}
      </div>
      {!everyone && (
        <div className="flex gap-2">
          <Input size="sm" placeholder={t.serverEmails} aria-label={t.serverEmails} value={emails} onChange={(e) => setEmails(e.target.value)} />
          <button type="button" className="btn sec sm" disabled={pending} onClick={() => save(false, emails)}>
            {t.serverSave}
          </button>
        </div>
      )}
    </div>
  );
}

function CheckAgain({ id }: { id: string }) {
  const t = messages.admin;
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      {result && <span className={`text-[12px] ${result.ok ? "text-green" : "text-coral"}`}>{result.message}</span>}
      <button type="button" className="btn sec sm" disabled={pending} onClick={() => start(async () => setResult(await checkMcpServer(id)))}>
        {pending ? t.serverChecking : t.serverCheck}
      </button>
    </>
  );
}

export function ConnectedActions({ id }: { id: string }) {
  const t = messages.admin;
  const router = useRouter();
  const [removing, startRemove] = useTransition();
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <CheckAgain id={id} />
      <button
        type="button"
        className="btn sec sm"
        disabled={removing}
        onClick={() =>
          startRemove(async () => {
            await removeMcpServer(id);
            router.push("/admin#connected-tools");
          })
        }
      >
        {t.serverRemove}
      </button>
    </div>
  );
}

export function ConnectorSettings({ server }: { server: ServerRow }) {
  return (
    <div className="flex flex-col gap-4">
      <AccessRules server={server} />
      <ApprovalRules server={server} />
    </div>
  );
}

export function ConnectorActionsList({ tools }: { tools: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tools.map((tool) => (
        <span key={tool} className="pill font-mono">
          {tool}
        </span>
      ))}
    </div>
  );
}

function ConnectedCard({ server }: { server: ServerRow }) {
  const t = messages.admin;
  const known = featuredFor(server.url);
  const down = server.tools === null;
  let host = server.url;
  try {
    host = new URL(server.url).host;
  } catch {}
  return (
    <li>
      <Link href={`/admin/connectors/${known?.id ?? server.id}`} className="conn-card conn-card-link">
        <ConnectorLogo connector={known ?? { name: server.name, url: server.url, publisher: { kind: "domain", label: host } }} />
        <span className="min-w-0 flex-1">
          <span className="conn-name">{server.name}</span>
          <span className="conn-by">{host}</span>
        </span>
        <span className={`pill ${down ? "c" : "g"}`}>{down ? t.connectedDown : t.connectedWorks(server.tools?.length ?? 0)}</span>
        <ChevronRight size={16} className="text-smoke flex-none" aria-hidden />
      </Link>
    </li>
  );
}

export type { ServerRow };

export function ServersAdmin({ servers }: { servers: ServerRow[] }) {
  const t = messages.admin;
  return (
    <section id="connected-tools" className="card p-5 flex flex-col gap-5 scroll-mt-6">
      {servers.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <h3 className="m-0 text-[14px] font-semibold">{t.connectedTitle(servers.length)}</h3>
          <ul className="conn-list" aria-label={t.connectedTitle(servers.length)}>
            {servers.map((server) => (
              <ConnectedCard key={server.id} server={server} />
            ))}
          </ul>
        </div>
      )}
      <ConnectorShowcase connectedUrls={servers.map((server) => server.url)} />
    </section>
  );
}
