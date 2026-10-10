import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { extensionFolderName } from "@/lib/extension-folder";
import { DEFAULT_LOOK } from "@/lib/look";
import { figurePng } from "../figure-png";
import { zip, type ZipEntry } from "./zip";

export const ICON_SIZES = [16, 32, 48, 128] as const;

export function extensionDir() {
  const configured = process.env.UNDERSTUDY_EXTENSION_DIR?.trim();
  if (configured) return configured;
  const base = process.env.UNDERSTUDY_APP_DIR ?? process.cwd();
  return path.resolve(base, "..", "extension", "dist");
}

function walk(root: string, relative = ""): string[] {
  const here = path.join(root, relative);
  return readdirSync(here).flatMap((name) => {
    const child = path.join(relative, name);
    return statSync(path.join(root, child)).isDirectory() ? walk(root, child) : [child];
  });
}

export function customizeManifest(raw: Buffer, productName: string) {
  const manifest = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  const icons = Object.fromEntries(ICON_SIZES.map((size) => [String(size), `icons/icon-${size}.png`]));
  manifest.name = productName;
  manifest.icons = icons;
  manifest.action = { ...(manifest.action as Record<string, unknown>), default_title: productName, default_icon: icons };
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
}

let cached: { key: string; data: Buffer } | null = null;

export async function extensionPackage() {
  const dir = extensionDir();
  if (!existsSync(path.join(dir, "manifest.json"))) return null;
  const productName = env.productName;
  const serverUrl = env.publicUrl;
  const files = walk(dir).sort();
  const key = JSON.stringify([dir, productName, serverUrl, files.map((file) => [file, statSync(path.join(dir, file)).mtimeMs])]);
  if (cached?.key === key) return cached.data;
  const folder = extensionFolderName(productName);
  const entries: ZipEntry[] = files.map((file) => {
    const data = readFileSync(path.join(dir, file));
    return { path: `${folder}/${file}`, data: file === "manifest.json" ? customizeManifest(data, productName) : data };
  });
  entries.push({ path: `${folder}/config.json`, data: Buffer.from(`${JSON.stringify({ serverUrl, productName }, null, 2)}\n`) });
  for (const size of ICON_SIZES) {
    entries.push({ path: `${folder}/icons/icon-${size}.png`, data: await figurePng(DEFAULT_LOOK, size, { padding: size <= 32 ? 2 : 10, background: null }) });
  }
  cached = { key, data: zip(entries) };
  return cached.data;
}
