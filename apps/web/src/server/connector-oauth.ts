import { randomBytes } from "node:crypto";
import { auth, discoverOAuthServerInfo, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { open, seal } from "@/lib/secret-box";
import { safeFetch } from "./safe-fetch";

type Server = typeof schema.mcpServers.$inferSelect;
type Login = typeof schema.mcpServerLogins.$inferSelect;
type LoginPatch = Partial<Pick<Login, "tokens" | "state" | "verifier" | "returnTo">>;

export const OAUTH_CALLBACK_PATH = "/api/connectors/oauth/callback";

export function oauthCallbackUrl() {
  return `${env.publicUrl.replace(/\/$/, "")}${OAUTH_CALLBACK_PATH}`;
}

export function usesOAuth(server: Pick<Server, "oauthClient">) {
  return Boolean(server.oauthClient);
}

export class SignInNeededError extends Error {
  constructor() {
    super("Unauthorized: this person has not signed in to the connector yet");
  }
}

function readSealed<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return (JSON.parse(open(value)) as T) ?? undefined;
  } catch {
    return undefined;
  }
}

export function safeReturnPath(path: unknown) {
  const value = typeof path === "string" ? path : "";
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value.slice(0, 300) : null;
}

export async function loginOf(serverId: string, userId: string) {
  const [login] = await getDb()
    .select()
    .from(schema.mcpServerLogins)
    .where(and(eq(schema.mcpServerLogins.serverId, serverId), eq(schema.mcpServerLogins.userId, userId)));
  return login ?? null;
}

export class StoredOAuthProvider implements OAuthClientProvider {
  authorizationUrl: URL | null = null;

  constructor(
    private server: Server,
    private userId: string,
    private login: Login | null,
  ) {}

  static async for(server: Server, userId: string) {
    return new StoredOAuthProvider(server, userId, await loginOf(server.id, userId));
  }

  async saveLogin(patch: LoginPatch) {
    const updatedAt = new Date();
    const [saved] = await getDb()
      .insert(schema.mcpServerLogins)
      .values({ serverId: this.server.id, userId: this.userId, updatedAt, ...patch })
      .onConflictDoUpdate({ target: [schema.mcpServerLogins.serverId, schema.mcpServerLogins.userId], set: { ...patch, updatedAt } })
      .returning();
    this.login = saved;
  }

  get redirectUrl() {
    return oauthCallbackUrl();
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: env.productName,
      redirect_uris: [oauthCallbackUrl()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async state() {
    const state = randomBytes(24).toString("base64url");
    await this.saveLogin({ state });
    return state;
  }

  clientInformation() {
    return readSealed<OAuthClientInformationMixed>(this.server.oauthClient);
  }

  private async saveClient(sealed: string) {
    this.server = { ...this.server, oauthClient: sealed };
    await getDb().update(schema.mcpServers).set({ oauthClient: sealed }).where(eq(schema.mcpServers.id, this.server.id));
  }

  async saveClientInformation(information: OAuthClientInformationMixed) {
    await this.saveClient(seal(JSON.stringify(information)));
  }

  tokens() {
    return readSealed<OAuthTokens>(this.login?.tokens);
  }

  async saveTokens(tokens: OAuthTokens) {
    await this.saveLogin({ tokens: seal(JSON.stringify(tokens)) });
  }

  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }

  async saveCodeVerifier(verifier: string) {
    await this.saveLogin({ verifier: seal(verifier) });
  }

  codeVerifier() {
    const verifier = this.login?.verifier ? open(this.login.verifier) : "";
    if (!verifier) throw new Error("No sign-in is in progress for this connector");
    return verifier;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all") await this.saveLogin({ tokens: null, verifier: null, state: null });
    if (scope === "tokens") await this.saveLogin({ tokens: null });
    if (scope === "verifier") await this.saveLogin({ verifier: null, state: null });
    if (scope === "client" && !readSealed<OAuthClientInformationMixed>(this.server.oauthClient)?.client_secret) await this.saveClient(seal("null"));
  }
}

export type OAuthSupport = { supported: false } | { supported: true; registers: boolean };

export async function oauthSupport(url: string): Promise<OAuthSupport> {
  try {
    const info = await discoverOAuthServerInfo(url, { fetchFn: safeFetch });
    const metadata = info.authorizationServerMetadata;
    if (!metadata?.authorization_endpoint || !metadata.token_endpoint) return { supported: false };
    return { supported: true, registers: Boolean(metadata.registration_endpoint) };
  } catch {
    return { supported: false };
  }
}

export async function beginSignIn(server: Server, userId: string, returnTo: string) {
  const provider = new StoredOAuthProvider(server, userId, null);
  await provider.saveLogin({ tokens: null, returnTo });
  const result = await auth(provider, { serverUrl: server.url, fetchFn: safeFetch });
  const page = provider.authorizationUrl;
  if (result !== "REDIRECT" || !page) throw new Error("The server did not send a sign-in page");
  const local = process.env.UNDERSTUDY_ALLOW_PRIVATE_MCP === "1" && page.protocol === "http:";
  if (page.protocol !== "https:" && !local) throw new Error("The sign-in page is not an https address");
  return page.toString();
}

async function loginByState(state: string, userId: string) {
  const [row] = await getDb()
    .select({ login: schema.mcpServerLogins, server: schema.mcpServers })
    .from(schema.mcpServerLogins)
    .innerJoin(schema.mcpServers, eq(schema.mcpServers.id, schema.mcpServerLogins.serverId))
    .where(and(eq(schema.mcpServerLogins.state, state), eq(schema.mcpServerLogins.userId, userId)));
  return row ?? null;
}

async function clearAttempt(serverId: string, userId: string) {
  await getDb()
    .update(schema.mcpServerLogins)
    .set({ state: null, verifier: null })
    .where(and(eq(schema.mcpServerLogins.serverId, serverId), eq(schema.mcpServerLogins.userId, userId)));
}

export async function finishSignIn(state: string, code: string, userId: string) {
  const found = await loginByState(state, userId);
  if (!found) return null;
  const provider = new StoredOAuthProvider(found.server, userId, found.login);
  let signedIn = true;
  try {
    await auth(provider, { serverUrl: found.server.url, authorizationCode: code, fetchFn: safeFetch });
  } catch (error) {
    signedIn = false;
    console.error(JSON.stringify({ event: "connector_sign_in_exchange_failed", url: found.server.url, error: String(error) }));
  }
  await clearAttempt(found.server.id, userId);
  const [server] = await getDb().select().from(schema.mcpServers).where(eq(schema.mcpServers.id, found.server.id));
  return server ? { server, signedIn, returnTo: found.login.returnTo } : null;
}

export async function abandonSignIn(state: string, userId: string) {
  const found = await loginByState(state, userId);
  if (!found) return null;
  await clearAttempt(found.server.id, userId);
  return { server: found.server, returnTo: found.login.returnTo };
}
