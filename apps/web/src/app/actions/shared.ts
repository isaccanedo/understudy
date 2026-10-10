import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { AgentTools } from "@/lib/db/schema";
import { cleanLook } from "@/lib/look";
import { messages } from "@/lib/messages";
import { requireUser } from "@/lib/session";
import { serverAllowedFor } from "@/server/approval-payload";

export async function toolsFrom(form: FormData, email: string): Promise<AgentTools> {
  const requested = form.getAll("servers").map(String).slice(0, 50);
  const allowed = requested.length
    ? (await getDb().select().from(schema.mcpServers).where(inArray(schema.mcpServers.id, requested)))
        .filter((server) => serverAllowedFor(server.allowedEmails, email))
        .map((server) => server.id)
    : [];
  return {
    notifyOwner: form.get("notifyOwner") === "on",
    slack: false,
    slackChannels: [],
    slackMode: slackModeFrom(form.get("slackMode")),
    servers: allowed,
    askTools: form.getAll("askTools").map(String).slice(0, 500),
  };
}

function slackModeFrom(value: FormDataEntryValue | null): AgentTools["slackMode"] {
  return value === "off" || value === "free" ? value : "ask";
}

export function parseLook(form: FormData) {
  try {
    return cleanLook(JSON.parse(String(form.get("look") ?? "{}")));
  } catch {
    return cleanLook(null);
  }
}

export async function ownAgent(agentId: string) {
  const user = await requireUser();
  const [agent] = await getDb()
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.ownerId, user.id)));
  if (!agent) throw new Error(messages.common.notFound);
  return { user, agent };
}

export async function ownRecipe(recipeId: string) {
  const user = await requireUser();
  const [row] = await getDb()
    .select({ recipe: schema.recipes, agent: schema.agents })
    .from(schema.recipes)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.recipes.agentId))
    .where(and(eq(schema.recipes.id, recipeId), eq(schema.agents.ownerId, user.id)));
  if (!row) throw new Error(messages.common.notFound);
  return { user, ...row };
}
