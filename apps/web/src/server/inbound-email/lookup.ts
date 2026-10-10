import { getPool } from "@/lib/db";

export type InboundTask = {
  recipeId: string;
  agentId: string;
  ownerEmail: string;
  allowedSenders: string | null;
  active: boolean;
};

export async function findInboundTask(localPart: string): Promise<InboundTask | null> {
  const { rows } = await getPool().query<{
    recipe_id: string;
    agent_id: string;
    owner_email: string;
    allowed_senders: string | null;
    active: boolean;
  }>(
    `select r.id as recipe_id, r.agent_id, u.email as owner_email, i.allowed_senders, r.active
       from recipe_inbound i
       join recipes r on r.id = i.recipe_id
       join agents a on a.id = r.agent_id
       join "user" u on u.id = a.owner_id
      where i.local_part = $1`,
    [localPart],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    recipeId: row.recipe_id,
    agentId: row.agent_id,
    ownerEmail: row.owner_email,
    allowedSenders: row.allowed_senders,
    active: row.active,
  };
}
