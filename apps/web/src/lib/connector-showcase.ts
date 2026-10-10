import type { CatalogEntry } from "@/lib/mcp-registry";
import { messages } from "@/lib/messages";

export const SHOWCASE_CATEGORIES = ["work", "code", "money", "research"] as const;
export type ShowcaseCategory = (typeof SHOWCASE_CATEGORIES)[number];

export type Connector = {
  id: string;
  name: string;
  url: string;
  publisher: { kind: "domain" | "github"; label: string };
  description?: string;
  category?: ShowcaseCategory;
  headerName?: string;
  headerPrefix?: string;
  keyPage?: string;
  icon?: string;
  signIn?: { needsClient: boolean };
  featured: boolean;
};

const bearer = { headerName: "Authorization", headerPrefix: "Bearer " };
const by = (label: string) => ({ kind: "domain" as const, label });

export const FEATURED_CONNECTORS: Connector[] = [
  {
    id: "linear",
    icon: "/connectors/linear.svg",
    name: "Linear",
    url: "https://mcp.linear.app/mcp",
    publisher: by("linear.app"),
    category: "work",
    ...bearer,
    keyPage: "https://linear.app/settings/account/security",
    featured: true,
  },
  {
    id: "hubspot",
    name: "HubSpot",
    url: "https://mcp.hubspot.com/",
    publisher: by("hubspot.com"),
    category: "work",
    signIn: { needsClient: true },
    keyPage: "https://developers.hubspot.com/mcp",
    featured: true,
  },
  {
    id: "zapier",
    icon: "/connectors/zapier.svg",
    name: "Zapier",
    url: "https://mcp.zapier.com/api/mcp/mcp",
    publisher: by("zapier.com"),
    category: "work",
    ...bearer,
    keyPage: "https://mcp.zapier.com",
    featured: true,
  },
  {
    id: "github",
    icon: "/connectors/github.svg",
    name: "GitHub",
    url: "https://api.githubcopilot.com/mcp/",
    publisher: by("github.com"),
    category: "code",
    ...bearer,
    keyPage: "https://github.com/settings/personal-access-tokens",
    featured: true,
  },
  {
    id: "supabase",
    icon: "/connectors/supabase.svg",
    name: "Supabase",
    url: "https://mcp.supabase.com/mcp",
    publisher: by("supabase.com"),
    category: "code",
    ...bearer,
    keyPage: "https://supabase.com/dashboard/account/tokens",
    featured: true,
  },
  {
    id: "neon",
    icon: "/connectors/neon.svg",
    name: "Neon",
    url: "https://mcp.neon.tech/mcp",
    publisher: by("neon.tech"),
    category: "code",
    ...bearer,
    keyPage: "https://console.neon.tech/app/settings/api-keys",
    featured: true,
  },
  { id: "deepwiki", name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp", publisher: by("deepwiki.com"), category: "code", featured: true },
  { id: "context7", icon: "/connectors/context7.png", name: "Context7", url: "https://mcp.context7.com/mcp", publisher: by("context7.com"), category: "code", featured: true },
  {
    id: "stripe",
    icon: "/connectors/stripe.svg",
    name: "Stripe",
    url: "https://mcp.stripe.com",
    publisher: by("stripe.com"),
    category: "money",
    ...bearer,
    keyPage: "https://dashboard.stripe.com/apikeys",
    featured: true,
  },
  {
    id: "mercadopago",
    icon: "/connectors/mercadopago.svg",
    name: "Mercado Pago",
    url: "https://mcp.mercadopago.com/mcp",
    publisher: by("mercadopago.com"),
    category: "money",
    ...bearer,
    keyPage: "https://www.mercadopago.com.br/developers/panel/app",
    featured: true,
  },
  {
    id: "posthog",
    icon: "/connectors/posthog.svg",
    name: "PostHog",
    url: "https://mcp.posthog.com/mcp",
    publisher: by("posthog.com"),
    category: "research",
    ...bearer,
    keyPage: "https://app.posthog.com/settings/user-api-keys",
    featured: true,
  },
  {
    id: "apify",
    icon: "/connectors/apify.svg",
    name: "Apify",
    url: "https://mcp.apify.com",
    publisher: by("apify.com"),
    category: "research",
    ...bearer,
    keyPage: "https://console.apify.com/settings/integrations",
    featured: true,
  },
  { id: "exa", icon: "/connectors/exa.svg", name: "Exa", url: "https://mcp.exa.ai/mcp", publisher: by("exa.ai"), category: "research", featured: true },
  { id: "huggingface", icon: "/connectors/huggingface.svg", name: "Hugging Face", url: "https://huggingface.co/mcp", publisher: by("huggingface.co"), category: "research", featured: true },
  { id: "mslearn", icon: "/connectors/mslearn.svg", name: "Microsoft Learn", url: "https://learn.microsoft.com/api/mcp", publisher: by("microsoft.com"), category: "research", featured: true },
  {
    id: "cloudflare-docs",
    icon: "/connectors/cloudflare.svg",
    name: "Cloudflare Docs",
    url: "https://docs.mcp.cloudflare.com/mcp",
    publisher: by("cloudflare.com"),
    category: "research",
    featured: true,
  },
];

export const CUSTOM_CONNECTOR = "new";

export function connectorHref(connector: Connector, query?: string) {
  if (connector.featured) return `/admin/connectors/${connector.id}`;
  const params = new URLSearchParams({ id: connector.id });
  if (query?.trim()) params.set("q", query.trim());
  return `/admin/connectors/catalog?${params}`;
}

export function featuredById(id: string) {
  return FEATURED_CONNECTORS.find((connector) => connector.id === id);
}

export function sameAddress(a: string, b: string) {
  const plain = (url: string) => url.trim().toLowerCase().replace(/\/+$/, "");
  return plain(a) === plain(b);
}

export function featuredFor(url: string) {
  return FEATURED_CONNECTORS.find((connector) => sameAddress(connector.url, url));
}

function matches(connector: Connector, query: string, blurb?: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [connector.name, connector.publisher.label, blurb ?? connector.description ?? ""].join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function filterFeatured(query: string, category: ShowcaseCategory | "all", blurbs: Partial<Record<string, string>> = {}) {
  return FEATURED_CONNECTORS.filter((connector) => (category === "all" || connector.category === category) && matches(connector, query, blurbs[connector.id]));
}

export function fromCatalog(entry: CatalogEntry): Connector {
  return {
    id: entry.id,
    name: entry.name,
    url: entry.url,
    publisher: entry.publisher,
    description: entry.description,
    headerName: entry.headerName,
    headerPrefix: entry.headerPrefix,
    keyPage: entry.headerName ? entry.website : undefined,
    icon: entry.icon,
    featured: false,
  };
}

export function catalogExtras(entries: CatalogEntry[], shown: Connector[]) {
  const extras: Connector[] = [];
  for (const entry of entries) {
    const connector = featuredFor(entry.url) ?? fromCatalog(entry);
    if ([...shown, ...extras].some((known) => sameAddress(known.url, connector.url))) continue;
    extras.push(connector);
  }
  return extras;
}

export function withPrefix(value: string, prefix?: string) {
  const key = value.trim();
  if (!key || !prefix || key.toLowerCase().startsWith(prefix.trim().toLowerCase())) return key;
  return `${prefix}${key}`;
}

export function monogram(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? "?").slice(0, 2).replace(/^./, (c) => c.toUpperCase());
}

function hostOf(url?: string) {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function parentOf(host: string) {
  const labels = host.split(".");
  return labels.length > 2 ? labels.slice(1).join(".") : undefined;
}

export function logoSources(connector: Pick<Connector, "icon" | "publisher" | "url">) {
  const sources: string[] = connector.icon ? [connector.icon] : [];
  const { kind, label } = connector.publisher;
  if (kind === "github" && /^[a-z0-9-]{1,39}$/i.test(label)) sources.push(`https://github.com/${label}.png?size=96`);
  const domain = kind === "domain" && /^[a-z0-9.-]+$/i.test(label) ? label.toLowerCase() : undefined;
  const address = hostOf(connector.url);
  for (const host of [domain, address, address && parentOf(address)]) {
    if (host && !host.endsWith("github.com") && !host.endsWith("githubusercontent.com")) sources.push(`https://${host}/favicon.ico`);
  }
  return [...new Set(sources)];
}

export function tintOf(name: string) {
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return `hsl(${hash % 360} 62% 64%)`;
}

export function publisherLine(connector: Connector) {
  const t = messages.admin;
  return connector.publisher.kind === "domain" ? t.catalogVerified(connector.publisher.label) : t.catalogGithub(connector.publisher.label);
}
