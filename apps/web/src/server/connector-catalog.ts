import { registrySearchUrl, toCatalog, type CatalogEntry } from "@/lib/mcp-registry";

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; entries: CatalogEntry[] }>();

export async function searchCatalog(query: string, fetcher: typeof fetch = fetch): Promise<{ ok: true; entries: CatalogEntry[] } | { ok: false }> {
  const key = query.trim().toLowerCase().slice(0, 60);
  if (key.length < 2) return { ok: true, entries: [] };
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { ok: true, entries: hit.entries };
  try {
    const response = await fetcher(registrySearchUrl(key), { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(6000) });
    if (!response.ok) return { ok: false };
    const entries = toCatalog(await response.json(), key).slice(0, 12);
    if (cache.size > 200) cache.clear();
    cache.set(key, { at: Date.now(), entries });
    return { ok: true, entries };
  } catch {
    return { ok: false };
  }
}
