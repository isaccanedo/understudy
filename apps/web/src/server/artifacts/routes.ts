import type { IncomingMessage, ServerResponse } from "node:http";
import { artifactContentPolicy, artifactContentType, withBridge, type ArtifactKind } from "@understudy/protocol";
import { env } from "@/lib/env";
import { contentDisposition } from "../files/routes";
import { RateLimiter } from "../rate-limit";
import { clientIp } from "../webhook";
import { contentVersion } from "./service";
import { blobStore, pageKey, sourceKey, type BlobStore } from "./storage";
import { readContentToken } from "./tokens";

export const ARTIFACT_CONTENT_PREFIX = "/api/artifacts/c/";
const limiter = new RateLimiter();

export const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), display-capture=(), clipboard-read=(), publickey-credentials-get=()";

export type ContentRoute = { token: string; page: number | null };

export function isArtifactContentRoute(pathname: string) {
  return pathname.startsWith(ARTIFACT_CONTENT_PREFIX);
}

export function matchContentRoute(method: string, pathname: string): ContentRoute | null {
  if (method !== "GET" && method !== "HEAD") return null;
  if (!isArtifactContentRoute(pathname)) return null;
  const parts = pathname.slice(ARTIFACT_CONTENT_PREFIX.length).split("/");
  if (parts.length === 1 && parts[0]) return { token: parts[0], page: null };
  if (parts.length === 3 && parts[0] && parts[1] === "page" && /^\d{1,4}$/.test(parts[2])) return { token: parts[0], page: Number(parts[2]) };
  return null;
}

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": PERMISSIONS_POLICY,
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Cache-Control": "private, max-age=3600, immutable",
};

const INERT_POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

export function contentHeaders(kind: ArtifactKind, name: string, download: boolean, frameAncestors: string[]): Record<string, string> {
  if (download || kind === "pages") {
    return { ...BASE_HEADERS, "Content-Type": "application/octet-stream", "Content-Disposition": contentDisposition(name, false), "Content-Security-Policy": INERT_POLICY };
  }
  if (kind === "html") {
    return { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": artifactContentPolicy(frameAncestors) };
  }
  return { ...BASE_HEADERS, "Content-Type": artifactContentType(name), "Content-Disposition": contentDisposition(name, true), "Content-Security-Policy": INERT_POLICY };
}

function notFound(res: ServerResponse) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end("not found");
}

export async function handleArtifactContent(req: IncomingMessage, res: ServerResponse, url: URL, store: BlobStore = blobStore()) {
  const route = matchContentRoute(req.method ?? "GET", url.pathname);
  if (!route) return notFound(res);
  const versionId = readContentToken(route.token);
  if (!versionId) return notFound(res);
  if (!limiter.allow(`content:${clientIp(req)}:${versionId}`, 4, 80)) {
    res.writeHead(429, { "Cache-Control": "no-store" });
    return res.end();
  }
  const version = await contentVersion(versionId);
  if (!version) return notFound(res);
  const frameAncestors = [env.publicUrl];
  const etag = `"${versionId}${route.page ? `-${route.page}` : ""}${url.searchParams.get("download") === "1" ? "-d" : ""}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag, "Cache-Control": BASE_HEADERS["Cache-Control"] });
    return res.end();
  }

  if (route.page !== null) {
    if (route.page < 1 || route.page > version.pages) return notFound(res);
    const blob = await store.get(pageKey(version.artifactId, version.versionId, route.page));
    if (!blob) return notFound(res);
    res.writeHead(200, { ...BASE_HEADERS, ETag: etag, "Content-Type": "image/jpeg", "Content-Length": String(blob.data.length), "Content-Security-Policy": INERT_POLICY });
    return res.end(req.method === "HEAD" ? undefined : blob.data);
  }

  const blob = await store.get(sourceKey(version.artifactId, version.versionId));
  if (!blob) return notFound(res);
  const download = url.searchParams.get("download") === "1";
  const headers = contentHeaders(version.kind, version.name, download, frameAncestors);
  const body = version.kind === "html" && !download ? Buffer.from(withBridge(blob.data.toString("utf8")), "utf8") : blob.data;
  res.writeHead(200, { ...headers, ETag: etag, "Content-Length": String(body.length) });
  res.end(req.method === "HEAD" ? undefined : body);
}
