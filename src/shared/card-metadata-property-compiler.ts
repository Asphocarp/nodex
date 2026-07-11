import {
  BLOCK_PROPERTY_MUTATION_CONTRACT_VERSION,
  parseBlockPropertyMutationRequest,
  stableStringifyBlockPropertyJson,
  type BlockPropertyJsonValue,
  type BlockPropertyMutationRequest,
} from "./block-property-mutations";
import { isCardStatus } from "./card-status";
import type { CardInput } from "./types";

export const CARD_METADATA_DATABASE_FIELDS = {
  status: { key: "status", valueType: "select" },
  priority: { key: "priority", valueType: "select" },
  estimate: { key: "estimate", valueType: "select" },
  tags: { key: "tags", valueType: "multi_select" },
  dueDate: { key: "due_date", valueType: "date" },
  scheduledStart: { key: "scheduled_start", valueType: "datetime" },
  scheduledEnd: { key: "scheduled_end", valueType: "datetime" },
  assignee: { key: "assignee", valueType: "person" },
} as const;

export const CARD_METADATA_INTRINSIC_FIELDS = {
  isAllDay: "schedule.isAllDay",
  recurrence: "recurrence.config",
  reminders: "reminders.config",
  scheduleTimezone: "schedule.timezone",
  agentBlocked: "agent.blocked",
  agentStatus: "agent.status",
  runInTarget: "run.target",
  runInLocalPath: "run.localPath",
  runInBaseBranch: "run.baseBranch",
  runInWorktreePath: "run.worktreePath",
  runInEnvironmentPath: "run.environmentPath",
} as const;

export type CardDatabaseMetadataField =
  keyof typeof CARD_METADATA_DATABASE_FIELDS;
export type CardIntrinsicMetadataField =
  keyof typeof CARD_METADATA_INTRINSIC_FIELDS;
export type CardMutableMetadataField =
  | CardDatabaseMetadataField
  | CardIntrinsicMetadataField;

export interface CardDatabasePropertyCoordinate {
  readonly scope: "database";
  readonly field: CardDatabaseMetadataField;
  readonly databaseBlockId: string;
  readonly propertyId: string;
  readonly revision: number;
  readonly value: BlockPropertyJsonValue;
}

export interface CardIntrinsicPropertyCoordinate {
  readonly scope: "intrinsic";
  readonly field: CardIntrinsicMetadataField;
  readonly revision: number;
  readonly value: BlockPropertyJsonValue;
}

export type CardMetadataPropertyCoordinate =
  | CardDatabasePropertyCoordinate
  | CardIntrinsicPropertyCoordinate;

/**
 * One consistent read coordinate for compatibility callers that still speak
 * Partial<CardInput>. Values and per-field revisions come from relational
 * authorities; the whole-Card metadata revision is display/freshness evidence
 * only and is never used as a write CAS.
 */
export interface CardMetadataPropertySnapshot {
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly changeLogSeq: number;
  readonly cardBlockId: string;
  readonly metadataRevision: number;
  readonly fields: readonly CardMetadataPropertyCoordinate[];
}

export class CardMetadataPropertyCompilerError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "CardMetadataPropertyCompilerError";
  }
}

const DATABASE_FIELDS = new Set<CardDatabaseMetadataField>(
  Object.keys(CARD_METADATA_DATABASE_FIELDS) as CardDatabaseMetadataField[],
);
const INTRINSIC_FIELDS = new Set<CardIntrinsicMetadataField>(
  Object.keys(CARD_METADATA_INTRINSIC_FIELDS) as CardIntrinsicMetadataField[],
);
const MUTABLE_FIELDS = new Set<CardMutableMetadataField>([
  ...DATABASE_FIELDS,
  ...INTRINSIC_FIELDS,
]);
const DOCUMENT_FIELDS = new Set(["title", "description"]);

const stableEqual = (left: unknown, right: unknown): boolean =>
  stableStringifyBlockPropertyJson(left) ===
  stableStringifyBlockPropertyJson(right);

