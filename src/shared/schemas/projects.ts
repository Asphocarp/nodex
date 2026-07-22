import { z } from "zod";
import type {
  Project,
  ProjectLifecycleInput,
  ProjectLifecycleMutationResult,
  ProjectOrderInput,
  ProjectPinnedInput,
  ProjectPinnedOrderInput,
} from "../types";

const ProjectSchema = z.object({
  id: z.string(),
  libraryId: z.string(),
  databaseId: z.string(),
  lifecycle: z.enum(["active", "inactive", "archived"]),
  bindingRevision: z.number(),
  name: z.string(),
  description: z.string(),
  icon: z.string().optional(),
  sources: z.array(z.object({ root: z.string(), order: z.number() })),
  primaryWorkspaceRoot: z.string().nullable(),
  pinned: z.boolean(),
  pinnedOrder: z.number().nullable(),
  created: z.coerce.date(),
  updated: z.coerce.date(),
}) satisfies z.ZodType<Project>;

const ProjectArchiveBlockerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("active-turn"),
    threadId: z.string(),
    label: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("pending-request"),
    threadId: z.string(),
    label: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("terminal"),
    terminalSessionId: z.string(),
    projectSessionId: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("background-process"),
    threadId: z.string(),
    processId: z.string().nullable(),
    label: z.string().nullable(),
  }),
]);

export const ProjectLifecycleMutationResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("updated"),
    project: ProjectSchema,
    changed: z.boolean(),
  }),
  z.object({
    kind: z.literal("blocked"),
    project: ProjectSchema,
    blockers: z.array(ProjectArchiveBlockerSchema),
  }),
  z.object({ kind: z.literal("not-found") }),
]) satisfies z.ZodType<ProjectLifecycleMutationResult>;

export function parseProjectLifecycleMutationResult(
  value: unknown,
): ProjectLifecycleMutationResult {
  return ProjectLifecycleMutationResultSchema.parse(value);
}

export const ProjectLifecycleInputSchema = z.object({
  lifecycle: z.enum(["active", "archived"]),
}) satisfies z.ZodType<ProjectLifecycleInput>;

export const ProjectOrderInputSchema = z.object({
  orderedProjectIds: z.array(z.string()),
}) satisfies z.ZodType<ProjectOrderInput>;

export const ProjectPinnedInputSchema = z.object({
  pinned: z.boolean(),
}) satisfies z.ZodType<ProjectPinnedInput>;

export const ProjectPinnedOrderInputSchema = z.object({
  orderedProjectIds: z.array(z.string()),
}) satisfies z.ZodType<ProjectPinnedOrderInput>;
