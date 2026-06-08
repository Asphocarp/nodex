import { z } from "zod";
import type {
  WindowRestoreSettings,
  WindowSessionBounds,
  WindowSessionBootstrap,
  WindowSessionCatalog,
  WindowSessionRecord,
} from "../window-session";
import { WorkbenchLayoutSnapshotSchema } from "./workbench-layout";

export const WindowRestorePolicySchema = z.enum(["all", "last-window", "none"]);

export const WindowRestoreSettingsSchema = z.object({
  policy: WindowRestorePolicySchema.catch("all"),
}) satisfies z.ZodType<WindowRestoreSettings>;

export const WindowSessionBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
  mode: z.enum(["normal", "maximized", "fullscreen"]).catch("normal"),
}) satisfies z.ZodType<WindowSessionBounds>;

export const WindowSessionRecordSchema = z.object({
  id: z.string().min(1),
  layout: WorkbenchLayoutSnapshotSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  focusedAt: z.string(),
  bounds: WindowSessionBoundsSchema.optional().catch(undefined),
}) satisfies z.ZodType<WindowSessionRecord>;

export const WindowSessionCatalogSchema = z.object({
  version: z.literal(1),
  lastActiveSessionId: z.string().min(1),
  sessions: z.array(WindowSessionRecordSchema),
}) satisfies z.ZodType<WindowSessionCatalog>;

export const WindowSessionBootstrapSchema = z.object({
  session: WindowSessionRecordSchema,
}) satisfies z.ZodType<WindowSessionBootstrap>;
