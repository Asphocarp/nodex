import { z } from "zod";
import {
  CARD_STATUS_ORDER,
  type CardSummary,
} from "./types";
import type { CardReferenceReadModel } from "./block-references";
import type {
  DatabaseViewJsonValue,
  DatabaseViewReadModel,
} from "./database-views";

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

const RecurrenceEndConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("never") }),
  z.object({
    type: z.literal("untilDate"),
    untilDate: z.string(),
  }),
]);

const CardSummaryHttpSchema = z.object({
  id: z.string(),
  status: z.enum(CARD_STATUS_ORDER),
  archived: z.boolean(),
  title: z.string(),
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
  agentBlocked: z.boolean(),
  agentStatus: z.string().optional(),
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
}).passthrough();

const CardReferenceReadModelHttpSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("missing"),
    targetBlockId: z.string(),
  }),
  z.object({
    status: z.literal("invalid_target"),
    targetBlockId: z.string(),
    actualBlockType: z.string(),
  }),
  z.object({
    status: z.literal("deleted"),
    targetBlockId: z.string(),
    projectId: z.string(),
  }),
  z.object({
    status: z.literal("available"),
    targetBlockId: z.string(),
    projectId: z.string(),
    lifecycle: z.enum(["active", "archived"]),
    summary: CardSummaryHttpSchema,
    document: z.object({
      documentId: z.string(),
      generation: z.number().int().nonnegative(),
      headSeq: z.number().int().nonnegative(),
      readiness: z.enum(["pending_genesis", "ready", "failed"]),
      authority: z.enum(["legacy_shadow", "ydoc_primary"]),
      schemaKey: z.string(),
      schemaVersion: z.number().int().nonnegative(),
    }),
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
    card: CardSummaryHttpSchema,
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

export const decodeCardSummaryHttp = (value: unknown): CardSummary =>
  decode(CardSummaryHttpSchema, value, "Card summary");

export const decodeCardReferenceReadModelHttp = (
  value: unknown,
): CardReferenceReadModel =>
  decode(
    CardReferenceReadModelHttpSchema,
    value,
    "Card reference read model",
  );

export const decodeDatabaseViewReadModelHttp = (
  value: unknown,
): DatabaseViewReadModel =>
  decode(
    DatabaseViewReadModelHttpSchema,
    value,
    "Database View read model",
  );
