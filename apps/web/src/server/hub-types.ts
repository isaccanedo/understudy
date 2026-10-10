import type {
  ApprovalRequest,
  ArtifactEdit,
  Attachment,
  MemoryFile,
  FileEntry,
  JobInfo,
  Brain,
  AgentState,
  InputEvent,
  Recipe,
  RecordedEvent,
} from "@understudy/protocol";
import type { BrainStatus, MessageArtifact } from "@/lib/db/schema";

export type ChatEntry = {
  id: string;
  role: "agent" | "user" | "activity" | "system";
  text: string;
  runId?: string | null;
  via?: string | null;
  streamId?: string | null;
  attachments?: Attachment[];
  artifact?: MessageArtifact;
  at: string;
};

export type ApprovalView = {
  id: string;
  agentId: string;
  runId: string | null;
  stepId: string | null;
  summary: string;
  fields: ApprovalRequest["fields"];
  status: string;
  createdAt: string;
};

export type ServerToViewer =
  | {
      type: "snapshot";
      online: boolean;
      state: AgentState;
      note?: string | null;
      computerStatus: string;
      brains: BrainStatus[];
      recordingId?: string | null;
      frame?: { jpegBase64: string; width: number; height: number; url: string } | null;
    }
  | { type: "presence"; online: boolean; computerStatus: string; message?: string | null }
  | { type: "frame"; jpegBase64: string; width: number; height: number; url: string; desktop?: boolean }
  | { type: "state"; state: AgentState; note?: string | null }
  | { type: "chat"; entry: ChatEntry }
  | { type: "chat_delta"; streamId: string; text: string }
  | { type: "recorded"; recordingId: string; seq: number; event: RecordedEvent }
  | { type: "recording"; recordingId: string; status: "recording" | "processing" | "done" | "failed" }
  | { type: "recipe"; recordingId: string; recipeId: string; recipe: Recipe }
  | { type: "approval"; approval: ApprovalView }
  | { type: "approval_closed"; id: string; status: string }
  | { type: "run_finished"; runId: string; ok: boolean; summary: string }
  | { type: "login_prompt"; brain: Brain; url?: string; code?: string; message: string }
  | { type: "login_done"; brain: Brain; ok: boolean; account?: string; message?: string }
  | { type: "brains"; brains: BrainStatus[] }
  | { type: "memory"; files: MemoryFile[] }
  | { type: "files"; files: FileEntry[] }
  | { type: "terminal_output"; terminalId: string; data: string }
  | { type: "jobs"; jobs: JobInfo[] }
  | { type: "terminal_exit"; terminalId: string; reason?: string }
  | { type: "credentials"; credentials: { name: string; username: string; site?: string }[] }
  | { type: "run_record"; runId: string }
  | { type: "recipe_failed"; recordingId: string; error: string }
  | { type: "error"; message: string };

export type ViewerToServer =
  | { type: "input"; event: InputEvent }
  | { type: "terminal_open"; terminalId: string; cols: number; rows: number }
  | { type: "terminal_input"; terminalId: string; data: string }
  | { type: "terminal_resize"; terminalId: string; cols: number; rows: number }
  | { type: "terminal_close"; terminalId: string }
  | { type: "job_stop"; jobId: string }
  | { type: "chat"; text: string; attachments?: string[]; artifactEdit?: ArtifactEdit }
  | { type: "record_start" }
  | { type: "record_narration"; text: string }
  | { type: "record_stop" }
  | { type: "login_start"; brain: Brain }
  | { type: "login_code"; brain: Brain; code: string }
  | { type: "set_brain"; brain: Brain }
  | { type: "memory_write"; path: string; text: string }
  | { type: "memory_delete"; path: string }
  | { type: "teach_text"; text: string }
  | { type: "credential_set"; name: string; username: string; secret: string; site?: string }
  | { type: "credential_delete"; name: string }
  | { type: "stop" };

export type RoomEntry = {
  id: string;
  author: "owner" | "agent" | "system";
  agentId: string | null;
  text: string;
  at: string;
};

export type RoomPresence = { agentId: string; working: boolean; note: string | null; online: boolean };

export type ServerToRoom =
  | { type: "snapshot"; participants: RoomPresence[]; recent: RoomEntry[] }
  | { type: "message"; entry: RoomEntry }
  | { type: "delta"; agentId: string; streamId: string; text: string }
  | { type: "presence"; participant: RoomPresence }
  | { type: "error"; message: string };

export type RoomToServer = { type: "chat"; text: string } | { type: "stop" };
