import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Link2,
  Maximize2,
  Minimize2,
  Minus,
  PencilLine,
  Plus,
  RotateCw,
  ShieldCheck,
  ShieldAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ARTIFACT_INSTRUCTION_MAX, ARTIFACT_SANDBOX, parseBridgeMessage } from "@understudy/protocol";
import { artifactLinks, shareArtifact, unshareArtifact } from "@/app/actions/artifacts";
import { Markdown } from "@/components/inside/Markdown";
import { currentLocale, messages } from "@/lib/messages";
import type { ArtifactView } from "@/server/artifacts/service";
import type { ViewerToServer } from "@/server/hub-types";
import { formatLabel, ZOOM_STEPS, nextZoom } from "./artifact-ui";

const t = messages.artifacts;

function whenOf(iso: string) {
  return new Date(iso).toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "short" });
}

function useSelectionIn(container: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!enabled) return;
    const onChange = () => {
      const selection = document.getSelection();
      const node = selection?.anchorNode ?? null;
      if (!selection || !node || !container.current?.contains(node)) return setText("");
      setText(String(selection).replace(/\s+/g, " ").trim().slice(0, 1500));
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [container, enabled]);
  return text;
}

function VersionMenu({ view, onSelect }: { view: ArtifactView; onSelect: (version: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (view.versions.length <= 1) return <span className="art-pill">v{view.version.version}</span>;
  return (
    <div ref={ref} className="art-menu-wrap">
      <button type="button" className="art-select" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t.versionOf(view.version.version, view.latestVersion)}
        <ChevronDown size={13} aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label={t.versions} className="art-menu">
          {view.versions.map((v) => (
            <button
              key={v.id}
              type="button"
              role="menuitemradio"
              aria-checked={v.version === view.version.version}
              className="art-menu-item"
              onClick={() => {
                setOpen(false);
                onSelect(v.version);
              }}
            >
              <span className={`art-pill ${v.version === view.latestVersion ? "is-new" : ""}`}>v{v.version}</span>
              <span className="min-w-0 flex-1">
                <span className="art-menu-name">{v.note || (v.version === 1 ? t.firstVersion : `v${v.version}`)}</span>
                <span className="art-menu-line" suppressHydrationWarning>
                  {whenOf(v.createdAt)}
                  {v.version === view.latestVersion ? ` · ${t.newest}` : ""}
                </span>
              </span>
              {v.version === view.version.version && <Check size={15} aria-hidden className="art-ok" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SharePanel({ agentId, artifactId, version, onClose }: { agentId: string; artifactId: string; version: number; onClose: () => void }) {
  const [state, setState] = useState<{ url?: string; until?: string; shared?: number[]; note?: string; busy?: boolean }>({});
  useEffect(() => {
    let alive = true;
    artifactLinks(agentId, artifactId)
      .then((links) => {
        if (alive && links.length) setState((s) => ({ ...s, until: links.map((l) => l.expiresAt).sort().at(-1), shared: [...new Set(links.map((l) => l.version))].sort((a, b) => a - b) }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [agentId, artifactId]);
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setState((s) => ({ ...s, note: t.linkCopied }));
    } catch {}
  };
  return (
    <div className="art-pop art-share" role="dialog" aria-label={t.shareTitle}>
      <div className="art-pop-head">
        <strong>{t.shareTitle}</strong>
        <button type="button" className="art-icon" aria-label={t.cancel} onClick={onClose}>
          <X size={15} aria-hidden />
        </button>
      </div>
      <p className="art-pop-body">{t.shareBody(version)}</p>
      {state.until && !state.url && (
        <p className="art-pop-body" suppressHydrationWarning>
          {t.linkActive((state.shared ?? []).map((v) => `v${v}`).join(", "), whenOf(state.until))}
        </p>
      )}
      {state.url && <input className="art-link" readOnly value={state.url} onFocus={(e) => e.currentTarget.select()} aria-label={t.shareTitle} />}
      <div className="art-pop-actions">
        {state.until && (
          <button
            type="button"
            className="art-btn ghost"
            disabled={state.busy}
            onClick={async () => {
              setState((s) => ({ ...s, busy: true }));
              await unshareArtifact(agentId, artifactId).catch(() => 0);
              setState({ note: t.revoked });
            }}
          >
            {t.revoke}
          </button>
        )}
        {state.url ? (
          <button type="button" className="art-btn" onClick={() => copy(state.url!)}>
            <Copy size={14} aria-hidden />
            {t.copyLink}
          </button>
        ) : (
          <button
            type="button"
            className="art-btn"
            disabled={state.busy}
            onClick={async () => {
              setState((s) => ({ ...s, busy: true }));
              try {
                const link = await shareArtifact(agentId, artifactId, version);
                setState({ url: link.url, until: link.expiresAt });
                await copy(link.url);
              } catch {
                setState({ note: t.loadFailed });
              }
            }}
          >
            <Link2 size={14} aria-hidden />
            {t.createLink}
          </button>
        )}
      </div>
      {state.note && (
        <p className="art-pop-note" role="status">
          {state.note}
        </p>
      )}
    </div>
  );
}

function EditBox({
  agentName,
  quote,
  page,
  onCancel,
  onSend,
}: {
  agentName: string;
  quote: string;
  page: number | null;
  onCancel: () => void;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const ready = text.trim().length > 0;
  return (
    <form
      className="art-pop art-edit"
      role="dialog"
      aria-label={t.requestEdits}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSend(text.trim());
      }}
    >
      <div className="art-pop-head">
        <strong>{quote ? t.editThisPart : page ? t.editPage(page) : t.editWhole}</strong>
      </div>
      {quote && <blockquote className="art-quote">{quote}</blockquote>}
      <textarea
        autoFocus
        className="art-textarea"
        placeholder={t.editPlaceholder}
        maxLength={ARTIFACT_INSTRUCTION_MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) onSend(text.trim());
        }}
      />
      <div className="art-pop-actions">
        <button type="button" className="art-btn ghost" onClick={onCancel}>
          {t.cancel}
        </button>
        <button type="submit" className="art-btn" disabled={!ready}>
          {t.sendTo(agentName)}
        </button>
      </div>
    </form>
  );
}

export function ArtifactViewer({
  view,
  agentName,
  mode,
  onBack,
  onSelectVersion,
  send,
  owner = false,
}: {
  view: ArtifactView;
  agentName: string;
  mode: "panel" | "public";
  onBack?: () => void;
  onSelectVersion?: (version: number) => void;
  send?: (message: ViewerToServer) => boolean;
  owner?: boolean;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [frameSelection, setFrameSelection] = useState("");
  const [blocked, setBlocked] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ quote: string; page: number | null } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const docSelection = useSelectionIn(docRef, view.kind === "markdown");
  const selection = view.kind === "html" ? frameSelection : docSelection;
  const canEdit = mode === "panel" && Boolean(send);
  const pages = view.pageUrls.length;
  const older = view.version.version !== view.latestVersion;

  useEffect(() => {
    setPage(1);
    setZoom(1);
    setFrameSelection("");
    setBlocked(null);
    setEditing(null);
  }, [view.version.id]);

  useEffect(() => {
    if (view.kind !== "html") return;
    const onMessage = (event: MessageEvent) => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const message = parseBridgeMessage(event.data);
      if (!message) return;
      if (message.kind === "selection") setFrameSelection(message.text);
      else setBlocked(message.host);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [view.kind]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else shellRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const sendEdit = (text: string, quote: string, onPage: number | null) => {
    if (!send) return;
    const ok = send({
      type: "chat",
      text,
      artifactEdit: { artifactId: view.id, version: view.version.version, ...(quote ? { quote } : {}), ...(onPage ? { page: onPage } : {}) },
    });
    setEditing(null);
    setFrameSelection("");
    if (ok) setNotice(t.sent(agentName));
  };

  const openEdit = () => setEditing({ quote: selection, page: view.kind === "pages" ? page : null });
  const zoomable = view.kind !== "markdown";

  let stage: ReactNode;
  if (view.kind === "html") {
    stage = (
      <div className="art-frame-wrap" style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})` }}>
        <iframe
          key={`${view.version.id}:${reloadKey}`}
          ref={frameRef}
          src={view.contentUrl}
          title={view.title}
          sandbox={ARTIFACT_SANDBOX}
          allow=""
          referrerPolicy="no-referrer"
          className="art-frame"
        />
      </div>
    );
  } else if (view.kind === "markdown") {
    stage = (
      <div ref={docRef} className="art-doc">
        <Markdown text={view.markdown ?? ""} />
      </div>
    );
  } else if (view.kind === "pages") {
    stage = (
      <div className="art-pages">
        <img src={view.pageUrls[page - 1]} alt={`${view.title}, ${t.pageOf(page, pages)}`} className="art-page" style={{ width: `${Math.round(zoom * 100)}%` }} referrerPolicy="no-referrer" />
      </div>
    );
  } else {
    stage = (
      <div className="art-pages">
        <img src={view.contentUrl} alt={view.title} className="art-image" style={{ width: zoom === 1 ? undefined : `${Math.round(zoom * 100)}%`, maxWidth: zoom === 1 ? "100%" : "none" }} referrerPolicy="no-referrer" />
      </div>
    );
  }

  return (
    <div ref={shellRef} className={`art-viewer ${fullscreen ? "is-full" : ""} is-${mode}`}>
      <div className="art-head">
        {onBack && (
          <button type="button" className="art-icon" aria-label={t.back} title={t.back} onClick={onBack}>
            <ChevronLeft size={17} aria-hidden />
          </button>
        )}
        <div className="art-title">
          <h2>{view.title}</h2>
          <small suppressHydrationWarning>
            {formatLabel(view.kind, view.version.name)} · {t.madeBy(agentName, whenOf(view.version.createdAt))}
          </small>
        </div>
        {mode === "panel" && onSelectVersion && <VersionMenu view={view} onSelect={onSelectVersion} />}
        {zoomable && (
          <div className="art-zoom" role="group" aria-label={t.zoomReset}>
            <button type="button" className="art-icon" aria-label={t.zoomOut} title={t.zoomOut} disabled={zoom <= ZOOM_STEPS[0]} onClick={() => setZoom((z) => nextZoom(z, -1))}>
              <Minus size={14} aria-hidden />
            </button>
            <button type="button" className="art-zoom-value" title={t.zoomReset} onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" className="art-icon" aria-label={t.zoomIn} title={t.zoomIn} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} onClick={() => setZoom((z) => nextZoom(z, 1))}>
              <Plus size={14} aria-hidden />
            </button>
          </div>
        )}
        {view.kind === "html" && (
          <button type="button" className="art-icon" aria-label={t.reload} title={t.reload} onClick={() => setReloadKey((k) => k + 1)}>
            <RotateCw size={15} aria-hidden />
          </button>
        )}
        <button type="button" className="art-icon art-hide-sm" aria-label={fullscreen ? t.exitFullscreen : t.fullscreen} title={fullscreen ? t.exitFullscreen : t.fullscreen} onClick={toggleFullscreen}>
          {fullscreen ? <Minimize2 size={15} aria-hidden /> : <Maximize2 size={15} aria-hidden />}
        </button>
        <a className="art-icon" href={view.downloadUrl} download={view.version.name} aria-label={t.download} title={t.download} rel="noopener noreferrer">
          <Download size={15} aria-hidden />
        </a>
        {mode === "panel" && owner && (
          <button type="button" className="art-icon" aria-label={t.share} title={t.share} aria-expanded={sharing} onClick={() => setSharing((s) => !s)}>
            <Link2 size={15} aria-hidden />
          </button>
        )}
        {view.kind === "markdown" && (
          <button
            type="button"
            className="art-btn ghost art-hide-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(view.markdown ?? "");
                setNotice(t.copied);
              } catch {}
            }}
          >
            {t.copyText}
          </button>
        )}
        {canEdit && (
          <button type="button" className="art-btn" onClick={openEdit}>
            <PencilLine size={14} aria-hidden />
            <span className="art-hide-sm">{t.requestEdits}</span>
          </button>
        )}
      </div>

      {older && onSelectVersion && (
        <div className="art-banner" role="status">
          <span>{t.olderVersion}</span>
          <button type="button" className="art-link-btn" onClick={() => onSelectVersion(view.latestVersion)}>
            {t.showNewest}
          </button>
        </div>
      )}

      <div className={`art-stage is-${view.kind}`}>
        {stage}
        {view.kind === "pages" && pages > 1 && (
          <div className="art-pager">
            <button type="button" className="art-icon" aria-label={t.previousPage} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft size={16} aria-hidden />
            </button>
            <span aria-live="polite">{t.pageOf(page, pages)}</span>
            <button type="button" className="art-icon" aria-label={t.nextPage} disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
              <ChevronRight size={16} aria-hidden />
            </button>
          </div>
        )}
        {canEdit && selection && !editing && (
          <button type="button" className="art-selection-btn" onClick={openEdit}>
            <PencilLine size={14} aria-hidden />
            {t.editThisPart}
          </button>
        )}
        {editing && (
          <EditBox agentName={agentName} quote={editing.quote} page={editing.page} onCancel={() => setEditing(null)} onSend={(text) => sendEdit(text, editing.quote, editing.page)} />
        )}
        {sharing && owner && <SharePanel key={view.version.id} agentId={view.agentId} artifactId={view.id} version={view.version.version} onClose={() => setSharing(false)} />}
        {notice && (
          <div className="art-toast" role="status">
            {notice}
          </div>
        )}
      </div>

      {blocked ? (
        <div className="art-foot is-warn" role="status">
          <ShieldAlert size={13} aria-hidden />
          <span className="min-w-0 flex-1">{t.blocked(blocked)}</span>
          {canEdit && (
            <button type="button" className="art-btn ghost sm" onClick={() => sendEdit(t.blockedRequest(blocked), "", null)}>
              {t.tellAgent(agentName)}
            </button>
          )}
        </div>
      ) : (
        <div className="art-foot">
          <ShieldCheck size={13} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{view.kind === "html" ? t.sandboxNote : canEdit && view.kind === "markdown" ? t.selectHint : t.savedNote}</span>
          {mode === "panel" && view.kind === "html" && <span className="art-hide-sm truncate">{t.savedNote}</span>}
        </div>
      )}
    </div>
  );
}
