import {
  stableStringifyBlockPropertyJson,
  type BlockPropertyJsonValue,
} from "./block-property-mutations";
import {
  MAX_PAGE_ASSIGNEE_LENGTH,
  MAX_PAGE_DESCRIPTION_LENGTH,
  MAX_PAGE_TAG_COUNT,
  MAX_PAGE_TAG_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
} from "./page-limits";
import { isWorkflowStatus, type WorkflowStatus } from "./workflow-status";
import { isPriority } from "./priority";
import { isFractionalRankKey } from "./fractional-rank";
import type {
  PageRunInTarget,
  Estimate,
  Priority,
  RecurrenceConfig,
  ReminderConfig,
} from "./types";
import {
  canonicalizePortableRichText,
  PortableRichTextError,
  portableRichTextPlainText,
  type PortableRichText,
} from "./block-documents/portable-rich-text";

export const PAGE_LIFECYCLE_CONTRACT_VERSION = 1 as const;

const MAX_ID_LENGTH = 512;
const MAX_PATH_LENGTH = 32_768;
const MAX_TIMEZONE_LENGTH = 256;
const MAX_ACTOR_JSON_LENGTH = 1_000_000;
const MAX_CANONICAL_REQUEST_LENGTH = 2_000_000;
const MAX_REMINDERS = 10_000;
const ESTIMATES = new Set<Estimate>(["xs", "s", "m", "l", "xl"]);
const RUN_TARGETS = new Set<PageRunInTarget>([
  "localProject",
  "newWorktree",
  "cloud",
]);
const RECURRENCE_FREQUENCIES = new Set<RecurrenceConfig["frequency"]>([
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);

export interface CreatePageOperation {
  readonly kind: "create_page";
  /** Application identity is allocated before enqueue so retry stays exact. */
  readonly pageId: string;
  readonly title: string;
  /** Canonical rich title; title remains its plain-text projection. */
  readonly richTitle?: PortableRichText;
  readonly nfm: string;
  readonly status: WorkflowStatus;
  readonly priority: Priority | null;
  readonly estimate: Estimate | null;
  readonly tags: readonly string[];
  readonly dueDate: string | null;
  readonly scheduledStart: string | null;
  readonly scheduledEnd: string | null;
  readonly isAllDay: boolean;
  readonly recurrence: RecurrenceConfig | null;
  readonly reminders: readonly ReminderConfig[];
  readonly scheduleTimezone: string | null;
  readonly assignee: string | null;
  readonly runInTarget: PageRunInTarget;
  readonly runInLocalPath: string | null;
  readonly runInBaseBranch: string | null;
  readonly runInWorktreePath: string | null;
  readonly runInEnvironmentPath: string | null;
  /** Missing appends to the Project's top-level Block order. */
  readonly beforeBlockId?: string;
  /** Missing appends to the status group in the primary Kanban View. */
  readonly beforeViewPageId?: string;
}

export interface ArchivePageOperation {
  readonly kind: "archive_page";
  readonly pageId: string;
  readonly expectedMetadataRevision: number;
}

export interface UnarchivePageOperation {
  readonly kind: "unarchive_page";
  readonly pageId: string;
  readonly expectedMetadataRevision: number;
}

export interface DeletePageOperation {
  readonly kind: "delete_page";
  readonly pageId: string;
  readonly expectedMetadataRevision: number;
  readonly expectedParentRevision: number;
}

export interface RestorePageOperation {
  readonly kind: "restore_page";
  readonly pageId: string;
  /** Immutable delete receipt whose exact tombstone this command restores. */
  readonly deleteOperationId: string;
  readonly expectedMetadataRevision: number;
  readonly expectedParentRevision: number;
  readonly membership: null | Readonly<{
    /** Restore reactivates this exact removed membership; it never copies a row. */
    membershipId: string;
    databaseId: string;
    dataSourceId: string;
    status: WorkflowStatus;
    /** Null preserves membership without opting the Page into manual View order. */
    position: null | Readonly<{
      viewId: string;
      beforeViewPageId?: string;
    }>;
  }>;
  readonly beforeBlockId?: string;
}

export interface MovePageInLibraryOperation {
  readonly kind: "move_page_in_library";
  readonly pageId: string;
  readonly expectedParentRevision: number;
  readonly beforeBlockId?: string;
}

export type PageLifecycleOperation =
  | CreatePageOperation
  | ArchivePageOperation
  | UnarchivePageOperation
  | DeletePageOperation
  | RestorePageOperation
  | MovePageInLibraryOperation;

export interface PageLifecycleMutationRequest {
  readonly version: typeof PAGE_LIFECYCLE_CONTRACT_VERSION;
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly clientSessionId?: string;
  readonly actor: Readonly<Record<string, BlockPropertyJsonValue>>;
  readonly operation: PageLifecycleOperation;
}

export interface PageLifecycleMutationReceipt {
  readonly version: typeof PAGE_LIFECYCLE_CONTRACT_VERSION;
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly operationKind: PageLifecycleOperation["kind"];
  readonly pageId: string;
  readonly duplicate: boolean;
  readonly metadataRevision: number;
  readonly parentRevision: number;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly documentId: string;
  readonly documentGeneration: number;
  readonly documentHeadSeq: number;
  readonly databaseId: string | null;
  readonly dataSourceId: string | null;
  readonly membershipId: string | null;
  readonly viewId: string | null;
  readonly libraryRankKey: string | null;
  readonly viewRankKey: string | null;
  readonly createdBlockIds: readonly string[];
  readonly commitSeq: number;
  readonly committedAt: string;
}

export type PageLifecycleMutationErrorCode =
  | "invalid_page_lifecycle_request"
  | "store_epoch_mismatch"
  | "operation_id_collision"
  | "operation_receipt_corrupt"
  | "project_not_found"
  | "authorization_denied"
  | "page_identity_collision"
  | "page_not_found"
  | "page_type_mismatch"
  | "page_lifecycle_conflict"
  | "metadata_revision_conflict"
  | "parent_revision_conflict"
  | "page_parent_invalid"
  | "position_anchor_not_found"
  | "position_anchor_group_mismatch"
  | "primary_database_not_found"
  | "database_schema_invalid"
  | "database_property_value_invalid"
  | "membership_not_found"
  | "view_not_found"
  | "delete_evidence_invalid"
  | "document_state_corrupt"
  | "unknown";

export interface PageLifecycleMutationCommandError {
  readonly code: PageLifecycleMutationErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly operationId?: string;
  readonly pageId?: string;
  readonly expectedRevision?: number;
  readonly actualRevision?: number;
}

export type PageLifecycleMutationCommandResult =
  | { readonly ok: true; readonly value: PageLifecycleMutationReceipt }
  | { readonly ok: false; readonly error: PageLifecycleMutationCommandError };

export class PageLifecycleContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageLifecycleContractError";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new PageLifecycleContractError(`${label} must be an object`);
};

