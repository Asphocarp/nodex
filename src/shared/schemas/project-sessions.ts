import { z } from "zod";
import type {
  ProjectSessionBrowserPlaceholderTabConfig,
  ProjectSessionCardStageTabConfig,
  ProjectSessionCreateInput,
  ProjectSessionDbViewTabConfig,
  ProjectSessionRightPaneLayout,
  ProjectSessionTabConfig,
  ProjectSessionTabCreateInput,
  ProjectSessionTabUpdateInput,
  ProjectSessionTerminalTabConfig,
  ProjectSessionThreadLinkInput,
  ProjectSessionUpdateInput,
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
  mode: z.enum(["project", "card"]),
  cardId: z.string().optional(),
}) satisfies z.ZodType<ProjectSessionTerminalTabConfig>;

export const ProjectSessionBrowserPlaceholderTabConfigSchema = z.object({
  url: z.string().optional(),
  title: z.string().optional(),
}) satisfies z.ZodType<ProjectSessionBrowserPlaceholderTabConfig>;

export function parseProjectSessionTabConfig(kind: string, config: unknown): ProjectSessionTabConfig {
  if (kind === "db_view") return ProjectSessionDbViewTabConfigSchema.parse(config);
  if (kind === "card_stage") return ProjectSessionCardStageTabConfigSchema.parse(config);
  if (kind === "terminal") return ProjectSessionTerminalTabConfigSchema.parse(config);
  if (kind === "browser_placeholder") return ProjectSessionBrowserPlaceholderTabConfigSchema.parse(config);
  throw new Error(`Unknown project session tab kind: ${kind}`);
}

const ProjectSessionSplitLeafSchema: z.ZodType<ProjectSessionRightPaneLayout["root"]> = z.lazy(() =>
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

export const ProjectSessionRightPaneLayoutSchema = z.object({
  version: z.literal(1),
  root: ProjectSessionSplitLeafSchema,
}) satisfies z.ZodType<ProjectSessionRightPaneLayout>;

export const ProjectSessionCreateInputSchema = z.object({
  projectId: z.string().min(1),
  title: titleSchema,
}) satisfies z.ZodType<ProjectSessionCreateInput>;

export const ProjectSessionUpdateInputSchema = z.object({
  title: titleSchema.optional(),
  leftPaneCollapsed: z.boolean().optional(),
  rightPaneCollapsed: z.boolean().optional(),
  rightPaneLayout: ProjectSessionRightPaneLayoutSchema.optional(),
}) satisfies z.ZodType<ProjectSessionUpdateInput>;

export const ProjectSessionTabKindSchema = z.enum([
  "db_view",
  "card_stage",
  "terminal",
  "browser_placeholder",
]);

export const ProjectSessionTabCreateInputSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
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
});

export function parseProjectSessionTabUpdateInput(kind: string, input: unknown): ProjectSessionTabUpdateInput {
  const parsed = ProjectSessionTabUpdateInputSchema.parse(input);
  if (parsed.config === undefined) return parsed as ProjectSessionTabUpdateInput;
  return {
    ...parsed,
    config: parseProjectSessionTabConfig(kind, parsed.config),
  };
}

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
