import { z } from "zod";
import type {
  WorkbenchRecentCardSession,
  WorkbenchResumeCardStageState,
  WorkbenchResumeSnapshot,
  WorkbenchResumeStageId,
  WorkbenchResumeStageNavDirection,
  WorkbenchResumeView,
} from "../workbench-resume";

export const WorkbenchViewSchema = z.enum([
  "kanban",
  "list",
  "toggle-list",
  "canvas",
  "calendar",
]) satisfies z.ZodType<WorkbenchResumeView>;

export const WorkbenchStageIdSchema = z.enum([
  "db",
  "cards",
  "threads",
  "files",
]) satisfies z.ZodType<WorkbenchResumeStageId>;

export const WorkbenchStageNavDirectionSchema = z.enum([
  "left",
  "right",
]) satisfies z.ZodType<WorkbenchResumeStageNavDirection>;

export const WorkbenchRecentCardSessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  cardId: z.string(),
  titleSnapshot: z.string(),
  lastOpenedAt: z.string(),
}) satisfies z.ZodType<WorkbenchRecentCardSession>;

export const WorkbenchResumeCardStageStateSchema = z.object({
  open: z.boolean(),
  projectId: z.string(),
  cardId: z.string().nullable(),
}) satisfies z.ZodType<WorkbenchResumeCardStageState>;

export const WorkbenchResumeSnapshotSchema = z.object({
  version: z.literal(1),
  dbProjectId: z.string(),
  threadsProjectId: z.string(),
  viewsByProject: z.record(z.string(), WorkbenchViewSchema),
  focusedStage: WorkbenchStageIdSchema,
  stageNavDirection: WorkbenchStageNavDirectionSchema,
  activeCardsTabId: z.string(),
  activeRecentSessionId: z.string().nullable(),
  activeThreadsTabId: z.string(),
  recentCardSessions: z.array(WorkbenchRecentCardSessionSchema),
  cardStage: WorkbenchResumeCardStageStateSchema,
}) satisfies z.ZodType<WorkbenchResumeSnapshot>;
