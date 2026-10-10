import { eq } from "drizzle-orm";
import { MEMORY_FILE_MAX_BYTES, type FileEntry, type MemoryFile } from "@understudy/protocol";
import { getDb, schema } from "@/lib/db";

export async function syncFiles(agentId: string, files: FileEntry[]) {
  const clean = files
    .filter((f) => typeof f.path === "string" && f.path)
    .slice(0, 1000)
    .map((f) => ({
      agentId,
      path: f.path.slice(0, 500),
      size: Math.max(0, Math.floor(Number(f.size) || 0)),
      updatedAt: new Date(Number(f.updatedAt) || Date.now()),
    }));
  await getDb().transaction(async (tx) => {
    await tx.delete(schema.agentFiles).where(eq(schema.agentFiles.agentId, agentId));
    if (clean.length > 0) await tx.insert(schema.agentFiles).values(clean);
  });
}

export async function syncMemory(agentId: string, files: MemoryFile[]) {
  const clean = files
    .filter((f) => typeof f.path === "string" && f.path && typeof f.text === "string")
    .slice(0, 500)
    .map((f) => ({
      agentId,
      path: f.path.slice(0, 500),
      text: f.text.slice(0, MEMORY_FILE_MAX_BYTES),
      updatedAt: new Date(Number(f.updatedAt) || Date.now()),
      syncedAt: new Date(),
    }));
  await getDb().transaction(async (tx) => {
    await tx.delete(schema.memoryFiles).where(eq(schema.memoryFiles.agentId, agentId));
    if (clean.length > 0) await tx.insert(schema.memoryFiles).values(clean);
  });
}
