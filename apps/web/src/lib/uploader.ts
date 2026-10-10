import type { Attachment } from "@understudy/protocol";

export type UploadErrorCode = "too_large" | "disk_full" | "offline" | "aborted" | "unknown_upload" | "failed";

export class UploadError extends Error {
  constructor(
    readonly code: UploadErrorCode,
    readonly status = 0,
    readonly detail: { free?: number; max?: number } = {},
  ) {
    super(code);
  }
}

export type UploadSource = { name: string; size: number; slice: (start: number, end: number) => Blob };

export type UploadTransport = {
  create: (name: string, size: number, signal: AbortSignal) => Promise<{ uploadId: string; chunkBytes: number; received: number }>;
  status: (uploadId: string, signal: AbortSignal) => Promise<{ received: number }>;
  put: (uploadId: string, offset: number, data: Blob, onProgress: (sent: number) => void, signal: AbortSignal) => Promise<{ received: number }>;
  finish: (uploadId: string, signal: AbortSignal) => Promise<{ attachment: Attachment }>;
  cancel: (uploadId: string) => Promise<void>;
};

export type UploadOptions = {
  signal: AbortSignal;
  onStart?: (uploadId: string) => void;
  onProgress?: (sent: number, total: number) => void;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
};

export const FATAL_CODES: UploadErrorCode[] = ["too_large", "disk_full", "aborted", "unknown_upload"];

export function errorFromStatus(status: number, body: { error?: string; free?: number; max?: number } = {}): UploadError {
  if (status === 413 || body.error === "too_large") return new UploadError("too_large", status, { max: body.max });
  if (status === 507 || body.error === "disk_full") return new UploadError("disk_full", status, { free: body.free });
  if (status === 503 || body.error === "offline") return new UploadError("offline", status);
  if (status === 404 || body.error === "unknown_upload") return new UploadError("unknown_upload", status);
  return new UploadError("failed", status);
}

export function retryDelay(attempt: number) {
  return Math.min(8000, 500 * 2 ** attempt);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runUpload(file: UploadSource, transport: UploadTransport, options: UploadOptions): Promise<Attachment> {
  const { signal } = options;
  const retries = options.retries ?? 5;
  const sleep = options.sleep ?? defaultSleep;
  const guard = () => {
    if (signal.aborted) throw new UploadError("aborted");
  };
  const created = await transport.create(file.name, file.size, signal);
  options.onStart?.(created.uploadId);
  let received = created.received;
  let failures = 0;
  options.onProgress?.(received, file.size);
  while (received < file.size) {
    guard();
    const end = Math.min(file.size, received + created.chunkBytes);
    const base = received;
    try {
      const result = await transport.put(created.uploadId, base, file.slice(base, end), (sent) => options.onProgress?.(base + sent, file.size), signal);
      received = result.received;
      failures = 0;
      options.onProgress?.(received, file.size);
    } catch (error) {
      guard();
      const code = error instanceof UploadError ? error.code : "failed";
      if (FATAL_CODES.includes(code) || failures >= retries) throw error instanceof UploadError ? error : new UploadError("failed");
      await sleep(retryDelay(failures));
      failures++;
      guard();
      try {
        received = (await transport.status(created.uploadId, signal)).received;
      } catch (statusError) {
        if (statusError instanceof UploadError && FATAL_CODES.includes(statusError.code)) throw statusError;
      }
    }
  }
  guard();
  for (let attempt = 0; ; attempt++) {
    try {
      return (await transport.finish(created.uploadId, signal)).attachment;
    } catch (error) {
      guard();
      const code = error instanceof UploadError ? error.code : "failed";
      if (FATAL_CODES.includes(code) || attempt >= retries) throw error instanceof UploadError ? error : new UploadError("failed");
      await sleep(retryDelay(attempt));
    }
  }
}

async function json(res: Response) {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function httpTransport(agentId: string): UploadTransport {
  const base = `/api/files/${encodeURIComponent(agentId)}/uploads`;
  const call = async (url: string, init: RequestInit) => {
    let res: Response;
    try {
      res = await fetch(url, { ...init, credentials: "same-origin" });
    } catch (error) {
      if (init.signal?.aborted) throw new UploadError("aborted");
      throw new UploadError("failed");
    }
    const body = await json(res);
    if (!res.ok) throw errorFromStatus(res.status, body as { error?: string; free?: number; max?: number });
    return body;
  };
  return {
    async create(name, size, signal) {
      const body = await call(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, size }), signal });
      return { uploadId: String(body.uploadId), chunkBytes: Number(body.chunkBytes), received: Number(body.received ?? 0) };
    },
    async status(uploadId, signal) {
      const body = await call(`${base}/${uploadId}`, { method: "GET", signal });
      return { received: Number(body.received ?? 0) };
    },
    put(uploadId, offset, data, onProgress, signal) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", `${base}/${uploadId}?offset=${offset}`);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.onprogress = (event) => onProgress(event.loaded);
        xhr.onload = () => {
          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(xhr.responseText || "{}");
          } catch {}
          if (xhr.status >= 200 && xhr.status < 300) resolve({ received: Number(body.received ?? offset + data.size) });
          else reject(errorFromStatus(xhr.status, body as { error?: string; free?: number; max?: number }));
        };
        xhr.onerror = () => reject(new UploadError("failed"));
        xhr.onabort = () => reject(new UploadError("aborted"));
        signal.addEventListener("abort", () => xhr.abort(), { once: true });
        xhr.send(data);
      });
    },
    async finish(uploadId, signal) {
      const body = await call(`${base}/${uploadId}/finish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal });
      return { attachment: body.attachment as Attachment };
    },
    async cancel(uploadId) {
      await fetch(`${base}/${uploadId}`, { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
    },
  };
}

export function fileUrl(agentId: string, path: string, options: { download?: boolean; thumb?: boolean } = {}) {
  const section = options.thumb ? "thumb" : "raw";
  return `/api/files/${encodeURIComponent(agentId)}/${section}?path=${encodeURIComponent(path)}${options.download ? "&download=1" : ""}`;
}

export function pastedName(prefix: string, type: string, at: Date) {
  const ext = type === "image/jpeg" ? "jpg" : type.startsWith("image/") ? type.slice(6).replace(/[^a-z0-9]/g, "") || "png" : "bin";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${prefix} ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}.${ext}`;
}
