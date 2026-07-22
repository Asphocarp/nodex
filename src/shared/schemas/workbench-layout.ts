import { z } from "zod";
import type {
  WorkbenchLayoutDockSnapshot,
  WorkbenchLayoutFilesStageTab,
  WorkbenchLayoutSidebarSnapshot,
  WorkbenchLayoutSnapshot,
  WorkbenchLayoutThreadsStageTab,
} from "../workbench-layout";
import {
  WorkbenchLayoutPageStageStateSchema,
  WorkbenchRecentPageSessionSchema,
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
  collapsibleSections: UnknownRecordSchema.catch({}),
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

export const WorkbenchLayoutFilesStageTabSchema = z.object({
  id: z.literal("diff"),
  title: z.string(),
}) satisfies z.ZodType<WorkbenchLayoutFilesStageTab>;

const migratePageStageDockIdentity = (value: unknown): unknown => {
  if (value === "cardstage") return "pagestage";
  if (Array.isArray(value)) return value.map(migratePageStageDockIdentity);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      migratePageStageDockIdentity(entry),
    ]),
  );
};

const migrateWorkbenchLayoutSnapshot = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  if (record.version === 2) {
    return {
      ...record,
      projectOrder: record.projectOrder ?? record.spaceOrder ?? [],
    };
  }
  if (record.version !== 1) return value;
  const legacyPageStage = record.pageStage ?? record.cardStage;
  const pageStage =
    typeof legacyPageStage === "object"
      && legacyPageStage !== null
      && !Array.isArray(legacyPageStage)
      ? {
          ...legacyPageStage,
          pageId:
            (legacyPageStage as Record<string, unknown>).pageId
            ?? (legacyPageStage as Record<string, unknown>).cardId
            ?? null,
        }
      : legacyPageStage;
  const legacySessions = Array.isArray(record.recentPageSessions)
    ? record.recentPageSessions
    : Array.isArray(record.recentCardSessions)
      ? record.recentCardSessions
      : [];
  const recentPageSessions = legacySessions.map((session) => {
    if (typeof session !== "object" || session === null || Array.isArray(session)) {
      return session;
    }
    const sessionRecord = session as Record<string, unknown>;
    return {
      ...sessionRecord,
      pageId: sessionRecord.pageId ?? sessionRecord.cardId,
    };
  });

  return {
    ...record,
    version: 2,
    projectOrder: record.projectOrder ?? record.spaceOrder ?? [],
    focusedStage: record.focusedStage === "cards" ? "pages" : record.focusedStage,
    activePagesTabId: record.activePagesTabId ?? record.activeCardsTabId ?? "",
    recentPageSessions,
    pageStage,
    dock: migratePageStageDockIdentity(record.dock),
  };
};

export const WorkbenchLayoutSnapshotSchema = z.preprocess(
  migrateWorkbenchLayoutSnapshot,
  z.object({
    version: z.literal(2),
    dbProjectId: z.string().nullable(),
    activeProjectSessionId: z.string().nullable().catch(null),
    threadsProjectId: z.string().nullable(),
    viewsByProject: ViewRecordSchema,
    searchByProject: StringRecordSchema.catch({}),
    dbViewPrefsByProject: UnknownRecordSchema.catch({}),
    projectOrder: z.array(z.string()).catch([]),
    focusedStage: WorkbenchStageIdSchema,
    stageNavDirection: WorkbenchStageNavDirectionSchema,
    sidebar: WorkbenchLayoutSidebarSnapshotSchema,
    dock: WorkbenchLayoutDockSnapshotSchema,
    sidebarStageExpandedByProject: BooleanRecordByIdSchema.catch({}),
    sidebarSectionExpandedByProject: BooleanRecordByIdSchema.catch({}),
    sidebarSectionShowAllByProject: BooleanRecordByIdSchema.catch({}),
    activePagesTabId: z.string(),
    activeRecentSessionId: z.string().nullable(),
    recentPageSessions: z.array(WorkbenchRecentPageSessionSchema).catch([]),
    pageStage: WorkbenchLayoutPageStageStateSchema,
    threadsTabs: z.array(WorkbenchLayoutThreadsStageTabSchema).catch([]),
    activeThreadsTabId: z.string(),
    filesTabs: z.array(WorkbenchLayoutFilesStageTabSchema).catch([]),
    activeFilesTabId: z.string(),
    stagePanelWidths: NumberRecordSchema.catch({}),
    slidingWindowPaneCount: z.number().finite().catch(2),
  }),
) satisfies z.ZodType<WorkbenchLayoutSnapshot>;
