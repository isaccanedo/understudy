import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { Ban, Check, Clock, X } from "lucide-react";
import Link from "next/link";
import { accessibleAgentIds } from "@/lib/access";
import { AgentFigure } from "@/components/AgentFigure";
import { ApprovalItem } from "@/components/approvals/ApprovalItem";
import { AutoRefresh } from "@/components/AutoRefresh";
import { getDb, schema } from "@/lib/db";
import { formatDate, formatTime, formatWhen } from "@/lib/format";
import { messages } from "@/lib/messages";
import { requireUser } from "@/lib/session";
import { EmptyState } from "@/components/ui/EmptyState";

const t = messages.approvals;

const STATUS_ICON = { approved: Check, denied: X, expired: Clock, cancelled: Ban } as Record<string, typeof Check>;

function dayOf(date: Date) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return t.today;
  if (date.toDateString() === yesterday.toDateString()) return t.yesterday;
  return formatDate(date);
}

export default async function WaitingPage() {
  const user = await requireUser();
  const db = getDb();
  const ids = await accessibleAgentIds(user.id, ["owner", "approver"]);
  const scope = ids.length ? inArray(schema.agents.id, ids) : eq(schema.agents.id, "");
  const pending = await db
    .select({ approval: schema.approvals, agent: schema.agents })
    .from(schema.approvals)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.approvals.agentId))
    .where(and(scope, eq(schema.approvals.status, "pending")))
    .orderBy(desc(schema.approvals.createdAt));
  const answered = await db
    .select({ approval: schema.approvals, agent: schema.agents, answerer: schema.user.name })
    .from(schema.approvals)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.approvals.agentId))
    .leftJoin(schema.user, eq(schema.user.id, schema.approvals.answeredBy))
    .where(and(scope, ne(schema.approvals.status, "pending")))
    .orderBy(desc(schema.approvals.createdAt))
    .limit(30);
  const days = new Map<string, typeof answered>();
  for (const row of answered) {
    const label = dayOf(row.approval.answeredAt ?? row.approval.createdAt);
    days.set(label, [...(days.get(label) ?? []), row]);
  }
  return (
    <div className="page narrow">
      <AutoRefresh />
      <div className="top">
        <div>
          <h1 className="flex items-center gap-2.5">
            {t.title}
            {pending.length > 0 && <span className="wait-count">{pending.length}</span>}
          </h1>
          <p>{t.subtitle}</p>
        </div>
      </div>
      <div className="page-body">
        {pending.length === 0 && answered.length === 0 && (
          <EmptyState framed mood="happy" title={messages.empty.waitingTitle} body={messages.empty.waitingBody} action={{ href: "/settings", label: messages.empty.waitingAction, secondary: true }} />
        )}
        {pending.length === 0 && answered.length > 0 && (
          <div className="card wait-clear">
            <AgentFigure state="done" size={52} look={{ body: "cloud", color: "#3ECF8E", eyes: "happy" }} />
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-white">{messages.empty.waitingTitle}</div>
              <div className="text-[13px] text-ash">{messages.empty.waitingBody}</div>
            </div>
          </div>
        )}
        {pending.length > 0 && (
          <div className="flex flex-col gap-3">
            {pending.map(({ approval, agent }) => (
              <ApprovalItem
                key={approval.id}
                approval={{ id: approval.id, summary: approval.summary, fields: approval.fields }}
                agent={{ id: agent.id, name: agent.name, look: agent.look }}
                when={formatWhen(approval.createdAt)}
              />
            ))}
          </div>
        )}
        {days.size > 0 && (
          <section className="flex flex-col gap-3" aria-label={t.history}>
            <h2 className="m-0 text-[15px] font-semibold">{t.history}</h2>
            {[...days].map(([label, rows]) => (
              <div key={label} className="flex flex-col gap-2">
                <h3 className="wait-day">{label}</h3>
                <ul className="card rows">
                  {rows.map(({ approval, agent, answerer }) => {
                    const Icon = STATUS_ICON[approval.status] ?? Clock;
                    const tone = approval.status === "approved" ? "g" : approval.status === "denied" ? "c" : "";
                    return (
                      <li key={approval.id}>
                        <Link href={`/agents/${agent.id}`} className="row wait-row">
                          <AgentFigure state="calm" size={34} look={agent.look} />
                          <span className="row-main">
                            <span className="wait-summary">{approval.summary}</span>
                            <span className="row-sub">
                              {agent.name}
                              {answerer && approval.status !== "expired" ? ` · ${approval.status === "cancelled" ? t.stoppedBy(answerer) : t.answeredBy(answerer)}` : ""} · {formatTime(approval.answeredAt ?? approval.createdAt)}
                            </span>
                            {approval.note && <span className="wait-note">“{approval.note}”</span>}
                          </span>
                          <span className={`pill ${tone} inline-flex items-center gap-1 flex-none`}>
                            <Icon size={12} aria-hidden />
                            {t.status[approval.status]}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