const requireStringSet = (
  value: unknown,
  label: string,
): readonly string[] => {
  if (!Array.isArray(value)) {
    throw new CardMetadataPropertyCompilerError(`${label} must be an array`);
  }
  const values = value.map((entry, index) => {
    if (
      typeof entry === "string" &&
      entry.length > 0 &&
      entry.length <= 512 &&
      entry === entry.trim()
    ) {
      return entry;
    }
    throw new CardMetadataPropertyCompilerError(
      `${label}[${index}] must be a canonical non-empty tag`,
    );
  });
  return [...new Set(values)].sort();
};

const normalizeDatabaseValue = (
  field: Exclude<CardDatabaseMetadataField, "tags">,
  value: unknown,
): string | null => {
  if (field === "dueDate") {
    if (value === null) return null;
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    throw new CardMetadataPropertyCompilerError(
      "Card dueDate must be a valid Date or null",
    );
  }
  if (field === "scheduledStart" || field === "scheduledEnd") {
    if (value === null) return null;
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return value.toISOString();
    }
    throw new CardMetadataPropertyCompilerError(
      `Card ${field} must be a valid Date or null`,
    );
  }
  if (field === "status") {
    if (isCardStatus(value)) return value;
    throw new CardMetadataPropertyCompilerError(
      "Card status must be a canonical status",
    );
  }
  if (field === "assignee") {
    if (typeof value === "string") return value.trim() || null;
    throw new CardMetadataPropertyCompilerError(
      "Card assignee must be a string",
    );
  }
  if (value === null || typeof value === "string") return value;
  throw new CardMetadataPropertyCompilerError(
    `Card ${field} must be a string or null`,
  );
};

