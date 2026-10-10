import { createHash } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  ARTIFACT_MAX_PAGES,
  ARTIFACT_NOTE_MAX,
  ARTIFACT_TITLE_MAX,
  artifactKindOf,
  FILE_MAX_BYTES,
  FILE_READ_MAX_BYTES,
  formatBytes,
  type ArtifactEdit,
  type ArtifactKind,
} from "@understudy/protocol";
import { getDb, schema } from "@/lib/db";
import type { MessageArtifact } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import type { ComputerReply, Hub } from "../hub";
import { blobStore, pageKey, sourceKey, versionKeys, type BlobStore } from "./storage";
import { contentToken, newShareToken, SHARE_LINK_DAYS, shareTokenHash, validShareToken } from "./tokens";

export const MARKDOWN_INLINE_MAX = 512 * 1024;
export const PUBLIC_TOKEN_SECONDS = 10 * 60;

type Ask = Pick<Hub, "askComputer">;

export type PublishInput = { path: string; title: string; artifactId?: string; note?: string };

export type PublishResult = { ok: true; artifactId: string; version: number; card: MessageArtifact } | { ok: false; error: string };

export function cleanTitle(raw: string) {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, ARTIFACT_TITLE_MAX);
}

export function cleanNote(raw: string | undefined) {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, ARTIFACT_NOTE_MAX);
}

function failed(reply: ComputerReply | { type: "failed"; error: string }) {
  if (reply.type === "failed") return reply.error === "offline" ? "your computer is not connected to the panel" : "your computer took too long to answer";
  return "error" in reply && reply.error ? reply.error : null;
}

export async function readWholeFile(hub: Ask, agentId: string, path: string, max: number): Promise<{ data?: Buffer; error?: string }> {
  const chunks: Buffer[] = [];
  let offset = 0;
  let size = Infinity;
  while (offset < size) {
    const reply = await hub.askComputer<Extract<ComputerReply, { type: "file_chunk" }>>(agentId, { type: "file_read", requestId: newId("fr"), path, offset, length: FILE_READ_MAX_BYTES }, 60_000);
    const error = failed(reply);
    if (error || reply.type !== "file_chunk" || reply.size === undefined) return { error: error ?? "could not read the file" };
    size = reply.size;
    if (size > max) return { error: `the file is ${formatBytes(size)}; artifacts can be at most ${formatBytes(max)}` };
    const data = Buffer.from(reply.base64 ?? "", "base64");
    if (!data.length && offset < size) return { error: "the file changed while it was being read" };
    chunks.push(data);
    offset += data.length;
  }
  return { data: Buffer.concat(chunks) };
}

async function renderPages(hub: Ask, agentId: string, path: string): Promise<{ pages?: Buffer[]; error?: string }> {
  const rendered = await hub.askComputer<Extract<ComputerReply, { type: "artifact_rendered" }>>(agentId, { type: "artifact_render", requestId: newId("ar"), path }, 5 * 60 * 1000);
  const error = failed(rendered);
  if (error || rendered.type !== "artifact_rendered" || !rendered.key || !rendered.pages) return { error: error === "no_preview" || !error ? "could not turn the file into pages; check that it opens" : error };
  const pages: Buffer[] = [];
  for (let page = 1; page <= Math.min(rendered.pages, ARTIFACT_MAX_PAGES); page++) {
    const reply = await hub.askComputer<Extract<ComputerReply, { type: "file_chunk" }>>(agentId, { type: "artifact_page", requestId: newId("ap"), key: rendered.key, page }, 60_000);
    const pageError = failed(reply);
    if (pageError || reply.type !== "file_chunk" || !reply.base64) return { error: pageError ?? `page ${page} is missing` };
    pages.push(Buffer.from(reply.base64, "base64"));
  }
  return { pages };
}

