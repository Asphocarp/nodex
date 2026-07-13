import type {
  CardDetail,
  CardDetailMembership,
} from "../../shared/card-detail";
import type {
  CardDatabaseMetadataField,
  CardIntrinsicMetadataField,
  CardMetadataPropertyCoordinate,
} from "../../shared/card-metadata-property-compiler";
import { isCardStatus, type CardStatus } from "../../shared/card-status";
import type {
  CardRunInTarget,
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
const RUN_TARGETS = new Set<CardRunInTarget>([
  "localProject",
  "newWorktree",
  "cloud",
]);

export interface CardStageCoreCard {
  readonly id: string;
  readonly archived: boolean;
  readonly title: string;
  readonly richTitle: PortableRichText;
  readonly isAllDay: boolean;
  readonly recurrence?: RecurrenceConfig;
  readonly reminders: readonly ReminderConfig[];
  readonly scheduleTimezone?: string;
  readonly agentBlocked: boolean;
  readonly agentStatus?: string;
  readonly runInTarget?: CardRunInTarget;
  readonly runInLocalPath?: string;
  readonly runInBaseBranch?: string;
  readonly runInWorktreePath?: string;
  readonly runInEnvironmentPath?: string;
  readonly revision: number;
  readonly created: Date;
}

export interface CardStageDatabaseProperties {
  readonly status: CardStatus;
  readonly priority?: Priority;
  readonly estimate?: Estimate;
  readonly tags: readonly string[];
  readonly dueDate?: Date;
  readonly scheduledStart?: Date;
  readonly scheduledEnd?: Date;
  readonly assignee?: string;
}

export type CardStageDatabaseContext =
  | { readonly kind: "standalone" }
  | {
      readonly kind: "member";
      readonly membership: CardDetailMembership;
      /**
       * Current Card Stage compatibility controls require the full seeded
       * property family. A generic Database with another schema remains a
       * truthful member but does not receive fabricated compatibility fields.
       */
      readonly compatibilityProperties: CardStageDatabaseProperties | null;
    };

export interface CardStageCardModel {
  readonly card: CardStageCoreCard;
  readonly databaseContext: CardStageDatabaseContext;
}

export type CardStageMetadataMutationResult =
  | { readonly status: "updated"; readonly didMutate: boolean }
  | { readonly status: "conflict" }
  | { readonly status: "not_found" }
  | { readonly status: "error"; readonly error: string };

export class CardStageCardProjectionError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "CardStageCardProjectionError";
  }
}

const findField = (
  detail: CardDetail,
  field: CardIntrinsicMetadataField | CardDatabaseMetadataField,
): CardMetadataPropertyCoordinate | null =>
  detail.properties.fields.find((candidate) => candidate.field === field) ??
  null;

const requireIntrinsic = (
  detail: CardDetail,
  field: CardIntrinsicMetadataField,
): CardMetadataPropertyCoordinate & { readonly scope: "intrinsic" } => {
  const coordinate = findField(detail, field);
  if (coordinate?.scope === "intrinsic") return coordinate;
  throw new CardStageCardProjectionError(
    `Card ${detail.card.blockId} is missing intrinsic field ${field}`,
  );
};

const optionalString = (value: unknown, label: string): string | undefined => {
  if (value === null) return undefined;
  if (typeof value === "string") return value || undefined;
  throw new CardStageCardProjectionError(`${label} must be a string or null`);
};

const requireBoolean = (value: unknown, label: string): boolean => {
  if (typeof value === "boolean") return value;
  throw new CardStageCardProjectionError(`${label} must be a boolean`);
};

const requireDate = (value: unknown, label: string): Date | undefined => {
  if (value === null) return undefined;
  if (typeof value !== "string") {
    throw new CardStageCardProjectionError(`${label} must be a date string or null`);
  }
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(date.getTime())) {
    throw new CardStageCardProjectionError(`${label} must be a valid date string`);
  }
  return date;
};

const recurrence = (value: unknown): RecurrenceConfig | undefined => {
  if (value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CardStageCardProjectionError(
      "Card recurrence must be an object or null",
    );
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (
    candidate.frequency !== "daily" &&
    candidate.frequency !== "weekly" &&
    candidate.frequency !== "monthly" &&
    candidate.frequency !== "yearly"
  ) {
    throw new CardStageCardProjectionError("Card recurrence frequency is invalid");
  }
  if (!Number.isInteger(candidate.interval) || (candidate.interval as number) < 1) {
    throw new CardStageCardProjectionError("Card recurrence interval is invalid");
  }
  return value as RecurrenceConfig;
};

const reminders = (value: unknown): readonly ReminderConfig[] => {
  if (!Array.isArray(value)) {
    throw new CardStageCardProjectionError("Card reminders must be an array");
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
    throw new CardStageCardProjectionError(
      `Card reminder ${index} is invalid`,
    );
  });
};

