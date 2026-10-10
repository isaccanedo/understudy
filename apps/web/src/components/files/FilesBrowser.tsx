"use client";

import { useRef, useState } from "react";
import { formatBytes, type FileEntry } from "@understudy/protocol";
import type { AgentLink, LiveState } from "@/components/live/useAgentSocket";
import { currentLocale, messages } from "@/lib/messages";
import { fileUrl, httpTransport, runUpload, UploadError } from "@/lib/uploader";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Look } from "@/lib/look";

export function FilesBrowser({ agentId, live, send, files, look }: { agentId: string; live: LiveState; send: AgentLink["send"]; files: FileEntry[]; look?: Look }) {
  const t = messages.files;
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function upload(list: File[]) {
    setNotice(null);
    const transport = httpTransport(agentId);
    const done: string[] = [];
    for (const file of list) {
      let uploadId = "";
      try {
        setBusy(`${file.name} · 0%`);
        await runUpload(file, transport, {
          signal: new AbortController().signal,
          onStart: (id) => (uploadId = id),
          onProgress: (sent, total) => setBusy(`${file.name} · ${total ? Math.round((sent / total) * 100) : 100}%`),
        });
        done.push(uploadId);
      } catch (error) {
        const code = error instanceof UploadError ? error.code : "failed";
        setNotice({ text: code === "too_large" ? t.tooLarge : code === "offline" ? t.offline : code === "disk_full" ? messages.attachments.diskFull("") : messages.common.error, error: true });
        break;
      }
    }
    setBusy(null);
    if (done.length && send({ type: "chat", text: "", attachments: done })) setNotice({ text: t.uploaded(list.map((f) => f.name).join(", ")) });
  }

  return (
    <div className="ws-panel">
      <p className="ws-lead">{t.subtitle}</p>
      <div className="grid grid-cols-2 gap-4 @max-[760px]:grid-cols-1">
        <div className="card p-[18px] flex flex-col gap-3 self-start">
          <h3 className="m-0 text-[14px] font-semibold">{t.inbox}</h3>
          <p className="m-0 text-[12.5px] text-ash">{t.inboxHint}</p>
          <button
            type="button"
            className="border-[1.5px] border-dashed border-line rounded-xl p-5 text-center text-ash text-[13px] cursor-pointer bg-transparent hover:text-mist hover:border-iron transition-colors"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = [...e.dataTransfer.files];
              if (dropped.length) upload(dropped);
            }}
          >
            {busy ? `${t.uploading} ${busy}` : t.drop}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])];
              if (picked.length) upload(picked);
              e.target.value = "";
            }}
          />
          {notice && <div className={`text-[12.5px] ${notice.error ? "text-coral" : "text-green"}`}>{notice.text}</div>}
          {!live.online && <div className="text-smoke text-[12px]">{t.offline}</div>}
        </div>
        <div className="card p-[18px] flex flex-col gap-3 self-start min-w-0">
          <h3 className="m-0 text-[14px] font-semibold">{t.outbox}</h3>
          <p className="m-0 text-[12.5px] text-ash">{t.outboxHint}</p>
          {files.length === 0 ? (
            <EmptyState size="sm" look={look} mood="calm" title={messages.empty.filesTitle} body={messages.empty.filesBody} />
          ) : (
            <div className="flex flex-col">
              {files.map((f) => (
                <div key={f.path} className="flex items-center gap-x-3 gap-y-1 border-t border-graphite py-2 first:border-0 text-[13px] flex-wrap">
                  <span className="font-mono truncate flex-1 min-w-[120px]">{f.path}</span>
                  <span className="text-smoke text-[12px] whitespace-nowrap" suppressHydrationWarning>
                    {formatBytes(f.size)} · {new Date(f.updatedAt).toLocaleString(currentLocale())}
                  </span>
                  <a
                    className="btn sec sm"
                    href={fileUrl(agentId, `outbox/${f.path}`, { download: true })}
                    aria-disabled={!live.online}
                    download
                  >
                    {t.download}
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
