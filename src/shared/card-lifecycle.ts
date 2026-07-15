import {
  stableStringifyBlockPropertyJson,
  type BlockPropertyJsonValue,
} from "./block-property-mutations";
import {
  MAX_CARD_ASSIGNEE_LENGTH,
  MAX_CARD_DESCRIPTION_LENGTH,
  MAX_CARD_TAG_COUNT,
  MAX_CARD_TAG_LENGTH,
  MAX_CARD_TITLE_LENGTH,
} from "./card-limits";
import { isCardStatus, type CardStatus } from "./card-status";
import { isFractionalRankKey } from "./fractional-rank";
import type {
  CardRunInTarget,
  Estimate,
  Priority,
  RecurrenceConfig,
  ReminderConfig,
} from "./types";

export const CARD_LIFECYCLE_CONTRACT_VERSION = 1 as const;

const MAX_ID_LENGTH = 512;
const MAX_PATH_LENGTH = 32_768;
const MAX_TIMEZONE_LENGTH = 256;
const MAX_ACTOR_JSON_LENGTH = 1_000_000;
const MAX_CANONICAL_REQUEST_LENGTH = 2_000_000;
const MAX_REMINDERS = 10_000;
const PRIORITIES = new Set<Priority>([
  "p0-critical",
  "p1-high",
  "p2-medium",
  "p3-low",
  "p4-later",
]);
const ESTIMATES = new Set<Estimate>(["xs", "s", "m", "l", "xl"]);
const RUN_TARGETS = new Set<CardRunInTarget>([
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

export interface CreateCardBlockOperation {
  readonly kind: "create_card";
  /** Application identity is allocated before enqueue so retry stays exact. */
  readonly cardId: string;
  readonly title: string;
  readonly nfm: string;
  readonly status: CardStatus;
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
  readonly runInTarget: CardRunInTarget;
  readonly runInLocalPath: string | null;
  readonly runInBaseBranch: string | null;
  readonly runInWorktreePath: string | null;
  readonly runInEnvironmentPath: string | null;
  /** Missing appends to the Project's top-level Block order. */
  readonly beforeBlockId?: string;
  /** Missing appends to the status group in the primary Kanban View. */
  readonly beforeViewCardId?: string;
}

export interface ArchiveCardBlockOperation {
  readonly kind: "archive_card";
  readonly cardId: string;
  readonly expectedMetadataRevision: number;
}

export interface UnarchiveCardBlockOperation {
  readonly kind: "unarchive_card";
  readonly cardId: string;
  readonly expectedMetadataRevision: number;
}

export interface DeleteCardBlockOperation {
  readonly kind: "delete_card";
  readonly cardId: string;
  readonly expectedMetadataRevision: number;
  readonly expectedLocationRevision: number;
}

export interface RestoreCardBlockOperation {
  readonly kind: "restore_card";
  readonly cardId: string;
  /** Immutable delete receipt whose exact tombstone this command restores. */
  readonly deleteOperationId: string;
  readonly expectedMetadataRevision: number;
  readonly expectedLocationRevision: number;
  readonly membership: null | Readonly<{
    /** Restore reactivates this exact removed membership; it never copies a row. */
    membershipId: string;
    databaseBlockId: string;
    viewId: string;
    status: CardStatus;
    beforeViewCardId?: string;
  }>;
  readonly beforeBlockId?: string;
}

export interface MoveCardBlockInSpaceOperation {
  readonly kind: "move_card_in_space";
  readonly cardId: string;
  readonly expectedLocationRevision: number;
  readonly beforeBlockId?: string;
}

export type CardLifecycleOperation =
  | CreateCardBlockOperation
  | ArchiveCardBlockOperation
  | UnarchiveCardBlockOperation
  | DeleteCardBlockOperation
  | RestoreCardBlockOperation
  | MoveCardBlockInSpaceOperation;

export interface CardLifecycleMutationRequest {
  readonly version: typeof CARD_LIFECYCLE_CONTRACT_VERSION;
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly clientSessionId?: string;
  readonly actor: Readonly<Record<string, BlockPropertyJsonValue>>;
  readonly operation: CardLifecycleOperation;
}

export interface CardLifecycleMutationReceipt {
  readonly version: typeof CARD_LIFECYCLE_CONTRACT_VERSION;
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly operationKind: CardLifecycleOperation["kind"];
  readonly cardId: string;
  readonly duplicate: boolean;
  readonly metadataRevision: number;
  readonly locationRevision: number;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly documentId: string;
  readonly documentGeneration: number;
  readonly documentHeadSeq: number;
  readonly databaseBlockId: string | null;
  readonly membershipId: string | null;
  readonly viewId: string | null;
  readonly topLevelRankKey: string | null;
  readonly viewRankKey: string | null;
  readonly createdBlockIds: readonly string[];
  readonly changeLogSeq: number;
  readonly committedAt: string;
}

export type CardLifecycleMutationErrorCode =
  | "invalid_card_lifecycle_request"
  | "store_epoch_mismatch"
  | "operation_id_collision"
  | "operation_receipt_corrupt"
  | "project_not_found"
  | "card_identity_collision"
  | "card_not_found"
  | "card_type_mismatch"
  | "card_lifecycle_conflict"
  | "metadata_revision_conflict"
  | "location_revision_conflict"
  | "card_location_invalid"
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

export interface CardLifecycleMutationCommandError {
  readonly code: CardLifecycleMutationErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly operationId?: string;
  readonly cardId?: string;
  readonly expectedRevision?: number;
  readonly actualRevision?: number;
}

export type CardLifecycleMutationCommandResult =
  | { readonly ok: true; readonly value: CardLifecycleMutationReceipt }
  | { readonly ok: false; readonly error: CardLifecycleMutationCommandError };

export class CardLifecycleContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardLifecycleContractError";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new CardLifecycleContractError(`${label} must be an object`);
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
    throw new CardLifecycleContractError(`${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    throw new CardLifecycleContractError(`${label}.${key} is not supported`);
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
  throw new CardLifecycleContractError(
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
  throw new CardLifecycleContractError(
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
  throw new CardLifecycleContractError(`${label} must be YYYY-MM-DD or null`);
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
  throw new CardLifecycleContractError(
    `${label} must be a canonical ISO timestamp or null`,
  );
};

const readRecurrence = (value: unknown): RecurrenceConfig | null => {
  if (value === undefined || value === null) return null;
  const recurrence = readRecord(value, "cardLifecycle.operation.recurrence");
  assertExactKeys(
    recurrence,
    "cardLifecycle.operation.recurrence",
    ["frequency", "interval"],
    ["byWeekdays", "endCondition"],
  );
  if (
    !RECURRENCE_FREQUENCIES.has(
      recurrence.frequency as RecurrenceConfig["frequency"],
    )
  ) {
    throw new CardLifecycleContractError(
      "cardLifecycle.operation.recurrence.frequency is invalid",
    );
  }
  if (
    typeof recurrence.interval !== "number" ||
    !Number.isSafeInteger(recurrence.interval) ||
    recurrence.interval < 1
  ) {
    throw new CardLifecycleContractError(
      "cardLifecycle.operation.recurrence.interval must be an integer >= 1",
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
      throw new CardLifecycleContractError(
        "cardLifecycle.operation.recurrence.byWeekdays must contain weekdays 0-6",
      );
    }
    byWeekdays = [...new Set(recurrence.byWeekdays)].sort(
      (left, right) => left - right,
    );
    if (byWeekdays.length !== recurrence.byWeekdays.length) {
      throw new CardLifecycleContractError(
        "cardLifecycle.operation.recurrence.byWeekdays must be unique",
      );
    }
  }
  if (recurrence.frequency === "weekly" && byWeekdays === undefined) {
    throw new CardLifecycleContractError(
      "weekly recurrence requires byWeekdays",
    );
  }
  let endCondition: RecurrenceConfig["endCondition"];
  if (recurrence.endCondition !== undefined) {
    const condition = readRecord(
      recurrence.endCondition,
      "cardLifecycle.operation.recurrence.endCondition",
    );
    if (condition.type === "never") {
      assertExactKeys(
        condition,
        "cardLifecycle.operation.recurrence.endCondition",
        ["type"],
      );
      endCondition = { type: "never" };
    } else if (condition.type === "untilDate") {
      assertExactKeys(
        condition,
        "cardLifecycle.operation.recurrence.endCondition",
        ["type", "untilDate"],
      );
      const untilDate = readCanonicalDate(
        condition.untilDate,
        "cardLifecycle.operation.recurrence.endCondition.untilDate",
      );
      if (untilDate === null) {
        throw new CardLifecycleContractError(
          "untilDate recurrence requires a date",
        );
      }
      endCondition = { type: "untilDate", untilDate };
    } else {
      throw new CardLifecycleContractError(
        "cardLifecycle.operation.recurrence.endCondition.type is invalid",
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
    throw new CardLifecycleContractError(
      "cardLifecycle.operation.reminders must be an array",
    );
  }
  if (value.length > MAX_REMINDERS) {
    throw new CardLifecycleContractError(
      `cardLifecycle.operation.reminders exceeds ${MAX_REMINDERS} items`,
    );
  }
  const offsets = value.map((entry, index) => {
    const reminder = readRecord(
      entry,
      `cardLifecycle.operation.reminders[${index}]`,
    );
    assertExactKeys(reminder, `cardLifecycle.operation.reminders[${index}]`, [
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
    throw new CardLifecycleContractError(
      `cardLifecycle.operation.reminders[${index}].offsetMinutes is invalid`,
    );
  });
  if (new Set(offsets).size !== offsets.length) {
    throw new CardLifecycleContractError(
      "cardLifecycle.operation.reminders must have unique offsets",
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
    throw new CardLifecycleContractError(
      "cardLifecycle.actor must be an object",
    );
  }
  let canonical: string;
  try {
    canonical = stableStringifyBlockPropertyJson(value);
  } catch (error) {
    throw new CardLifecycleContractError(
      `cardLifecycle.actor must contain bounded JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (canonical.length > MAX_ACTOR_JSON_LENGTH) {
    throw new CardLifecycleContractError(
      "cardLifecycle.actor exceeds the JSON size limit",
    );
  }
  return JSON.parse(canonical) as Readonly<
    Record<string, BlockPropertyJsonValue>
  >;
};

const parseCreate = (
  operation: Readonly<Record<string, unknown>>,
): CreateCardBlockOperation => {
  const label = "cardLifecycle.operation";
  assertExactKeys(
    operation,
    label,
    ["kind", "cardId", "title", "nfm", "status"],
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
      "beforeViewCardId",
    ],
  );
  const title = readString(operation, "title", label, MAX_CARD_TITLE_LENGTH);
  if (!title.trim()) {
    throw new CardLifecycleContractError(`${label}.title cannot be blank`);
  }
  const nfm = readString(operation, "nfm", label, MAX_CARD_DESCRIPTION_LENGTH, {
    allowEmpty: true,
  });
  if (!isCardStatus(operation.status)) {
    throw new CardLifecycleContractError(`${label}.status is invalid`);
  }
  if (
    operation.priority !== undefined &&
    operation.priority !== null &&
    !PRIORITIES.has(operation.priority as Priority)
  ) {
    throw new CardLifecycleContractError(`${label}.priority is invalid`);
  }
  if (
    operation.estimate !== undefined &&
    operation.estimate !== null &&
    !ESTIMATES.has(operation.estimate as Estimate)
  ) {
    throw new CardLifecycleContractError(`${label}.estimate is invalid`);
  }
  const tagsValue = operation.tags ?? [];
  if (
    !Array.isArray(tagsValue) ||
    tagsValue.length > MAX_CARD_TAG_COUNT ||
    !tagsValue.every(
      (tag) =>
        typeof tag === "string" &&
        tag.length > 0 &&
        tag.length <= MAX_CARD_TAG_LENGTH,
    )
  ) {
    throw new CardLifecycleContractError(`${label}.tags is invalid`);
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
    throw new CardLifecycleContractError(
      `${label}.scheduledStart and scheduledEnd must be set together`,
    );
  }
  if (
    scheduledStart !== null &&
    scheduledEnd !== null &&
    scheduledEnd <= scheduledStart
  ) {
    throw new CardLifecycleContractError(
      `${label}.scheduledEnd must be after scheduledStart`,
    );
  }
  const isAllDay = operation.isAllDay ?? false;
  if (typeof isAllDay !== "boolean") {
    throw new CardLifecycleContractError(`${label}.isAllDay must be a boolean`);
  }
  if (isAllDay && scheduledStart === null) {
    throw new CardLifecycleContractError(
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
      throw new CardLifecycleContractError(
        `${label}.scheduleTimezone is invalid`,
      );
    }
  }
  const runInTarget = operation.runInTarget ?? "localProject";
  if (!RUN_TARGETS.has(runInTarget as CardRunInTarget)) {
    throw new CardLifecycleContractError(`${label}.runInTarget is invalid`);
  }
  return {
    kind: "create_card",
    cardId: readId(operation, "cardId", label),
    title,
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
      MAX_CARD_ASSIGNEE_LENGTH,
    ),
    runInTarget: runInTarget as CardRunInTarget,
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
    ...(readOptionalId(operation, "beforeViewCardId", label) === undefined
      ? {}
      : {
          beforeViewCardId: readOptionalId(
            operation,
            "beforeViewCardId",
            label,
          ),
        }),
  };
};

