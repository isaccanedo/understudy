import { Check, CircleAlert, Ellipsis, GraduationCap, Loader2, PanelRightClose } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AgentState, FileEntry } from "@understudy/protocol";
import { AgentFigure } from "@/components/AgentFigure";
import { ComputerScreen } from "@/components/live/ComputerScreen";
import type { AgentLink, Frame } from "@/components/live/useAgentSocket";
import { cleanLook, type Look } from "@/lib/look";
import { currentLocale, messages } from "@/lib/messages";
import { STATE_PILL } from "@/lib/state-pill";
import { fileKind, latestDeliveries } from "@/lib/outputs";
import { openArtifact, useArtifactList } from "@/components/artifacts/ArtifactsPanel";
import { fileUrl } from "@/lib/uploader";
import { advancedTabs, type WorkspaceTab } from "@/lib/workspace-tabs";
import { TAB_ICONS } from "./AgentWorkspace";
import type { RunSummary } from "./TasksPanel";

const a = messages.agentPage;
const TasksIcon = TAB_ICONS.tasks;
const FilesIcon = TAB_ICONS.files;

function MoreActions({ tabs, onOpen }: { tabs: readonly WorkspaceTab[]; onOpen: (tab: WorkspaceTab) => void }) {
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

  return (
    <div ref={ref} className="ac-more">
      <button type="button" className="ac-action" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis size={16} aria-hidden />
        {messages.workspace.more}
      </button>
      {open && (
        <div role="menu" className="ws-menu ac-menu">
          {tabs.map((tab) => {
            const Icon = TAB_ICONS[tab];
            return (
              <button
                key={tab}
                type="button"
                role="menuitem"
                className="ws-menu-item"
                onClick={() => {
                  setOpen(false);
                  onOpen(tab);
                }}
              >
                <Icon size={16} strokeWidth={1.9} aria-hidden />
                <span className="ws-menu-name">{messages.workspace.tabs[tab]}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RunIcon({ run }: { run: RunSummary }) {
  if (run.waiting) return <CircleAlert size={12} aria-hidden />;
  if (run.status === "running") return <Loader2 size={12} className="cx-spin" aria-hidden />;
  if (run.status === "failed") return <CircleAlert size={12} aria-hidden />;
  return <Check size={12} aria-hidden />;
}

export function AgentCard({
  agent,
  link,
  state,
  owner,
  approvals,
  runs,
  files,
  subscribeFrames,
  onOpen,
  onCustomize,
  onHide,
}: {
  agent: { id: string; name: string; look: Look; role: string };
  link: Pick<AgentLink, "live">;
  state: AgentState;
  owner: boolean;
  approvals: number;
  runs: RunSummary[];
  files: FileEntry[] | null;
  subscribeFrames: (listener: (frame: Frame) => void) => () => void;
  onOpen: (view: WorkspaceTab) => void;
  onCustomize: (() => void) | null;
  onHide: () => void;
}) {
  const { live } = link;
  const status = live.online ? messages.states[state] : messages.live.offline;
  const note = live.online && live.note ? live.note : null;
  const recent = runs.slice(0, 3);
  const { items: artifacts } = useArtifactList(agent.id);
  const outputs = latestDeliveries(artifacts ?? [], files ?? []);
  const hasArtifacts = (artifacts?.length ?? 0) > 0;
  const when = (at: number) => new Date(at).toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "short" });
  const more = owner ? (["memory", "jobs", "logins", "settings", ...advancedTabs(true)] as WorkspaceTab[]) : [];
  const figure = <AgentFigure size={92} look={agent.look} state={state} count={approvals} />;

  return (
    <section className="ac" aria-label={a.cardLabel(agent.name)} style={{ "--agent": cleanLook(agent.look).color } as CSSProperties}>
      <button type="button" className="ac-hide" aria-label={a.hidePanel} title={a.hidePanel} onClick={onHide}>
        <PanelRightClose size={16} strokeWidth={1.9} aria-hidden />
      </button>
      <div className="ac-hero">
        {onCustomize ? (
          <button type="button" className="ac-figure" onClick={onCustomize} aria-label={a.customize(agent.name)} title={a.customize(agent.name)}>
            {figure}
          </button>
        ) : (
          <div className="ac-figure">{figure}</div>
        )}
        <h2 className="ac-name">{agent.name}</h2>
        {agent.role && <p className="ac-role">{agent.role}</p>}
        <span className={`ac-status ${live.online ? STATE_PILL[state] : ""}`}>
          <span className="ac-status-dot" aria-hidden />
          <span className="truncate">
            {status.charAt(0).toUpperCase() + status.slice(1)}
            {note ? ` · ${note}` : ""}
          </span>
        </span>
      </div>

      <div className="ac-actions">
        {owner && (
          <Link href={`/agents/${agent.id}/teach`} className="ac-action">
            <GraduationCap size={16} aria-hidden />
            {a.teach}
          </Link>
        )}
        <button type="button" className="ac-action" onClick={() => onOpen("tasks")}>
          <TasksIcon size={16} aria-hidden />
          {messages.workspace.tabs.tasks}
          {approvals > 0 && <span className="ws-count c">{approvals}</span>}
        </button>
        {owner && files && (
          <button type="button" className="ac-action" onClick={() => onOpen("files")}>
            <FilesIcon size={16} aria-hidden />
            {messages.workspace.tabs.files}
          </button>
        )}
        {more.length > 0 && files && <MoreActions tabs={more} onOpen={onOpen} />}
      </div>

      <div className="ac-section">
        <div className="ac-section-head">
          <h3>{a.computer}</h3>
          <span>{live.online ? a.live : messages.live.offline}</span>
        </div>
        <button type="button" className="ac-thumb" onClick={() => onOpen("computer")} aria-label={a.openComputer(agent.name)}>
          <ComputerScreen subscribeFrames={subscribeFrames} sendInput={() => {}} controlling={false} online={live.online} url={live.url} look={agent.look} compact />
          <span className={`ac-conn ${live.online ? "on" : ""}`}>
            <i aria-hidden />
            {live.online ? a.connected : messages.live.offline}
          </span>
          <span className="ac-open">{a.open}</span>
        </button>
      </div>

      <div className="ac-section">
        <div className="ac-section-head">
          <h3>{a.recentActivity}</h3>
          {runs.length > 0 && (
            <button type="button" onClick={() => onOpen("tasks")}>
              {a.seeAll}
            </button>
          )}
        </div>
        {recent.length === 0 ? (
          <p className="ac-empty">{a.noActivity(agent.name)}</p>
        ) : (
          <ul className="ac-list">
            {recent.map((run) => (
              <li key={run.id} className={`ac-run ${run.waiting ? "is-waiting" : run.status === "failed" ? "is-failed" : ""}`}>
                <span className="ac-run-icon">
                  <RunIcon run={run} />
                </span>
                <span className="ac-run-label">{run.label}</span>
                <time>{run.when}</time>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(files || hasArtifacts) && (
        <div className="ac-section">
          <div className="ac-section-head">
            <h3>{a.outputs}</h3>
            {hasArtifacts ? (
              <button type="button" onClick={() => onOpen("artifacts")}>
                {a.seeAll}
              </button>
            ) : (
              files &&
              files.length > 0 && (
                <button type="button" onClick={() => onOpen("files")}>
                  {a.allFiles}
                </button>
              )
            )}
          </div>
          {outputs.length === 0 ? (
            <p className="ac-empty">{a.noOutputs(agent.name)}</p>
          ) : (
            <ul className="ac-list">
              {outputs.map((item) => {
                if (item.kind === "artifact") {
                  const kind = fileKind(item.artifact.name);
                  return (
                    <li key={item.key}>
                      <button type="button" className="ac-out" onClick={() => openArtifact({ artifactId: item.artifact.id, version: null })} title={item.artifact.title}>
                        <span className={`ac-out-kind ${kind.tone}`} aria-hidden>
                          {kind.label}
                        </span>
                        <span className="min-w-0">
                          <span className="ac-out-name">{item.artifact.title}</span>
                          <span className="ac-out-when" suppressHydrationWarning>
                            {when(item.at)}
                            {item.artifact.latestVersion > 1 ? ` · v${item.artifact.latestVersion}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                }
                const kind = fileKind(item.file.path);
                const name = item.file.path.split("/").pop() ?? item.file.path;
                return (
                  <li key={item.key}>
                    <a className="ac-out" href={fileUrl(agent.id, `outbox/${item.file.path}`, { download: true })} download title={item.file.path}>
                      <span className={`ac-out-kind ${kind.tone}`} aria-hidden>
                        {kind.label}
                      </span>
                      <span className="min-w-0">
                        <span className="ac-out-name">{name}</span>
                        <span className="ac-out-when" suppressHydrationWarning>
                          {when(item.at)}
                        </span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
