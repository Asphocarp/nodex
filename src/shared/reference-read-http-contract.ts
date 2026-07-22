import { z } from "zod";
import {
  WORKFLOW_STATUS_ORDER,
  type DatabasePageSummary,
} from "./types";
import type { PageTargetReadModel } from "./page-targets";
import type { PageOwnershipPathReadModel } from "./page-ownership-paths";
import type {
  DatabaseViewJsonValue,
  DatabaseViewReadModel,
} from "./database-views";
import { canonicalizePortableRichText } from "./block-documents/portable-rich-text";

const PRIORITIES = [
  "p0-critical",
  "p1-high",
  "p2-medium",
  "p3-low",
  "p4-later",
] as const;
const ESTIMATES = ["xs", "s", "m", "l", "xl"] as const;
const RUN_IN_TARGETS = ["localProject", "newWorktree", "cloud"] as const;
const REFERENCE_HTTP_ERROR_CODE = "invalid_reference_http_payload" as const;

/**
 * HTTP JSON cannot preserve `Date` instances. This error marks payloads that
 * failed at that transport boundary, before they can enter renderer state.
 */
export class ReferenceReadHttpBoundaryError extends TypeError {
  readonly code = REFERENCE_HTTP_ERROR_CODE;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReferenceReadHttpBoundaryError";
  }
}

const isCanonicalIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
};

const HttpIsoDateStringSchema = z.string().refine(isCanonicalIsoDate, {
  message: "Expected a canonical ISO-8601 timestamp",
});
const HttpDateSchema = HttpIsoDateStringSchema.transform(
  (value) => new Date(value),
);
const PortableRichTextHttpSchema = z.unknown().transform((value, context) => {
  try {
    return canonicalizePortableRichText(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : String(error),
    });
    return z.NEVER;
  }
});

const RecurrenceEndConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("never") }),
  z.object({
    type: z.literal("untilDate"),
    untilDate: z.string(),
  }),
]);

const PageSummaryHttpSchema = z.object({
  id: z.string(),
  status: z.enum(WORKFLOW_STATUS_ORDER),
  archived: z.boolean(),
  title: z.string(),
  richTitle: PortableRichTextHttpSchema,
  priority: z.enum(PRIORITIES).optional(),
  estimate: z.enum(ESTIMATES).optional(),
  tags: z.array(z.string()),
  dueDate: HttpDateSchema.optional(),
  scheduledStart: HttpDateSchema.optional(),
  scheduledEnd: HttpDateSchema.optional(),
  isAllDay: z.boolean().optional(),
  recurrence: z.object({
    frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
    interval: z.number().int().positive(),
    byWeekdays: z.array(z.number().int().min(0).max(6)).optional(),
    endCondition: RecurrenceEndConditionSchema.optional(),
  }).optional(),
  reminders: z.array(z.object({ offsetMinutes: z.number().finite() })).optional(),
  scheduleTimezone: z.string().optional(),
  assignee: z.string().optional(),
  runInTarget: z.enum(RUN_IN_TARGETS).optional(),
  runInLocalPath: z.string().optional(),
  runInBaseBranch: z.string().optional(),
  runInWorktreePath: z.string().optional(),
  runInEnvironmentPath: z.string().optional(),
  revision: z.number().int().nonnegative().optional(),
  created: HttpDateSchema,
  order: z.number().finite(),
  descriptionPreview: z.string(),
  descriptionLength: z.number().int().nonnegative(),
  hasDescription: z.boolean(),
});

const PageContentSummaryHttpSchema = z.object({
  pageId: z.string(),
  libraryId: z.string(),
  lifecycle: z.enum(["active", "archived", "deleted"]),
  parent: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("library"), libraryId: z.string() }),
    z.object({ kind: z.literal("page"), pageId: z.string() }),
    z.object({ kind: z.literal("data_source"), dataSourceId: z.string() }),
  ]),
  parentRevision: z.number().int().nonnegative(),
  metadataRevision: z.number().int().nonnegative(),
  documentId: z.string(),
  documentGeneration: z.number().int().positive(),
  documentHeadSeq: z.number().int().nonnegative(),
  title: z.string(),
  richTitle: PortableRichTextHttpSchema,
  preview: z.string(),
  plainText: z.string(),
  createdAt: HttpIsoDateStringSchema,
  updatedAt: HttpIsoDateStringSchema,
});
const ActivePageContentSummaryHttpSchema = PageContentSummaryHttpSchema.extend({
  lifecycle: z.enum(["active", "archived"]),
});
const ProjectionAuthorityHttpShape = {
  libraryId: z.string(),
  storeEpoch: z.string(),
  changeLogSeq: z.number().int().nonnegative(),
} as const;

