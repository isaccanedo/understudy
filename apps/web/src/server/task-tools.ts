import { z } from "zod";
import type { schema } from "@/lib/db";
import { env } from "@/lib/env";
import { agentTabPath } from "@/lib/workspace-tabs";
import type { Hub } from "./hub";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

type AgentRow = typeof schema.agents.$inferSelect;

export type TaskTool = {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (args: never) => Promise<ToolResult>;
};

const reply = (text: string, isError = false): ToolResult => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

export function tasksLink(agentId: string) {
  return `${env.publicUrl}${agentTabPath(agentId, "tasks")}`;
}

export function taskLink(agentId: string, recipeId: string) {
  return `${env.publicUrl}/agents/${agentId}/recipes/${recipeId}`;
}

export function taskTools(hub: Pick<Hub, "recordings">, agent: Pick<AgentRow, "id">): TaskTool[] {
  return [
    {
      name: "save_task",
      description:
        "Save a routine as one of your tasks, so it shows up in your owner's Tasks tab and can run again on a schedule or on demand. This is the only way to create a task: notes or files in ~/memory are not tasks. Use it when your owner asks you to save, remember or keep a routine as a task. description: the whole task in plain words, self-contained, because the task is written down later without this conversation: what it is for, the steps in order (sites, files, fields), the rules to follow, and when it should run. The task is created paused for your owner to review. Only say it is being saved if this tool accepted it, and never say it is already saved: the panel posts the link when it is ready, or the reason if it fails.",
      schema: z.object({ description: z.string().trim().min(10).max(20000) }),
      run: (async (args: { description: string }) => {
        const recordingId = await hub.recordings.startFromText(agent.id, args.description, "chat");
        if (!recordingId) return reply("not saved: your computer is not connected to the panel. Tell your owner the task was not saved.", true);
        return reply(
          `accepted: the task is being written down now and will appear paused in your owner's Tasks tab (${tasksLink(agent.id)}) for them to review and schedule. It is not saved yet; the panel will post the link to it when it is ready. Tell your owner exactly that, not that it is saved. [recordingId: ${recordingId}]`,
        );
      }) as TaskTool["run"],
    },
  ];
}