const readCompatibilityDatabaseProperties = (
  detail: CardDetail,
): CardStageDatabaseProperties | null => {
  const fields = new Map(
    detail.properties.fields
      .filter((field) => field.scope === "database")
      .map((field) => [field.field, field] as const),
  );
  const requiredFields = [
    "status",
    "priority",
    "estimate",
    "tags",
    "dueDate",
    "scheduledStart",
    "scheduledEnd",
    "assignee",
  ] as const satisfies readonly CardDatabaseMetadataField[];
  if (requiredFields.some((field) => !fields.has(field))) return null;

  const value = (field: CardDatabaseMetadataField): unknown =>
    fields.get(field)?.value;
  const status = value("status");
  if (!isCardStatus(status)) {
    throw new CardStageCardProjectionError("Card Database status is invalid");
  }
  const priorityValue = value("priority");
  if (priorityValue !== null && !PRIORITIES.has(priorityValue as Priority)) {
    throw new CardStageCardProjectionError("Card Database priority is invalid");
  }
  const estimateValue = value("estimate");
  if (estimateValue !== null && !ESTIMATES.has(estimateValue as Estimate)) {
    throw new CardStageCardProjectionError("Card Database estimate is invalid");
  }
  const tagsValue = value("tags");
  if (!Array.isArray(tagsValue) || tagsValue.some((tag) => typeof tag !== "string")) {
    throw new CardStageCardProjectionError("Card Database tags are invalid");
  }
  const assigneeValue = value("assignee");
  const dueDate = requireDate(value("dueDate"), "Card due date");
  const scheduledStart = requireDate(
    value("scheduledStart"),
    "Card scheduled start",
  );
  const scheduledEnd = requireDate(
    value("scheduledEnd"),
    "Card scheduled end",
  );
  const assignee = optionalString(assigneeValue, "Card assignee");
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

export const projectCardDetailToStageModel = (
  detail: CardDetail,
): CardStageCardModel => {
  const runTargetValue = requireIntrinsic(detail, "runInTarget").value;
  if (runTargetValue !== null && !RUN_TARGETS.has(runTargetValue as CardRunInTarget)) {
    throw new CardStageCardProjectionError("Card run target is invalid");
  }
  const created = new Date(detail.card.createdAt);
  if (Number.isNaN(created.getTime())) {
    throw new CardStageCardProjectionError("Card created timestamp is invalid");
  }
  const content = detail.card.content;
  const card: CardStageCoreCard = {
    id: detail.card.blockId,
    archived: detail.card.lifecycle === "archived",
    title: content?.title ?? "",
    richTitle: content?.richTitle ?? [],
    isAllDay: requireBoolean(
      requireIntrinsic(detail, "isAllDay").value,
      "Card all-day state",
    ),
    recurrence: recurrence(requireIntrinsic(detail, "recurrence").value),
    reminders: reminders(requireIntrinsic(detail, "reminders").value),
    scheduleTimezone: optionalString(
      requireIntrinsic(detail, "scheduleTimezone").value,
      "Card schedule timezone",
    ),
    agentBlocked: requireBoolean(
      requireIntrinsic(detail, "agentBlocked").value,
      "Card Agent blocked state",
    ),
    agentStatus: optionalString(
      requireIntrinsic(detail, "agentStatus").value,
      "Card Agent status",
    ),
    ...(runTargetValue === null
      ? {}
      : { runInTarget: runTargetValue as CardRunInTarget }),
    runInLocalPath: optionalString(
      requireIntrinsic(detail, "runInLocalPath").value,
      "Card local path",
    ),
    runInBaseBranch: optionalString(
      requireIntrinsic(detail, "runInBaseBranch").value,
      "Card base branch",
    ),
    runInWorktreePath: optionalString(
      requireIntrinsic(detail, "runInWorktreePath").value,
      "Card worktree path",
    ),
    runInEnvironmentPath: optionalString(
      requireIntrinsic(detail, "runInEnvironmentPath").value,
      "Card environment path",
    ),
    revision: detail.card.metadataRevision,
    created,
  };

  if (detail.databaseContext.kind === "standalone") {
    return { card, databaseContext: { kind: "standalone" } };
  }
  return {
    card,
    databaseContext: {
      kind: "member",
      membership: detail.databaseContext.membership,
      compatibilityProperties: readCompatibilityDatabaseProperties(detail),
    },
  };
};
