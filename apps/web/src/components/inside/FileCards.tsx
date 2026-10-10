import {
  AlertCircle,
  Download,
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  LoaderCircle,
  RotateCw,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { codeLanguageOf, formatBytes, mimeOf, previewKind, TEXT_PREVIEW_MAX_BYTES, type Attachment } from "@understudy/protocol";
import { highlight } from "@/lib/highlight";
import { messages } from "@/lib/messages";
import { fileUrl } from "@/lib/uploader";
import type { PendingFile } from "./useAttachments";

export function TypeIcon({ name, size = 16 }: { name: string; size?: number }) {
  const mime = mimeOf(name);
  const props = { size, "aria-hidden": true as const };
  if (mime.startsWith("image/")) return <FileImage {...props} />;
  if (mime.startsWith("video/")) return <FileVideo {...props} />;
  if (mime.startsWith("audio/")) return <FileAudio {...props} />;
  if (/zip|gzip|tar|7z|rar/.test(mime)) return <FileArchive {...props} />;
  if (/spreadsheet|excel|csv|tab-separated/.test(mime)) return <FileSpreadsheet {...props} />;
  if (codeLanguageOf(name) && !/plain|markdown/.test(mime)) return <FileCode {...props} />;
  if (/pdf|text|document|word|rtf|presentation/.test(mime)) return <FileText {...props} />;
  return <FileIcon {...props} />;
}

function kindLabel(name: string) {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1];
  return ext ? ext.toUpperCase() : messages.attachments.file;
}

export function AttachmentChip({ item, onRemove, onRetry }: { item: PendingFile; onRemove: () => void; onRetry: () => void }) {
  const t = messages.attachments;
  const percent = item.size ? Math.min(100, Math.round((item.sent / item.size) * 100)) : item.status === "done" ? 100 : 0;
  const busy = item.status === "uploading" || item.status === "waiting";
  return (
    <div className={`fx-chip is-${item.status}`} title={item.name}>
      <div className="fx-chip-thumb">
        {item.preview ? <img src={item.preview} alt="" /> : <TypeIcon name={item.name} size={17} />}
      </div>
      <div className="fx-chip-body">
        <span className="fx-chip-name">{item.name}</span>
        <span className="fx-chip-meta" aria-live="polite">
          {item.status === "error" ? (
            <span className="fx-chip-error">
              <AlertCircle size={11} aria-hidden />
              {item.error}
            </span>
          ) : item.status === "waiting" ? (
            `${formatBytes(item.size)} · ${t.waiting}`
          ) : item.status === "uploading" ? (
            `${formatBytes(item.sent)} / ${formatBytes(item.size)} · ${percent}%`
          ) : (
            `${formatBytes(item.size)} · ${kindLabel(item.name)}`
          )}
        </span>
        {busy && (
          <span className="fx-progress" role="progressbar" aria-label={t.uploadingName(item.name)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span style={{ width: `${percent}%` }} />
          </span>
        )}
      </div>
      {item.status === "error" && (
        <button type="button" className="fx-chip-btn" onClick={onRetry} aria-label={t.retryName(item.name)} title={t.retry}>
          <RotateCw size={13} aria-hidden />
        </button>
      )}
      <button type="button" className="fx-chip-btn" onClick={onRemove} aria-label={busy ? t.cancelName(item.name) : t.removeName(item.name)} title={busy ? t.cancel : t.remove}>
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}

function TextPreview({ url, name, size }: { url: string; name: string; size: number }) {
  const [state, setState] = useState<{ text?: string; error?: boolean }>({});
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal, headers: { Range: `bytes=0-${TEXT_PREVIEW_MAX_BYTES - 1}` }, credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const buffer = await res.arrayBuffer();
        setState({ text: new TextDecoder("utf-8", { fatal: false }).decode(buffer) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ error: true });
      });
    return () => controller.abort();
  }, [url]);
  if (state.error) return <div className="fx-empty">{messages.attachments.previewOffline}</div>;
  if (state.text === undefined) return <div className="fx-empty"><LoaderCircle size={14} className="cx-spin" aria-hidden /> {messages.attachments.loading}</div>;
  const lang = codeLanguageOf(name) ?? "text";
  const lines = state.text.split("\n");
  const shown = lines.slice(0, 400).join("\n");
  return (
    <div className="fx-code">
      <pre>
        <code>
          {highlight(shown, lang).map((token, i) => (token.kind === "plain" ? token.text : <span key={i} className={`hl-${token.kind}`}>{token.text}</span>))}
        </code>
      </pre>
      {(lines.length > 400 || size > TEXT_PREVIEW_MAX_BYTES) && <div className="fx-more">{messages.attachments.truncated}</div>}
    </div>
  );
}

