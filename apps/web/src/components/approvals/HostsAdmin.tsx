"use client";

import { Server } from "lucide-react";
import { useState, useTransition } from "react";
import { forgetHost, removeHost, trustHost } from "@/app/actions/hosts";
import { ConfirmButton } from "@/components/ConfirmButton";
import { hostName } from "@/lib/host-policy";
import { messages } from "@/lib/messages";
import { EmptyState } from "@/components/ui/EmptyState";

const t = messages.admin;

export type HostRow = { id: string; trusted: boolean; connected: boolean; agents: number; lastSeen: string };

function friendly(id: string) {
  const name = hostName(id);
  if (name.kind === "cloud") return t.hostCloud(name.ip);
  if (name.kind === "numbered") return t.hostNumbered(name.n);
  return name.id;
}

function status(host: HostRow) {
  if (!host.trusted) return host.connected ? { pill: "a", text: t.hostWaiting } : { pill: "c", text: t.hostRefused };
  return host.connected ? { pill: "g", text: t.hostOnline } : { pill: "", text: t.hostOffline };
}

export function HostsAdmin({ hosts }: { hosts: HostRow[] }) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  if (hosts.length === 0) return <EmptyState framed size="sm" mood="sleepy" title={messages.empty.machinesTitle} body={t.hostsEmpty} />;
  return (
    <ul className="card rows" aria-label={t.hostsTitle}>
      {hosts.map((host) => {
        const name = friendly(host.id);
        const state = status(host);
        const removable = !host.connected && host.agents === 0;
        return (
          <li key={host.id} className="row">
            <span className="row-icon" aria-hidden>
              <Server size={18} />
            </span>
            <div className="row-main">
              <div className="row-title">
                <span className="truncate">{name}</span>
                <span className={`pill ${state.pill}`}>
                  <span className="dot" />
                  {state.text}
                </span>
              </div>
              <div className="row-sub">{t.hostDetail(host.agents, host.lastSeen)}</div>
              {name !== host.id && <div className="row-id">{host.id}</div>}
              {failed === host.id && (
                <div role="alert" className="text-coral text-[12.5px]">
                  {t.hostRemoveFailed}
                </div>
              )}
            </div>
            <div className="row-actions">
              {host.trusted ? (
                <ConfirmButton label={t.hostForget} question={t.hostForgetConfirm(name)} disabled={pending} onConfirm={() => start(() => forgetHost(host.id))} />
              ) : (
                <ConfirmButton
                  label={t.hostTrust}
                  question={t.hostTrustConfirm(name)}
                  className="btn ok sm"
                  confirmClassName="btn ok sm"
                  disabled={pending}
                  onConfirm={() => start(() => trustHost(host.id))}
                />
              )}
              {removable && (
                <ConfirmButton
                  label={t.hostRemove}
                  question={t.hostRemoveConfirm(name)}
                  disabled={pending}
                  onConfirm={() =>
                    start(async () => {
                      setFailed(null);
                      const result = await removeHost(host.id);
                      if (!result.ok) setFailed(host.id);
                    })
                  }
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
