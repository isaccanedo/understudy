import type { AgentState } from "@understudy/protocol";

export const STATE_PILL: Record<AgentState, string> = {
  calm: "",
  working: "s",
  waiting_you: "c",
  stuck: "c",
  listening: "s",
  thinking: "s",
  done: "g",
};
