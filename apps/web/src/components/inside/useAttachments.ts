import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes, MAX_ATTACHMENTS, type Attachment } from "@understudy/protocol";
import { messages } from "@/lib/messages";
import { httpTransport, pastedName, runUpload, UploadError, type UploadTransport } from "@/lib/uploader";

export type PendingFile = {
  key: string;
  file: File;
  name: string;
  size: number;
  type: string;
  status: "waiting" | "uploading" | "done" | "error";
  sent: number;
  uploadId?: string;
  attachment?: Attachment;
  error?: string;
  preview?: string;
};

const PARALLEL = 2;
const PREVIEWABLE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/;

function describe(error: unknown) {
  const t = messages.attachments;
  if (!(error instanceof UploadError)) return t.failed;
  if (error.code === "too_large") return t.tooLarge(formatBytes(error.detail.max ?? 0));
  if (error.code === "disk_full") return t.diskFull(error.detail.free !== undefined ? formatBytes(error.detail.free) : "");
  if (error.code === "offline") return t.offline;
  return t.failed;
}

export function namedFile(file: File, now = new Date()) {
  if (file.name && file.name !== "image.png" && file.name !== "blob") return file;
  return new File([file], pastedName(messages.attachments.pastedName, file.type, now), { type: file.type, lastModified: file.lastModified });
}

export function useAttachments(agentId: string, transport: UploadTransport = httpTransport(agentId)) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const running = useRef(new Set<string>());
  const transportRef = useRef(transport);
  const filesRef = useRef(files);
  filesRef.current = files;

  const patch = useCallback((key: string, change: Partial<PendingFile>) => {
    setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...change } : f)));
  }, []);

  const start = useCallback(
    (item: PendingFile) => {
      const controller = new AbortController();
      controllers.current.set(item.key, controller);
      running.current.add(item.key);
      patch(item.key, { status: "uploading", sent: 0, error: undefined });
      runUpload(item.file, transportRef.current, {
        signal: controller.signal,
        onStart: (uploadId) => patch(item.key, { uploadId }),
        onProgress: (sent) => patch(item.key, { sent }),
      })
        .then((attachment) => patch(item.key, { status: "done", sent: item.size, attachment }))
        .catch((error) => {
          if (error instanceof UploadError && error.code === "aborted") return;
          patch(item.key, { status: "error", error: describe(error) });
        })
        .finally(() => {
          running.current.delete(item.key);
          controllers.current.delete(item.key);
          setFiles((list) => [...list]);
        });
    },
    [patch],
  );

  useEffect(() => {
    const free = PARALLEL - running.current.size;
    if (free <= 0) return;
    for (const item of files.filter((f) => f.status === "waiting" && !running.current.has(f.key)).slice(0, free)) start(item);
  }, [files, start]);

  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort();
      for (const f of filesRef.current) if (f.preview) URL.revokeObjectURL(f.preview);
    },
    [],
  );

  const add = useCallback((incoming: File[]) => {
    if (!incoming.length) return;
    const room = MAX_ATTACHMENTS - filesRef.current.length;
    if (incoming.length > room) setNotice(messages.attachments.tooMany(MAX_ATTACHMENTS));
    else setNotice(null);
    const now = new Date();
    const added = incoming.slice(0, Math.max(0, room)).map((raw, i) => {
      const file = namedFile(raw, new Date(now.getTime() + i * 1000));
      return {
        key: `f${now.getTime()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        status: "waiting" as const,
        sent: 0,
        ...(PREVIEWABLE.test(file.type) ? { preview: URL.createObjectURL(file) } : {}),
      };
    });
    setFiles((list) => [...list, ...added]);
  }, []);

  const remove = useCallback((key: string) => {
    const item = filesRef.current.find((f) => f.key === key);
    controllers.current.get(key)?.abort();
    if (item?.uploadId && item.status !== "done") void transportRef.current.cancel(item.uploadId);
    if (item?.preview) URL.revokeObjectURL(item.preview);
    setFiles((list) => list.filter((f) => f.key !== key));
  }, []);

  const retry = useCallback((key: string) => {
    setFiles((list) => list.map((f) => (f.key === key ? { ...f, status: "waiting", sent: 0, error: undefined, uploadId: undefined } : f)));
  }, []);

  const clear = useCallback(() => {
    for (const f of filesRef.current) if (f.preview) URL.revokeObjectURL(f.preview);
    setFiles([]);
    setNotice(null);
  }, []);

  const uploading = files.some((f) => f.status === "waiting" || f.status === "uploading");
  const ready = files.filter((f) => f.status === "done" && f.uploadId).map((f) => f.uploadId!);

  return { files, add, remove, retry, clear, uploading, ready, notice };
}

export type AttachmentsState = ReturnType<typeof useAttachments>;
