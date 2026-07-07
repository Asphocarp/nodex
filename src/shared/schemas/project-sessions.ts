import { z } from "zod";
import type {
  ProjectSessionBrowserTabConfig,
  ProjectSessionCardStageTabConfig,
  ProjectSessionCreateInput,
  ProjectSessionDbViewTabConfig,
  ProjectSessionFilesTabConfig,
  ProjectSessionProjectScopedTabConfig,
  ProjectSessionPanelLayout,
  ProjectSessionPanelNode,
  ProjectSessionPanelState,
  ProjectSessionPanelActivateInput,
  ProjectSessionPanelEnsureRightLeafInput,
  ProjectSessionPanelMaximizeInput,
  ProjectSessionPanelMergeInput,
  ProjectSessionPanelResizeInput,
  ProjectSessionPanelSplitInput,
  ProjectSessionTabConfig,
  ProjectSessionTabCreateInput,
  ProjectSessionTabDeleteInput,
  ProjectSessionTabMoveInput,
  ProjectSessionTabReorderInput,
  ProjectSessionTabUpdateInput,
  ProjectSessionTerminalTabConfig,
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

export const MAX_PROJECT_SESSION_TITLE_LENGTH = 2_000;

const titleSchema = z.string().trim().min(1).max(MAX_PROJECT_SESSION_TITLE_LENGTH);

export const ProjectSessionDbViewTabConfigSchema = z.object({
  projectId: z.string().min(1),
  view: WorkbenchViewSchema,
}) satisfies z.ZodType<ProjectSessionDbViewTabConfig>;

export const ProjectSessionCardStageTabConfigSchema = z.object({
  projectId: z.string().min(1),
  cardId: z.string().min(1),
  titleSnapshot: z.string().optional(),
}) satisfies z.ZodType<ProjectSessionCardStageTabConfig>;

export const ProjectSessionTerminalTabConfigSchema = z.object({
  projectId: z.string().min(1),
  terminalSessionId: z.string().min(1),
}) satisfies z.ZodType<ProjectSessionTerminalTabConfig>;

export const ProjectSessionBrowserTabConfigSchema = z.object({
  projectId: z.string().min(1),
  url: z.string().optional(),
  title: z.string().optional(),
  faviconUrl: z.string().optional(),
  deviceToolbarVisible: z.boolean().optional(),
}) satisfies z.ZodType<ProjectSessionBrowserTabConfig>;

export const ProjectSessionProjectScopedTabConfigSchema = z.object({
  projectId: z.string().min(1),
}) satisfies z.ZodType<ProjectSessionProjectScopedTabConfig>;

export const ProjectSessionFilesTabConfigSchema = z.object({
  projectId: z.string().min(1),
  hostId: z.literal("local").default("local"),
  workspaceRoot: z.string().trim().default(""),
  path: z.string().trim().min(1).optional(),
}) satisfies z.ZodType<ProjectSessionFilesTabConfig>;

export function parseProjectSessionTabConfig(kind: string, config: unknown): ProjectSessionTabConfig {
  if (kind === "db_view") return ProjectSessionDbViewTabConfigSchema.parse(config);
  if (kind === "card_stage") return ProjectSessionCardStageTabConfigSchema.parse(config);
  if (kind === "terminal") return ProjectSessionTerminalTabConfigSchema.parse(config);
  if (kind === "browser") return ProjectSessionBrowserTabConfigSchema.parse(config);
  if (kind === "review") return ProjectSessionProjectScopedTabConfigSchema.parse(config);
  if (kind === "files") return ProjectSessionFilesTabConfigSchema.parse(config);
  if (kind === "files_placeholder") {
    const scopedConfig = ProjectSessionProjectScopedTabConfigSchema.parse(config);
    return {
      projectId: scopedConfig.projectId,
      hostId: "local",
      workspaceRoot: "",
    };
  }
  throw new Error(`Unknown project session tab kind: ${kind}`);
}

export const PanelIdSchema = z.enum(["right", "bottom"]);

const ProjectSessionSplitLeafSchema: z.ZodType<ProjectSessionPanelNode> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("leaf"),
      id: z.string().min(1),
      tabIds: z.array(z.string()),
      activeTabId: z.string().nullable(),
      mruTabIds: z.array(z.string()).default([]),
    }),
    z.object({
      type: z.literal("split"),
      id: z.string().min(1),
      direction: z.enum(["horizontal", "vertical"]),
      first: ProjectSessionSplitLeafSchema,
      second: ProjectSessionSplitLeafSchema,
      ratio: z.number().finite().min(0.1).max(0.9),
    }),
  ]),
);

