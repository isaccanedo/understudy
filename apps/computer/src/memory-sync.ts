import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, readFileSync, statSync, unlinkSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { MEMORY_FILE_MAX_BYTES, type ComputerToServer, type MemoryFile } from "@understudy/protocol";
import { log } from "@understudy/runtime";

const DEBOUNCE_MS = 1000;
const MAX_FILES = 500;

export function capText(text: string, maxBytes = MEMORY_FILE_MAX_BYTES): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return text;
  return buffer.subarray(0, maxBytes).toString("utf8").replace(/�+$/, "");
}

export function memoryPath(root: string, requested: string): string | null {
  if (typeof requested !== "string" || !requested.trim() || requested.includes("\0")) return null;
  if (requested.startsWith("/") || requested.startsWith("\\")) return null;
  const base = resolve(root);
  const target = resolve(base, requested);
  if (target === base || !target.startsWith(base + sep)) return null;
  if (existsSync(base)) {
    const realBase = realpathSync(base);
    let probe = target;
    while (!existsSync(probe) && probe !== base) probe = dirname(probe);
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) return null;
    const realProbe = realpathSync(probe);
    if (realProbe !== realBase && !realProbe.startsWith(realBase + sep)) return null;
  }
  return target;
}

export const SKILLS_PREFIX = "skills/";

export function safeMount(dir: string, parent: string): string | null {
  try {
    if (lstatSync(dir).isSymbolicLink()) return null;
    const real = realpathSync(dir);
    const realParent = realpathSync(parent);
    return real.startsWith(realParent + sep) ? real : null;
  } catch {
    return null;
  }
}

export function readMemory(root: string): MemoryFile[] {
  const files: MemoryFile[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= MAX_FILES) return;
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try {
          files.push({ path: relative(root, full).split(sep).join("/"), text: capText(readFileSync(full, "utf8")), updatedAt: Math.round(statSync(full).mtimeMs) });
        } catch {}
      }
    }
  };
  walk(root);
  return files;
}

export type MemorySync = {
  publish: () => void;
  write: (path: string, text: string) => boolean;
  remove: (path: string) => boolean;
  close: () => void;
};

export function readSnapshot(root: string, skills?: { dir: string; parent: string }): MemoryFile[] {
  const files = readMemory(root);
  const mount = skills ? safeMount(skills.dir, skills.parent) : null;
  if (!mount) return files;
  return [...files, ...readMemory(mount).map((file) => ({ ...file, path: `${SKILLS_PREFIX}${file.path}` }))].slice(0, MAX_FILES);
}

export function startMemorySync(root: string, send: (message: ComputerToServer) => boolean, skills?: { dir: string; parent: string }): MemorySync {
  mkdirSync(root, { recursive: true });
  if (skills) mkdirSync(skills.dir, { recursive: true });
  let skillsWatcher: FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;

  const publish = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    send({ type: "memory", files: readSnapshot(root, skills) });
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(publish, DEBOUNCE_MS);
  };

  try {
    watcher = watch(root, { recursive: true }, schedule);
    watcher.on("error", (error) => log("memory", `watch failed: ${error.message}`));
  } catch (error) {
    log("memory", `watch unavailable, polling: ${(error as Error).message}`);
    let last = "";
    const poll = setInterval(() => {
      const snapshot = JSON.stringify(readSnapshot(root, skills).map((file) => [file.path, file.updatedAt]));
      if (snapshot !== last) {
        last = snapshot;
        schedule();
      }
    }, 5000);
    poll.unref();
  }
  const skillsMount = skills ? safeMount(skills.dir, skills.parent) : null;
  if (skillsMount) {
    try {
      skillsWatcher = watch(skillsMount, { recursive: true }, schedule);
      skillsWatcher.on("error", () => {});
    } catch {}
  }

  const resolveTarget = (path: string) => {
    if (skills && typeof path === "string" && path.startsWith(SKILLS_PREFIX)) {
      const mount = safeMount(skills.dir, skills.parent);
      return mount ? memoryPath(mount, path.slice(SKILLS_PREFIX.length)) : null;
    }
    return memoryPath(root, path);
  };

  return {
    publish,
    write(path, text) {
      const target = resolveTarget(path);
      if (!target) {
        log("memory", `refused write outside memory: ${JSON.stringify(path).slice(0, 120)}`);
        return false;
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, capText(String(text ?? "")));
      schedule();
      return true;
    },
    remove(path) {
      const target = resolveTarget(path);
      if (!target) {
        log("memory", `refused delete outside memory: ${JSON.stringify(path).slice(0, 120)}`);
        return false;
      }
      try {
        if (statSync(target).isFile()) unlinkSync(target);
      } catch {}
      schedule();
      return true;
    },
    close() {
      if (timer) clearTimeout(timer);
      watcher?.close();
      skillsWatcher?.close();
    },
  };
}
