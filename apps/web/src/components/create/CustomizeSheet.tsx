"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { AgentFigure } from "@/components/AgentFigure";
import { accessoryColor, ACCESSORIES, BODIES, COLORS, EYES, randomLook, type Look } from "@/lib/look";
import { messages } from "@/lib/messages";

function Carousel({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  function measure() {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  }

  useEffect(() => {
    const el = ref.current;
    const picked = el?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (el && picked) el.scrollLeft = picked.offsetLeft - (el.clientWidth - picked.offsetWidth) / 2;
    measure();
  }, []);

  const scroll = (direction: number) => ref.current?.scrollBy({ left: direction * ref.current.clientWidth * 0.8, behavior: "smooth" });

  return (
    <div className="cz-row">
      <div className="cz-row-head">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="cz-track-wrap">
        <div ref={ref} className="cz-track" role="radiogroup" aria-label={label} onScroll={measure}>
          {children}
        </div>
        {!edges.start && (
          <button type="button" className="cz-arrow is-start" aria-label={messages.agentPage.previous} onClick={() => scroll(-1)}>
            <ChevronLeft size={16} aria-hidden />
          </button>
        )}
        {!edges.end && (
          <button type="button" className="cz-arrow is-end" aria-label={messages.agentPage.next} onClick={() => scroll(1)}>
            <ChevronRight size={16} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

function Tile({ selected, label, look, onPick }: { selected: boolean; label: string; look: Look; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={label} title={label} className="cz-tile" onClick={onPick}>
      <AgentFigure size={52} look={look} live={false} />
    </button>
  );
}

const withAccessory = (look: Look, acc: string): Look => ({ ...look, acc, accColor: acc === look.acc ? look.accColor : accessoryColor(acc, look.color) });

export function CustomizeSheet({
  open,
  name,
  look,
  onSave,
  onClose,
}: {
  open: boolean;
  name: string;
  look: Look;
  onSave: (look: Look) => Promise<void>;
  onClose: () => void;
}) {
  const l = messages.look;
  const c = messages.agentPage;
  const ref = useRef<HTMLDialogElement | null>(null);
  const [draft, setDraft] = useState(look);
  const [saving, start] = useTransition();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setDraft(look);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, look]);

  const set = (patch: Partial<Look>) => setDraft((current) => ({ ...current, ...patch }));

  function save() {
    start(async () => {
      await onSave(draft);
      onClose();
    });
  }

  return (
    <dialog
      ref={ref}
      className="sheet cz"
      aria-label={c.customizeTitle(name)}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet-body" style={{ "--agent": draft.color } as CSSProperties}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[16px] font-semibold text-white">{c.customizeTitle(name)}</h2>
            <p className="m-0 text-smoke text-[12.5px]">{c.customizeHint(name)}</p>
          </div>
          <button type="button" className="cx-back" aria-label={messages.common.close} onClick={onClose}>
            <X size={17} aria-hidden />
          </button>
        </div>
        <div className="cz-preview">
          <AgentFigure size={112} look={draft} state="done" />
        </div>
        <div className="cz-rows scroll-thin">
          <Carousel label={l.color} hint={c.colorHint}>
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={draft.color === color}
                aria-label={color}
                className="cz-swatch"
                style={{ background: color }}
                onClick={() => setDraft((current) => ({ ...current, color, accColor: current.acc === "none" ? accessoryColor("none", color) : current.accColor }))}
              />
            ))}
          </Carousel>
          <Carousel label={c.character}>
            {BODIES.map((body) => (
              <Tile key={body} selected={draft.body === body} label={l.bodies[body] ?? body} look={{ ...draft, body }} onPick={() => set({ body })} />
            ))}
          </Carousel>
          <Carousel label={l.eyes}>
            {EYES.map((eyes) => (
              <Tile key={eyes} selected={draft.eyes === eyes} label={l.eyeNames[eyes] ?? eyes} look={{ ...draft, eyes }} onPick={() => set({ eyes })} />
            ))}
          </Carousel>
          <Carousel label={l.acc}>
            {ACCESSORIES.map((acc) => (
              <Tile key={acc} selected={draft.acc === acc} label={l.accNames[acc] ?? acc} look={withAccessory(draft, acc)} onPick={() => setDraft((current) => withAccessory(current, acc))} />
            ))}
          </Carousel>
          {draft.acc !== "none" && (
            <Carousel label={l.accColor}>
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={draft.accColor === color}
                  aria-label={color}
                  className="cz-swatch is-small"
                  style={{ background: color }}
                  onClick={() => set({ accColor: color })}
                />
              ))}
            </Carousel>
          )}
        </div>
        <div className="flex justify-between gap-2">
          <button type="button" className="btn sec sm" onClick={() => setDraft(randomLook())}>
            {l.shuffle}
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn sec sm" onClick={onClose}>
              {messages.common.cancel}
            </button>
            <button type="button" className="btn pri sm" disabled={saving} onClick={save}>
              {saving ? c.saving : c.save}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
