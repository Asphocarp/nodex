import { z } from "zod";
import type {
  ProjectSessionBrowserPlaceholderTabConfig,
  ProjectSessionCardStageTabConfig,
  ProjectSessionCreateInput,
  ProjectSessionDbViewTabConfig,
  ProjectSessionProjectScopedTabConfig,
  ProjectSessionPanelLayout,
  ProjectSessionPanelState,
  ProjectSessionTabConfig,
  ProjectSessionTabCreateInput,
  ProjectSessionTabMoveInput,
  ProjectSessionTabReorderInput,
  ProjectSessionTabUpdateInput,
  ProjectSessionTerminalTabConfig,
  ProjectSessionThreadLinkInput,
  ProjectSessionUpdateInput,
  ProjectSessionPinnedInput,
  ProjectSessionPinnedOrderInput,
  ProjectSessionUnreadInput,
  ProjectSessionListOptions,
  ProjectSessionForkInput,
} from "../types";
import { WorkbenchViewSchema } from "./workbench";

const titleSchema = z.string().trim().min(1).max(160);

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

export const ProjectSessionBrowserPlaceholderTabConfigSchema = z.object({
  projectId: z.string().min(1).optional(),
  url: z.string().optional(),
  title: z.string().optional(),
}) satisfies z.ZodType<ProjectSessionBrowserPlaceholderTabConfig>;

export const ProjectSessionProjectScopedTabConfigSchema = z.object({
  projectId: z.string().min(1),
}) satisfies z.ZodType<ProjectSessionProjectScopedTabConfig>;

export function parseProjectSessionTabConfig(kind: string, config: unknown): ProjectSessionTabConfig {
  if (kind === "db_view") return ProjectSessionDbViewTabConfigSchema.parse(config);
  if (kind === "card_stage") return ProjectSessionCardStageTabConfigSchema.parse(config);
  if (kind === "terminal") return ProjectSessionTerminalTabConfigSchema.parse(config);
  if (kind === "browser_placeholder") return ProjectSessionBrowserPlaceholderTabConfigSchema.parse(config);
  if (kind === "review") return ProjectSessionProjectScopedTabConfigSchema.parse(config);
  if (kind === "files_placeholder") return ProjectSessionProjectScopedTabConfigSchema.parse(config);
  if (kind === "side_chat_placeholder") return ProjectSessionProjectScopedTabConfigSchema.parse(config);
  throw new Error(`Unknown project session tab kind: ${kind}`);
}

export const PanelIdSchema = z.enum(["right", "bottom"]);

const ProjectSessionSplitLeafSchema: z.ZodType<ProjectSessionPanelLayout["root"]> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("leaf"),
      id: z.string().min(1),
      tabIds: z.array(z.string()),
      activeTabId: z.string().nullable(),
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

export const ProjectSessionPanelLayoutSchema = z.object({
  version: z.literal(1),
  root: ProjectSessionSplitLeafSchema,
}) satisfies z.ZodType<ProjectSessionPanelLayout>;

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
  projectId: z.string().min(1),
  title: titleSchema,
}) satisfies z.ZodType<ProjectSessionCreateInput>;

export const ProjectSessionListOptionsSchema = z.object({
  includeArchived: z.boolean().optional(),
}).optional() satisfies z.ZodType<ProjectSessionListOptions | undefined>;

export const ProjectSessionUpdateInputSchema = z.object({
  title: titleSchema.optional(),
  leftPaneCollapsed: z.boolean().optional(),
  panels: z.object({
    right: ProjectSessionPanelStateUpdateSchema.optional(),
    bottom: ProjectSessionPanelStateUpdateSchema.optional(),
  }).optional(),
}) satisfies z.ZodType<ProjectSessionUpdateInput>;

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
}) satisfies z.ZodType<ProjectSessionForkInput>;

export const ProjectSessionTabKindSchema = z.enum([
  "db_view",
  "card_stage",
  "terminal",
  "browser_placeholder",
  "review",
  "files_placeholder",
  "side_chat_placeholder",
]);

export const ProjectSessionTabCreateInputSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  panelId: PanelIdSchema,
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

export const ProjectSessionTabReorderInputSchema = z.object({
  sessionId: z.string().min(1),
  panelId: PanelIdSchema,
  orderedTabIds: z.array(z.string()),
}) satisfies z.ZodType<ProjectSessionTabReorderInput>;

export const ProjectSessionTabMoveInputSchema = z.object({
  tabId: z.string().min(1),
  targetPanelId: PanelIdSchema,
  targetIndex: z.number().int().nonnegative().optional(),
}) satisfies z.ZodType<ProjectSessionTabMoveInput>;

export const ProjectSessionThreadLinkInputSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  threadId: z.string().min(1),
  parentThreadId: z.string().nullable().optional(),
  threadName: z.string().nullable().optional(),
  threadPreview: z.string().optional(),
  modelProvider: z.string().optional(),
  cwd: z.string().nullable().optional(),
  statusType: z.string().optional(),
  statusActiveFlags: z.array(z.string()).optional(),
  archived: z.boolean().optional(),
  createdAt: z.number().finite().optional(),
  updatedAt: z.number().finite().optional(),
}) satisfies z.ZodType<ProjectSessionThreadLinkInput>;
