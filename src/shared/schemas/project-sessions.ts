import { z } from "zod";
import type {
  WorkbenchProjectionBrowserTabConfig,
  WorkbenchProjectionCanvasStageTabConfig,
  WorkbenchProjectionPageStageTabConfig,
  ProjectSessionCreateInput,
  WorkbenchProjectionDbViewTabConfig,
  WorkbenchProjectionFilesTabConfig,
  WorkbenchProjectionTabConfig,
  WorkbenchProjectionTabConfigByKind,
  WorkbenchTabKind,
  WorkbenchProjectionTerminalTabConfig,
  ProjectSessionThreadLinkInput,
  ProjectSessionUpdateInput,
  ProjectSessionRenameInput,
  ProjectSessionPinnedInput,
  ProjectSessionPinnedOrderInput,
  ProjectSessionUnreadInput,
  ProjectSessionListOptions,
  ProjectSessionForkInput,
} from "../types";
import { WorkbenchViewSchema } from "./workbench";
import { WorkbenchReviewConfigSchema } from "./workbench-review";
import { WorkbenchImageEditorSurfaceConfigSchema } from "./workbench-image-editor";
import {
  CodexCollaborationModeKindSchema,
  CodexThreadActiveFlagSchema,
  CodexThreadStatusTypeSchema,
} from "./codex";

export const MAX_PROJECT_SESSION_TITLE_LENGTH = 2_000;

const titleSchema = z.string().trim().min(1).max(MAX_PROJECT_SESSION_TITLE_LENGTH);

export const WorkbenchProjectionDbViewTabConfigSchema = z.object({
  projectId: z.string().min(1),
  databaseViewId: z.string().min(1),
  view: WorkbenchViewSchema,
}).strict() satisfies z.ZodType<WorkbenchProjectionDbViewTabConfig>;

export const WorkbenchProjectionPageStageTabConfigSchema = z.object({
  projectId: z.string().min(1),
  pageId: z.string().min(1),
  titleSnapshot: z.string().optional(),
}).strict() satisfies z.ZodType<WorkbenchProjectionPageStageTabConfig>;

export const WorkbenchProjectionCanvasStageTabConfigSchema = z.object({
  projectId: z.string().min(1),
  canvasBlockId: z.string().min(1),
  titleSnapshot: z.string().optional(),
}).strict() satisfies z.ZodType<WorkbenchProjectionCanvasStageTabConfig>;

export const WorkbenchProjectionTerminalTabConfigSchema = z.object({
  terminalSessionId: z.string().min(1),
}).strict() satisfies z.ZodType<WorkbenchProjectionTerminalTabConfig>;

export const WorkbenchProjectionBrowserTabConfigSchema = z.object({
  projectId: z.string().min(1).nullable(),
  url: z.string().optional(),
  title: z.string().optional(),
  faviconUrl: z.string().optional(),
  deviceToolbarVisible: z.boolean().optional(),
}).strict() satisfies z.ZodType<WorkbenchProjectionBrowserTabConfig>;

export const WorkbenchProjectionReviewTabConfigSchema = WorkbenchReviewConfigSchema;

export const WorkbenchProjectionFilesTabConfigSchema = z.object({
  projectId: z.string().min(1).nullable(),
  hostId: z.literal("local").default("local"),
  workspaceRoot: z.preprocess(
    (value) => typeof value === "string" && value.trim().length === 0 ? null : value,
    z.string().trim().min(1).nullable(),
  ).default(null),
  cwd: z.preprocess(
    (value) => typeof value === "string" && value.trim().length === 0 ? null : value,
    z.string().trim().min(1).nullable(),
  ).default(null),
  path: z.string().trim().min(1).optional(),
}).strict() satisfies z.ZodType<WorkbenchProjectionFilesTabConfig>;

