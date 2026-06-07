import { z } from "zod";
import type {
  WorkbenchLayoutDockSnapshot,
  WorkbenchLayoutFilesStageTab,
  WorkbenchLayoutSidebarSnapshot,
  WorkbenchLayoutSnapshot,
  WorkbenchLayoutTerminalStageTab,
  WorkbenchLayoutThreadsStageTab,
  WorkspaceBootstrap,
  WorkspaceCatalog,
  WorkspaceRecord,
} from "../workspace";
import {
  WorkbenchRecentCardSessionSchema,
  WorkbenchResumeCardStageStateSchema,
  WorkbenchStageIdSchema,
  WorkbenchStageNavDirectionSchema,
  WorkbenchViewSchema,
} from "./workbench";

const UnknownRecordSchema = z.record(z.string(), z.unknown());

const BooleanRecordSchema = UnknownRecordSchema.transform((value) =>
  Object.entries(value).reduce<Record<string, boolean>>((acc, [key, enabled]) => {
    if (typeof enabled === "boolean") acc[key] = enabled;
    return acc;
  }, {}),
);

const BooleanRecordByIdSchema = UnknownRecordSchema.transform((value) =>
  Object.entries(value).reduce<Record<string, Record<string, boolean>>>((acc, [key, record]) => {
    const parsed = BooleanRecordSchema.safeParse(record);
    if (parsed.success) acc[key] = parsed.data;
    return acc;
  }, {}),
);

const StringRecordSchema = UnknownRecordSchema.transform((value) =>
  Object.entries(value).reduce<Record<string, string>>((acc, [key, text]) => {
    if (typeof text === "string") acc[key] = text;
    return acc;
  }, {}),
);

const NumberRecordSchema = UnknownRecordSchema.transform((value) =>
  Object.entries(value).reduce<Record<string, number>>((acc, [key, number]) => {
    if (typeof number === "number" && Number.isFinite(number)) acc[key] = number;
    return acc;
  }, {}),
);

const ViewRecordSchema = UnknownRecordSchema.transform((value) =>
  Object.entries(value).reduce<Record<string, z.infer<typeof WorkbenchViewSchema>>>((acc, [key, view]) => {
    const parsed = WorkbenchViewSchema.safeParse(view);
    if (parsed.success) acc[key] = parsed.data;
    return acc;
  }, {}),
);

export const WorkbenchLayoutSidebarSnapshotSchema = z.object({
  collapsed: z.boolean().catch(false),
  width: z.number().finite().catch(280),
  topLevelSectionOrder: z.array(z.string()).catch([]),
  topLevelSections: UnknownRecordSchema.catch({}),
}) satisfies z.ZodType<WorkbenchLayoutSidebarSnapshot>;

export const WorkbenchLayoutDockSnapshotSchema = z.object({
  width: z.number().finite().catch(560),
  tree: z.unknown(),
}) satisfies z.ZodType<WorkbenchLayoutDockSnapshot>;

export const WorkbenchLayoutThreadsStageTabSchema = z.object({
  id: z.string(),
  title: z.string(),
  preview: z.string(),
}) satisfies z.ZodType<WorkbenchLayoutThreadsStageTab>;

export const WorkbenchLayoutTerminalStageTabSchema = z.object({
  id: z.string(),
  kind: z.enum(["project", "card"]),
  projectId: z.string(),
  title: z.string(),
  sessionId: z.string(),
  cardId: z.string().optional(),
  sessionRefId: z.string().optional(),
}) satisfies z.ZodType<WorkbenchLayoutTerminalStageTab>;

export const WorkbenchLayoutFilesStageTabSchema = z.object({
  id: z.literal("diff"),
  title: z.string(),
}) satisfies z.ZodType<WorkbenchLayoutFilesStageTab>;

export const WorkbenchLayoutSnapshotSchema = z.object({
  version: z.literal(1),
  dbProjectId: z.string(),
  threadsProjectId: z.string(),
  viewsByProject: ViewRecordSchema,
  searchByProject: StringRecordSchema.catch({}),
  dbViewPrefsByProject: UnknownRecordSchema.catch({}),
  spaceOrder: z.array(z.string()).catch([]),
  focusedStage: WorkbenchStageIdSchema,
  stageNavDirection: WorkbenchStageNavDirectionSchema,
  sidebar: WorkbenchLayoutSidebarSnapshotSchema,
  dock: WorkbenchLayoutDockSnapshotSchema,
  sidebarStageExpandedByProject: BooleanRecordByIdSchema.catch({}),
  sidebarSectionExpandedByProject: BooleanRecordByIdSchema.catch({}),
  sidebarSectionShowAllByProject: BooleanRecordByIdSchema.catch({}),
  activeCardsTabId: z.string(),
  activeRecentSessionId: z.string().nullable(),
  recentCardSessions: z.array(WorkbenchRecentCardSessionSchema).catch([]),
  cardStage: WorkbenchResumeCardStageStateSchema,
  threadsTabs: z.array(WorkbenchLayoutThreadsStageTabSchema).catch([]),
  activeThreadsTabId: z.string(),
  terminalTabs: z.array(WorkbenchLayoutTerminalStageTabSchema).catch([]),
  activeTerminalTabId: z.string(),
  filesTabs: z.array(WorkbenchLayoutFilesStageTabSchema).catch([]),
  activeFilesTabId: z.string(),
  stagePanelWidths: NumberRecordSchema.catch({}),
  slidingWindowPaneCount: z.number().finite().catch(2),
  terminalPanelOpen: z.boolean().catch(false),
  terminalPanelHeight: z.number().finite().catch(260),
}) satisfies z.ZodType<WorkbenchLayoutSnapshot>;

export const WorkspaceRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().optional().catch(undefined),
  createdAt: z.string(),
  updatedAt: z.string(),
  layout: WorkbenchLayoutSnapshotSchema,
}) satisfies z.ZodType<WorkspaceRecord>;

export const WorkspaceCatalogSchema = z.object({
  version: z.literal(1),
  lastActiveWorkspaceId: z.string().min(1),
  workspaces: z.array(WorkspaceRecordSchema).min(1),
}) satisfies z.ZodType<WorkspaceCatalog>;

export const WorkspaceBootstrapSchema = z.object({
  catalog: WorkspaceCatalogSchema,
  activeWorkspace: WorkspaceRecordSchema,
}) satisfies z.ZodType<WorkspaceBootstrap>;
