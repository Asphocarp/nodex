import { z } from "zod";
import type {
  WorkbenchLayoutDockSnapshot,
  WorkbenchLayoutFilesStageTab,
  WorkbenchLayoutSnapshotV4,
  WorkbenchLayoutSnapshotV3,
  WorkbenchLayoutSidebarSnapshot,
  WorkbenchLayoutSnapshot,
  WorkbenchLayoutThreadsStageTab,
  WorkbenchLibraryLocationTarget,
  WorkbenchLocation,
  WorkbenchSessionLocation,
} from "../workbench-layout";
import {
  WorkbenchLayoutPageStageStateSchema,
  WorkbenchRecentPageSessionSchema,
  WorkbenchStageIdSchema,
  WorkbenchStageNavDirectionSchema,
  WorkbenchViewSchema,
} from "./workbench";
import { WorkbenchSessionViewSnapshotSchema } from "./workbench-session-view";
import {
  parseDatabaseId,
  parseDatabaseViewId,
} from "../database-identities";

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

export const WorkbenchSessionLocationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("session"),
    activeProjectId: z.string().min(1).nullable(),
    sessionId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("empty"),
    activeProjectId: z.string().min(1).nullable(),
  }),
]) satisfies z.ZodType<WorkbenchSessionLocation>;

export const WorkbenchLibraryLocationTargetSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("home") }),
    z.object({
      kind: z.literal("page"),
      pageId: z.string().min(1),
    }),
    z.object({
      kind: z.literal("database"),
      databaseId: z.string().min(1),
      accessProjectId: z.string().min(1).optional(),
    }),
    z.object({
      kind: z.literal("view"),
      viewId: z.string().min(1),
      accessProjectId: z.string().min(1).optional(),
    }),
  ],
).transform((target): WorkbenchLibraryLocationTarget => {
  if (target.kind === "database") {
    return {
      ...target,
      databaseId: parseDatabaseId(target.databaseId),
    };
  }
  if (target.kind === "view") {
    return {
      ...target,
      viewId: parseDatabaseViewId(target.viewId),
    };
  }
  return target;
}) satisfies z.ZodType<WorkbenchLibraryLocationTarget>;

export const WorkbenchLocationSchema = z.discriminatedUnion("kind", [
  ...WorkbenchSessionLocationSchema.options,
  z.object({
    kind: z.literal("library"),
    target: WorkbenchLibraryLocationTargetSchema,
    returnTo: WorkbenchSessionLocationSchema,
  }),
  z.object({
    kind: z.literal("settings"),
    path: z.string().min(1),
    returnTo: WorkbenchSessionLocationSchema,
  }),
  z.object({
    kind: z.literal("automations"),
    path: z.string().min(1),
    returnTo: WorkbenchSessionLocationSchema,
  }),
  z.object({
    kind: z.literal("pending-worktree"),
    clientThreadId: z.string().min(1),
    returnTo: WorkbenchSessionLocationSchema,
  }),
]) satisfies z.ZodType<WorkbenchLocation>;

const PersistedWorkbenchLocationSchema = z.discriminatedUnion("kind", [
  ...WorkbenchSessionLocationSchema.options,
  z.object({
    kind: z.literal("library"),
    target: WorkbenchLibraryLocationTargetSchema,
    returnTo: WorkbenchSessionLocationSchema,
  }),
  z.object({
    kind: z.literal("settings"),
    path: z.string().min(1),
    returnTo: WorkbenchSessionLocationSchema,
  }),
  z.object({
    kind: z.literal("automations"),
    path: z.string().min(1),
    returnTo: WorkbenchSessionLocationSchema,
  }),
]);

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
      version: 3,
      projectOrder: record.projectOrder ?? record.spaceOrder ?? [],
      sessionViewsBySessionId: {},
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
    version: 3,
    projectOrder: record.projectOrder ?? record.spaceOrder ?? [],
    focusedStage: record.focusedStage === "cards" ? "pages" : record.focusedStage,
    activePagesTabId: record.activePagesTabId ?? record.activeCardsTabId ?? "",
    recentPageSessions,
    pageStage,
    dock: migratePageStageDockIdentity(record.dock),
    sessionViewsBySessionId: {},
  };
};

export const WorkbenchLayoutSnapshotV3Schema = z.preprocess(
  migrateWorkbenchLayoutSnapshot,
  z.object({
    version: z.literal(3),
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
    sessionViewsBySessionId: z.record(
      z.string(),
      WorkbenchSessionViewSnapshotSchema,
    ).catch({}),
  }),
) satisfies z.ZodType<WorkbenchLayoutSnapshotV3>;

const migrateWorkbenchLayoutSnapshotToV4 = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  if (record.version === 4) {
    const location = record.location;
    if (
      typeof location === "object"
      && location !== null
      && !Array.isArray(location)
      && (location as Record<string, unknown>).kind === "pending-worktree"
    ) {
      return {
        ...record,
        location: (location as Record<string, unknown>).returnTo,
      };
    }
    return value;
  }

  const migratedV3 = migrateWorkbenchLayoutSnapshot(value);
  if (
    typeof migratedV3 !== "object"
    || migratedV3 === null
    || Array.isArray(migratedV3)
  ) {
    return migratedV3;
  }
  const legacy = migratedV3 as Record<string, unknown>;
  if (legacy.version !== 3) return migratedV3;

  const activeProjectId =
    typeof legacy.dbProjectId === "string" && legacy.dbProjectId.length > 0
      ? legacy.dbProjectId
      : null;
  const sessionId =
    typeof legacy.activeProjectSessionId === "string"
      && legacy.activeProjectSessionId.length > 0
      ? legacy.activeProjectSessionId
      : null;

  return {
    version: 4,
    location: sessionId
      ? {
          kind: "session",
          activeProjectId,
          sessionId,
        }
      : {
          kind: "empty",
          activeProjectId,
        },
    databaseSearchByProject: legacy.searchByProject ?? {},
    sessionViewsBySessionId: legacy.sessionViewsBySessionId ?? {},
  };
};

export const WorkbenchLayoutSnapshotV4Schema = z.preprocess(
  migrateWorkbenchLayoutSnapshotToV4,
  z.object({
    version: z.literal(4),
    location: PersistedWorkbenchLocationSchema,
    databaseSearchByProject: StringRecordSchema.catch({}),
    sessionViewsBySessionId: z.record(
      z.string(),
      WorkbenchSessionViewSnapshotSchema,
    ).catch({}),
  }),
) satisfies z.ZodType<WorkbenchLayoutSnapshotV4>;

export const WorkbenchLayoutSnapshotSchema:
  z.ZodType<WorkbenchLayoutSnapshot> =
  WorkbenchLayoutSnapshotV4Schema;