export function parseWorkbenchProjectionTabConfig<Kind extends WorkbenchTabKind>(
  kind: Kind,
  config: unknown,
): WorkbenchProjectionTabConfigByKind[Kind] {
  let parsed: WorkbenchProjectionTabConfig;
  if (kind === "db_view") parsed = WorkbenchProjectionDbViewTabConfigSchema.parse(config);
  else if (kind === "page_stage") parsed = WorkbenchProjectionPageStageTabConfigSchema.parse(config);
  else if (kind === "canvas_stage") {
    parsed = WorkbenchProjectionCanvasStageTabConfigSchema.parse(config);
  }
  else if (kind === "terminal") parsed = WorkbenchProjectionTerminalTabConfigSchema.parse(config);
  else if (kind === "browser") parsed = WorkbenchProjectionBrowserTabConfigSchema.parse(config);
  else if (kind === "review") parsed = WorkbenchProjectionReviewTabConfigSchema.parse(config);
  else if (kind === "files") parsed = WorkbenchProjectionFilesTabConfigSchema.parse(config);
  else if (kind === "image_editor") {
    parsed = WorkbenchImageEditorSurfaceConfigSchema.parse(config);
  }
  else {
    throw new Error(`Unknown project session tab kind: ${String(kind)}`);
  }
  return parsed as WorkbenchProjectionTabConfigByKind[Kind];
}

export const ProjectSessionCreateInputSchema = z.object({
  projectId: z.string().min(1).nullable(),
  noThreadFallbackTitle: titleSchema,
}) satisfies z.ZodType<ProjectSessionCreateInput>;

export const ProjectSessionListOptionsSchema = z.object({
  includeArchived: z.boolean().optional(),
}).optional() satisfies z.ZodType<ProjectSessionListOptions | undefined>;

export const ProjectSessionUpdateInputSchema = z.object({
  noThreadFallbackTitle: titleSchema.optional(),
}).strict() satisfies z.ZodType<ProjectSessionUpdateInput>;

export const ProjectSessionRenameInputSchema = z.object({
  title: z.string(),
}) satisfies z.ZodType<ProjectSessionRenameInput>;

export const ProjectSessionPinnedInputSchema = z.object({
  pinned: z.boolean(),
}) satisfies z.ZodType<ProjectSessionPinnedInput>;

export const ProjectSessionPinnedOrderInputSchema = z.object({
  orderedSessionIds: z.array(z.string()),
}) satisfies z.ZodType<ProjectSessionPinnedOrderInput>;

export const ProjectSessionUnreadInputSchema = z.object({
  unread: z.boolean(),
}) satisfies z.ZodType<ProjectSessionUnreadInput>;

export const ProjectSessionForkInputSchema = z.object({
  target: z.enum(["local", "newWorktree"]),
  localEnvironmentConfigPath: z.string().trim().min(1).nullable().optional(),
  turnId: z.string().trim().min(1).optional(),
  message: z.string().optional(),
  collaborationMode: CodexCollaborationModeKindSchema.optional(),
}) satisfies z.ZodType<ProjectSessionForkInput>;

export const ProjectSessionThreadLinkInputSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  threadId: z.string().min(1),
  forkedFromId: z.string().nullable().optional(),
  parentThreadId: z.string().nullable().optional(),
  threadSource: z.string().nullable().optional(),
  serviceName: z.string().nullable().optional(),
  agentNickname: z.string().nullable().optional(),
  agentRole: z.string().nullable().optional(),
  agentPath: z.string().nullable().optional(),
  threadName: z.string().nullable().optional(),
  threadPreview: z.string().optional(),
  modelProvider: z.string().optional(),
  executionProfile: z.object({
    providerId: z.string().trim().min(1).max(512),
    modelId: z.string().trim().min(1).max(512),
    harnessId: z.string().trim().min(1).max(512).nullable(),
    reasoningEffort: z.string().trim().min(1).max(64).nullable(),
    serviceTier: z.string().trim().min(1).max(64).nullable(),
  }).nullable().optional(),
  executionHostId: z.string().trim().min(1).max(512).optional(),
  runtimeWorkspaceRoots: z.array(z.string()).max(128).optional(),
  cwd: z.string().nullable().optional(),
  managedWorktreePath: z.string().nullable().optional(),
  projectlessOutputDirectory: z.string().nullable().optional(),
  projectlessWorkspaceBrowserRoot: z.string().nullable().optional(),
  statusType: CodexThreadStatusTypeSchema.optional(),
  statusActiveFlags: z.array(CodexThreadActiveFlagSchema).optional(),
  archived: z.boolean().optional(),
  createdAt: z.number().finite().optional(),
  updatedAt: z.number().finite().optional(),
  recencyAt: z.number().finite().optional(),
}) satisfies z.ZodType<ProjectSessionThreadLinkInput>;