export async function publishArtifact(hub: Ask, agentId: string, input: PublishInput, store: BlobStore = blobStore()): Promise<PublishResult> {
  const title = cleanTitle(input.title);
  if (!title) return { ok: false, error: "give the artifact a title" };
  const note = cleanNote(input.note);
  const db = getDb();
  let existing: typeof schema.artifacts.$inferSelect | undefined;
  if (input.artifactId) {
    [existing] = await db.select().from(schema.artifacts).where(and(eq(schema.artifacts.id, input.artifactId), eq(schema.artifacts.agentId, agentId)));
    if (!existing) return { ok: false, error: `there is no artifact ${input.artifactId}; leave artifact_id out to start a new one` };
  }
  const shared = await hub.askComputer<Extract<ComputerReply, { type: "file_shared" }>>(agentId, { type: "file_share", requestId: newId("share"), path: input.path }, 10 * 60 * 1000);
  const shareError = failed(shared);
  if (shareError || shared.type !== "file_shared" || !shared.attachment) return { ok: false, error: shareError ?? "could not find the file" };
  const attachment = shared.attachment;
  const kind = artifactKindOf(attachment.name);
  if (!kind) return { ok: false, error: `${attachment.name} cannot be shown as an artifact; use a single .html file, .md, .pdf, .pptx, .docx, .xlsx, or an image (.png, .jpg, .webp, .gif, .svg). Send other files with share_file` };
  const max = env.artifactMaxBytes;
  if (attachment.size > max) return { ok: false, error: `the file is ${formatBytes(attachment.size)}; artifacts can be at most ${formatBytes(max)}` };
  const source = await readWholeFile(hub, agentId, attachment.path, max);
  if (!source.data) return { ok: false, error: source.error ?? "could not read the file" };
  const used = await agentArtifactBytes(agentId);
  if (used + source.data.length > env.artifactAgentMaxBytes) return { ok: false, error: `this understudy's artifacts already use ${formatBytes(used)} of ${formatBytes(env.artifactAgentMaxBytes)}; ask your owner to delete old ones` };
  let pages: Buffer[] = [];
  if (kind === "pages") {
    const rendered = await renderPages(hub, agentId, attachment.path);
    if (!rendered.pages) return { ok: false, error: rendered.error ?? "could not turn the file into pages" };
    pages = rendered.pages;
  }

  const artifactId = existing?.id ?? newId("art");
  const version = existing ? existing.latestVersion + 1 : 1;
  const versionId = newId("arv");
  await store.put(sourceKey(artifactId, versionId), source.data, "application/octet-stream");
  for (const [index, page] of pages.entries()) await store.put(pageKey(artifactId, versionId, index + 1), page, "image/jpeg");

  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      if (existing) {
        await tx.update(schema.artifacts).set({ title, kind, latestVersion: version, updatedAt: now }).where(and(eq(schema.artifacts.id, artifactId), eq(schema.artifacts.latestVersion, existing.latestVersion)));
      } else {
        await tx.insert(schema.artifacts).values({ id: artifactId, agentId, title, kind, latestVersion: 1, createdAt: now, updatedAt: now });
      }
      await tx.insert(schema.artifactVersions).values({
        id: versionId,
        artifactId,
        version,
        kind,
        note,
        name: attachment.name,
        sourcePath: attachment.path,
        size: source.data!.length,
        sha256: createHash("sha256").update(source.data!).digest("hex"),
        pages: pages.length,
        createdAt: now,
      });
    });
  } catch {
    await store.remove(versionKeys(artifactId, versionId, pages.length)).catch(() => {});
    return { ok: false, error: "another version of this artifact was published at the same time; publish again" };
  }
  const card: MessageArtifact = { artifactId, version, title, kind, name: attachment.name, pages: pages.length };
  return { ok: true, artifactId, version, card };
}

export async function agentArtifactBytes(agentId: string) {
  const [row] = await getDb()
    .select({ total: sql<string>`coalesce(sum(${schema.artifactVersions.size}), 0)` })
    .from(schema.artifactVersions)
    .innerJoin(schema.artifacts, eq(schema.artifacts.id, schema.artifactVersions.artifactId))
    .where(eq(schema.artifacts.agentId, agentId));
  return Number(row?.total ?? 0);
}

export type ArtifactSummary = { id: string; title: string; kind: ArtifactKind; latestVersion: number; updatedAt: string; name: string; pages: number; thumbUrl: string | null };

export type ArtifactVersionView = { id: string; version: number; note: string; name: string; size: number; pages: number; createdAt: string };

export type ArtifactView = {
  id: string;
  agentId: string;
  title: string;
  kind: ArtifactKind;
  latestVersion: number;
  version: ArtifactVersionView;
  versions: ArtifactVersionView[];
  contentUrl: string;
  downloadUrl: string;
  pageUrls: string[];
  markdown: string | null;
};

function contentBase() {
  return `${env.artifactOrigin ?? ""}/api/artifacts/c/`;
}

export function contentUrls(versionId: string, pages: number, now = Date.now(), seconds?: number) {
  const token = contentToken(versionId, now, seconds);
  const base = `${contentBase()}${token}`;
  return { contentUrl: base, downloadUrl: `${base}?download=1`, pageUrls: Array.from({ length: pages }, (_, i) => `${base}/page/${i + 1}`) };
}

