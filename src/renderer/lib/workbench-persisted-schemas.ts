import { z } from "zod";
import { createDefaultDockTree, type DockTreeNode } from "./dock-layout";
import type { CardStageState } from "./use-card-stage";
import type {
  FilesStageTab,
  RecentCardSession,
  SidebarGroupId,
  SidebarSectionState,
  StageId,
  StageNavDirection,
  StagePanelWidths,
  TerminalStageTab,
  ThreadsStageTab,
  WorkbenchView,
} from "./use-workbench-state";
import type {
  NavigationHistoryState,
  NavigationSnapshot,
} from "./workbench-navigation-history";
import {
  WorkbenchRecentCardSessionSchema,
  WorkbenchStageIdSchema,
  WorkbenchStageNavDirectionSchema,
  WorkbenchViewSchema,
} from "../../shared/schemas/workbench";
import { parseValueWithSchema } from "../../shared/schemas/storage";

const NavigationCardStageStateSchema = z.object({
  open: z.boolean(),
  projectId: z.string(),
  cardId: z.string().nullable(),
}) satisfies z.ZodType<CardStageState>;
const UnknownRecordSchema = z.record(z.string(), z.unknown());
const UnknownArraySchema = z.array(z.unknown());

export const NavigationSnapshotSchema = z.object({
  dbProjectId: z.string().min(1),
  activeView: WorkbenchViewSchema,
  focusedStage: WorkbenchStageIdSchema,
  stageNavDirection: WorkbenchStageNavDirectionSchema,
  cardStage: NavigationCardStageStateSchema,
  activeCardsTabId: z.string(),
  activeRecentSessionId: z.string().nullable(),
  threadsProjectId: z.string().min(1),
  activeThreadsTabId: z.string(),
  activeFilesTabId: z.string(),
}) satisfies z.ZodType<NavigationSnapshot>;

export const NavigationHistoryStateSchema = z.object({
  backStack: UnknownArraySchema.transform((items) =>
    items
      .map((item) => parseNavigationSnapshot(item))
      .filter((item): item is NavigationSnapshot => item !== null),
  ),
  forwardStack: UnknownArraySchema.transform((items) =>
    items
      .map((item) => parseNavigationSnapshot(item))
      .filter((item): item is NavigationSnapshot => item !== null),
  ),
}) satisfies z.ZodType<NavigationHistoryState>;

const SidebarGroupIdSchema = z.enum([
  "db",
  "recents",
  "cards",
  "threads",
  "files",
]) satisfies z.ZodType<SidebarGroupId>;
const WORKBENCH_STAGE_IDS = new Set<StageId>(["db", "cards", "threads", "files"]);

const ThreadsStageTabSchema = z.object({
  id: z.string(),
  title: z.string(),
  preview: z.string(),
}) satisfies z.ZodType<ThreadsStageTab>;

const TerminalStageTabSchema = z.object({
  id: z.string(),
  kind: z.enum(["project", "card"]),
  projectId: z.string().optional(),
  title: z.string(),
  sessionId: z.string(),
  cardId: z.string().optional(),
  sessionRefId: z.string().optional(),
});

const FilesStageTabSchema = z.object({
  id: z.literal("diff"),
  title: z.string(),
}) satisfies z.ZodType<FilesStageTab>;

const ViewMapSchema = UnknownRecordSchema.transform((value) =>
  Object.entries(value).reduce<Record<string, WorkbenchView>>((acc, [projectId, view]) => {
    const parsedView = WorkbenchViewSchema.safeParse(view);
    if (!parsedView.success) return acc;
    acc[projectId] = parsedView.data;
    return acc;
  }, {}),
);
const SearchMapSchema = UnknownRecordSchema.transform((value) =>
  Object.entries(value).reduce<Record<string, string>>((acc, [projectId, search]) => {
    if (typeof search !== "string") return acc;
    acc[projectId] = search;
    return acc;
  }, {}),
);
const SpaceOrderSchema = UnknownArraySchema.transform((value) =>
  value.filter((item): item is string => typeof item === "string" && item.length > 0),
);
const SidebarStageExpandedSchema = UnknownRecordSchema.transform((value) =>
  Object.entries(value).reduce<Record<string, Partial<Record<SidebarGroupId, boolean>>>>((acc, [projectId, stageMap]) => {
    const parsedStageMap = UnknownRecordSchema.safeParse(stageMap);
    if (!parsedStageMap.success) return acc;
    acc[projectId] = Object.entries(parsedStageMap.data).reduce<Partial<Record<SidebarGroupId, boolean>>>(
      (stageAcc, [stageId, expanded]) => {
        const parsedStageId = SidebarGroupIdSchema.safeParse(stageId);
        if (!parsedStageId.success || typeof expanded !== "boolean") return stageAcc;
        stageAcc[parsedStageId.data] = expanded;
        return stageAcc;
      },
      {},
    );
    return acc;
  }, {}),
);
const SidebarSectionStateByProjectSchema = UnknownRecordSchema.transform((value) =>
  Object.entries(value).reduce<Record<string, SidebarSectionState>>((acc, [projectId, sectionMap]) => {
    const parsedSectionMap = UnknownRecordSchema.safeParse(sectionMap);
    if (!parsedSectionMap.success) return acc;
    acc[projectId] = Object.entries(parsedSectionMap.data).reduce<SidebarSectionState>((sectionAcc, [sectionId, enabled]) => {
      if (typeof sectionId !== "string" || sectionId.length === 0 || typeof enabled !== "boolean") {
        return sectionAcc;
      }
      sectionAcc[sectionId] = enabled;
      return sectionAcc;
    }, {});
    return acc;
  }, {}),
);
const ThreadsStageTabsSchema = UnknownArraySchema.transform((items) =>
  items
    .map((item) => ThreadsStageTabSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result) => result.data),
);
const TerminalStageTabsSchema = UnknownArraySchema.transform((items) =>
  items
    .map((item) => TerminalStageTabSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result) => result.data),
);
const FilesStageTabsSchema = UnknownArraySchema.transform((items) =>
  items
    .map((item) => FilesStageTabSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result) => result.data),
);
const RecentCardSessionsSchema = UnknownArraySchema.transform((items) =>
  items
    .map((item) => WorkbenchRecentCardSessionSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result) => result.data),
);
const DockPrefsSchema = z.object({
  width: z.number().finite().optional(),
  tree: z.custom<DockTreeNode>((value) => typeof value === "object" && value !== null).optional(),
});