const ProjectSessionPanelLayoutV2Schema = z.object({
  version: z.literal(2),
  root: ProjectSessionSplitLeafSchema,
  activeLeafId: z.string().min(1),
  mruLeafIds: z.array(z.string().min(1)),
  maximizedLeafId: z.string().min(1).nullable().optional(),
});

export const ProjectSessionPanelLayoutSchema = ProjectSessionPanelLayoutV2Schema satisfies z.ZodType<ProjectSessionPanelLayout>;

export const ProjectSessionPanelStateSchema = z.object({
  collapsed: z.boolean(),
  layout: ProjectSessionPanelLayoutSchema,
  size: z.object({
    widthPx: z.number().finite().positive().optional(),
    heightPx: z.number().finite().positive().optional(),
    fullWidth: z.boolean().optional(),
  }),
}) satisfies z.ZodType<ProjectSessionPanelState>;

export const ProjectSessionPanelsSchema = z.object({
  right: ProjectSessionPanelStateSchema,
  bottom: ProjectSessionPanelStateSchema,
});

const ProjectSessionPanelStateUpdateSchema = z.object({
  collapsed: z.boolean().optional(),
  layout: ProjectSessionPanelLayoutSchema.optional(),
  size: z.object({
    widthPx: z.number().finite().positive().optional(),
    heightPx: z.number().finite().positive().optional(),
    fullWidth: z.boolean().optional(),
  }).optional(),
});

export const ProjectSessionCreateInputSchema = z.object({
  projectId: z.string().min(1).nullable(),
  noThreadFallbackTitle: titleSchema,
}) satisfies z.ZodType<ProjectSessionCreateInput>;

export const ProjectSessionListOptionsSchema = z.object({
  includeArchived: z.boolean().optional(),
}).optional() satisfies z.ZodType<ProjectSessionListOptions | undefined>;

export const ProjectSessionUpdateInputSchema = z.object({
  noThreadFallbackTitle: titleSchema.optional(),
  leftPaneCollapsed: z.boolean().optional(),
  panels: z.object({
    right: ProjectSessionPanelStateUpdateSchema.optional(),
    bottom: ProjectSessionPanelStateUpdateSchema.optional(),
  }).optional(),
}) satisfies z.ZodType<ProjectSessionUpdateInput>;

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
  worktreeStartMode: z.enum(["autoBranch", "detachedHead"]).optional(),
  worktreeBranchPrefix: z.string().trim().min(1).max(48).optional(),
  turnId: z.string().trim().min(1).optional(),
  message: z.string().optional(),
  collaborationMode: z.enum(["default", "plan"]).optional(),
}) satisfies z.ZodType<ProjectSessionForkInput>;

export const ProjectSessionTabKindSchema = z.enum([
  "db_view",
  "card_stage",
  "terminal",
  "browser",
  "review",
  "files",
]);

export const ProjectSessionTabCreateInputSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  panelId: PanelIdSchema,
  targetLeafId: z.string().min(1).optional(),
  clientTabId: z.string().regex(/^[A-Za-z0-9:_-]{1,160}$/).optional(),
  kind: ProjectSessionTabKindSchema,
  title: titleSchema,
  config: z.unknown(),
}).transform((input) => ({
  ...input,
  config: parseProjectSessionTabConfig(input.kind, input.config),
})) satisfies z.ZodType<ProjectSessionTabCreateInput>;

export const ProjectSessionTabUpdateInputSchema = z.object({
  title: titleSchema.optional(),
  config: z.unknown().optional(),
  stateKey: z.number().int().nonnegative().optional(),
  state: z.unknown().optional(),
});