function versionView(row: typeof schema.artifactVersions.$inferSelect): ArtifactVersionView {
  return { id: row.id, version: row.version, note: row.note, name: row.name, size: row.size, pages: row.pages, createdAt: row.createdAt.toISOString() };
}

export async function listArtifacts(agentId: string, limit = 200): Promise<ArtifactSummary[]> {
  const db = getDb();
  const rows = await db
    .select({ artifact: schema.artifacts, version: schema.artifactVersions })
    .from(schema.artifacts)
    .innerJoin(schema.artifactVersions, and(eq(schema.artifactVersions.artifactId, schema.artifacts.id), eq(schema.artifactVersions.version, schema.artifacts.latestVersion)))
    .where(eq(schema.artifacts.agentId, agentId))
    .orderBy(desc(schema.artifacts.updatedAt))
    .limit(limit);
  return rows.map(({ artifact, version }) => {
    const urls = contentUrls(version.id, Math.min(version.pages, 1));
    return {
      id: artifact.id,
      title: artifact.title,
      kind: version.kind,
      latestVersion: artifact.latestVersion,
      updatedAt: artifact.updatedAt.toISOString(),
      name: version.name,
      pages: version.pages,
      thumbUrl: version.kind === "image" ? urls.contentUrl : version.kind === "pages" ? (urls.pageUrls[0] ?? null) : null,
    };
  });
}

export async function loadArtifactView(agentId: string, artifactId: string, version?: number, store: BlobStore = blobStore(), tokenSeconds?: number): Promise<ArtifactView | null> {
  const db = getDb();
  const [artifact] = await db.select().from(schema.artifacts).where(and(eq(schema.artifacts.id, artifactId), eq(schema.artifacts.agentId, agentId)));
  if (!artifact) return null;
  const rows = await db.select().from(schema.artifactVersions).where(eq(schema.artifactVersions.artifactId, artifactId)).orderBy(desc(schema.artifactVersions.version));
  const chosen = rows.find((row) => row.version === version) ?? rows[0];
  if (!chosen) return null;
  let markdown: string | null = null;
  if (chosen.kind === "markdown") {
    const blob = await store.get(sourceKey(artifactId, chosen.id));
    markdown = blob ? blob.data.subarray(0, MARKDOWN_INLINE_MAX).toString("utf8") : "";
  }
  return {
    id: artifact.id,
    agentId,
    title: artifact.title,
    kind: chosen.kind,
    latestVersion: artifact.latestVersion,
    version: versionView(chosen),
    versions: rows.map(versionView),
    ...contentUrls(chosen.id, chosen.pages, Date.now(), tokenSeconds),
    markdown,
  };
}

export type ContentVersion = { versionId: string; artifactId: string; agentId: string; kind: ArtifactKind; version: number; name: string; pages: number };

export async function contentVersion(versionId: string): Promise<ContentVersion | null> {
  const [row] = await getDb()
    .select({ versionId: schema.artifactVersions.id, artifactId: schema.artifacts.id, agentId: schema.artifacts.agentId, kind: schema.artifactVersions.kind, version: schema.artifactVersions.version, name: schema.artifactVersions.name, pages: schema.artifactVersions.pages })
    .from(schema.artifactVersions)
    .innerJoin(schema.artifacts, eq(schema.artifacts.id, schema.artifactVersions.artifactId))
    .where(eq(schema.artifactVersions.id, versionId));
  return row ?? null;
}

export type PreparedEdit = { card: MessageArtifact; title: string; path: string | null };

export async function prepareEdit(hub: Pick<Hub, "sendToComputer">, agentId: string, edit: ArtifactEdit, store: BlobStore = blobStore()): Promise<PreparedEdit | null> {
  const db = getDb();
  const [row] = await db
    .select({ artifact: schema.artifacts, version: schema.artifactVersions })
    .from(schema.artifactVersions)
    .innerJoin(schema.artifacts, eq(schema.artifacts.id, schema.artifactVersions.artifactId))
    .where(and(eq(schema.artifacts.id, edit.artifactId), eq(schema.artifacts.agentId, agentId), eq(schema.artifactVersions.version, edit.version)));
  if (!row) return null;
  const { artifact, version } = row;
  let path = version.sourcePath;
  if (version.size <= FILE_MAX_BYTES) {
    const blob = await store.get(sourceKey(artifact.id, version.id));
    const relative = `artifacts/${artifact.id}/v${version.version}/${version.name}`;
    if (blob && hub.sendToComputer(agentId, { type: "file_put", path: relative, base64: blob.data.toString("base64") })) path = `inbox/${relative}`;
  }
  const page = edit.page && edit.page <= version.pages ? edit.page : undefined;
  const quote = edit.quote?.replace(/\s+/g, " ").trim() || undefined;
  return {
    title: artifact.title,
    path,
    card: { artifactId: artifact.id, version: version.version, title: artifact.title, kind: version.kind, name: version.name, pages: version.pages, edit: { ...(quote ? { quote } : {}), ...(page ? { page } : {}) } },
  };
}

