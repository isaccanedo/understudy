import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { MemoryFile } from "@understudy/protocol";
import { ConfirmButton } from "@/components/ConfirmButton";
import type { AgentLink } from "@/components/live/useAgentSocket";
import { currentLocale, messages } from "@/lib/messages";
import { Textarea } from "@/components/ui/controls";
import type { Look } from "@/lib/look";
import { EmptyState } from "@/components/ui/EmptyState";

export function MemoryBrowser({ link, files, look }: { link: Pick<AgentLink, "live" | "send">; files: MemoryFile[]; look?: Look }) {
  const t = messages.memory;
  const { live, send } = link;
  const [selected, setSelected] = useState<string | null>(files[0]?.path ?? null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const current = useMemo(() => files.find((f) => f.path === selected) ?? null, [files, selected]);
  const isRecipe = Boolean(current?.path.startsWith("recipes/"));
  const readOnly = Boolean(current?.path.startsWith("journal/")) || isRecipe;

  useEffect(() => {
    if (!dirty) setDraft(current?.text ?? "");
  }, [current, dirty]);

  const groups = useMemo(() => {
    const map = new Map<string, MemoryFile[]>();
    for (const file of files) {
      const skill = file.path.match(/^skills\/([^/]+)\//);
      const folder = skill ? `skills/${skill[1]}` : file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
      map.set(folder, [...(map.get(folder) ?? []), file]);
    }
    const rank = (folder: string) => (folder === "" ? 0 : folder.startsWith("skills/") ? 2 : 1);
    return [...map.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  }, [files]);

  function save() {
    if (!selected) return;
    if (send({ type: "memory_write", path: selected, text: draft })) {
      setDirty(false);
      setNotice(t.saved);
      setTimeout(() => setNotice(null), 2000);
    }
  }

  return (
    <div className="ws-panel">
      <p className="ws-lead">{t.subtitle}</p>
      {files.length === 0 ? (
        <div className="card">
          {live.online ? (
            <EmptyState look={look} mood="calm" title={messages.empty.memoryTitle} body={messages.empty.memoryBody} />
          ) : (
            <EmptyState look={look} mood="sleepy" title={messages.empty.offlineTitle} body={t.offline} />
          )}
        </div>
      ) : (
      <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-4 @max-[700px]:grid-cols-1">
        <div className="card p-3 flex flex-col gap-1 self-start max-h-[70vh] overflow-y-auto scroll-thin @max-[700px]:max-h-[240px]">
          {groups.map(([folder, list], index) => (
            <div key={folder} className="flex flex-col gap-0.5">
              {folder.startsWith("skills/") && !groups[index - 1]?.[0].startsWith("skills/") && (
                <div className="flex items-center gap-1.5 text-mist text-[12px] font-semibold px-2 pt-3">
                  <Sparkles size={13} aria-hidden />
                  {t.skills}
                </div>
              )}
              {folder && (
                <div className={`text-smoke text-[11px] px-2 pt-2 ${folder.startsWith("skills/") ? "" : "uppercase tracking-wide"}`}>
                  {folder.startsWith("skills/") ? folder.slice("skills/".length) : folder}
                </div>
              )}
              {list.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => {
                    setSelected(file.path);
                    setDirty(false);
                  }}
                  className={`text-left rounded-lg px-2.5 py-1.5 text-[13px] cursor-pointer border-0 truncate ${selected === file.path ? "bg-graphite text-mist" : "bg-transparent text-ash hover:text-mist"}`}
                >
                  {file.path.startsWith("skills/") ? file.path.split("/").slice(2).join("/") : file.path.split("/").pop()}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="card p-4 flex flex-col gap-3 min-h-[50vh] min-w-0">
          {current ? (
            <>
              <div className="flex items-center gap-3 text-[12.5px] text-smoke flex-wrap">
                <span className="font-mono text-ash truncate">{current.path}</span>
                <span suppressHydrationWarning>{new Date(current.updatedAt).toLocaleString(currentLocale())}</span>
                {notice && <span className="text-green ml-auto">{notice}</span>}
              </div>
              <Textarea
                size="sm"
                className="flex-1 font-mono !leading-[1.55] resize-none !min-h-[40vh]"
                value={draft}
                readOnly={readOnly}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDirty(true);
                }}
                spellCheck={false}
              />
              <div className="flex gap-2 justify-end flex-wrap">
                {!live.online && <span className="text-smoke text-[12px] mr-auto self-center">{t.offline}</span>}
                {isRecipe && (
                  <Link href="/recipes" className="text-[12px] text-ash underline mr-auto self-center">
                    {t.recipeHint}
                  </Link>
                )}
                <ConfirmButton
                  className="btn sec"
                  label={t.remove}
                  question={t.confirmDelete(selected ?? "")}
                  disabled={!live.online || readOnly || !selected}
                  onConfirm={() => {
                    if (selected && send({ type: "memory_delete", path: selected })) {
                      setSelected(null);
                      setDirty(false);
                    }
                  }}
                />
                <button className="btn pri" disabled={!dirty || !live.online || readOnly} onClick={save}>
                  {t.save}
                </button>
              </div>
            </>
          ) : (
            <div className="m-auto text-smoke text-[13px]">{t.pick}</div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
