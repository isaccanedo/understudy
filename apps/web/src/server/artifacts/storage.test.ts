import assert from "node:assert/strict";
import { test } from "node:test";
import { objectUrl, pageKey, s3Store, sourceKey, validBlobKey, versionKeys } from "./storage";

const config = { bucket: "understudy-artifacts", region: "us-east-1", endpoint: "http://127.0.0.1:9000", accessKeyId: "minio-test", secretAccessKey: "minio-test-secret", sessionToken: undefined };

test("blob keys are fixed paths under the artifact and version", () => {
  assert.equal(sourceKey("art_abcdef12", "arv_version01"), "artifacts/art_abcdef12/arv_version01/source");
  assert.equal(pageKey("art_abcdef12", "arv_version01", 2), "artifacts/art_abcdef12/arv_version01/page-2.jpg");
  assert.deepEqual(versionKeys("art_abcdef12", "arv_version01", 2), ["artifacts/art_abcdef12/arv_version01/source", "artifacts/art_abcdef12/arv_version01/page-1.jpg", "artifacts/art_abcdef12/arv_version01/page-2.jpg"]);
  assert.equal(validBlobKey("artifacts/art_abcdef12/arv_version01/source"), true);
  assert.equal(validBlobKey("artifacts/art_abcdef12/3/source"), false);
  assert.equal(validBlobKey("artifacts/../secrets"), false);
  assert.equal(validBlobKey("artifacts/art_abcdef12/arv_version01/source/../../x"), false);
  assert.throws(() => objectUrl(config, "other/key"));
});

test("the S3 store signs path-style requests that MinIO and S3 both accept", async () => {
  const seen: Request[] = [];
  const objects = new Map<string, { body: Buffer; type: string }>();
  const fetcher = (async (input: Request) => {
    seen.push(input);
    const key = new URL(input.url).pathname;
    if (input.method === "PUT") {
      objects.set(key, { body: Buffer.from(await input.arrayBuffer()), type: input.headers.get("content-type") ?? "" });
      return new Response(null, { status: 200 });
    }
    if (input.method === "GET") {
      const found = objects.get(key);
      return found ? new Response(new Uint8Array(found.body), { status: 200, headers: { "content-type": found.type } }) : new Response(null, { status: 404 });
    }
    objects.delete(key);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const store = s3Store(config, fetcher);
  await store.put("artifacts/art_abcdef12/arv_version01/source", Buffer.from("<h1>hi</h1>"), "application/octet-stream");
  const put = seen[0];
  assert.equal(put.url, "http://127.0.0.1:9000/understudy-artifacts/artifacts/art_abcdef12/arv_version01/source");
  assert.match(put.headers.get("authorization") ?? "", /^AWS4-HMAC-SHA256 Credential=minio-test\/\d{8}\/us-east-1\/s3\/aws4_request/);
  assert.ok(put.headers.get("x-amz-content-sha256"));
  const got = await store.get("artifacts/art_abcdef12/arv_version01/source");
  assert.equal(got?.data.toString(), "<h1>hi</h1>");
  assert.equal(await store.get("artifacts/art_abcdef12/arv_version02/source"), null);
  await store.remove(["artifacts/art_abcdef12/arv_version01/source"]);
  assert.equal(await store.get("artifacts/art_abcdef12/arv_version01/source"), null);
});

test("a refused upload is an error, not a silent success", async () => {
  const store = s3Store(config, (async () => new Response("denied", { status: 403 })) as typeof fetch);
  await assert.rejects(store.put("artifacts/art_abcdef12/arv_version01/source", Buffer.from("x"), "text/plain"), /403/);
});
