import { AwsClient } from "aws4fetch";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";

export type Blob = { data: Buffer; contentType: string };

export type BlobStore = {
  name: "s3" | "database";
  put: (key: string, data: Buffer, contentType: string) => Promise<void>;
  get: (key: string) => Promise<Blob | null>;
  remove: (keys: string[]) => Promise<void>;
};

export type BucketConfig = NonNullable<typeof env.artifactBucket>;

const KEY = /^artifacts\/art_[A-Za-z0-9_-]{6,80}\/arv_[A-Za-z0-9_-]{6,80}\/(source|page-\d{1,4}\.jpg)$/;

export function validBlobKey(key: string) {
  return KEY.test(key);
}

export function sourceKey(artifactId: string, versionId: string) {
  return `artifacts/${artifactId}/${versionId}/source`;
}

export function pageKey(artifactId: string, versionId: string, page: number) {
  return `artifacts/${artifactId}/${versionId}/page-${page}.jpg`;
}

export function versionKeys(artifactId: string, versionId: string, pages: number) {
  return [sourceKey(artifactId, versionId), ...Array.from({ length: pages }, (_, i) => pageKey(artifactId, versionId, i + 1))];
}

export function objectUrl(config: Pick<BucketConfig, "endpoint" | "bucket">, key: string) {
  if (!validBlobKey(key)) throw new Error("invalid artifact key");
  return `${config.endpoint}/${encodeURIComponent(config.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function s3Store(config: BucketConfig, fetcher: typeof fetch = fetch): BlobStore {
  const client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, sessionToken: config.sessionToken, region: config.region, service: "s3" });
  const call = async (method: string, key: string, body?: Buffer, contentType?: string) => {
    const request = await client.sign(objectUrl(config, key), {
      method,
      ...(body ? { body: new Uint8Array(body) } : {}),
      headers: contentType ? { "content-type": contentType } : {},
    });
    return fetcher(request);
  };
  return {
    name: "s3",
    async put(key, data, contentType) {
      const res = await call("PUT", key, data, contentType);
      if (!res.ok) throw new Error(`artifact storage refused the upload (${res.status})`);
    },
    async get(key) {
      const res = await call("GET", key);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`artifact storage failed (${res.status})`);
      return { data: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
    },
    async remove(keys) {
      for (const key of keys) {
        const res = await call("DELETE", key);
        if (!res.ok && res.status !== 404) throw new Error(`artifact storage could not delete (${res.status})`);
      }
    },
  };
}

export function databaseStore(): BlobStore {
  return {
    name: "database",
    async put(key, data, contentType) {
      if (!validBlobKey(key)) throw new Error("invalid artifact key");
      await getDb().insert(schema.artifactBlobs).values({ key, data, contentType }).onConflictDoUpdate({ target: schema.artifactBlobs.key, set: { data, contentType } });
    },
    async get(key) {
      if (!validBlobKey(key)) return null;
      const [row] = await getDb().select().from(schema.artifactBlobs).where(eq(schema.artifactBlobs.key, key));
      return row ? { data: row.data, contentType: row.contentType } : null;
    },
    async remove(keys) {
      if (keys.length) await getDb().delete(schema.artifactBlobs).where(inArray(schema.artifactBlobs.key, keys));
    },
  };
}

let current: BlobStore | null = null;

export function blobStore(): BlobStore {
  if (!current) {
    const bucket = env.artifactBucket;
    current = bucket ? s3Store(bucket) : databaseStore();
  }
  return current;
}