const assertExactKeys = (
  value: Readonly<Record<string, unknown>>,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void => {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (Object.hasOwn(value, key)) continue;
    throw new PageLifecycleContractError(`${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    throw new PageLifecycleContractError(`${label}.${key} is not supported`);
  }
};

const readString = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  maximum: number,
  options: { readonly allowEmpty?: boolean; readonly trim?: boolean } = {},
): string => {
  const candidate = value[key];
  const isCanonical =
    typeof candidate === "string" &&
    candidate.length <= maximum &&
    (options.allowEmpty === true || candidate.length > 0) &&
    (options.trim !== true || candidate === candidate.trim());
  if (isCanonical) return candidate;
  throw new PageLifecycleContractError(
    `${label}.${key} must be a bounded${options.allowEmpty ? "" : " non-empty"} string`,
  );
};

const readId = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string => readString(value, key, label, MAX_ID_LENGTH, { trim: true });

const readOptionalId = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string | undefined =>
  value[key] === undefined ? undefined : readId(value, key, label);

const readRevision = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): number => {
  const revision = value[key];
  if (
    typeof revision === "number" &&
    Number.isSafeInteger(revision) &&
    revision >= 1
  ) {
    return revision;
  }
  throw new PageLifecycleContractError(
    `${label}.${key} must be a safe integer >= 1`,
  );
};

const readNullableString = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  maximum: number,
): string | null => {
  if (value[key] === undefined || value[key] === null || value[key] === "") {
    return null;
  }
  return readString(value, key, label, maximum);
};

const readCanonicalDate = (value: unknown, label: string): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return value;
    }
  }
  throw new PageLifecycleContractError(`${label} must be YYYY-MM-DD or null`);
};

const readCanonicalDateTime = (
  value: unknown,
  label: string,
): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString() === value) {
      return value;
    }
  }
  throw new PageLifecycleContractError(
    `${label} must be a canonical ISO timestamp or null`,
  );
};

const readRecurrence = (value: unknown): RecurrenceConfig | null => {
  if (value === undefined || value === null) return null;
  const recurrence = readRecord(value, "pageLifecycle.operation.recurrence");
  assertExactKeys(
    recurrence,
    "pageLifecycle.operation.recurrence",
    ["frequency", "interval"],
    ["byWeekdays", "endCondition"],
  );
  if (
    !RECURRENCE_FREQUENCIES.has(
      recurrence.frequency as RecurrenceConfig["frequency"],
    )
  ) {
    throw new PageLifecycleContractError(
      "pageLifecycle.operation.recurrence.frequency is invalid",
    );
  }
  if (
    typeof recurrence.interval !== "number" ||
    !Number.isSafeInteger(recurrence.interval) ||
    recurrence.interval < 1
  ) {
    throw new PageLifecycleContractError(
      "pageLifecycle.operation.recurrence.interval must be an integer >= 1",
    );
  }
  let byWeekdays: number[] | undefined;
  if (recurrence.byWeekdays !== undefined) {
    if (
      !Array.isArray(recurrence.byWeekdays) ||
      recurrence.byWeekdays.length < 1 ||
      !recurrence.byWeekdays.every(
        (day) =>
          typeof day === "number" &&
          Number.isInteger(day) &&
          day >= 0 &&
          day <= 6,
      )
    ) {
      throw new PageLifecycleContractError(
        "pageLifecycle.operation.recurrence.byWeekdays must contain weekdays 0-6",
      );
    }
    byWeekdays = [...new Set(recurrence.byWeekdays)].sort(
      (left, right) => left - right,
    );
    if (byWeekdays.length !== recurrence.byWeekdays.length) {
      throw new PageLifecycleContractError(
        "pageLifecycle.operation.recurrence.byWeekdays must be unique",
      );
    }
  }
  if (recurrence.frequency === "weekly" && byWeekdays === undefined) {
    throw new PageLifecycleContractError(
      "weekly recurrence requires byWeekdays",
    );
  }
  let endCondition: RecurrenceConfig["endCondition"];
  if (recurrence.endCondition !== undefined) {
    const condition = readRecord(
      recurrence.endCondition,
      "pageLifecycle.operation.recurrence.endCondition",
    );
    if (condition.type === "never") {
      assertExactKeys(
        condition,
        "pageLifecycle.operation.recurrence.endCondition",
        ["type"],
      );
      endCondition = { type: "never" };
    } else if (condition.type === "untilDate") {
      assertExactKeys(
        condition,
        "pageLifecycle.operation.recurrence.endCondition",
        ["type", "untilDate"],
      );
      const untilDate = readCanonicalDate(
        condition.untilDate,
        "pageLifecycle.operation.recurrence.endCondition.untilDate",
      );
      if (untilDate === null) {
        throw new PageLifecycleContractError(
          "untilDate recurrence requires a date",
        );
      }
      endCondition = { type: "untilDate", untilDate };
    } else {
      throw new PageLifecycleContractError(
        "pageLifecycle.operation.recurrence.endCondition.type is invalid",
      );
    }
  }
  return {
    frequency: recurrence.frequency as RecurrenceConfig["frequency"],
    interval: recurrence.interval,
    ...(byWeekdays === undefined ? {} : { byWeekdays }),
    ...(endCondition === undefined ? {} : { endCondition }),
  };
};

const readReminders = (value: unknown): readonly ReminderConfig[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new PageLifecycleContractError(
      "pageLifecycle.operation.reminders must be an array",
    );
  }
  if (value.length > MAX_REMINDERS) {
    throw new PageLifecycleContractError(
      `pageLifecycle.operation.reminders exceeds ${MAX_REMINDERS} items`,
    );
  }
  const offsets = value.map((entry, index) => {
    const reminder = readRecord(
      entry,
      `pageLifecycle.operation.reminders[${index}]`,
    );
    assertExactKeys(reminder, `pageLifecycle.operation.reminders[${index}]`, [
      "offsetMinutes",
    ]);
    if (
      typeof reminder.offsetMinutes === "number" &&
      Number.isSafeInteger(reminder.offsetMinutes) &&
      reminder.offsetMinutes >= 0 &&
      reminder.offsetMinutes <= 365 * 24 * 60
    ) {
      return reminder.offsetMinutes;
    }
    throw new PageLifecycleContractError(
      `pageLifecycle.operation.reminders[${index}].offsetMinutes is invalid`,
    );
  });
  if (new Set(offsets).size !== offsets.length) {
    throw new PageLifecycleContractError(
      "pageLifecycle.operation.reminders must have unique offsets",
    );
  }
  return offsets
    .sort((left, right) => left - right)
    .map((offsetMinutes) => ({ offsetMinutes }));
};

const readActor = (
  value: unknown,
): Readonly<Record<string, BlockPropertyJsonValue>> => {
  if (!isRecord(value)) {
    throw new PageLifecycleContractError(
      "pageLifecycle.actor must be an object",
    );
  }
  let canonical: string;
  try {
    canonical = stableStringifyBlockPropertyJson(value);
  } catch (error) {
    throw new PageLifecycleContractError(
      `pageLifecycle.actor must contain bounded JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (canonical.length > MAX_ACTOR_JSON_LENGTH) {
    throw new PageLifecycleContractError(
      "pageLifecycle.actor exceeds the JSON size limit",
    );
  }
  return JSON.parse(canonical) as Readonly<
    Record<string, BlockPropertyJsonValue>
  >;
};

const parseCreate = (
  operation: Readonly<Record<string, unknown>>,
): CreatePageOperation => {
  const label = "pageLifecycle.operation";
  assertExactKeys(
    operation,
    label,
    ["kind", "pageId", "title", "nfm", "status"],
    [
      "priority",
      "estimate",
      "tags",
      "dueDate",
      "scheduledStart",
      "scheduledEnd",
      "isAllDay",
      "recurrence",
      "reminders",
      "scheduleTimezone",
      "assignee",
      "agentBlocked",
      "agentStatus",
      "runInTarget",
      "runInLocalPath",
      "runInBaseBranch",
      "runInWorktreePath",
      "runInEnvironmentPath",
      "beforeBlockId",
      "beforeViewPageId",
      "richTitle",
    ],
  );
  const title = readString(operation, "title", label, MAX_PAGE_TITLE_LENGTH);
  if (!title.trim()) {
    throw new PageLifecycleContractError(`${label}.title cannot be blank`);
  }
  const nfm = readString(operation, "nfm", label, MAX_PAGE_DESCRIPTION_LENGTH, {
    allowEmpty: true,
  });
  let richTitle: PortableRichText | undefined;
  if (operation.richTitle !== undefined) {
    try {
      richTitle = canonicalizePortableRichText(operation.richTitle);
    } catch (error) {
      if (!(error instanceof PortableRichTextError)) throw error;
      throw new PageLifecycleContractError(
        `${label}.richTitle is invalid: ${error.message}`,
      );
    }
    if (portableRichTextPlainText(richTitle) !== title) {
      throw new PageLifecycleContractError(
        `${label}.title must equal the richTitle plain-text projection`,
      );
    }
  }
  if (!isWorkflowStatus(operation.status)) {
    throw new PageLifecycleContractError(`${label}.status is invalid`);
  }
  if (
    operation.priority !== undefined &&
    operation.priority !== null &&
    !isPriority(operation.priority)
  ) {
    throw new PageLifecycleContractError(`${label}.priority is invalid`);
  }
  if (
    operation.estimate !== undefined &&
    operation.estimate !== null &&
    !ESTIMATES.has(operation.estimate as Estimate)
  ) {
    throw new PageLifecycleContractError(`${label}.estimate is invalid`);
  }
  const tagsValue = operation.tags ?? [];
  if (
    !Array.isArray(tagsValue) ||
    tagsValue.length > MAX_PAGE_TAG_COUNT ||
    !tagsValue.every(
      (tag) =>
        typeof tag === "string" &&
        tag.length > 0 &&
        tag.length <= MAX_PAGE_TAG_LENGTH,
    )
  ) {
    throw new PageLifecycleContractError(`${label}.tags is invalid`);
  }
  const tags = [...new Set(tagsValue)].sort();
  const scheduledStart = readCanonicalDateTime(
    operation.scheduledStart,
    `${label}.scheduledStart`,
  );
  const scheduledEnd = readCanonicalDateTime(
    operation.scheduledEnd,
    `${label}.scheduledEnd`,
  );
  if ((scheduledStart === null) !== (scheduledEnd === null)) {
    throw new PageLifecycleContractError(
      `${label}.scheduledStart and scheduledEnd must be set together`,
    );
  }
  if (
    scheduledStart !== null &&
    scheduledEnd !== null &&
    scheduledEnd <= scheduledStart
  ) {
    throw new PageLifecycleContractError(
      `${label}.scheduledEnd must be after scheduledStart`,
    );
  }
  const isAllDay = operation.isAllDay ?? false;
  if (typeof isAllDay !== "boolean") {
    throw new PageLifecycleContractError(`${label}.isAllDay must be a boolean`);
  }
  if (isAllDay && scheduledStart === null) {
    throw new PageLifecycleContractError(
      `${label}.isAllDay requires a scheduled range`,
    );
  }
  const scheduleTimezone = readNullableString(
    operation,
    "scheduleTimezone",
    label,
    MAX_TIMEZONE_LENGTH,
  );
  if (scheduleTimezone !== null) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: scheduleTimezone });
    } catch {
      throw new PageLifecycleContractError(
        `${label}.scheduleTimezone is invalid`,
      );
    }
  }
  const runInTarget = operation.runInTarget ?? "localProject";
  if (!RUN_TARGETS.has(runInTarget as PageRunInTarget)) {
    throw new PageLifecycleContractError(`${label}.runInTarget is invalid`);
  }
  return {
    kind: "create_page",
    pageId: readId(operation, "pageId", label),
    title,
    ...(richTitle ? { richTitle } : {}),
    nfm,
    status: operation.status,
    priority: (operation.priority as Priority | null | undefined) ?? null,
    estimate: (operation.estimate as Estimate | null | undefined) ?? null,
    tags,
    dueDate: readCanonicalDate(operation.dueDate, `${label}.dueDate`),
    scheduledStart,
    scheduledEnd,
    isAllDay,
    recurrence: readRecurrence(operation.recurrence),
    reminders: readReminders(operation.reminders),
    scheduleTimezone,
    assignee: readNullableString(
      operation,
      "assignee",
      label,
      MAX_PAGE_ASSIGNEE_LENGTH,
    ),
    runInTarget: runInTarget as PageRunInTarget,
    runInLocalPath: readNullableString(
      operation,
      "runInLocalPath",
      label,
      MAX_PATH_LENGTH,
    ),
    runInBaseBranch: readNullableString(
      operation,
      "runInBaseBranch",
      label,
      MAX_PATH_LENGTH,
    ),
    runInWorktreePath: readNullableString(
      operation,
      "runInWorktreePath",
      label,
      MAX_PATH_LENGTH,
    ),
    runInEnvironmentPath: readNullableString(
      operation,
      "runInEnvironmentPath",
      label,
      MAX_PATH_LENGTH,
    ),
    ...(readOptionalId(operation, "beforeBlockId", label) === undefined
      ? {}
      : { beforeBlockId: readOptionalId(operation, "beforeBlockId", label) }),
    ...(readOptionalId(operation, "beforeViewPageId", label) === undefined
      ? {}
      : {
          beforeViewPageId: readOptionalId(
            operation,
            "beforeViewPageId",
            label,
          ),
        }),
  };
};

