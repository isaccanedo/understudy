export const WORKSPACE_TABS = ["computer", "artifacts", "files", "terminal", "jobs", "memory", "tasks", "logins", "settings"] as const;

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

export type AgentView = "card" | WorkspaceTab;

const SHARED_TABS: readonly WorkspaceTab[] = ["computer", "artifacts", "tasks"];

export const DEFAULT_VIEW: AgentView = "card";

export function tabsFor(owner: boolean): readonly WorkspaceTab[] {
  return owner ? WORKSPACE_TABS : SHARED_TABS;
}

export const ADVANCED_TABS: readonly WorkspaceTab[] = ["terminal"];

export function panelTabs(owner: boolean): readonly WorkspaceTab[] {
  return tabsFor(owner).filter((tab) => tab !== "computer");
}

export function barTabs(owner: boolean, current: AgentView): readonly WorkspaceTab[] {
  return panelTabs(owner).filter((tab) => tab === current || !ADVANCED_TABS.includes(tab));
}

export function advancedTabs(owner: boolean): readonly WorkspaceTab[] {
  return tabsFor(owner).filter((tab) => ADVANCED_TABS.includes(tab));
}

export function parseView(value: string | null | undefined, owner: boolean): AgentView {
  return tabsFor(owner).find((tab) => tab === value) ?? DEFAULT_VIEW;
}

export function tabSearch(current: string, view: AgentView) {
  const params = new URLSearchParams(current);
  if (view === DEFAULT_VIEW) params.delete("tab");
  else params.set("tab", view);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function agentTabPath(agentId: string, view: AgentView) {
  return `/agents/${agentId}${tabSearch("", view)}`;
}
