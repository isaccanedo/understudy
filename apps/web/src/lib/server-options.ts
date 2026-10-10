import { asc } from "drizzle-orm";
import { serverAllowedFor } from "@/server/approval-payload";
import { loginOf, usesOAuth } from "@/server/connector-oauth";
import { listUpstreamTools } from "@/server/upstream";
import { getDb, schema } from "./db";

export async function serverOptions(user: { id: string; email: string }) {
  const servers = (await getDb().select().from(schema.mcpServers).orderBy(asc(schema.mcpServers.name))).filter((server) =>
    serverAllowedFor(server.allowedEmails, user.email),
  );
  return Promise.all(
    servers.map(async (server) => ({
      id: server.id,
      name: server.name,
      askAll: server.askAll,
      adminAsk: server.askTools ?? [],
      signIn: usesOAuth(server) ? { signedIn: Boolean((await loginOf(server.id, user.id))?.tokens) } : undefined,
      tools: await listUpstreamTools(server, user.id).then(
        (tools) => tools.map((tool) => ({ name: tool.name, description: tool.description })),
        () => null,
      ),
    })),
  );
}
