import type { PageDetail } from "../../shared/page-detail";
import { isWorkflowStatus, type WorkflowStatus } from "../../shared/workflow-status";
import type {
  PageRunInTarget,
  Estimate,
  Priority,
  RecurrenceConfig,
  ReminderConfig,
} from "../../shared/types";
import type { PortableRichText } from "../../shared/block-documents/portable-rich-text";

const PRIORITIES = new Set<Priority>([
  "p0-critical",
  "p1-high",
  "p2-medium",
  "p3-low",
  "p4-later",
]);
const ESTIMATES = new Set<Estimate>(["xs", "s", "m", "l", "xl"]);
const RUN_TARGETS = new Set<PageRunInTarget>([
  "localProject",
  "newWorktree",
  "cloud",
]);

export interface PageStageCorePage {
  readonly id: string;
  readonly archived: boolean;
  readonly title: string;
  readonly richTitle: PortableRichText;
  readonly isAllDay: boolean;
  readonly recurrence?: RecurrenceConfig;
  readonly reminders: readonly ReminderConfig[];
  readonly scheduleTimezone?: string;
  readonly runInTarget?: PageRunInTarget;
  readonly runInLocalPath?: string;
  readonly runInBaseBranch?: string;
  readonly runInWorktreePath?: string;
  readonly runInEnvironmentPath?: string;
  readonly revision: number;
  readonly created: Date;
}

export interface PageStageDatabaseProperties {
  readonly status: WorkflowStatus;
  readonly priority?: Priority;
  readonly estimate?: Estimate;
  readonly tags: readonly string[];
  readonly dueDate?: Date;
  readonly scheduledStart?: Date;
  readonly scheduledEnd?: Date;
  readonly assignee?: string;
}

export type PageStageDatabaseContext =
  | { readonly kind: "standalone" }
  | {
      readonly kind: "member";
      readonly membership: {
        readonly id: string;
        readonly dataSourceId: string;
        readonly databaseId: string;
        readonly revision: number;
      };
      /**
       * Current Page Stage compatibility controls require the full seeded
       * property family. A generic Database with another schema remains a
       * truthful member but does not receive fabricated compatibility fields.
       */
      readonly compatibilityProperties: PageStageDatabaseProperties | null;
    };

export interface PageStagePageModel {
  readonly page: PageStageCorePage;
  readonly databaseContext: PageStageDatabaseContext;
}

export type PageStageMetadataMutationResult =
  | { readonly status: "updated"; readonly didMutate: boolean }
  | { readonly status: "conflict" }
  | { readonly status: "not_found" }
  | { readonly status: "error"; readonly error: string };

export class PageStagePageProjectionError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "PageStagePageProjectionError";
  }
}

const requireIntrinsic = (
  detail: PageDetail,
  key: string,
) => {
  const property = detail.intrinsicProperties.find(
    (candidate) => candidate.key === key,
  );
  if (property) return property;
  throw new PageStagePageProjectionError(
    `Page ${detail.page.pageId} is missing intrinsic property ${key}`,
  );
};

const optionalString = (value: unknown, label: string): string | undefined => {
  if (value === null) return undefined;
  if (typeof value === "string") return value || undefined;
  throw new PageStagePageProjectionError(`${label} must be a string or null`);
};

const requireBoolean = (value: unknown, label: string): boolean => {
  if (typeof value === "boolean") return value;
  throw new PageStagePageProjectionError(`${label} must be a boolean`);
};

const requireDate = (value: unknown, label: string): Date | undefined => {
  if (value === null) return undefined;
  if (typeof value !== "string") {
    throw new PageStagePageProjectionError(`${label} must be a date string or null`);
  }
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(date.getTime())) {
    throw new PageStagePageProjectionError(`${label} must be a valid date string`);
  }
  return date;
};

const recurrence = (value: unknown): RecurrenceConfig | undefined => {
  if (value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PageStagePageProjectionError(
      "Page recurrence must be an object or null",
    );
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (
    candidate.frequency !== "daily" &&
    candidate.frequency !== "weekly" &&
    candidate.frequency !== "monthly" &&
    candidate.frequency !== "yearly"
  ) {
    throw new PageStagePageProjectionError("Page recurrence frequency is invalid");
  }
  if (!Number.isInteger(candidate.interval) || (candidate.interval as number) < 1) {
    throw new PageStagePageProjectionError("Page recurrence interval is invalid");
  }
  return value as RecurrenceConfig;
};

const reminders = (value: unknown): readonly ReminderConfig[] => {
  if (!Array.isArray(value)) {
    throw new PageStagePageProjectionError("Page reminders must be an array");
  }
  return value.map((entry, index) => {
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof (entry as { readonly offsetMinutes?: unknown }).offsetMinutes ===
        "number" &&
      Number.isFinite(
        (entry as { readonly offsetMinutes: number }).offsetMinutes,
      )
    ) {
      return {
        offsetMinutes: (entry as { readonly offsetMinutes: number })
          .offsetMinutes,
      };
    }
    throw new PageStagePageProjectionError(
      `Page reminder ${index} is invalid`,
    );
  });
};

