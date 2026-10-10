import { eq } from "drizzle-orm";
import { normalizeDomain, normalizeSite, OwnerRuleSchema, type OwnerRule } from "@understudy/protocol";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/ids";
import { messages as copy } from "@/lib/messages";
import type { Hub } from "./hub";
import { sendPush } from "./push";

export const MAX_RULES = 30;

export function cleanRules(input: unknown): OwnerRule[] | null {
  if (!Array.isArray(input) || input.length > MAX_RULES) return null;
  const rules: OwnerRule[] = [];
  for (const raw of input) {
    const candidate = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : null;
    if (!candidate) return null;
    if (typeof candidate.id !== "string" || !/^rule_[A-Za-z0-9_-]{4,40}$/.test(candidate.id)) candidate.id = newId("rule");
    if (candidate.kind === "allowed_email_domains" && Array.isArray(candidate.domains)) {
      candidate.domains = [...new Set(candidate.domains.map((domain) => normalizeDomain(String(domain))).filter((domain) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)))];
    }
    if (candidate.kind === "blocked_site" && typeof candidate.site === "string") {
      candidate.site = normalizeSite(candidate.site);
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(candidate.site as string)) return null;
    }
    if (candidate.kind === "custom" && typeof candidate.text === "string") candidate.text = candidate.text.replace(/\s+/g, " ").trim();
    if (candidate.kind === "max_amount" && typeof candidate.amount === "string") candidate.amount = Number(candidate.amount);
    const parsed = OwnerRuleSchema.safeParse(candidate);
    if (!parsed.success) return null;
    rules.push(parsed.data);
  }
  return rules;
}

export async function reportRuleBlock(hub: Hub, agentId: string, rule: string, detail: string, runId?: string | null) {
  await hub.addMessage(agentId, "system", copy.rules.blocked(rule.slice(0, 300), detail.slice(0, 300)), runId ?? null);
  const [agent] = await getDb().select({ ownerId: schema.agents.ownerId, name: schema.agents.name }).from(schema.agents).where(eq(schema.agents.id, agentId));
  if (!agent) return;
  await sendPush([agent.ownerId], { title: copy.rules.pushTitle(agent.name), body: `${rule} ${detail}`.slice(0, 180), url: runId ? `/runs/${runId}` : `/agents/${agentId}`, tag: `rule-${agentId}` }).catch(() => {});
}