export function parseNavigationSnapshot(value: unknown): NavigationSnapshot | null {
  return parseValueWithSchema(value, NavigationSnapshotSchema.nullable(), null);
}

export function parseNavigationHistoryState(
  value: unknown,
  maxHistoryEntries: number,
): NavigationHistoryState {
  const parsed = parseValueWithSchema(value, NavigationHistoryStateSchema, {
    backStack: [],
    forwardStack: [],
  });

  return {
    backStack: parsed.backStack.slice(-maxHistoryEntries),
    forwardStack: parsed.forwardStack.slice(-maxHistoryEntries),
  };
}

export function parseWorkbenchViewMap(value: unknown): Record<string, WorkbenchView> {
  return parseValueWithSchema(value, ViewMapSchema, {});
}

export function parseWorkbenchSearchMap(value: unknown): Record<string, string> {
  return parseValueWithSchema(value, SearchMapSchema, {});
}

export function parseWorkbenchSpaceOrder(value: unknown): string[] {
  return parseValueWithSchema(value, SpaceOrderSchema, []);
}

export function parseWorkbenchRecentSessions(value: unknown, maxSessions: number): RecentCardSession[] {
  return parseValueWithSchema(value, RecentCardSessionsSchema, []).slice(0, maxSessions);
}

export function parseWorkbenchStageMap(value: unknown): Record<string, StageId> {
  const parsed = parseValueWithSchema(value, UnknownRecordSchema, {});
  return Object.entries(parsed).reduce<Record<string, StageId>>((acc, [projectId, stageId]) => {
    const parsedStageId = WorkbenchStageIdSchema.safeParse(stageId);
    if (!parsedStageId.success) return acc;
    acc[projectId] = parsedStageId.data;
    return acc;
  }, {});
}

export function parseSidebarStageExpanded(
  value: unknown,
): Record<string, Partial<Record<SidebarGroupId, boolean>>> {
  return parseValueWithSchema(value, SidebarStageExpandedSchema, {});
}

export function parseSidebarSectionStateByProject(
  value: unknown,
): Record<string, SidebarSectionState> {
  return parseValueWithSchema(value, SidebarSectionStateByProjectSchema, {});
}

export function parseThreadsStageTabs(value: unknown): ThreadsStageTab[] {
  return parseValueWithSchema(value, ThreadsStageTabsSchema, []);
}

export function parseTerminalStageTabs(
  value: unknown,
  defaultProjectId: string,
): TerminalStageTab[] {
  return parseValueWithSchema(value, TerminalStageTabsSchema, []).map((tab) => ({
    ...tab,
    projectId: tab.projectId ?? defaultProjectId,
  }));
}

export function parseFilesStageTabs(value: unknown): FilesStageTab[] {
  return parseValueWithSchema(value, FilesStageTabsSchema, []);
}

export function parseStagePanelWidths(value: unknown): StagePanelWidths {
  const parsed = parseValueWithSchema(value, UnknownRecordSchema, {});
  return Object.entries(parsed).reduce<StagePanelWidths>((acc, [stageId, width]) => {
    if (!WORKBENCH_STAGE_IDS.has(stageId as StageId) || typeof width !== "number" || !Number.isFinite(width)) {
      return acc;
    }
    acc[stageId as StageId] = width;
    return acc;
  }, {});
}

export function parseStageNavDirection(value: unknown): StageNavDirection | null {
  return parseValueWithSchema(value, WorkbenchStageNavDirectionSchema.nullable(), null);
}

export function parseDockPrefs(value: unknown): { width?: number; tree: DockTreeNode } {
  const parsed = parseValueWithSchema(value, DockPrefsSchema, {});
  return {
    width: parsed.width,
    tree: parsed.tree ?? createDefaultDockTree(),
  };
}
