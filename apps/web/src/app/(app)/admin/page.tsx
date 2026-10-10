import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { count, desc, isNotNull } from "drizzle-orm";
import { CreateUserForm } from "@/components/approvals/CreateUserForm";
import { HostsAdmin } from "@/components/approvals/HostsAdmin";
import { getHub } from "@/server/hub-access";
import { ServersAdmin } from "@/components/approvals/ServersAdmin";
import { listUpstreamTools } from "@/server/upstream";
import { UserActions } from "@/components/approvals/UserActions";
import { SettingsSection } from "@/components/ui/Section";
import { getDb, schema } from "@/lib/db";
import { formatDate, formatWhen } from "@/lib/format";
import { messages } from "@/lib/messages";
import { requireAdmin } from "@/lib/session";

const t = messages.admin;

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default async function AdminPage() {
  const me = await requireAdmin();
  const users = await getDb().select().from(schema.user).orderBy(desc(schema.user.createdAt));
  const servers = await getDb().select().from(schema.mcpServers).orderBy(desc(schema.mcpServers.createdAt));
  const serverRows = await Promise.all(
    servers.map(async (server) => ({
      id: server.id,
      name: server.name,
      url: server.url,
      tools: await listUpstreamTools(server, me.id).then((tools) => tools.map((tool) => tool.name), () => null),
      askAll: server.askAll,
      askTools: server.askTools ?? [],
      allowedEmails: server.allowedEmails ?? null,
    })),
  );
  const hostRows = await getDb().select().from(schema.hosts).orderBy(desc(schema.hosts.lastSeenAt));
  const bound = await getDb()
    .select({ hostId: schema.agents.hostId, agents: count() })
    .from(schema.agents)
    .where(isNotNull(schema.agents.hostId))
    .groupBy(schema.agents.hostId);
  const connected = new Set((getHub()?.stats().hosts ?? []).map((h) => h.hostId));
  const hosts = hostRows.map((host) => ({
    id: host.id,
    trusted: host.trusted,
    connected: connected.has(host.id),
    agents: bound.find((b) => b.hostId === host.id)?.agents ?? 0,
    lastSeen: formatWhen(host.lastSeenAt),
  }));
  const pending = users.filter((u) => u.status === "pending");
  const others = users.filter((u) => u.status !== "pending");
  const person = (u: (typeof users)[number]) => (
    <li key={u.id} className="row">
      <span className="row-av" aria-hidden>
        {initials(u.name || u.email)}
      </span>
      <div className="row-main">
        <div className="row-title">
          <span className="truncate">{u.name || u.email}</span>
          {u.id === me.id && <span className="pill s">{t.you}</span>}
          {u.admin && <span className="pill">{t.adminBadge}</span>}
          {u.status === "rejected" && <span className="pill c">{t.rejected}</span>}
          {u.mustChangePassword && u.status === "approved" && <span className="pill a">{t.mustChange}</span>}
        </div>
        <div className="row-sub truncate">
          {u.email} · {t.since(formatDate(u.createdAt))}
        </div>
      </div>
      <div className="row-actions">
        <UserActions userId={u.id} name={u.name || u.email} status={u.status} self={u.id === me.id} />
      </div>
    </li>
  );
  return (
    <div className="page">
      <div className="top">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </div>
      <div className="page-body set-page">
        {pending.length > 0 && (
          <SettingsSection id="pending" title={`${t.pending} · ${pending.length}`} hint={t.pendingHint}>
            <ul className="card rows" aria-label={t.pending}>
              {pending.map(person)}
            </ul>
          </SettingsSection>
        )}
        <SettingsSection id="create" title={t.createTitle} hint={t.createHint}>
          <CreateUserForm />
        </SettingsSection>
        <SettingsSection id="people" title={t.approved} hint={t.approvedHint}>
          <ul className="card rows" aria-label={t.approved}>
            {others.map(person)}
          </ul>
        </SettingsSection>
        <SettingsSection id="machines" title={t.hostsTitle} hint={t.hostsHint}>
          <HostsAdmin hosts={hosts} />
        </SettingsSection>
        <SettingsSection id="tools" title={t.serversTitle} hint={t.serversWhat}>
          <div className="tools-slot">
            <ServersAdmin servers={serverRows} />
          </div>
        </SettingsSection>
        <SettingsSection id="slack" title={t.slackTitle} hint={t.slackHint}>
          <Link href="/admin/slack" className="card row row-link no-underline">
            <span className="row-main">
              <span className="row-sub">{messages.slackAdmin.subtitle}</span>
            </span>
            <span className="btn sec sm">
              {t.slackOpen}
              <ChevronRight size={15} aria-hidden />
            </span>
          </Link>
        </SettingsSection>
      </div>
    </div>
  );
}
