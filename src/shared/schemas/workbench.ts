import { z } from "zod";
import type {
  WorkbenchRecentCardSession,
  WorkbenchLayoutCardStageState,
  WorkbenchLayoutStageId,
  WorkbenchLayoutStageNavDirection,
  WorkbenchLayoutView,
} from "../workbench-layout";

export const WorkbenchViewSchema = z.enum([
  "kanban",
  "list",
  "toggle-list",
  "canvas",
  "calendar",
]) satisfies z.ZodType<WorkbenchLayoutView>;

export const WorkbenchStageIdSchema = z.enum([
  "db",
  "cards",
  "threads",
  "files",
]) satisfies z.ZodType<WorkbenchLayoutStageId>;

export const WorkbenchStageNavDirectionSchema = z.enum([
  "left",
  "right",
]) satisfies z.ZodType<WorkbenchLayoutStageNavDirection>;

export const WorkbenchRecentCardSessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  cardId: z.string(),
  titleSnapshot: z.string(),
  lastOpenedAt: z.string(),
}) satisfies z.ZodType<WorkbenchRecentCardSession>;

export const WorkbenchLayoutCardStageStateSchema = z.object({
  open: z.boolean(),
  projectId: z.string(),
  cardId: z.string().nullable(),
}) satisfies z.ZodType<WorkbenchLayoutCardStageState>;