const parseOperation = (value: unknown): CardLifecycleOperation => {
  const operation = readRecord(value, "cardLifecycle.operation");
  if (operation.kind === "create_card") return parseCreate(operation);
  if (
    operation.kind === "archive_card" ||
    operation.kind === "unarchive_card"
  ) {
    assertExactKeys(operation, "cardLifecycle.operation", [
      "kind",
      "cardId",
      "expectedMetadataRevision",
    ]);
    return {
      kind: operation.kind,
      cardId: readId(operation, "cardId", "cardLifecycle.operation"),
      expectedMetadataRevision: readRevision(
        operation,
        "expectedMetadataRevision",
        "cardLifecycle.operation",
      ),
    };
  }
  if (operation.kind === "delete_card") {
    assertExactKeys(operation, "cardLifecycle.operation", [
      "kind",
      "cardId",
      "expectedMetadataRevision",
      "expectedLocationRevision",
    ]);
    return {
      kind: "delete_card",
      cardId: readId(operation, "cardId", "cardLifecycle.operation"),
      expectedMetadataRevision: readRevision(
        operation,
        "expectedMetadataRevision",
        "cardLifecycle.operation",
      ),
      expectedLocationRevision: readRevision(
        operation,
        "expectedLocationRevision",
        "cardLifecycle.operation",
      ),
    };
  }
  if (operation.kind === "restore_card") {
    assertExactKeys(
      operation,
      "cardLifecycle.operation",
      [
        "kind",
        "cardId",
        "deleteOperationId",
        "expectedMetadataRevision",
        "expectedLocationRevision",
        "membership",
      ],
      ["beforeBlockId"],
    );
    let membership: RestoreCardBlockOperation["membership"];
    if (operation.membership === null) {
      membership = null;
    } else {
      const candidate = readRecord(
        operation.membership,
        "cardLifecycle.operation.membership",
      );
      assertExactKeys(
        candidate,
        "cardLifecycle.operation.membership",
        ["membershipId", "databaseBlockId", "viewId", "status"],
        ["beforeViewCardId"],
      );
      if (!isCardStatus(candidate.status)) {
        throw new CardLifecycleContractError(
          "cardLifecycle.operation.membership.status is invalid",
        );
      }
      const beforeViewCardId = readOptionalId(
        candidate,
        "beforeViewCardId",
        "cardLifecycle.operation.membership",
      );
      membership = {
        membershipId: readId(
          candidate,
          "membershipId",
          "cardLifecycle.operation.membership",
        ),
        databaseBlockId: readId(
          candidate,
          "databaseBlockId",
          "cardLifecycle.operation.membership",
        ),
        viewId: readId(
          candidate,
          "viewId",
          "cardLifecycle.operation.membership",
        ),
        status: candidate.status,
        ...(beforeViewCardId === undefined ? {} : { beforeViewCardId }),
      };
    }
    if (operation.membership === undefined) {
      throw new CardLifecycleContractError(
        "cardLifecycle.operation.membership must be null or an object",
      );
    }
    const beforeBlockId = readOptionalId(
      operation,
      "beforeBlockId",
      "cardLifecycle.operation",
    );
    return {
      kind: "restore_card",
      cardId: readId(operation, "cardId", "cardLifecycle.operation"),
      deleteOperationId: readId(
        operation,
        "deleteOperationId",
        "cardLifecycle.operation",
      ),
      expectedMetadataRevision: readRevision(
        operation,
        "expectedMetadataRevision",
        "cardLifecycle.operation",
      ),
      expectedLocationRevision: readRevision(
        operation,
        "expectedLocationRevision",
        "cardLifecycle.operation",
      ),
      membership,
      ...(beforeBlockId === undefined ? {} : { beforeBlockId }),
    };
  }
  if (operation.kind === "move_card_in_space") {
    assertExactKeys(
      operation,
      "cardLifecycle.operation",
      ["kind", "cardId", "expectedLocationRevision"],
      ["beforeBlockId"],
    );
    const beforeBlockId = readOptionalId(
      operation,
      "beforeBlockId",
      "cardLifecycle.operation",
    );
    return {
      kind: "move_card_in_space",
      cardId: readId(operation, "cardId", "cardLifecycle.operation"),
      expectedLocationRevision: readRevision(
        operation,
        "expectedLocationRevision",
        "cardLifecycle.operation",
      ),
      ...(beforeBlockId === undefined ? {} : { beforeBlockId }),
    };
  }
  throw new CardLifecycleContractError(
    "cardLifecycle.operation.kind is not supported",
  );
};

