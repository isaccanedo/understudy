import { and, eq } from "drizzle-orm";
import { connectedBrowsers } from "@/app/actions/extension";
import { ExtensionGuide } from "@/components/extension/ExtensionGuide";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { messages } from "@/lib/messages";
import { requireUser } from "@/lib/session";
import { extensionFolderName } from "@/lib/extension-folder";

const t = messages.extension;

export default async function ExtensionPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const user = await requireUser();
  const { agent: agentId } = await searchParams;
  const [agent] = agentId
    ? await getDb()
        .select({ id: schema.agents.id, name: schema.agents.name })
        .from(schema.agents)
        .where(and(eq(schema.agents.id, agentId), eq(schema.agents.ownerId, user.id)))
    : [];
  return (
    <div className="page">
      <div className="top">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </div>
      <ExtensionGuide initialBrowsers={await connectedBrowsers()} productName={env.productName} folder={extensionFolderName(env.productName)} agent={agent ?? null} />
    </div>
  );
}