const PageTargetReadModelHttpSchema = z.discriminatedUnion("status", [
  z.object({
    ...ProjectionAuthorityHttpShape,
    status: z.literal("missing"),
    targetPageId: z.string(),
  }),
  z.object({
    ...ProjectionAuthorityHttpShape,
    status: z.literal("invalid_target"),
    targetPageId: z.string(),
    actualBlockType: z.string(),
  }),
  z.object({
    ...ProjectionAuthorityHttpShape,
    status: z.literal("deleted"),
    targetPageId: z.string(),
    libraryId: z.string(),
  }),
  z.object({
    ...ProjectionAuthorityHttpShape,
    status: z.literal("available"),
    targetPageId: z.string(),
    page: ActivePageContentSummaryHttpSchema,
    document: z.object({
      readiness: z.enum(["pending_genesis", "ready", "failed"]),
      schemaKey: z.string(),
      schemaVersion: z.number().int().nonnegative(),
    }),
  }),
]);

const PageOwnershipPathReadModelHttpSchema = z.discriminatedUnion("status", [
  z.object({
    ...ProjectionAuthorityHttpShape,
    status: z.literal("missing"),
    targetPageId: z.string(),
  }),
  z.object({
    ...ProjectionAuthorityHttpShape,
    status: z.literal("available"),
    targetPageId: z.string(),
    ancestors: z.array(z.object({
      pageId: z.string(),
      title: z.string(),
      lifecycle: z.enum(["active", "archived"]),
    })),
  }),
]);

const DatabaseViewJsonValueSchema: z.ZodType<DatabaseViewJsonValue> = z.lazy(
  () => z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(DatabaseViewJsonValueSchema),
    z.record(z.string(), DatabaseViewJsonValueSchema),
  ]),
);

const DatabaseViewReadModelHttpSchema = z.object({
  ...ProjectionAuthorityHttpShape,
  dataSourceId: z.string(),
  view: z.object({
    id: z.string(),
    databaseBlockId: z.string(),
    projectId: z.string(),
    name: z.string(),
    kind: z.enum(["kanban", "list", "calendar", "canvas"]),
    config: z.record(z.string(), DatabaseViewJsonValueSchema),
    isPrimary: z.boolean(),
    createdAt: HttpIsoDateStringSchema,
    updatedAt: HttpIsoDateStringSchema,
  }),
  rows: z.array(z.object({
    page: PageSummaryHttpSchema,
    groupKey: z.string().nullable(),
    rankKey: z.string(),
  })),
});

const formatIssuePath = (path: PropertyKey[]): string => {
  if (path.length === 0) return "$";
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") return `${result}[${segment}]`;
    return `${result}.${String(segment)}`;
  }, "$" as string);
};

const decode = <T>(
  schema: z.ZodType<T>,
  value: unknown,
  modelName: string,
): T => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  const location = formatIssuePath(issue?.path ?? []);
  const detail = issue?.message ?? "Unknown payload error";
  throw new ReferenceReadHttpBoundaryError(
    `Invalid ${modelName} HTTP payload at ${location}: ${detail}`,
    { cause: result.error },
  );
};

export const decodePageSummaryHttp = (value: unknown): DatabasePageSummary =>
  decode(PageSummaryHttpSchema, value, "Page summary");

export const decodePageTargetReadModelHttp = (
  value: unknown,
): PageTargetReadModel =>
  decode(
    PageTargetReadModelHttpSchema,
    value,
    "Page target read model",
  );

export const decodePageOwnershipPathReadModelHttp = (
  value: unknown,
): PageOwnershipPathReadModel =>
  decode(
    PageOwnershipPathReadModelHttpSchema,
    value,
    "Page ownership path read model",
  );

export const decodeDatabaseViewReadModelHttp = (
  value: unknown,
): DatabaseViewReadModel =>
  decode(
    DatabaseViewReadModelHttpSchema,
    value,
    "Database View read model",
  );