const parseOperation = (value: unknown): PageLifecycleOperation => {
  const operation = readRecord(value, "pageLifecycle.operation");
  if (operation.kind === "create_page") return parseCreate(operation);
  if (
    operation.kind === "archive_page" ||
    operation.kind === "unarchive_page"
  ) {
    assertExactKeys(operation, "pageLifecycle.operation", [
      "kind",
      "pageId",
      "expectedMetadataRevision",
    ]);
    return {
      kind: operation.kind,
      pageId: readId(operation, "pageId", "pageLifecycle.operation"),
      expectedMetadataRevision: readRevision(
        operation,
        "expectedMetadataRevision",
        "pageLifecycle.operation",
      ),
    };
  }
  if (operation.kind === "delete_page") {
    assertExactKeys(operation, "pageLifecycle.operation", [
      "kind",
      "pageId",
      "expectedMetadataRevision",
      "expectedParentRevision",
    ]);
    return {
      kind: "delete_page",
      pageId: readId(operation, "pageId", "pageLifecycle.operation"),
      expectedMetadataRevision: readRevision(
        operation,
        "expectedMetadataRevision",
        "pageLifecycle.operation",
      ),
      expectedParentRevision: readRevision(
        operation,
        "expectedParentRevision",
        "pageLifecycle.operation",
      ),
    };
  }
  if (operation.kind === "restore_page") {
    assertExactKeys(
      operation,
      "pageLifecycle.operation",
      [
        "kind",
        "pageId",
        "deleteOperationId",
        "expectedMetadataRevision",
        "expectedParentRevision",
        "membership",
      ],
      ["beforeBlockId"],
    );
    let membership: RestorePageOperation["membership"];
    if (operation.membership === null) {
      membership = null;
    } else {
      const candidate = readRecord(
        operation.membership,
        "pageLifecycle.operation.membership",
      );
      assertExactKeys(
        candidate,
        "pageLifecycle.operation.membership",
        ["membershipId", "databaseId", "dataSourceId", "status", "position"],
      );
      if (!isWorkflowStatus(candidate.status)) {
        throw new PageLifecycleContractError(
          "pageLifecycle.operation.membership.status is invalid",
        );
      }
      let position: Exclude<
        RestorePageOperation["membership"],
        null
      >["position"];
      if (candidate.position === undefined) {
        throw new PageLifecycleContractError(
          "pageLifecycle.operation.membership.position must be null or an object",
        );
      }
      if (candidate.position === null) {
        position = null;
      } else {
        const positionCandidate = readRecord(
          candidate.position,
          "pageLifecycle.operation.membership.position",
        );
        assertExactKeys(
          positionCandidate,
          "pageLifecycle.operation.membership.position",
          ["viewId"],
          ["beforeViewPageId"],
        );
        const beforeViewPageId = readOptionalId(
          positionCandidate,
          "beforeViewPageId",
          "pageLifecycle.operation.membership.position",
        );
        position = {
          viewId: readId(
            positionCandidate,
            "viewId",
            "pageLifecycle.operation.membership.position",
          ),
          ...(beforeViewPageId === undefined ? {} : { beforeViewPageId }),
        };
      }
      membership = {
        membershipId: readId(
          candidate,
          "membershipId",
          "pageLifecycle.operation.membership",
        ),
        databaseId: readId(
          candidate,
          "databaseId",
          "pageLifecycle.operation.membership",
        ),
        dataSourceId: readId(
          candidate,
          "dataSourceId",
          "pageLifecycle.operation.membership",
        ),
        status: candidate.status,
        position,
      };
    }
    if (operation.membership === undefined) {
      throw new PageLifecycleContractError(
        "pageLifecycle.operation.membership must be null or an object",
      );
    }
    const beforeBlockId = readOptionalId(
      operation,
      "beforeBlockId",
      "pageLifecycle.operation",
    );
    return {
      kind: "restore_page",
      pageId: readId(operation, "pageId", "pageLifecycle.operation"),
      deleteOperationId: readId(
        operation,
        "deleteOperationId",
        "pageLifecycle.operation",
      ),
      expectedMetadataRevision: readRevision(
        operation,
        "expectedMetadataRevision",
        "pageLifecycle.operation",
      ),
      expectedParentRevision: readRevision(
        operation,
        "expectedParentRevision",
        "pageLifecycle.operation",
      ),
      membership,
      ...(beforeBlockId === undefined ? {} : { beforeBlockId }),
    };
  }
  if (operation.kind === "move_page_in_library") {
    assertExactKeys(
      operation,
      "pageLifecycle.operation",
      ["kind", "pageId", "expectedParentRevision"],
      ["beforeBlockId"],
    );
    const beforeBlockId = readOptionalId(
      operation,
      "beforeBlockId",
      "pageLifecycle.operation",
    );
    return {
      kind: "move_page_in_library",
      pageId: readId(operation, "pageId", "pageLifecycle.operation"),
      expectedParentRevision: readRevision(
        operation,
        "expectedParentRevision",
        "pageLifecycle.operation",
      ),
      ...(beforeBlockId === undefined ? {} : { beforeBlockId }),
    };
  }
  throw new PageLifecycleContractError(
    "pageLifecycle.operation.kind is not supported",
  );
};

