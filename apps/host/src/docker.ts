import { request } from "node:http";

export type DockerResponse = { status: number; body: string };

export type DockerClient = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<DockerResponse>;

export function dockerClient(socketPath: string, apiVersion = "v1.45"): DockerClient {
  return (method, path, body, headers = {}) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const call = request(
        {
          socketPath,
          method,
          path: `/${apiVersion}${path}`,
          headers: {
            ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
            ...headers,
          },
          timeout: 10 * 60 * 1000,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
          response.on("error", reject);
        },
      );
      call.on("timeout", () => call.destroy(new Error(`docker ${method} ${path} timed out`)));
      call.on("error", reject);
      if (payload) call.write(payload);
      call.end();
    });
}

export class DockerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function expectOk(response: DockerResponse, allowed: number[] = []): DockerResponse {
  if ((response.status >= 200 && response.status < 300) || allowed.includes(response.status)) return response;
  let message = response.body;
  try {
    message = JSON.parse(response.body).message ?? message;
  } catch {}
  throw new DockerError(response.status, message.trim().slice(0, 500));
}
