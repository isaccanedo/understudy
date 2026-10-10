import { ArrowLeft, Brain, CalendarClock, Ellipsis, FolderOpen, KeyRound, ListChecks, Monitor, PanelRightClose, PanelsTopLeft, Settings2, SquareTerminal, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { FileEntry, JobInfo, MemoryFile } from "@understudy/protocol";
import { ArtifactsPanel } from "@/components/artifacts/ArtifactsPanel";
import { FilesBrowser } from "@/components/files/FilesBrowser";
import { JobsList } from "@/components/jobs/JobsList";
import type { AgentLink } from "@/components/live/useAgentSocket";
import { MemoryBrowser } from "@/components/memory/MemoryBrowser";
import { TerminalPane } from "@/components/terminal/TerminalPane";
import { VaultManager } from "@/components/vault/VaultManager";
import type { CredentialInfo } from "@/lib/db/schema";
import type { Look } from "@/lib/look";
import { messages } from "@/lib/messages";
import { advancedTabs, barTabs, panelTabs, type WorkspaceTab } from "@/lib/workspace-tabs";
import { SettingsPanel, type SettingsData } from "./SettingsPanel";
import { TasksPanel, type RunSummary, type TaskSummary } from "./TasksPanel";

export type OwnerData = {
  files: FileEntry[];
  memory: MemoryFile[];
  credentials: CredentialInfo[];
  settings: SettingsData;
};

export const TAB_ICONS: Record<WorkspaceTab, LucideIcon> = {
  computer: Monitor,
  artifacts: PanelsTopLeft,
  files: FolderOpen,
  terminal: SquareTerminal,
  jobs: CalendarClock,
  memory: Brain,
  tasks: ListChecks,
  logins: KeyRound,
  settings: Settings2,
};

const FILL: ReadonlySet<WorkspaceTab> = new Set(["terminal", "artifacts"]);

const byPath = <T extends { path: string }>(items: T[]) => [...items].sort((a, b) => a.path.localeCompare(b.path));

export function useWorkspaceFeeds(listen: AgentLink["listen"], ownerData: OwnerData | null) {
  const [files, setFiles] = useState(() => byPath(ownerData?.files ?? []));
  const [memory, setMemory] = useState(() => byPath(ownerData?.memory ?? []));
  const [credentials, setCredentials] = useState(ownerData?.credentials ?? []);
  const [jobs, setJobs] = useState<JobInfo[] | null>(null);

  useEffect(
    () =>
      listen({
        onFiles: (next) => setFiles(byPath(next)),
        onMemory: (next) => setMemory(byPath(next)),
        onCredentials: setCredentials,
        onJobs: (next) => setJobs([...next].sort((a, b) => b.startedAt - a.startedAt)),
      }),
    [listen],
  );

  return { files, memory, credentials, jobs };
}

function useScrollEdges() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  }, []);
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);
  return { ref, edges, measure };
}

function MoreMenu({
  tabs,
  current,
  hrefFor,
  onSelect,
  agentName,
}: {
  tabs: readonly WorkspaceTab[];
  current: WorkspaceTab;
  hrefFor: (tab: WorkspaceTab) => string;
  onSelect: (tab: WorkspaceTab) => void;
  agentName: string;
}) {
  const t = messages.workspace;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (tabs.length === 0) return null;

  return (
    <div ref={ref} className="ws-more">
      <button
        type="button"
        className={`ws-more-btn ${tabs.includes(current) ? "is-on" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.more}
        title={t.more}
        onClick={() => setOpen((o) => !o)}
      >
        <Ellipsis size={16} aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label={t.more} className="ws-menu">
          <div className="ws-menu-head">{t.advanced}</div>
          {tabs.map((tab) => {
            const Icon = TAB_ICONS[tab];
            return (
              <a
                key={tab}
                role="menuitem"
                href={hrefFor(tab)}
                className="ws-menu-item"
                autoFocus
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  event.preventDefault();
                  setOpen(false);
                  onSelect(tab);
                }}
              >
                <Icon size={16} strokeWidth={1.9} aria-hidden />
                <span className="min-w-0">
                  <span className="ws-menu-name">{t.tabs[tab]}</span>
                  <span className="ws-menu-line">{t.advancedLines[tab]?.(agentName)}</span>
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WorkspaceTabs({
  tabs,
  current,
  hrefFor,
  onSelect,
  counts,
  more,
  backLabel,
  onBack,
  onHide,
}: {
  tabs: readonly WorkspaceTab[];
  current: WorkspaceTab;
  hrefFor: (tab: WorkspaceTab) => string;
  onSelect: (tab: WorkspaceTab) => void;
  counts: Partial<Record<WorkspaceTab, { value: number; tone: "s" | "c"; label: string }>>;
  more: ReactNode;
  backLabel: string;
  onBack: () => void;
  onHide: () => void;
}) {
  const t = messages.workspace;
  const { ref, edges, measure } = useScrollEdges();

  useEffect(() => {
    const bar = ref.current;
    const active = bar?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!bar || !active) return;
    const start = active.offsetLeft;
    const end = start + active.offsetWidth;
    if (start < bar.scrollLeft) bar.scrollLeft = start - 8;
    else if (end > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = end - bar.clientWidth + 8;
  }, [current, ref]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.indexOf(current);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const target = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : step ? tabs[(index + step + tabs.length) % tabs.length] : null;
    if (!target) return;
    event.preventDefault();
    onSelect(target);
    ref.current?.querySelector<HTMLElement>(`#ws-tab-${target}`)?.focus();
  }

  function onClick(event: MouseEvent<HTMLAnchorElement>, tab: WorkspaceTab) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onSelect(tab);
  }

  return (
    <div className="ws-bar">
      <button type="button" className="ws-back" aria-label={backLabel} title={backLabel} onClick={onBack}>
        <ArrowLeft size={17} aria-hidden />
      </button>
      <div
        ref={ref}
        role="tablist"
        aria-label={t.label}
        onKeyDown={onKeyDown}
        onScroll={measure}
        onWheel={(e) => {
          const el = e.currentTarget;
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY;
        }}
        className={`ws-tabs ${edges.start ? "" : "fade-start"} ${edges.end ? "" : "fade-end"}`}
      >
        {tabs.map((tab) => {
          const Icon = TAB_ICONS[tab];
          const count = counts[tab];
          const selected = tab === current;
          return (
            <a
              key={tab}
              id={`ws-tab-${tab}`}
              role="tab"
              href={hrefFor(tab)}
              aria-selected={selected}
              aria-controls={`ws-panel-${tab}`}
              tabIndex={selected ? 0 : -1}
              className="ws-tab"
              title={t.tabs[tab]}
              onClick={(e) => onClick(e, tab)}
            >
              <Icon size={15} strokeWidth={1.9} aria-hidden />
              <span className="ws-label">{t.tabs[tab]}</span>
              {count && count.value > 0 && (
                <>
                  <span className={`ws-count ${count.tone}`} aria-hidden>
                    {count.value}
                  </span>
                  <span className="sr-only">, {count.label}</span>
                </>
              )}
            </a>
          );
        })}
      </div>
      {more}
      <button type="button" className="ws-hide" aria-label={t.hide} title={t.hide} onClick={onHide}>
        <PanelRightClose size={16} strokeWidth={1.9} aria-hidden />
      </button>
    </div>
  );
}