export const parsePageLifecycleMutationRequest = (
  value: unknown,
): PageLifecycleMutationRequest => {
  const request = readRecord(value, "pageLifecycle");
  assertExactKeys(
    request,
    "pageLifecycle",
    ["version", "operationId", "projectId", "storeEpoch", "actor", "operation"],
    ["clientSessionId"],
  );
  if (request.version !== PAGE_LIFECYCLE_CONTRACT_VERSION) {
    throw new PageLifecycleContractError(
      `pageLifecycle.version must be ${PAGE_LIFECYCLE_CONTRACT_VERSION}`,
    );
  }
  const clientSessionId = readOptionalId(
    request,
    "clientSessionId",
    "pageLifecycle",
  );
  const parsed: PageLifecycleMutationRequest = {
    version: PAGE_LIFECYCLE_CONTRACT_VERSION,
    operationId: readId(request, "operationId", "pageLifecycle"),
    projectId: readId(request, "projectId", "pageLifecycle"),
    storeEpoch: readId(request, "storeEpoch", "pageLifecycle"),
    ...(clientSessionId === undefined ? {} : { clientSessionId }),
    actor: readActor(request.actor),
    operation: parseOperation(request.operation),
  };
  const canonicalIntent = stableStringifyBlockPropertyJson({
    version: parsed.version,
    operationId: parsed.operationId,
    projectId: parsed.projectId,
    storeEpoch: parsed.storeEpoch,
    operation: parsed.operation,
  });
  if (canonicalIntent.length <= MAX_CANONICAL_REQUEST_LENGTH) return parsed;
  throw new PageLifecycleContractError(
    "pageLifecycle exceeds the canonical request size limit",
  );
};

