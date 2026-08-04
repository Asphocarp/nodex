import { z } from "zod";
import type { WorkbenchReviewConfig } from "../workbench-review-context";

const idSchema = z.string().min(1).max(512);

export const WorkbenchReviewContextSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("project"),
    projectId: idSchema,
  }).strict(),
  z.object({
    kind: z.literal("session"),
    sessionId: idSchema,
  }).strict(),
]);

function migrateWorkbenchReviewConfig(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  if (candidate.context !== undefined) return value;
  if (typeof candidate.projectId !== "string" || candidate.projectId.trim().length === 0) {
    return value;
  }
  return {
    ...candidate,
    context: { kind: "project", projectId: candidate.projectId },
  };
}

export const WorkbenchReviewConfigSchema = z.preprocess(
  migrateWorkbenchReviewConfig,
  z.union([
    z.object({
      projectId: idSchema,
      context: WorkbenchReviewContextSchema.optional(),
    }).strict(),
    z.object({
      projectId: z.null(),
      context: z.object({
        kind: z.literal("session"),
        sessionId: idSchema,
      }).strict(),
    }).strict(),
  ]),
) satisfies z.ZodType<WorkbenchReviewConfig>;
