"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/ids";
import { messages } from "@/lib/messages";
import { forgetServer, slugify, testConnection } from "@/server/upstream";
import { seal } from "@/lib/secret-box";
import { searchCatalog } from "@/server/connector-catalog";
import { beginSignIn, oauthCallbackUrl, oauthSupport, safeReturnPath } from "@/server/connector-oauth";
import { serverAllowedFor } from "@/server/approval-payload";
import { requireAdmin, requireUser } from "@/lib/session";

export type AddServerState = { ok: boolean; message: string; id?: string; signIn?: { needsClient: boolean; returnAddress: string } } | null;

export async function addMcpServer(_: AddServerState, form: FormData): Promise<AddServerState> {
  const admin = await requireAdmin();
  const name = String(form.get("name") ?? "").trim().slice(0, 60);
  const url = String(form.get("url") ?? "").trim();
  const headerName = String(form.get("headerName") ?? "").trim().slice(0, 100);
  const headerValue = String(form.get("headerValue") ?? "");
  if (!name || !/^https?:\/\//i.test(url)) return { ok: false, message: messages.admin.serverBadInput };
  const db = getDb();
  let slug = slugify(name);
  const taken = await db.select({ slug: schema.mcpServers.slug }).from(schema.mcpServers);
  if (taken.some((t) => t.slug === slug)) slug = `${slug}_${taken.length + 1}`;
  const row = {
    id: newId("mcp"),
    name,
    slug,
    url,
    headerName: headerName || null,
    headerValue: headerName && headerValue ? seal(headerValue) : null,
    createdBy: admin.id,
    createdAt: new Date(),
    askAll: false,
    askTools: [] as string[],
    allowedEmails: null,
    oauthClient: null,
  };
  const test = await testConnection(row);
  if (!test.ok && test.problem === "unauthorized" && !headerValue) {
    const support = await oauthSupport(url);
    if (support.supported) return { ok: false, message: "", signIn: { needsClient: !support.registers, returnAddress: oauthCallbackUrl() } };
  }
  if (!test.ok) return { ok: false, message: messages.admin.serverProblem[test.problem] };
  await db.insert(schema.mcpServers).values(row);
  revalidatePath("/admin", "layout");
  return { ok: true, message: messages.admin.serverAddedWith(name, test.tools.length), id: row.id };
}

export async function checkMcpServer(id: string) {
  const admin = await requireAdmin();
  const [server] = await getDb().select().from(schema.mcpServers).where(eq(schema.mcpServers.id, id));
  if (!server) return { ok: false, message: messages.common.notFound };
  const test = await testConnection(server, admin.id);
  revalidatePath("/admin", "layout");
  return test.ok ? { ok: true, message: messages.admin.serverWorks(test.tools.length) } : { ok: false, message: messages.admin.serverProblem[test.problem] };
}

export async function removeMcpServer(id: string) {
  await requireAdmin();
  await getDb().delete(schema.mcpServers).where(eq(schema.mcpServers.id, id));
  forgetServer(id);
  revalidatePath("/admin", "layout");
}

export async function setServerApprovals(id: string, askAll: boolean, askTools: string[]) {
  await requireAdmin();
  await getDb()
    .update(schema.mcpServers)
    .set({ askAll, askTools: askTools.map(String).slice(0, 500) })
    .where(eq(schema.mcpServers.id, id));
  revalidatePath("/admin", "layout");
}

export async function setServerAccess(id: string, everyone: boolean, emails: string) {
  await requireAdmin();
  const list = emails
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+$/.test(e))
    .slice(0, 500);
  await getDb()
    .update(schema.mcpServers)
    .set({ allowedEmails: everyone ? null : list })
    .where(eq(schema.mcpServers.id, id));
  revalidatePath("/admin", "layout");
}

export async function searchConnectorCatalog(query: string) {
  await requireAdmin();
  return searchCatalog(String(query ?? ""));
}

export type SignInState = { ok: false; message: string } | { ok: true; to: string } | null;

export async function startConnectorSignIn(_: SignInState, form: FormData): Promise<SignInState> {
  const admin = await requireAdmin();
  const name = String(form.get("name") ?? "").trim().slice(0, 60);
  const url = String(form.get("url") ?? "").trim();
  const clientId = String(form.get("clientId") ?? "").trim().slice(0, 500);
  const clientSecret = String(form.get("clientSecret") ?? "").trim().slice(0, 2000);
  if (!name || !/^https:\/\//i.test(url)) return { ok: false, message: messages.admin.serverBadInput };
  const db = getDb();
  let slug = slugify(name);
  const taken = await db.select({ slug: schema.mcpServers.slug }).from(schema.mcpServers);
  if (taken.some((t) => t.slug === slug)) slug = `${slug}_${taken.length + 1}`;
  const row = {
    id: newId("mcp"),
    name,
    slug,
    url,
    headerName: null,
    headerValue: null,
    oauthClient: seal(JSON.stringify(clientId ? { client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}) } : null)),
    createdBy: admin.id,
    createdAt: new Date(),
    askAll: false,
    askTools: [] as string[],
    allowedEmails: null,
  };
  await db.insert(schema.mcpServers).values(row);
  try {
    return { ok: true, to: await beginSignIn(row, admin.id, `/admin/connectors/${row.id}`) };
  } catch (error) {
    console.error(JSON.stringify({ event: "connector_sign_in_failed", url, error: String(error) }));
    await db.delete(schema.mcpServers).where(eq(schema.mcpServers.id, row.id));
    return { ok: false, message: clientId ? messages.admin.signInRefusedClient : messages.admin.signInFailed };
  }
}

export async function signInToConnector(id: string, returnTo: string): Promise<SignInState> {
  const user = await requireUser();
  const [server] = await getDb().select().from(schema.mcpServers).where(eq(schema.mcpServers.id, id));
  if (!server || !serverAllowedFor(server.allowedEmails, user.email)) return { ok: false, message: messages.common.notFound };
  try {
    forgetServer(id);
    return { ok: true, to: await beginSignIn(server, user.id, safeReturnPath(returnTo) ?? "/") };
  } catch (error) {
    console.error(JSON.stringify({ event: "connector_sign_in_failed", url: server.url, error: String(error) }));
    return { ok: false, message: messages.admin.signInFailed };
  }
}