function Preview({ agentId, attachment }: { agentId: string; attachment: Attachment }) {
  const [broken, setBroken] = useState(false);
  const kind = previewKind(attachment);
  const url = fileUrl(agentId, attachment.path);
  if (broken) return <div className="fx-empty">{messages.attachments.previewOffline}</div>;
  if (kind === "image") {
    return (
      <a className="fx-media fx-image" href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt={attachment.name} loading="lazy" onError={() => setBroken(true)} />
      </a>
    );
  }
  if (kind === "video") {
    return (
      <div className="fx-media">
        <video controls preload="metadata" playsInline src={url} poster={fileUrl(agentId, attachment.path, { thumb: true })} onError={() => setBroken(true)} />
      </div>
    );
  }
  if (kind === "audio") {
    return (
      <div className="fx-audio">
        <audio controls preload="metadata" src={url} onError={() => setBroken(true)} />
      </div>
    );
  }
  if (kind === "pdf") {
    return (
      <a className="fx-media fx-pdf" href={url} target="_blank" rel="noopener noreferrer" aria-label={messages.attachments.openName(attachment.name)}>
        <img src={fileUrl(agentId, attachment.path, { thumb: true })} alt="" loading="lazy" onError={() => setBroken(true)} />
      </a>
    );
  }
  if (kind === "text") return <TextPreview url={url} name={attachment.name} size={attachment.size} />;
  return null;
}

export function FileCard({ agentId, attachment }: { agentId: string; attachment: Attachment }) {
  const t = messages.attachments;
  const kind = previewKind(attachment);
  const opens = kind === "image" || kind === "pdf" || kind === "video";
  return (
    <figure className={`fx-card is-${kind}`}>
      <Preview agentId={agentId} attachment={attachment} />
      <figcaption className="fx-foot">
        <span className="fx-foot-icon">
          <TypeIcon name={attachment.name} size={15} />
        </span>
        <span className="fx-foot-text">
          <span className="fx-foot-name" title={attachment.name}>{attachment.name}</span>
          <span className="fx-foot-meta">
            {formatBytes(attachment.size)} · {kindLabel(attachment.name)}
          </span>
        </span>
        {opens && (
          <a className="fx-foot-btn" href={fileUrl(agentId, attachment.path)} target="_blank" rel="noopener noreferrer" aria-label={t.openName(attachment.name)} title={t.open}>
            <ExternalLink size={14} aria-hidden />
          </a>
        )}
        <a className="fx-foot-btn" href={fileUrl(agentId, attachment.path, { download: true })} download={attachment.name} aria-label={t.downloadName(attachment.name)} title={t.download}>
          <Download size={14} aria-hidden />
        </a>
      </figcaption>
    </figure>
  );
}

export function AttachmentList({ agentId, attachments }: { agentId: string; attachments: Attachment[] }) {
  return (
    <div className="fx-list">
      {attachments.map((attachment) => (
        <FileCard key={attachment.path} agentId={agentId} attachment={attachment} />
      ))}
    </div>
  );
}
