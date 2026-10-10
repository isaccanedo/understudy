"use client";

import { useEffect, useRef, useState } from "react";
import type { InputEvent } from "@understudy/protocol";
import { AgentFigure } from "@/components/AgentFigure";
import type { Look } from "@/lib/look";
import { messages } from "@/lib/messages";
import type { Frame } from "./useAgentSocket";

const t = messages.live;

const MOVE_INTERVAL_MS = 16;

export function ComputerScreen({
  subscribeFrames,
  sendInput,
  controlling,
  online,
  url,
  label,
  look,
  compact = false,
}: {
  subscribeFrames: (listener: (frame: Frame) => void) => () => void;
  sendInput: (event: InputEvent) => void;
  controlling: boolean;
  online: boolean;
  url: string;
  label?: string;
  look?: Look;
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const lastMove = useRef(0);
  const [hasFrame, setHasFrame] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [draftUrl, setDraftUrl] = useState(url);
  const [editingUrl, setEditingUrl] = useState(false);

  useEffect(() => {
    if (!editingUrl) setDraftUrl(url);
  }, [url, editingUrl]);

  useEffect(() => {
    let pending: Frame | null = null;
    let drawing = false;
    const draw = async () => {
      const canvas = canvasRef.current;
      if (!canvas || !pending) {
        drawing = false;
        return;
      }
      const frame = pending;
      pending = null;
      try {
        const blob = await fetch(`data:image/jpeg;base64,${frame.jpegBase64}`).then((r) => r.blob());
        const bitmap = await createImageBitmap(blob);
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        sizeRef.current = { width: frame.width || bitmap.width, height: frame.height || bitmap.height };
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
        bitmap.close();
        setHasFrame(true);
        setDesktop(Boolean(frame.desktop));
      } catch {}
      if (pending) draw();
      else drawing = false;
    };
    return subscribeFrames((frame) => {
      pending = frame;
      if (!drawing) {
        drawing = true;
        draw();
      }
    });
  }, [subscribeFrames]);

  useEffect(() => {
    if (controlling) canvasRef.current?.focus();
  }, [controlling]);

  function point(e: { clientX: number; clientY: number }) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { width, height } = sizeRef.current;
    const scaleX = (width || canvas.width) / rect.width;
    const scaleY = (height || canvas.height) / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }

  const handlers = controlling
    ? {
        onMouseMove: (e: React.MouseEvent) => {
          const now = performance.now();
          if (now - lastMove.current < MOVE_INTERVAL_MS) return;
          lastMove.current = now;
          sendInput({ kind: "mouse", action: "move", ...point(e) });
        },
        onMouseDown: (e: React.MouseEvent) => {
          e.preventDefault();
          canvasRef.current?.focus();
          sendInput({ kind: "mouse", action: "down", button: e.button === 2 ? "right" : "left", ...point(e) });
        },
        onMouseUp: (e: React.MouseEvent) => {
          sendInput({ kind: "mouse", action: "up", button: e.button === 2 ? "right" : "left", ...point(e) });
        },
        onWheel: (e: React.WheelEvent) => {
          sendInput({ kind: "mouse", action: "wheel", deltaY: Math.round(e.deltaY), ...point(e) });
        },
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        onKeyDown: (e: React.KeyboardEvent) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") return;
          e.preventDefault();
          sendInput({
            kind: "key",
            action: "down",
            key: e.key,
            code: e.code,
            text: e.key.length === 1 && !e.metaKey && !e.ctrlKey ? e.key : undefined,
          });
        },
        onKeyUp: (e: React.KeyboardEvent) => {
          e.preventDefault();
          sendInput({ kind: "key", action: "up", key: e.key, code: e.code });
        },
        onPaste: (e: React.ClipboardEvent) => {
          const text = e.clipboardData.getData("text");
          if (text) sendInput({ kind: "key", action: "char", key: text, text });
        },
      }
    : {};

  return (
    <div className={`screen ${desktop ? "is-desktop" : ""} ${controlling ? "controlling" : ""} ${compact ? "is-compact" : ""}`}>
      {desktop && label && <span className="screen-tag">{label}</span>}
      {!desktop && !compact && (
      <div className="chrome">
        <div className="dots">
          <i />
          <i />
          <i />
        </div>
        <form
          className="flex-1 min-w-0 flex"
          onSubmit={(e) => {
            e.preventDefault();
            const value = draftUrl.trim();
            if (!value) return;
            const target = /^https?:\/\//i.test(value) ? value : `https://${value}`;
            sendInput({ kind: "navigate", url: target });
            setEditingUrl(false);
            canvasRef.current?.focus();
          }}
        >
          <input
            className="url"
            value={draftUrl}
            readOnly={!controlling}
            onFocus={() => setEditingUrl(true)}
            onBlur={() => setEditingUrl(false)}
            onChange={(e) => setDraftUrl(e.target.value)}
            aria-label="URL"
            spellCheck={false}
          />
        </form>
        {label && <span className="who">{label}</span>}
      </div>
      )}
      <div className="stage">
        <canvas
          ref={canvasRef}
          tabIndex={controlling ? 0 : -1}
          className={hasFrame ? "" : "hidden"}
          style={{ cursor: controlling ? "default" : "auto" }}
          {...handlers}
        />
        {!hasFrame && (
          <div className="placeholder">
            <AgentFigure state={online ? "thinking" : "calm"} size={compact ? 36 : 56} look={look} />
            {online ? t.waitingFrame : t.offline}
          </div>
        )}
      </div>
    </div>
  );
}
