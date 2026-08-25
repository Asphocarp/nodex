import { z } from "zod";
import type { WorkbenchReviewConfig } from "../workbench-review";

const idSchema = z.string().min(1).max(512);
const LegacyWorkbenchReviewContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), projectId: idSchema }).strict(),
  z.object({ kind: z.literal("session"), sessionId: idSchema }).strict(),
]);

function migrateWorkbenchReviewConfig(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  if (candidate.context === undefined) return value;
  if (Object.keys(candidate).some((key) => key !== "projectId" && key !== "context")) return value;
  if (!LegacyWorkbenchReviewContextSchema.safeParse(candidate.context).success) return value;
  if (candidate.projectId === null) return { projectId: null };
  if (typeof candidate.projectId !== "string") return value;
  const projectId = candidate.projectId.trim();
  return projectId ? { projectId } : value;
}

export const WorkbenchReviewConfigSchema = z.preprocess(
  migrateWorkbenchReviewConfig,
  z
    .object({
      projectId: idSchema.nullable(),
    })
    .strict(),
) satisfies z.ZodType<WorkbenchReviewConfig>;