export const canonicalizePageLifecycleMutationRequest = (
  value: unknown,
): string => {
  const request = parsePageLifecycleMutationRequest(value);
  const canonical = stableStringifyBlockPropertyJson({
    version: request.version,
    operationId: request.operationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    operation: request.operation,
  });
  if (canonical.length <= MAX_CANONICAL_REQUEST_LENGTH) return canonical;
  throw new PageLifecycleContractError(
    "pageLifecycle exceeds the canonical request size limit",
  );
};

const readBoolean = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): boolean => {
  if (typeof value[key] === "boolean") return value[key];
  throw new PageLifecycleContractError(`${label}.${key} must be a boolean`);
};

const readNullableId = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string | null => {
  if (value[key] === null) return null;
  return readId(value, key, label);
};

const readNullableRank = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string | null => {
  if (value[key] === null) return null;
  const rankKey = readId(value, key, label);
  if (isFractionalRankKey(rankKey)) return rankKey;
  throw new PageLifecycleContractError(
    `${label}.${key} must be a canonical fractional rank or null`,
  );
};

export const parsePageLifecycleMutationReceipt = (
  value: unknown,
): PageLifecycleMutationReceipt => {
  const receipt = readRecord(value, "pageLifecycleReceipt");
  assertExactKeys(receipt, "pageLifecycleReceipt", [
    "version",
    "operationId",
    "projectId",
    "storeEpoch",
    "operationKind",
    "pageId",
    "duplicate",
    "metadataRevision",
    "parentRevision",
    "lifecycle",
    "documentId",
    "documentGeneration",
    "documentHeadSeq",
    "databaseId",
    "dataSourceId",
    "membershipId",
    "viewId",
    "libraryRankKey",
    "viewRankKey",
    "createdBlockIds",
    "commitSeq",
    "committedAt",
  ]);
  if (receipt.version !== PAGE_LIFECYCLE_CONTRACT_VERSION) {
    throw new PageLifecycleContractError(
      `pageLifecycleReceipt.version must be ${PAGE_LIFECYCLE_CONTRACT_VERSION}`,
    );
  }
  const operationKinds = new Set<PageLifecycleOperation["kind"]>([
    "create_page",
    "archive_page",
    "unarchive_page",
    "delete_page",
    "restore_page",
    "move_page_in_library",
  ]);
  if (
    !operationKinds.has(receipt.operationKind as PageLifecycleOperation["kind"])
  ) {
    throw new PageLifecycleContractError(
      "pageLifecycleReceipt.operationKind is invalid",
    );
  }
  if (
    receipt.lifecycle !== "active" &&
    receipt.lifecycle !== "archived" &&
    receipt.lifecycle !== "deleted"
  ) {
    throw new PageLifecycleContractError(
      "pageLifecycleReceipt.lifecycle is invalid",
    );
  }
  if (
    !Array.isArray(receipt.createdBlockIds) ||
    !receipt.createdBlockIds.every(
      (blockId) =>
        typeof blockId === "string" &&
        blockId.length > 0 &&
        blockId.length <= MAX_ID_LENGTH &&
        blockId === blockId.trim(),
    ) ||
    new Set(receipt.createdBlockIds).size !== receipt.createdBlockIds.length
  ) {
    throw new PageLifecycleContractError(
      "pageLifecycleReceipt.createdBlockIds is invalid",
    );
  }
  const committedAt = readString(
    receipt,
    "committedAt",
    "pageLifecycleReceipt",
    128,
  );
  const committedDate = new Date(committedAt);
  if (
    Number.isNaN(committedDate.getTime()) ||
    committedDate.toISOString() !== committedAt
  ) {
    throw new PageLifecycleContractError(
      "pageLifecycleReceipt.committedAt must be canonical ISO time",
    );
  }
  return {
    version: PAGE_LIFECYCLE_CONTRACT_VERSION,
    operationId: readId(receipt, "operationId", "pageLifecycleReceipt"),
    projectId: readId(receipt, "projectId", "pageLifecycleReceipt"),
    storeEpoch: readId(receipt, "storeEpoch", "pageLifecycleReceipt"),
    operationKind: receipt.operationKind as PageLifecycleOperation["kind"],
    pageId: readId(receipt, "pageId", "pageLifecycleReceipt"),
    duplicate: readBoolean(receipt, "duplicate", "pageLifecycleReceipt"),
    metadataRevision: readRevision(
      receipt,
      "metadataRevision",
      "pageLifecycleReceipt",
    ),
    parentRevision: readRevision(
      receipt,
      "parentRevision",
      "pageLifecycleReceipt",
    ),
    lifecycle: receipt.lifecycle,
    documentId: readId(receipt, "documentId", "pageLifecycleReceipt"),
    documentGeneration: readRevision(
      receipt,
      "documentGeneration",
      "pageLifecycleReceipt",
    ),
    documentHeadSeq: readRevision(
      receipt,
      "documentHeadSeq",
      "pageLifecycleReceipt",
    ),
    databaseId: readNullableId(
      receipt,
      "databaseId",
      "pageLifecycleReceipt",
    ),
    dataSourceId: readNullableId(
      receipt,
      "dataSourceId",
      "pageLifecycleReceipt",
    ),
    membershipId: readNullableId(
      receipt,
      "membershipId",
      "pageLifecycleReceipt",
    ),
    viewId: readNullableId(receipt, "viewId", "pageLifecycleReceipt"),
    libraryRankKey: readNullableRank(
      receipt,
      "libraryRankKey",
      "pageLifecycleReceipt",
    ),
    viewRankKey: readNullableRank(
      receipt,
      "viewRankKey",
      "pageLifecycleReceipt",
    ),
    createdBlockIds: [...receipt.createdBlockIds],
    commitSeq: readRevision(receipt, "commitSeq", "pageLifecycleReceipt"),
    committedAt,
  };
};

