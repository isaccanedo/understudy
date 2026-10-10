import type { z } from "zod";
import type {
  AgentStateSchema,
  ApprovalRequestSchema,
  BrainSchema,
  BrainStatusSchema,
  ComputerSpecSchema,
  ComputerToServerSchema,
  CredentialInfoSchema,
  FileEntrySchema,
  JobInfoSchema,
  OwnerRuleSchema,
  HostToServerSchema,
  InputEventSchema,
  MemoryFileSchema,
  RecipeQuestionSchema,
  RecipeSchema,
  RecipeStepSchema,
  RecordedEventSchema,
  RunStepSchema,
  ServerToComputerSchema,
  ServerToHostSchema,
  StepModeSchema,
  UsageSchema,
} from "./schemas.ts";

export * from "./schemas.ts";
export * from "./patterns.ts";
export * from "./recipe.ts";
export * from "./rules.ts";
export * from "./capture.ts";
export * from "./files.ts";
export * from "./artifacts.ts";

export type AgentState = z.infer<typeof AgentStateSchema>;
export type Brain = z.infer<typeof BrainSchema>;
export type StepMode = z.infer<typeof StepModeSchema>;
export type RecordedEvent = z.infer<typeof RecordedEventSchema>;
export type RecipeStep = z.infer<typeof RecipeStepSchema>;
export type RecipeQuestion = z.infer<typeof RecipeQuestionSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type MemoryFile = z.infer<typeof MemoryFileSchema>;
export type RunStep = z.infer<typeof RunStepSchema>;
export type Usage = z.infer<typeof UsageSchema>;
export type FileEntry = z.infer<typeof FileEntrySchema>;
export type JobInfo = z.infer<typeof JobInfoSchema>;
export type OwnerRule = z.infer<typeof OwnerRuleSchema>;
export type BrainStatus = z.infer<typeof BrainStatusSchema>;
export type CredentialInfo = z.infer<typeof CredentialInfoSchema>;
export type ComputerToServer = z.infer<typeof ComputerToServerSchema>;
export type InputEvent = z.infer<typeof InputEventSchema>;
export type ServerToComputer = z.infer<typeof ServerToComputerSchema>;
export type ComputerSpec = z.infer<typeof ComputerSpecSchema>;
export type HostToServer = z.infer<typeof HostToServerSchema>;
export type ServerToHost = z.infer<typeof ServerToHostSchema>;

export const MEMORY_FILE_MAX_BYTES = 64 * 1024;

export const FILE_MAX_BYTES = 20 * 1024 * 1024;

export const RUN_RECORD_MAX_SCREENSHOTS = 20;

export const PROTOCOL_VERSION = "1";

export const PATHS = {
  computerSocket: "/api/ws/computer",
  hostSocket: "/api/ws/host",
  viewerSocket: "/api/ws/viewer",
  gatekeeperMcp: "/api/mcp",
} as const;