export type ShareLink = { url: string; expiresAt: string; version: number };

export async function createShareLink(agentId: string, artifactId: string, version: number, userId: string, now = new Date()): Promise<ShareLink | null> {
  const db = getDb();
  const [row] = await db
    .select({ version: schema.artifactVersions.version })
    .from(schema.artifactVersions)
    .innerJoin(schema.artifacts, eq(schema.artifacts.id, schema.artifactVersions.artifactId))
    .where(and(eq(schema.artifacts.id, artifactId), eq(schema.artifacts.agentId, agentId), eq(schema.artifactVersions.version, version)));
  if (!row) return null;
  const token = newShareToken();
  const expiresAt = new Date(now.getTime() + SHARE_LINK_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(schema.artifactLinks).values({ id: newId("arl"), artifactId, version, tokenHash: shareTokenHash(token), createdBy: userId, createdAt: now, expiresAt });
  return { url: `${env.publicUrl}/shared/${token}`, expiresAt: expiresAt.toISOString(), version };
}

export async function revokeShareLinks(agentId: string, artifactId: string, now = new Date()) {
  const db = getDb();
  const [artifact] = await db.select({ id: schema.artifacts.id }).from(schema.artifacts).where(and(eq(schema.artifacts.id, artifactId), eq(schema.artifacts.agentId, agentId)));
  if (!artifact) return 0;
  const rows = await db
    .update(schema.artifactLinks)
    .set({ revokedAt: now })
    .where(and(eq(schema.artifactLinks.artifactId, artifactId), isNull(schema.artifactLinks.revokedAt)))
    .returning({ id: schema.artifactLinks.id });
  return rows.length;
}

export async function activeShareLinks(agentId: string, artifactId: string, now = new Date()) {
  const rows = await getDb()
    .select({ id: schema.artifactLinks.id, version: schema.artifactLinks.version, expiresAt: schema.artifactLinks.expiresAt })
    .from(schema.artifactLinks)
    .innerJoin(schema.artifacts, eq(schema.artifacts.id, schema.artifactLinks.artifactId))
    .where(and(eq(schema.artifactLinks.artifactId, artifactId), eq(schema.artifacts.agentId, agentId), isNull(schema.artifactLinks.revokedAt), gt(schema.artifactLinks.expiresAt, now)));
  return rows.map((row) => ({ id: row.id, version: row.version, expiresAt: row.expiresAt.toISOString() }));
}

export async function sharedArtifact(token: string, now = new Date(), store: BlobStore = blobStore()): Promise<(ArtifactView & { agentName: string }) | null> {
  if (!validShareToken(token)) return null;
  const db = getDb();
  const [link] = await db
    .select({ artifactId: schema.artifactLinks.artifactId, version: schema.artifactLinks.version, agentId: schema.artifacts.agentId, agentName: schema.agents.name })
    .from(schema.artifactLinks)
    .innerJoin(schema.artifacts, eq(schema.artifacts.id, schema.artifactLinks.artifactId))
    .innerJoin(schema.agents, eq(schema.agents.id, schema.artifacts.agentId))
    .where(and(eq(schema.artifactLinks.tokenHash, shareTokenHash(token)), isNull(schema.artifactLinks.revokedAt), gt(schema.artifactLinks.expiresAt, now)));
  if (!link) return null;
  const view = await loadArtifactView(link.agentId, link.artifactId, link.version, store, PUBLIC_TOKEN_SECONDS);
  if (!view || view.version.version !== link.version) return null;
  return { ...view, id: "", agentId: "", latestVersion: link.version, versions: [view.version], agentName: link.agentName };
}

export async function removeAgentArtifactBlobs(agentId: string, store: BlobStore = blobStore()) {
  const rows = await getDb()
    .select({ artifactId: schema.artifactVersions.artifactId, versionId: schema.artifactVersions.id, pages: schema.artifactVersions.pages })
    .from(schema.artifactVersions)
    .innerJoin(schema.artifacts, eq(schema.artifacts.id, schema.artifactVersions.artifactId))
    .where(eq(schema.artifacts.agentId, agentId));
  await store.remove(rows.flatMap((row) => versionKeys(row.artifactId, row.versionId, row.pages)));
}