const readCompatibilityDatabaseProperties = (
  detail: PageDetail,
): PageStageDatabaseProperties | null => {
  if (detail.dataSourceContext.kind !== "member") return null;
  const context = detail.dataSourceContext;
  const fields = new Map<string, (typeof context.properties)[number]>(
    context.properties.map((property) => [property.propertyId, property] as const),
  );
  const requiredFields = [
    "status",
    "priority",
    "estimate",
    "tags",
    "due_date",
    "scheduled_start",
    "scheduled_end",
    "assignee",
  ] as const;
  if (requiredFields.some((field) => !fields.has(field))) return null;

  const value = (field: (typeof requiredFields)[number]): unknown => {
    const property = fields.get(field);
    if (!property) return null;
    return context.values[property.propertyId]?.value ??
      (property.valueType === "multi_select" ? [] : null);
  };
  const status = value("status");
  if (!isWorkflowStatus(status)) {
    throw new PageStagePageProjectionError("Page Database status is invalid");
  }
  const priorityValue = value("priority");
  if (priorityValue !== null && !PRIORITIES.has(priorityValue as Priority)) {
    throw new PageStagePageProjectionError("Page Database priority is invalid");
  }
  const estimateValue = value("estimate");
  if (estimateValue !== null && !ESTIMATES.has(estimateValue as Estimate)) {
    throw new PageStagePageProjectionError("Page Database estimate is invalid");
  }
  const tagsValue = value("tags");
  if (!Array.isArray(tagsValue) || tagsValue.some((tag) => typeof tag !== "string")) {
    throw new PageStagePageProjectionError("Page Database tags are invalid");
  }
  const assigneeValue = value("assignee");
  const dueDate = requireDate(value("due_date"), "Page due date");
  const scheduledStart = requireDate(
    value("scheduled_start"),
    "Page scheduled start",
  );
  const scheduledEnd = requireDate(
    value("scheduled_end"),
    "Page scheduled end",
  );
  const assignee = optionalString(assigneeValue, "Page assignee");
  return {
    status,
    ...(priorityValue === null ? {} : { priority: priorityValue as Priority }),
    ...(estimateValue === null ? {} : { estimate: estimateValue as Estimate }),
    tags: tagsValue as string[],
    ...(dueDate ? { dueDate } : {}),
    ...(scheduledStart ? { scheduledStart } : {}),
    ...(scheduledEnd ? { scheduledEnd } : {}),
    ...(assignee ? { assignee } : {}),
  };
};

export const projectPageDetailToStageModel = (
  detail: PageDetail,
): PageStagePageModel => {
  const runTargetValue = requireIntrinsic(detail, "run.target").value;
  if (runTargetValue !== null && !RUN_TARGETS.has(runTargetValue as PageRunInTarget)) {
    throw new PageStagePageProjectionError("Page run target is invalid");
  }
  const created = new Date(detail.page.createdAt);
  if (Number.isNaN(created.getTime())) {
    throw new PageStagePageProjectionError("Page created timestamp is invalid");
  }
  const page: PageStageCorePage = {
    id: detail.page.pageId,
    archived: detail.page.lifecycle === "archived",
    title: detail.page.title,
    richTitle: detail.page.richTitle,
    isAllDay: requireBoolean(
      requireIntrinsic(detail, "schedule.isAllDay").value,
      "Page all-day state",
    ),
    recurrence: recurrence(requireIntrinsic(detail, "recurrence.config").value),
    reminders: reminders(requireIntrinsic(detail, "reminders.config").value),
    scheduleTimezone: optionalString(
      requireIntrinsic(detail, "schedule.timezone").value,
      "Page schedule timezone",
    ),
    ...(runTargetValue === null
      ? {}
      : { runInTarget: runTargetValue as PageRunInTarget }),
    runInLocalPath: optionalString(
      requireIntrinsic(detail, "run.localPath").value,
      "Page local path",
    ),
    runInBaseBranch: optionalString(
      requireIntrinsic(detail, "run.baseBranch").value,
      "Page base branch",
    ),
    runInWorktreePath: optionalString(
      requireIntrinsic(detail, "run.worktreePath").value,
      "Page worktree path",
    ),
    runInEnvironmentPath: optionalString(
      requireIntrinsic(detail, "run.environmentPath").value,
      "Page environment path",
    ),
    revision: detail.page.metadataRevision,
    created,
  };

  if (detail.dataSourceContext.kind === "standalone") {
    return { page, databaseContext: { kind: "standalone" } };
  }
  return {
    page,
    databaseContext: {
      kind: "member",
      membership: {
        id: detail.dataSourceContext.membership.membershipId,
        dataSourceId: detail.dataSourceContext.membership.dataSourceId,
        databaseId: detail.dataSourceContext.database.databaseId,
        revision: detail.dataSourceContext.membership.revision,
      },
      compatibilityProperties: readCompatibilityDatabaseProperties(detail),
    },
  };
};
