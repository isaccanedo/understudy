import { ArrowRight, FileArchive, Folder, MoreVertical, Pin, Puzzle, RotateCw } from "lucide-react";
import { AgentFigure } from "@/components/AgentFigure";
import { messages } from "@/lib/messages";

const t = messages.extension;

function Window({ children, address }: { children: React.ReactNode; address?: string }) {
  return (
    <div className="rounded-[14px] overflow-hidden border border-line bg-[#1b1d24] shadow-[0_18px_40px_-24px_rgb(0_0_0/.8)] text-[11.5px] text-ash select-none" aria-hidden>
      <div className="flex items-center gap-2 px-3 py-2 bg-[#25272f] border-b border-line">
        <span className="flex gap-1.5">
          <i className="w-2.5 h-2.5 rounded-full bg-[#ff6363]/70" />
          <i className="w-2.5 h-2.5 rounded-full bg-[#f2b45a]/70" />
          <i className="w-2.5 h-2.5 rounded-full bg-[#59d499]/70" />
        </span>
        <RotateCw size={12} className="text-smoke" />
        <div className="flex-1 rounded-full bg-[#15161b] px-3 py-1 text-mist truncate">{address ?? "chrome://extensions"}</div>
        <Puzzle size={14} className="text-smoke" />
        <MoreVertical size={14} className="text-smoke" />
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Spot({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`rounded-[10px] ring-2 ring-sky ring-offset-2 ring-offset-[#1b1d24] ${className}`}>{children}</span>;
}

function Switch({ on }: { on: boolean }) {
  return (
    <span className={`relative inline-block w-[30px] h-[18px] rounded-full ${on ? "bg-sky" : "bg-iron"}`}>
      <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white ${on ? "left-[14px]" : "left-[2px]"}`} />
    </span>
  );
}

function ExtensionsHeader({ dev }: { dev: "spot" | "on" }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-mist font-semibold text-[13px]">{t.mockExtensions}</span>
      <span className="flex-1 rounded-full bg-[#15161b] px-3 py-1 text-smoke truncate">{t.mockSearch}</span>
      {dev === "spot" ? (
        <Spot className="inline-flex items-center gap-2 px-2 py-1">
          <span className="text-mist">{t.mockDevMode}</span>
          <Switch on />
        </Spot>
      ) : (
        <span className="inline-flex items-center gap-2 px-2 py-1">
          <span>{t.mockDevMode}</span>
          <Switch on />
        </span>
      )}
    </div>
  );
}

export function DownloadArt({ folder }: { folder: string }) {
  return (
    <div className="flex items-center justify-center gap-4 py-6 text-[12px] text-ash" aria-hidden>
      <div className="flex flex-col items-center gap-2">
        <div className="w-14 h-14 rounded-[14px] bg-graphite grid place-items-center">
          <FileArchive size={26} className="text-mist" />
        </div>
        <span>{folder}.zip</span>
      </div>
      <ArrowRight size={18} className="text-smoke" />
      <div className="flex flex-col items-center gap-2">
        <Spot className="w-14 h-14 bg-graphite grid place-items-center">
          <Folder size={26} className="text-sky" />
        </Spot>
        <span className="text-mist">{folder}</span>
      </div>
    </div>
  );
}

export function OpenArt() {
  return (
    <Window address="chrome://extensions">
      <div className="h-[54px] grid place-items-center text-smoke">
        <span className="inline-flex items-center gap-2">
          <ArrowRight size={14} /> Enter
        </span>
      </div>
    </Window>
  );
}

export function DevModeArt() {
  return (
    <Window>
      <ExtensionsHeader dev="spot" />
      <div className="mt-3 h-6 rounded-md bg-graphite" />
    </Window>
  );
}

export function LoadArt() {
  return (
    <Window>
      <ExtensionsHeader dev="on" />
      <div className="mt-3 flex gap-2 flex-wrap">
        <Spot className="px-3 py-1 bg-[#2b3550] text-mist font-medium">{t.mockLoadUnpacked}</Spot>
        <span className="px-3 py-1 rounded-[10px] bg-graphite">{t.mockPack}</span>
        <span className="px-3 py-1 rounded-[10px] bg-graphite">{t.mockUpdate}</span>
      </div>
    </Window>
  );
}

export function PinArt({ productName }: { productName: string }) {
  return (
    <div className="rounded-[14px] overflow-hidden border border-line bg-[#1b1d24] text-[11.5px] text-ash select-none" aria-hidden>
      <div className="flex items-center gap-2 px-3 py-2 bg-[#25272f] border-b border-line">
        <div className="flex-1 rounded-full bg-[#15161b] px-3 py-1 truncate">example.com</div>
        <Spot className="p-1 inline-grid place-items-center">
          <Puzzle size={14} className="text-mist" />
        </Spot>
        <MoreVertical size={14} className="text-smoke" />
      </div>
      <div className="flex justify-end p-3">
        <div className="w-[220px] rounded-[12px] bg-[#25272f] border border-line p-2 flex items-center gap-2">
          <AgentFigure size={22} live={false} />
          <span className="flex-1 text-mist truncate">{productName}</span>
          <Spot className="p-1 inline-grid place-items-center">
            <Pin size={13} className="text-sky" />
          </Spot>
        </div>
      </div>
    </div>
  );
}
