import {
  ArrowUp,
  Check,
  ChevronDown,
  LoaderCircle,
  MessageSquare,
  Mic,
  MicOff,
  Paperclip,
  ShieldAlert,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { answerApproval } from "@/app/actions/approvals";
import { AgentFigure } from "@/components/AgentFigure";
import { ApprovalFields } from "@/components/approvals/ApprovalFields";
import { CHAT_WIDTH, CHAT_WIDTH_COOKIE, clampChatWidth, parseStoredWidth } from "@/lib/chat-layout";
import type { Look } from "@/lib/look";
import { currentLocale, messages } from "@/lib/messages";
import type { ApprovalView, ChatEntry } from "@/server/hub-types";
import { ArtifactCard, ArtifactEditChip } from "@/components/artifacts/ArtifactCard";
import { AttachmentChip, AttachmentList } from "./FileCards";
import { Markdown } from "./Markdown";
import type { AttachmentsState } from "./useAttachments";

const t = messages.live;

export function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
}

function fullTimeOf(iso: string) {
  return new Date(iso).toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "short" });
}

function dayLabel(iso: string) {
  const date = new Date(iso);
  if (date.toDateString() === new Date().toDateString()) return messages.live.today;
  return date.toLocaleDateString(currentLocale(), { weekday: "short", day: "numeric", month: "short" });
}

function ViaSlack() {
  return (
    <span className="cx-via">
      <MessageSquare size={10} aria-hidden />
      {messages.live.viaSlack}
    </span>
  );
}

export function DayDivider({ at }: { at: string }) {
  return (
    <div className="cx-divider" role="separator" suppressHydrationWarning>
      {dayLabel(at)}
    </div>
  );
}

export function MessageRow({
  entry,
  continued,
  agentName,
  look,
  agentId,
  onOpenArtifact,
}: {
  entry: ChatEntry;
  continued: boolean;
  agentName: string;
  look: Look;
  agentId?: string;
  onOpenArtifact?: () => void;
}) {
  const files = agentId && entry.attachments?.length ? <AttachmentList agentId={agentId} attachments={entry.attachments} /> : null;
  if (entry.role === "system") {
    return (
      <div className="cx-system" suppressHydrationWarning>
        <span>{entry.text}</span>
        <time dateTime={entry.at} title={fullTimeOf(entry.at)}>{timeOf(entry.at)}</time>
      </div>
    );
  }
  if (entry.role === "user") {
    return (
      <div className={`cx-user ${continued ? "is-continued" : ""}`}>
        {!continued && (
          <div className="cx-meta" suppressHydrationWarning>
            {entry.via === "slack" && <ViaSlack />}
            <span className="cx-name">{messages.live.you}</span>
            <time dateTime={entry.at} title={fullTimeOf(entry.at)}>{timeOf(entry.at)}</time>
          </div>
        )}
        {entry.artifact && <ArtifactEditChip artifact={entry.artifact} onOpen={onOpenArtifact} />}
        {entry.text && <div className="cx-bubble">{entry.text}</div>}
        {files}
      </div>
    );
  }
  return (
    <div className={`cx-agent ${continued ? "is-continued" : ""}`}>
      <div className="cx-avatar">{!continued && <AgentFigure size={22} look={look} live={false} />}</div>
      <div className="cx-agent-body">
        {!continued && (
          <div className="cx-meta" suppressHydrationWarning>
            <span className="cx-name">{agentName}</span>
            <time dateTime={entry.at} title={fullTimeOf(entry.at)}>{timeOf(entry.at)}</time>
            {entry.via === "slack" && <ViaSlack />}
          </div>
        )}
        {entry.text && <Markdown text={entry.text} />}
        {entry.artifact && <ArtifactCard artifact={entry.artifact} onOpen={onOpenArtifact} />}
        {files}
      </div>
    </div>
  );
}

export function StreamingRow({ text, agentName, look }: { text: string; agentName: string; look: Look }) {
  return (
    <div className="cx-agent" aria-live="polite" aria-busy="true">
      <div className="cx-avatar">
        <AgentFigure size={22} look={look} state="working" />
      </div>
      <div className="cx-agent-body">
        <div className="cx-meta">
          <span className="cx-name">{agentName}</span>
          <span className="cx-typing">{messages.live.typing}</span>
        </div>
        <Markdown text={text} streaming />
      </div>
    </div>
  );
}

