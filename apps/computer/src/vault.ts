import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type CredentialInfo = { name: string; username: string; site?: string };

type Sealed = { iv: string; tag: string; data: string };

type VaultFile = { version: 1; entries: Record<string, { username: string; site?: string; secret: Sealed }> };

export type Vault = {
  set: (name: string, username: string, secret: string, site?: string) => void;
  remove: (name: string) => boolean;
  list: () => CredentialInfo[];
  reveal: (name: string) => { username: string; secret: string; site?: string } | null;
};

const NAME = /^[\w .@-]{1,64}$/;

export function validCredentialName(name: string): boolean {
  return typeof name === "string" && NAME.test(name);
}

export function vaultDir(home: string): string {
  return join(home, ".understudy");
}

function loadKey(dir: string, env: NodeJS.ProcessEnv): Buffer {
  if (env.UNDERSTUDY_VAULT_KEY) {
    const key = Buffer.from(env.UNDERSTUDY_VAULT_KEY, "base64");
    if (key.length !== 32) throw new Error("UNDERSTUDY_VAULT_KEY must be 32 bytes, base64");
    return key;
  }
  const file = join(dir, "vault.key");
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  return Buffer.from(readFileSync(file, "utf8").trim(), "base64");
}

function seal(key: Buffer, text: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

function open(key: Buffer, sealed: Sealed): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8");
}

export function hostMatches(site: string | undefined, url: string): boolean {
  if (!site) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const wanted = site.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\*\./, "");
  return host === wanted || host.endsWith(`.${wanted}`);
}

export function openVault(home: string, env: NodeJS.ProcessEnv = process.env): Vault {
  const dir = vaultDir(home);
  const file = join(dir, "vault.json");
  const key = loadKey(dir, env);

  const read = (): VaultFile => {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      return parsed?.version === 1 ? parsed : { version: 1, entries: {} };
    } catch {
      return { version: 1, entries: {} };
    }
  };

  const write = (vault: VaultFile) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const scratch = `${file}.${process.pid}.tmp`;
    writeFileSync(scratch, JSON.stringify(vault), { mode: 0o600 });
    renameSync(scratch, file);
  };

  return {
    set(name, username, secret, site) {
      if (!validCredentialName(name)) throw new Error("invalid credential name");
      if (!site || !site.trim()) throw new Error("a saved login needs a site");
      const vault = read();
      vault.entries[name] = { username: String(username ?? ""), ...(site ? { site } : {}), secret: seal(key, String(secret ?? "")) };
      write(vault);
    },
    remove(name) {
      const vault = read();
      if (!(name in vault.entries)) return false;
      delete vault.entries[name];
      write(vault);
      return true;
    },
    list() {
      return Object.entries(read().entries)
        .map(([name, entry]) => ({ name, username: entry.username, ...(entry.site ? { site: entry.site } : {}) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    reveal(name) {
      const entry = read().entries[name];
      if (!entry) return null;
      return { username: entry.username, secret: open(key, entry.secret), ...(entry.site ? { site: entry.site } : {}) };
    },
  };
}
