export const REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers";

export type CatalogEntry = {
  id: string;
  name: string;
  description: string;
  url: string;
  publisher: { kind: "domain" | "github"; label: string };
  website?: string;
  headerName?: string;
  headerPrefix?: string;
  icon?: string;
};

type RegistryHeader = { name?: unknown; isSecret?: unknown; isRequired?: unknown };
type RegistryRemote = { type?: unknown; url?: unknown; headers?: RegistryHeader[]; variables?: unknown };
type RegistryIcon = { src?: unknown; mimeType?: unknown };
type RegistryServer = { name?: unknown; title?: unknown; description?: unknown; websiteUrl?: unknown; remotes?: RegistryRemote[]; icons?: unknown };
type RegistryItem = { server?: RegistryServer; _meta?: Record<string, { status?: unknown; isLatest?: unknown } | undefined> };

export function registrySearchUrl(query: string, limit = 40) {
  const params = new URLSearchParams({ search: query.trim().slice(0, 60), version: "latest", limit: String(limit) });
  return `${REGISTRY_URL}?${params}`;
}

export function publisherOf(name: string): CatalogEntry["publisher"] {
  const namespace = name.split("/")[0] ?? "";
  if (namespace.startsWith("io.github.")) return { kind: "github", label: namespace.slice("io.github.".length) };
  return { kind: "domain", label: namespace.split(".").reverse().join(".") };
}

function remoteOf(server: RegistryServer) {
  for (const remote of server.remotes ?? []) {
    if (remote.type !== "streamable-http" || typeof remote.url !== "string") continue;
    if (!/^https:\/\//i.test(remote.url) || /[{}]/.test(remote.url)) continue;
    if (remote.variables && Object.keys(remote.variables as object).length > 0) continue;
    const header = (remote.headers ?? []).find((h) => typeof h.name === "string" && (h.isSecret === true || h.isRequired === true));
    return { url: remote.url, headerName: typeof header?.name === "string" ? header.name : undefined };
  }
  return null;
}

const ICON_TYPES = new Set(["image/png", "image/svg+xml", "image/webp", "image/jpeg"]);

export function iconOf(icons: unknown) {
  if (!Array.isArray(icons)) return undefined;
  for (const icon of icons as RegistryIcon[]) {
    if (typeof icon?.src !== "string" || icon.src.length > 500 || !/^https:\/\/[^\s"'()]+$/i.test(icon.src)) continue;
    if (icon.mimeType !== undefined && !ICON_TYPES.has(String(icon.mimeType))) continue;
    return icon.src;
  }
  return undefined;
}

const GENERIC = new Set(["mcp", "server", "mcp-server", "remote", "remote-mcp", "api"]);

function titleCase(text: string) {
  return text
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 60);
}

function displayName(server: RegistryServer, name: string) {
  if (typeof server.title === "string" && server.title.trim()) return server.title.trim().slice(0, 60);
  const last = name.split("/").pop() ?? name;
  if (!GENERIC.has(last.toLowerCase())) return titleCase(last);
  const publisher = publisherOf(name);
  return titleCase(publisher.kind === "domain" ? (publisher.label.split(".")[0] ?? last) : publisher.label);
}

function score(entry: CatalogEntry, query: string) {
  const q = query.trim().toLowerCase();
  const label = entry.publisher.label.toLowerCase();
  let value = 0;
  if (entry.publisher.kind === "domain") value += 2;
  if (q && label.split(".").includes(q)) value += 4;
  if (q && entry.name.toLowerCase() === q) value += 3;
  if (q && entry.name.toLowerCase().startsWith(q)) value += 1;
  return value;
}

export function toCatalog(payload: unknown, query = ""): CatalogEntry[] {
  const items = (payload as { servers?: RegistryItem[] } | null)?.servers ?? [];
  const seen = new Set<string>();
  const entries: CatalogEntry[] = [];
  for (const item of items) {
    const server = item?.server;
    if (!server || typeof server.name !== "string") continue;
    const official = item._meta?.["io.modelcontextprotocol.registry/official"];
    if (official && (official.status !== "active" || official.isLatest === false)) continue;
    if (seen.has(server.name)) continue;
    const remote = remoteOf(server);
    if (!remote) continue;
    seen.add(server.name);
    entries.push({
      id: server.name,
      name: displayName(server, server.name),
      description: typeof server.description === "string" ? server.description.slice(0, 200) : "",
      url: remote.url,
      publisher: publisherOf(server.name),
      website: typeof server.websiteUrl === "string" && /^https:\/\//i.test(server.websiteUrl) ? server.websiteUrl : undefined,
      headerName: remote.headerName,
      headerPrefix: remote.headerName?.toLowerCase() === "authorization" ? "Bearer " : undefined,
      icon: iconOf(server.icons),
    });
  }
  return entries
    .map((entry, index) => ({ entry, index, rank: score(entry, query) }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map(({ entry }) => entry);
}