const portableValue = (
  value: unknown,
  label: string,
): BlockPropertyJsonValue => {
  try {
    return JSON.parse(
      stableStringifyBlockPropertyJson(value),
    ) as BlockPropertyJsonValue;
  } catch (error) {
    throw new CardMetadataPropertyCompilerError(
      `${label} must be bounded portable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const normalizeIntrinsicValue = (
  field: CardIntrinsicMetadataField,
  value: unknown,
): BlockPropertyJsonValue => {
  if (field === "agentBlocked") {
    if (typeof value === "boolean") return value;
    throw new CardMetadataPropertyCompilerError(
      "Card agentBlocked must be a boolean",
    );
  }
  if (field === "isAllDay") {
    if (typeof value === "boolean") return value;
    if (value === null) return false;
    throw new CardMetadataPropertyCompilerError(
      "Card isAllDay must be a boolean or null",
    );
  }
  if (field === "reminders") {
    if (Array.isArray(value)) return portableValue(value, "Card reminders");
    throw new CardMetadataPropertyCompilerError(
      "Card reminders must be an array",
    );
  }
  if (field === "recurrence") {
    if (value === null) return null;
    return portableValue(value, "Card recurrence");
  }
  if (field === "runInTarget") {
    if (
      value === "localProject" ||
      value === "newWorktree" ||
      value === "cloud"
    ) {
      return value;
    }
    throw new CardMetadataPropertyCompilerError(
      "Card runInTarget is invalid",
    );
  }
  if (value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  throw new CardMetadataPropertyCompilerError(
    `Card ${field} must be a string or null`,
  );
};

const requireCoordinate = (
  snapshot: CardMetadataPropertySnapshot,
  field: CardMutableMetadataField,
): CardMetadataPropertyCoordinate => {
  const coordinate = snapshot.fields.find(
    (candidate) => candidate.field === field,
  );
  if (coordinate) return coordinate;
  throw new CardMetadataPropertyCompilerError(
    `Card metadata snapshot is missing ${field}`,
  );
};

/**
 * Translate the legacy Card patch vocabulary to the existing canonical Block
 * property mutation contract. This helper performs no I/O and owns no receipt:
 * callers retain the returned mutationId and submit the exact request through
 * the existing BlockPropertyMutation transport.
 */
export interface CompileCardMetadataPropertyMutationInput {
  readonly mutationId: string;
  readonly clientSessionId?: string;
  readonly actor: Readonly<Record<string, BlockPropertyJsonValue>>;
  readonly snapshot: CardMetadataPropertySnapshot;
  readonly patch: Partial<CardInput>;
}

/**
 * Compile a compatibility Card metadata patch, returning null when the patch
 * is already represented by the captured authority coordinate.
 */
export const compileCardMetadataPropertyMutationOrNull = (
  input: CompileCardMetadataPropertyMutationInput,
): BlockPropertyMutationRequest | null => {
  const patch = input.patch as Readonly<Record<string, unknown>>;
  for (const field of Object.keys(patch)) {
    if (DOCUMENT_FIELDS.has(field)) {
      throw new CardMetadataPropertyCompilerError(
        `Card ${field} belongs to the Card Document, not metadata`,
      );
    }
    if (MUTABLE_FIELDS.has(field as CardMutableMetadataField)) continue;
    throw new CardMetadataPropertyCompilerError(
      `Card ${field} is not mutable metadata; lifecycle uses CardLifecycleMutation`,
    );
  }

  const fields: BlockPropertyMutationRequest["fields"][number][] = [];
  for (const field of [...MUTABLE_FIELDS].sort()) {
    if (!Object.hasOwn(patch, field)) continue;
    const rawValue = patch[field];
    if (rawValue === undefined) {
      throw new CardMetadataPropertyCompilerError(
        `Card ${field} must be omitted instead of undefined`,
      );
    }
    const coordinate = requireCoordinate(input.snapshot, field);
    if (field === "tags") {
      if (coordinate.scope !== "database") {
        throw new CardMetadataPropertyCompilerError(
          "Card tags require an active Database membership",
        );
      }
      const current = requireStringSet(coordinate.value, "Current Card tags");
      const target = requireStringSet(rawValue, "Card tags");
      const currentSet = new Set(current);
      const targetSet = new Set(target);
      const add = target.filter((tag) => !currentSet.has(tag));
      const remove = current.filter((tag) => !targetSet.has(tag));
      if (add.length === 0 && remove.length === 0) continue;
      fields.push({
        scope: "database",
        cardBlockId: input.snapshot.cardBlockId,
        databaseBlockId: coordinate.databaseBlockId,
        propertyId: coordinate.propertyId,
        operation: "add_remove",
        add,
        remove,
      });
      continue;
    }
    if (DATABASE_FIELDS.has(field as CardDatabaseMetadataField)) {
      if (coordinate.scope !== "database") {
        throw new CardMetadataPropertyCompilerError(
          `Card ${field} requires an active Database membership`,
        );
      }
      const value = normalizeDatabaseValue(
        field as Exclude<CardDatabaseMetadataField, "tags">,
        rawValue,
      );
      if (stableEqual(coordinate.value, value)) continue;
      fields.push({
        scope: "database",
        cardBlockId: input.snapshot.cardBlockId,
        databaseBlockId: coordinate.databaseBlockId,
        propertyId: coordinate.propertyId,
        operation: "set",
        expectedRevision: coordinate.revision,
        value,
      });
      continue;
    }
    if (coordinate.scope !== "intrinsic") {
      throw new CardMetadataPropertyCompilerError(
        `Card ${field} is not an intrinsic Block property`,
      );
    }
    const value = normalizeIntrinsicValue(
      field as CardIntrinsicMetadataField,
      rawValue,
    );
    if (stableEqual(coordinate.value, value)) continue;
    fields.push({
      scope: "intrinsic",
      blockId: input.snapshot.cardBlockId,
      propertyKey:
        CARD_METADATA_INTRINSIC_FIELDS[field as CardIntrinsicMetadataField],
      operation: "set",
      expectedRevision: coordinate.revision,
      value,
    });
  }
  if (fields.length === 0) return null;
  return parseBlockPropertyMutationRequest({
    version: BLOCK_PROPERTY_MUTATION_CONTRACT_VERSION,
    mutationId: input.mutationId,
    projectId: input.snapshot.projectId,
    storeEpoch: input.snapshot.storeEpoch,
    ...(input.clientSessionId
      ? { clientSessionId: input.clientSessionId }
      : {}),
    actor: input.actor,
    fields,
  });
};

export const compileCardMetadataPropertyMutation = (
  input: CompileCardMetadataPropertyMutationInput,
): BlockPropertyMutationRequest => {
  const request = compileCardMetadataPropertyMutationOrNull(input);
  if (request) return request;
  throw new CardMetadataPropertyCompilerError(
    "Card metadata patch has no semantic changes",
  );
};