export const parseCardLifecycleMutationRequest = (
  value: unknown,
): CardLifecycleMutationRequest => {
  const request = readRecord(value, "cardLifecycle");
  assertExactKeys(
    request,
    "cardLifecycle",
    ["version", "operationId", "projectId", "storeEpoch", "actor", "operation"],
    ["clientSessionId"],
  );
  if (request.version !== CARD_LIFECYCLE_CONTRACT_VERSION) {
    throw new CardLifecycleContractError(
      `cardLifecycle.version must be ${CARD_LIFECYCLE_CONTRACT_VERSION}`,
    );
  }
  const clientSessionId = readOptionalId(
    request,
    "clientSessionId",
    "cardLifecycle",
  );
  const parsed: CardLifecycleMutationRequest = {
    version: CARD_LIFECYCLE_CONTRACT_VERSION,
    operationId: readId(request, "operationId", "cardLifecycle"),
    projectId: readId(request, "projectId", "cardLifecycle"),
    storeEpoch: readId(request, "storeEpoch", "cardLifecycle"),
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
  throw new CardLifecycleContractError(
    "cardLifecycle exceeds the canonical request size limit",
  );
};

export const canonicalizeCardLifecycleMutationRequest = (
  value: unknown,
): string => {
  const request = parseCardLifecycleMutationRequest(value);
  const canonical = stableStringifyBlockPropertyJson({
    version: request.version,
    operationId: request.operationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    operation: request.operation,
  });
  if (canonical.length <= MAX_CANONICAL_REQUEST_LENGTH) return canonical;
  throw new CardLifecycleContractError(
    "cardLifecycle exceeds the canonical request size limit",
  );
};

const readBoolean = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): boolean => {
  if (typeof value[key] === "boolean") return value[key];
  throw new CardLifecycleContractError(`${label}.${key} must be a boolean`);
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
  throw new CardLifecycleContractError(
    `${label}.${key} must be a canonical fractional rank or null`,
  );
};

