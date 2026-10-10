"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AgentFigure } from "@/components/AgentFigure";
import { Segmented } from "@/components/ui/Segmented";
import { accessoryColor, ACCESSORIES, BODIES, COLORS, EYES, randomLook, type Look } from "@/lib/look";
import { messages } from "@/lib/messages";

function Swatches({ label, options, value, onPick, size = 22 }: { label: string; options: string[]; value: string; onPick: (v: string) => void; size?: number }) {
  return (
    <div className={`flex flex-wrap justify-center ${size > 22 ? "gap-3 py-4" : "gap-1.5"}`} role="radiogroup" aria-label={label}>
      {options.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          onClick={() => onPick(color)}
          className="rounded-full cursor-pointer p-0"
          style={{ width: size, height: size, background: color, border: `2px solid ${value === color ? "var(--mist)" : "transparent"}` }}
        />
      ))}
    </div>
  );
}

function Tiles({ label, options, value, onPick, names, lookFor, hideLabel }: { label: string; options: string[]; value: string; onPick: (v: string) => void; names: Record<string, string>; lookFor: (option: string) => Look; hideLabel?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      {!hideLabel && <div className="text-[11.5px] text-smoke text-left">{label}</div>}
      <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            onClick={() => onPick(option)}
            className={`flex flex-col items-center gap-0.5 rounded-[10px] pt-1.5 pb-1 cursor-pointer border ${value === option ? "border-mist bg-obsidian" : "border-transparent hover:bg-obsidian"}`}
          >
            <AgentFigure size={38} look={lookFor(option)} live={false} />
            <span className={`text-[10.5px] ${value === option ? "text-mist" : "text-smoke"}`}>{names[option] ?? option}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const withAccessory = (look: Look, acc: string): Look => ({ ...look, acc, accColor: acc === look.acc ? look.accColor : accessoryColor(acc, look.color) });

export function LookPicker({ look, onChange }: { look: Look; onChange: (look: Look) => void }) {
  const l = messages.look;
  const set = (patch: Partial<Look>) => onChange({ ...look, ...patch });
  return (
    <div className="flex flex-col gap-3 w-full">
      <Swatches label={l.color} options={COLORS} value={look.color} onPick={(color) => set({ color })} />
      <Tiles label={l.body} options={BODIES} value={look.body} onPick={(body) => set({ body })} names={l.bodies} lookFor={(body) => ({ ...look, body })} />
      <Tiles label={l.eyes} options={EYES} value={look.eyes} onPick={(eyes) => set({ eyes })} names={l.eyeNames} lookFor={(eyes) => ({ ...look, eyes })} />
      <Tiles label={l.acc} options={ACCESSORIES} value={look.acc} onPick={(acc) => onChange(withAccessory(look, acc))} names={l.accNames} lookFor={(acc) => withAccessory(look, acc)} />
      {look.acc !== "none" && (
        <div className="flex flex-col gap-1.5 w-full">
          <div className="text-[11.5px] text-smoke text-left">{l.accColor}</div>
          <Swatches label={l.accColor} options={COLORS} value={look.accColor} onPick={(accColor) => set({ accColor })} />
        </div>
      )}
      <button type="button" className="btn sec sm self-center" onClick={() => onChange(randomLook())}>
        {l.shuffle}
      </button>
    </div>
  );
}

type Part = "color" | "body" | "eyes" | "acc";

export function LookSheet({ open, look, onChange, onClose }: { open: boolean; look: Look; onChange: (look: Look) => void; onClose: () => void }) {
  const l = messages.look;
  const ref = useRef<HTMLDialogElement | null>(null);
  const [part, setPart] = useState<Part>("color");
  const set = (patch: Partial<Look>) => onChange({ ...look, ...patch });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={l.sheetTitle}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet-body">
        <div className="flex items-center gap-3">
          <div className="figure-stage w-[76px] h-[76px] flex-none" style={{ "--tint": look.color } as CSSProperties}>
            <AgentFigure size={60} look={look} state="calm" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[15px] font-semibold">{l.sheetTitle}</h2>
            <p className="m-0 text-smoke text-[12.5px]">{l.sheetHint}</p>
          </div>
          <button type="button" className="cx-back" aria-label={messages.common.close} onClick={onClose}>
            <X size={17} aria-hidden />
          </button>
        </div>
        <Segmented
          label={l.sheetTitle}
          value={part}
          onChange={setPart}
          options={[
            { value: "color", label: l.color },
            { value: "body", label: l.body },
            { value: "eyes", label: l.eyes },
            { value: "acc", label: l.acc },
          ]}
        />
        <div className="sheet-part scroll-thin">
          {part === "color" && <Swatches size={36} label={l.color} options={COLORS} value={look.color} onPick={(color) => set({ color })} />}
          {part === "body" && <Tiles hideLabel label={l.body} options={BODIES} value={look.body} onPick={(body) => set({ body })} names={l.bodies} lookFor={(body) => ({ ...look, body })} />}
          {part === "eyes" && <Tiles hideLabel label={l.eyes} options={EYES} value={look.eyes} onPick={(eyes) => set({ eyes })} names={l.eyeNames} lookFor={(eyes) => ({ ...look, eyes })} />}
          {part === "acc" && (
            <div className="flex flex-col gap-3">
              <Tiles hideLabel label={l.acc} options={ACCESSORIES} value={look.acc} onPick={(acc) => onChange(withAccessory(look, acc))} names={l.accNames} lookFor={(acc) => withAccessory(look, acc)} />
              {look.acc !== "none" && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-[11.5px] text-smoke">{l.accColor}</div>
                  <Swatches label={l.accColor} options={COLORS} value={look.accColor} onPick={(accColor) => set({ accColor })} />
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-between gap-2">
          <button type="button" className="btn sec sm" onClick={() => onChange(randomLook())}>
            {l.shuffle}
          </button>
          <button type="button" className="btn pri sm" onClick={onClose}>
            {l.done}
          </button>
        </div>
      </div>
    </dialog>
  );
}