export function parseProjectSessionTabUpdateInput(kind: string, input: unknown): ProjectSessionTabUpdateInput {
  const parsed = ProjectSessionTabUpdateInputSchema.parse(input);
  if (parsed.config === undefined) return parsed as ProjectSessionTabUpdateInput;
  return {
    ...parsed,
    config: parseProjectSessionTabConfig(kind, parsed.config),
  };
}

export const ProjectSessionTabDeleteInputSchema = z.object({
  tabId: z.string().min(1),
  preserveEmptyLeafIds: z.array(z.string().min(1)).optional(),
  preferredActiveLeafId: z.string().min(1).nullable().optional(),
  preferredActiveTabId: z.string().min(1).nullable().optional(),
}) satisfies z.ZodType<ProjectSessionTabDeleteInput>;

export const ProjectSessionTabReorderInputSchema = z.object({
  sessionId: z.string().min(1),
  panelId: PanelIdSchema,
  leafId: z.string().min(1).optional(),
  orderedTabIds: z.array(z.string()),
}) satisfies z.ZodType<ProjectSessionTabReorderInput>;

const ProjectSessionPanelSplitSideSchema = z.enum(["left", "right", "up", "down"]);

export const ProjectSessionTabMoveInputSchema = z.object({
  tabId: z.string().min(1),
  targetPanelId: PanelIdSchema,
  targetLeafId: z.string().min(1).optional(),
  targetIndex: z.number().int().nonnegative().optional(),
  preserveEmptyLeafIds: z.array(z.string().min(1)).optional(),
  splitTarget: z.object({
    leafId: z.string().min(1),
    side: ProjectSessionPanelSplitSideSchema,
  }).optional(),
}) satisfies z.ZodType<ProjectSessionTabMoveInput>;

export const ProjectSessionPanelSplitInputSchema = z.object({
  sessionId: z.string().min(1),
  panelId: PanelIdSchema,
  leafId: z.string().min(1),
  side: ProjectSessionPanelSplitSideSchema,
  tabId: z.string().min(1).optional(),
  preserveEmptyLeafIds: z.array(z.string().min(1)).optional(),
}) satisfies z.ZodType<ProjectSessionPanelSplitInput>;

export const ProjectSessionPanelEnsureRightLeafInputSchema = z.object({
  sessionId: z.string().min(1),
  panelId: PanelIdSchema,
  sourceLeafId: z.string().min(1),
}) satisfies z.ZodType<ProjectSessionPanelEnsureRightLeafInput>;

export const ProjectSessionPanelMergeInputSchema = z.object({
  sessionId: z.string().min(1),
  panelId: PanelIdSchema,
  leafId: z.string().min(1),
}) satisfies z.ZodType<ProjectSessionPanelMergeInput>;

export const ProjectSessionPanelActivateInputSchema = z.object({
  sessionId: z.string().min(1),
  panelId: PanelIdSchema,
  leafId: z.string().min(1),
  tabId: z.string().min(1).nullable().optional(),
}) satisfies z.ZodType<ProjectSessionPanelActivateInput>;

export const ProjectSessionPanelResizeInputSchema = z.object({
  sessionId: z.string().min(1),
  panelId: PanelIdSchema,
  branchId: z.string().min(1),
  ratio: z.number().finite(),
}) satisfies z.ZodType<ProjectSessionPanelResizeInput>;

export const ProjectSessionPanelMaximizeInputSchema = z.object({
  sessionId: z.string().min(1),
  panelId: PanelIdSchema,
  leafId: z.string().min(1).nullable(),
}) satisfies z.ZodType<ProjectSessionPanelMaximizeInput>;

export const ProjectSessionThreadLinkInputSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  threadId: z.string().min(1),
  parentThreadId: z.string().nullable().optional(),
  threadName: z.string().nullable().optional(),
  threadPreview: z.string().optional(),
  modelProvider: z.string().optional(),
  cwd: z.string().nullable().optional(),
  managedWorktreePath: z.string().nullable().optional(),
  projectlessOutputDirectory: z.string().nullable().optional(),
  statusType: z.string().optional(),
  statusActiveFlags: z.array(z.string()).optional(),
  archived: z.boolean().optional(),
  createdAt: z.number().finite().optional(),
  updatedAt: z.number().finite().optional(),
}) satisfies z.ZodType<ProjectSessionThreadLinkInput>;
