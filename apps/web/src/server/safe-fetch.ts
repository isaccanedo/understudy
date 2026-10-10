import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

function extraBlocked() {
  return (process.env.UNDERSTUDY_BLOCKED_CIDRS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function inExtra(address: string, family: "ipv4" | "ipv6") {
  for (const cidr of extraBlocked()) {
    const [network, bits] = cidr.split("/");
    const kind = isIP(network) === 6 ? "ipv6" : "ipv4";
    if (kind !== family) continue;
    const list = new BlockList();
    list.addSubnet(network, Number(bits ?? (kind === "ipv6" ? 128 : 32)), kind);
    if (list.check(address, family)) return true;
  }
  return false;
}

export function isPublicAddress(address: string) {
  const version = isIP(address);
  if (!version) return false;
  const family = version === 6 ? "ipv6" : "ipv4";
  if (family === "ipv6" && address.toLowerCase().startsWith("::ffff:")) {
    const mapped = address.slice(7);
    if (isIP(mapped) === 4) return isPublicAddress(mapped);
  }
  if (blocked.check(address, family)) return false;
  return !inExtra(address, family);
}

export function allowPrivateUpstreams() {
  return process.env.UNDERSTUDY_ALLOW_PRIVATE_MCP === "1";
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

export function guardedLookup(hostname: string, options: { all?: boolean } & Record<string, unknown>, callback: LookupCallback) {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    const list = addresses as LookupAddress[];
    const refused = allowPrivateUpstreams() ? undefined : list.find((entry) => !isPublicAddress(entry.address));
    if (refused || list.length === 0) {
      const denied = Object.assign(new Error(`refused to connect to a private address for ${hostname}`), { code: "EPRIVATEADDR" });
      return callback(denied, []);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export class PrivateAddressError extends Error {}

export function assertPublicUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new PrivateAddressError("unsupported protocol");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivateUpstreams() && isIP(host) && !isPublicAddress(host)) throw new PrivateAddressError("private address");
  if (!allowPrivateUpstreams() && /(^|\.)(localhost|local|internal|cluster\.local)$/i.test(host)) throw new PrivateAddressError("private host name");
  return url;
}

const dispatcher = new Agent({ connect: { lookup: guardedLookup as never } });

export const safeFetch: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
  assertPublicUrl(url);
  return undiciFetch(url, { ...(init as object), redirect: "error", dispatcher } as never);
}) as unknown as typeof fetch;