export const parseCardLifecycleMutationReceipt = (
  value: unknown,
): CardLifecycleMutationReceipt => {
  const receipt = readRecord(value, "cardLifecycleReceipt");
  assertExactKeys(receipt, "cardLifecycleReceipt", [
    "version",
    "operationId",
    "projectId",
    "storeEpoch",
    "operationKind",
    "cardId",
    "duplicate",
    "metadataRevision",
    "locationRevision",
    "lifecycle",
    "documentId",
    "documentGeneration",
    "documentHeadSeq",
    "databaseBlockId",
    "membershipId",
    "viewId",
    "topLevelRankKey",
    "viewRankKey",
    "createdBlockIds",
    "changeLogSeq",
    "committedAt",
  ]);
  if (receipt.version !== CARD_LIFECYCLE_CONTRACT_VERSION) {
    throw new CardLifecycleContractError(
      `cardLifecycleReceipt.version must be ${CARD_LIFECYCLE_CONTRACT_VERSION}`,
    );
  }
  const operationKinds = new Set<CardLifecycleOperation["kind"]>([
    "create_card",
    "archive_card",
    "unarchive_card",
    "delete_card",
    "restore_card",
    "move_card_in_space",
  ]);
  if (
    !operationKinds.has(receipt.operationKind as CardLifecycleOperation["kind"])
  ) {
    throw new CardLifecycleContractError(
      "cardLifecycleReceipt.operationKind is invalid",
    );
  }
  if (
    receipt.lifecycle !== "active" &&
    receipt.lifecycle !== "archived" &&
    receipt.lifecycle !== "deleted"
  ) {
    throw new CardLifecycleContractError(
      "cardLifecycleReceipt.lifecycle is invalid",
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
    throw new CardLifecycleContractError(
      "cardLifecycleReceipt.createdBlockIds is invalid",
    );
  }
  const committedAt = readString(
    receipt,
    "committedAt",
    "cardLifecycleReceipt",
    128,
  );
  const committedDate = new Date(committedAt);
  if (
    Number.isNaN(committedDate.getTime()) ||
    committedDate.toISOString() !== committedAt
  ) {
    throw new CardLifecycleContractError(
      "cardLifecycleReceipt.committedAt must be canonical ISO time",
    );
  }
  return {
    version: CARD_LIFECYCLE_CONTRACT_VERSION,
    operationId: readId(receipt, "operationId", "cardLifecycleReceipt"),
    projectId: readId(receipt, "projectId", "cardLifecycleReceipt"),
    storeEpoch: readId(receipt, "storeEpoch", "cardLifecycleReceipt"),
    operationKind: receipt.operationKind as CardLifecycleOperation["kind"],
    cardId: readId(receipt, "cardId", "cardLifecycleReceipt"),
    duplicate: readBoolean(receipt, "duplicate", "cardLifecycleReceipt"),
    metadataRevision: readRevision(
      receipt,
      "metadataRevision",
      "cardLifecycleReceipt",
    ),
    locationRevision: readRevision(
      receipt,
      "locationRevision",
      "cardLifecycleReceipt",
    ),
    lifecycle: receipt.lifecycle,
    documentId: readId(receipt, "documentId", "cardLifecycleReceipt"),
    documentGeneration: readRevision(
      receipt,
      "documentGeneration",
      "cardLifecycleReceipt",
    ),
    documentHeadSeq: readRevision(
      receipt,
      "documentHeadSeq",
      "cardLifecycleReceipt",
    ),
    databaseBlockId: readNullableId(
      receipt,
      "databaseBlockId",
      "cardLifecycleReceipt",
    ),
    membershipId: readNullableId(
      receipt,
      "membershipId",
      "cardLifecycleReceipt",
    ),
    viewId: readNullableId(receipt, "viewId", "cardLifecycleReceipt"),
    topLevelRankKey: readNullableRank(
      receipt,
      "topLevelRankKey",
      "cardLifecycleReceipt",
    ),
    viewRankKey: readNullableRank(
      receipt,
      "viewRankKey",
      "cardLifecycleReceipt",
    ),
    createdBlockIds: [...receipt.createdBlockIds],
    changeLogSeq: readRevision(receipt, "changeLogSeq", "cardLifecycleReceipt"),
    committedAt,
  };
};

export const parseCardLifecycleMutationCommandError = (
  value: unknown,
): CardLifecycleMutationCommandError => {
  const error = readRecord(value, "cardLifecycleError");
  assertExactKeys(
    error,
    "cardLifecycleError",
    ["code", "message", "retryable"],
    ["operationId", "cardId", "expectedRevision", "actualRevision"],
  );
  const codes = new Set<CardLifecycleMutationErrorCode>([
    "invalid_card_lifecycle_request",
    "store_epoch_mismatch",
    "operation_id_collision",
    "operation_receipt_corrupt",
    "project_not_found",
    "card_identity_collision",
    "card_not_found",
    "card_type_mismatch",
    "card_lifecycle_conflict",
    "metadata_revision_conflict",
    "location_revision_conflict",
    "card_location_invalid",
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
  if (!codes.has(error.code as CardLifecycleMutationErrorCode)) {
    throw new CardLifecycleContractError("cardLifecycleError.code is invalid");
  }
  const operationId = readOptionalId(
    error,
    "operationId",
    "cardLifecycleError",
  );
  const cardId = readOptionalId(error, "cardId", "cardLifecycleError");
  const expectedRevision =
    error.expectedRevision === undefined
      ? undefined
      : readRevision(error, "expectedRevision", "cardLifecycleError");
  const actualRevision =
    error.actualRevision === undefined
      ? undefined
      : readRevision(error, "actualRevision", "cardLifecycleError");
  return {
    code: error.code as CardLifecycleMutationErrorCode,
    message: readString(error, "message", "cardLifecycleError", 10_000, {
      allowEmpty: false,
    }),
    retryable: readBoolean(error, "retryable", "cardLifecycleError"),
    ...(operationId === undefined ? {} : { operationId }),
    ...(cardId === undefined ? {} : { cardId }),
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    ...(actualRevision === undefined ? {} : { actualRevision }),
  };
};

export const parseCardLifecycleMutationCommandResult = (
  value: unknown,
): CardLifecycleMutationCommandResult => {
  const result = readRecord(value, "cardLifecycleResult");
  if (result.ok === true) {
    assertExactKeys(result, "cardLifecycleResult", ["ok", "value"]);
    return { ok: true, value: parseCardLifecycleMutationReceipt(result.value) };
  }
  if (result.ok === false) {
    assertExactKeys(result, "cardLifecycleResult", ["ok", "error"]);
    return {
      ok: false,
      error: parseCardLifecycleMutationCommandError(result.error),
    };
  }
  throw new CardLifecycleContractError(
    "cardLifecycleResult.ok must be a boolean",
  );
};
