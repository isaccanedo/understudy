import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc } from "drizzle-orm";
import { ConnectForm, ConnectorLogo, ManualConnectForm } from "@/components/approvals/ConnectorShowcase";
import { ConnectedActions, ConnectorActionsList, ConnectorSettings } from "@/components/approvals/ServersAdmin";
import { ConnectorSignIn } from "@/components/approvals/ConnectorSignIn";
import { CUSTOM_CONNECTOR, featuredById, featuredFor, fromCatalog, publisherLine, sameAddress, type Connector } from "@/lib/connector-showcase";
import { getDb, schema } from "@/lib/db";
import { messages } from "@/lib/messages";
import { requireAdmin } from "@/lib/session";
import { searchCatalog } from "@/server/connector-catalog";
import { oauthCallbackUrl, usesOAuth } from "@/server/connector-oauth";
import { listUpstreamTools } from "@/server/upstream";

const t = messages.admin;

type Server = typeof schema.mcpServers.$inferSelect;

async function fromRegistry(id: string | undefined, query: string | undefined) {
  if (!id || !query) return null;
  const found = await searchCatalog(query);
  const entry = found.ok ? found.entries.find((candidate) => candidate.id === id) : undefined;
  return entry ? (featuredFor(entry.url) ?? fromCatalog(entry)) : null;
}

function asConnector(server: Server): Connector {
  let host = server.url;
  try {
    host = new URL(server.url).host;
  } catch {}
  return { id: server.id, name: server.name, url: server.url, publisher: { kind: "domain", label: host }, featured: false };
}

function Back() {
  return (
    <Link href="/admin#connected-tools" className="conn-back">
      <ArrowLeft size={15} aria-hidden />
      {t.connectorsBack}
    </Link>
  );
}

export default async function ConnectorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ id?: string; q?: string; signin?: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const query = await searchParams;

  if (id === CUSTOM_CONNECTOR)
    return (
      <div className="page narrow">
        <div className="conn-page">
          <Back />
          <header className="conn-hero">
            <span className="conn-custom-icon is-big" aria-hidden>
              <Plus size={30} />
            </span>
            <div className="min-w-0 flex-1">
              <h1>{t.manualPageTitle}</h1>
              <p>{t.manualHint}</p>
            </div>
          </header>
          <ManualConnectForm />
        </div>
      </div>
    );

  const servers = await getDb().select().from(schema.mcpServers).orderBy(desc(schema.mcpServers.createdAt));
  const byId = servers.find((server) => server.id === id);
  const connector = byId ? (featuredFor(byId.url) ?? asConnector(byId)) : (featuredById(id) ?? (id === "catalog" ? await fromRegistry(query.id, query.q) : null));
  if (!connector) notFound();
  const server = byId ?? servers.find((candidate) => sameAddress(candidate.url, connector.url));
  const tools = server ? await listUpstreamTools(server, admin.id).then((list) => list.map((tool) => tool.name), () => null) : null;
  const blurb = (t.showcaseBlurbs as Partial<Record<string, string>>)[connector.id] ?? connector.description;

  return (
    <div className="page narrow">
      <div className="conn-page">
        <Back />
        <header className="conn-hero">
          <ConnectorLogo connector={connector} size={72} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1>{connector.name}</h1>
              {server && <span className={`pill ${tools ? "g" : "c"}`}>{tools ? t.connectedWorks(tools.length) : t.connectedDown}</span>}
            </div>
            <p className="conn-hero-by">{publisherLine(connector)}</p>
            {blurb && <p>{blurb}</p>}
          </div>
        </header>
        {server ? (
          <>
            <section className="card conn-panel">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="m-0 text-[15px] font-semibold flex-1">{t.connectorWhat}</h2>
                <ConnectedActions id={server.id} />
              </div>
              {query.signin === "done" && tools && <p className="m-0 text-[13px] text-green">{t.signInDone}</p>}
              {query.signin === "failed" && <p role="alert" className="m-0 text-[13px] text-coral">{t.signInDidNotFinish}</p>}
              {query.signin === "refused" && <p role="alert" className="m-0 text-[13px] text-coral">{t.signInCancelled}</p>}
              {usesOAuth(server) && <p className="m-0 text-[13px] text-ash">{t.signInEachPerson(server.name)}</p>}
              {usesOAuth(server) && !tools && <ConnectorSignIn id={server.id} returnTo={`/admin/connectors/${server.id}`} label={t.signInGo(server.name)} />}
              {tools && tools.length > 0 ? <ConnectorActionsList tools={tools} /> : <p className="m-0 text-[13px] text-smoke">{tools ? t.connectorNoActions : t.connectorDownHint}</p>}
            </section>
            <section className="card conn-panel">
              <h2 className="m-0 text-[15px] font-semibold">{t.connectedSettings}</h2>
              <ConnectorSettings
                server={{ id: server.id, name: server.name, url: server.url, tools, askAll: server.askAll, askTools: server.askTools ?? [], allowedEmails: server.allowedEmails ?? null }}
              />
            </section>
          </>
        ) : (
          <ConnectForm connector={connector} returnAddress={oauthCallbackUrl()} />
        )}
      </div>
    </div>
  );
}