export function WorkingRow({ agentName, look, note }: { agentName: string; look: Look; note: string | null }) {
  return (
    <div className="cx-agent cx-working" role="status" aria-live="polite">
      <div className="cx-avatar">
        <AgentFigure size={22} look={look} state="working" />
      </div>
      <div className="cx-agent-body">
        <div className="cx-meta">
          <span className="cx-name">{agentName}</span>
        </div>
        <div className="cx-working-line">
          <span className="cx-shimmer">{messages.live.working}</span>
          {note && <span className="cx-working-note">{note}</span>}
        </div>
      </div>
    </div>
  );
}

export function StepsGroup({ entries, active }: { entries: ChatEntry[]; active: boolean }) {
  const [open, setOpen] = useState(false);
  const last = entries[entries.length - 1];
  const listId = `steps-${entries[0].id}`;
  return (
    <div className={`cx-steps ${open ? "is-open" : ""}`}>
      <button type="button" className="cx-steps-head" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)} title={open ? t.hideSteps : t.showSteps}>
        {active ? <LoaderCircle size={13} className="cx-spin" aria-hidden /> : <Wrench size={13} aria-hidden />}
        <span className="cx-steps-last">{last.text}</span>
        <span className="cx-steps-count">{messages.live.steps(entries.length)}</span>
        <ChevronDown size={13} className="cx-chev" aria-hidden />
      </button>
      {open && (
        <ol id={listId} className="cx-steps-list">
          {entries.map((entry, i) => (
            <li key={entry.id} className={active && i === entries.length - 1 ? "is-live" : ""} suppressHydrationWarning>
              <span className="cx-step-text">{entry.text}</span>
              <time dateTime={entry.at}>{timeOf(entry.at)}</time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ApprovalCard({ approval, onDone, canAnswer = true }: { approval: ApprovalView; onDone: (id: string) => void; canAnswer?: boolean }) {
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  async function answer(approved: boolean) {
    setBusy(approved ? "yes" : "no");
    try {
      await answerApproval(approval.id, approved);
      onDone(approval.id);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="cx-approval" aria-label={messages.live.approvalTitle}>
      <header>
        <span className="cx-approval-icon">
          <ShieldAlert size={15} aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="cx-approval-title">{messages.live.approvalTitle}</div>
          <div className="cx-approval-summary">{approval.summary}</div>
        </div>
      </header>
      <ApprovalFields fields={approval.fields} compact />
      {canAnswer && (
        <div className="cx-approval-actions">
          <button className="btn sm sec" disabled={busy !== null} onClick={() => answer(false)}>
            {busy === "no" ? <LoaderCircle size={14} className="cx-spin" aria-hidden /> : <X size={14} aria-hidden />}
            {messages.live.deny}
          </button>
          <button className="btn sm pri" disabled={busy !== null} onClick={() => answer(true)}>
            {busy === "yes" ? <LoaderCircle size={14} className="cx-spin" aria-hidden /> : <Check size={14} aria-hidden />}
            {messages.live.approve}
          </button>
        </div>
      )}
    </section>
  );
}

export function Composer({
  agentName,
  draft,
  setDraft,
  onSubmit,
  speech,
  attachments,
}: {
  agentName: string;
  draft: string;
  setDraft: (value: string) => void;
  onSubmit: () => void;
  speech: { supported: boolean; listening: boolean; interim: string; start: () => void; stop: () => void };
  attachments?: AttachmentsState;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const pickRef = useRef<HTMLInputElement | null>(null);
  const files = attachments?.files ?? [];
  const uploading = attachments?.uploading ?? false;
  const ready = !uploading && (draft.trim().length > 0 || (attachments?.ready.length ?? 0) > 0);
  const t = messages.attachments;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  return (
    <form
      className="cx-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.focus();
      }}
    >
      {files.length > 0 && attachments && (
        <div className="fx-chips" aria-label={t.attach}>
          {files.map((item) => (
            <AttachmentChip key={item.key} item={item} onRemove={() => attachments.remove(item.key)} onRetry={() => attachments.retry(item.key)} />
          ))}
        </div>
      )}
      {attachments?.notice && <div className="fx-notice" role="status">{attachments.notice}</div>}
      <textarea
        ref={ref}
        rows={1}
        placeholder={speech.interim || messages.live.chatPlaceholder(agentName)}
        aria-label={messages.live.chatPlaceholder(agentName)}
        aria-describedby="cx-composer-hint"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onPaste={(e) => {
          if (!attachments) return;
          const pasted = [...e.clipboardData.files];
          if (!pasted.length) return;
          e.preventDefault();
          attachments.add(pasted);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (ready) onSubmit();
          }
        }}
      />
      <div className="cx-composer-bar">
        {attachments && (
          <>
            <button type="button" className="cx-icon-btn" aria-label={t.attach} title={t.attach} onClick={() => pickRef.current?.click()}>
              <Paperclip size={16} aria-hidden />
            </button>
            <input
              ref={pickRef}
              type="file"
              multiple
              hidden
              tabIndex={-1}
              onChange={(e) => {
                attachments.add([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
          </>
        )}
        <span id="cx-composer-hint" className="cx-hint">
          {uploading ? t.waitForUploads : messages.live.composerHint}
        </span>
        {speech.supported && (
          <button
            type="button"
            className={`cx-icon-btn ${speech.listening ? "is-on" : ""}`}
            aria-label={speech.listening ? messages.teach.micOn : messages.teach.micOff}
            aria-pressed={speech.listening}
            onClick={() => (speech.listening ? speech.stop() : speech.start())}
          >
            {speech.listening ? <MicOff size={16} aria-hidden /> : <Mic size={16} aria-hidden />}
          </button>
        )}
        <button type="submit" aria-label={uploading ? t.waitForUploads : messages.live.send} title={uploading ? t.waitForUploads : undefined} disabled={!ready} className={`cx-send ${ready ? "is-ready" : ""}`}>
          {uploading ? <LoaderCircle size={16} className="cx-spin" aria-hidden /> : <ArrowUp size={16} strokeWidth={2.4} aria-hidden />}
        </button>
      </div>
    </form>
  );
}

const WIDTH_KEY = "understudy.chatWidth";

function readWidth() {
  try {
    return parseStoredWidth(window.localStorage.getItem(WIDTH_KEY));
  } catch {
    return null;
  }
}

function saveWidth(width: number) {
  try {
    document.cookie = `${CHAT_WIDTH_COOKIE}=${width}; path=/; max-age=31536000; samesite=lax`;
  } catch {}
  try {
    window.localStorage.setItem(WIDTH_KEY, String(width));
  } catch {}
}

export function useChatWidth(initial?: number | null) {
  const [width, setWidth] = useState<number>(initial ?? CHAT_WIDTH.fallback);
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);
  const draggingRef = useRef(false);
  widthRef.current = width;

  useLayoutEffect(() => {
    const stored = initial ?? readWidth();
    if (stored) {
      const fitted = clampChatWidth(stored, window.innerWidth);
      if (fitted !== initial) setWidth(fitted);
      if (!initial) saveWidth(fitted);
    }
    const onResize = () => setWidth((w) => clampChatWidth(w, window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const commit = useCallback((next: number) => {
    const clamped = clampChatWidth(next, window.innerWidth);
    widthRef.current = clamped;
    setWidth(clamped);
    saveWidth(clamped);
  }, []);

  const handleProps = {
    role: "separator",
    tabIndex: 0,
    "aria-orientation": "vertical" as const,
    "aria-label": messages.live.resizeChat,
    "aria-valuemin": CHAT_WIDTH.min,
    "aria-valuemax": CHAT_WIDTH.max,
    "aria-valuenow": width,
    "data-dragging": dragging || undefined,
    onPointerDown(e: PointerEvent<HTMLDivElement>) {
      if (e.button !== 0) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      draggingRef.current = true;
      setDragging(true);
    },
    onPointerMove(e: PointerEvent<HTMLDivElement>) {
      if (!draggingRef.current) return;
      const left = e.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
      widthRef.current = clampChatWidth(e.clientX - left, window.innerWidth);
      setWidth(widthRef.current);
    },
    onPointerUp(e: PointerEvent<HTMLDivElement>) {
      if (!draggingRef.current) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      draggingRef.current = false;
      setDragging(false);
      saveWidth(widthRef.current);
    },
    onPointerCancel() {
      draggingRef.current = false;
      setDragging(false);
      saveWidth(widthRef.current);
    },
    onDoubleClick() {
      commit(CHAT_WIDTH.fallback);
    },
    onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
      const step = e.shiftKey ? CHAT_WIDTH.bigStep : CHAT_WIDTH.step;
      const moves: Record<string, number> = {
        ArrowLeft: widthRef.current - step,
        ArrowRight: widthRef.current + step,
        Home: CHAT_WIDTH.min,
        End: CHAT_WIDTH.max,
      };
      if (!(e.key in moves)) return;
      e.preventDefault();
      commit(moves[e.key]);
    },
  };

  return { width, dragging, handleProps };
}