export function AgentWorkspace({
  agent,
  link,
  owner,
  approvals,
  recipes,
  runs,
  ownerData,
  feeds,
  tab,
  hrefFor,
  onSelect,
  onBack,
  onHide,
}: {
  agent: { id: string; name: string; look: Look };
  link: AgentLink;
  owner: boolean;
  approvals: number;
  recipes: TaskSummary[];
  runs: RunSummary[];
  ownerData: OwnerData | null;
  feeds: ReturnType<typeof useWorkspaceFeeds>;
  tab: WorkspaceTab;
  hrefFor: (tab: WorkspaceTab) => string;
  onSelect: (tab: WorkspaceTab) => void;
  onBack: () => void;
  onHide: () => void;
}) {
  const t = messages.workspace;
  const full = owner && ownerData !== null;
  const tabs = panelTabs(full);
  const [visited, setVisited] = useState<ReadonlySet<WorkspaceTab>>(() => new Set([tab]));

  useEffect(() => {
    setVisited((current) => (current.has(tab) ? current : new Set(current).add(tab)));
  }, [tab]);

  const running = feeds.jobs?.filter((job) => job.status === "running").length ?? 0;
  const counts = {
    jobs: { value: running, tone: "s" as const, label: t.runningJobs(running) },
    tasks: { value: approvals, tone: "c" as const, label: t.waitingApprovals(approvals) },
  };

  function panel(name: WorkspaceTab) {
    if (name === "artifacts") return <ArtifactsPanel agentId={agent.id} agentName={agent.name} look={agent.look} owner={owner} send={owner ? link.send : undefined} />;
    if (name === "tasks") return <TasksPanel agentId={agent.id} owner={owner} recipes={recipes} runs={runs} look={agent.look} />;
    if (!ownerData) return null;
    if (name === "files") return <FilesBrowser agentId={agent.id} live={link.live} send={link.send} files={feeds.files} look={agent.look} />;
    if (name === "terminal") return <TerminalPane agentId={agent.id} agentName={agent.name} link={link} active={tab === "terminal"} />;
    if (name === "jobs") return <JobsList agentName={agent.name} link={link} jobs={feeds.jobs} look={agent.look} />;
    if (name === "memory") return <MemoryBrowser link={link} files={feeds.memory} look={agent.look} />;
    if (name === "logins") return <VaultManager link={link} credentials={feeds.credentials} look={agent.look} />;
    if (name === "settings") return <SettingsPanel link={link} data={ownerData.settings} />;
    return null;
  }

  return (
    <section id="agent-workspace" className="ws" aria-label={t.label}>
      <WorkspaceTabs
        tabs={barTabs(full, tab)}
        current={tab}
        hrefFor={hrefFor}
        onSelect={onSelect}
        counts={counts}
        more={<MoreMenu tabs={advancedTabs(full)} current={tab} hrefFor={hrefFor} onSelect={onSelect} agentName={agent.name} />}
        backLabel={t.backToCard(agent.name)}
        onBack={onBack}
        onHide={onHide}
      />
      {tabs.map((name) =>
        visited.has(name) || name === tab ? (
          <div
            key={name}
            id={`ws-panel-${name}`}
            role="tabpanel"
            aria-labelledby={`ws-tab-${name}`}
            hidden={name !== tab}
            className={`ws-body scroll-thin ${FILL.has(name) ? "is-fill" : ""}`}
          >
            {panel(name)}
          </div>
        ) : null,
      )}
    </section>
  );
}