export const parsePageLifecycleMutationCommandError = (
  value: unknown,
): PageLifecycleMutationCommandError => {
  const error = readRecord(value, "pageLifecycleError");
  assertExactKeys(
    error,
    "pageLifecycleError",
    ["code", "message", "retryable"],
    ["operationId", "pageId", "expectedRevision", "actualRevision"],
  );
  const codes = new Set<PageLifecycleMutationErrorCode>([
    "invalid_page_lifecycle_request",
    "store_epoch_mismatch",
    "operation_id_collision",
    "operation_receipt_corrupt",
    "project_not_found",
    "page_identity_collision",
    "page_not_found",
    "page_type_mismatch",
    "page_lifecycle_conflict",
    "metadata_revision_conflict",
    "parent_revision_conflict",
    "page_parent_invalid",
    "position_anchor_not_found",
    "position_anchor_group_mismatch",
    "primary_database_not_found",
    "database_schema_invalid",
    "database_property_value_invalid",
    "membership_not_found",
    "view_not_found",
    "delete_evidence_invalid",
    "document_state_corrupt",
    "unknown",
  ]);
  if (!codes.has(error.code as PageLifecycleMutationErrorCode)) {
    throw new PageLifecycleContractError("pageLifecycleError.code is invalid");
  }
  const operationId = readOptionalId(
    error,
    "operationId",
    "pageLifecycleError",
  );
  const pageId = readOptionalId(error, "pageId", "pageLifecycleError");
  const expectedRevision =
    error.expectedRevision === undefined
      ? undefined
      : readRevision(error, "expectedRevision", "pageLifecycleError");
  const actualRevision =
    error.actualRevision === undefined
      ? undefined
      : readRevision(error, "actualRevision", "pageLifecycleError");
  return {
    code: error.code as PageLifecycleMutationErrorCode,
    message: readString(error, "message", "pageLifecycleError", 10_000, {
      allowEmpty: false,
    }),
    retryable: readBoolean(error, "retryable", "pageLifecycleError"),
    ...(operationId === undefined ? {} : { operationId }),
    ...(pageId === undefined ? {} : { pageId }),
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    ...(actualRevision === undefined ? {} : { actualRevision }),
  };
};

export const parsePageLifecycleMutationCommandResult = (
  value: unknown,
): PageLifecycleMutationCommandResult => {
  const result = readRecord(value, "pageLifecycleResult");
  if (result.ok === true) {
    assertExactKeys(result, "pageLifecycleResult", ["ok", "value"]);
    return { ok: true, value: parsePageLifecycleMutationReceipt(result.value) };
  }
  if (result.ok === false) {
    assertExactKeys(result, "pageLifecycleResult", ["ok", "error"]);
    return {
      ok: false,
      error: parsePageLifecycleMutationCommandError(result.error),
    };
  }
  throw new PageLifecycleContractError(
    "pageLifecycleResult.ok must be a boolean",
  );
};
