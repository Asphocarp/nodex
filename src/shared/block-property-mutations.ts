export const BLOCK_PROPERTY_MUTATION_CONTRACT_VERSION = 1 as const;
export const MAX_BLOCK_PROPERTY_MUTATION_FIELDS = 256;

const MAX_ID_LENGTH = 512;
const MAX_PROPERTY_KEY_LENGTH = 128;
const MAX_SET_MEMBER_LENGTH = 512;
const MAX_SET_MEMBERS = 10_000;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 100_000;
const MAX_JSON_KEY_LENGTH = 512;
const MAX_JSON_STRING_LENGTH = 1_000_000;
const MAX_CANONICAL_REQUEST_LENGTH = 2_000_000;

export type BlockPropertyJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly BlockPropertyJsonValue[]
  | Readonly<{ [key: string]: BlockPropertyJsonValue }>;

export interface SetIntrinsicBlockProperty {
  readonly scope: "intrinsic";
  readonly blockId: string;
  readonly propertyKey: string;
  readonly operation: "set";
  /** Zero means that the property must not exist yet. */
  readonly expectedRevision: number;
  readonly value: BlockPropertyJsonValue;
}

export interface SetDatabaseScalarProperty {
  readonly scope: "database";
  readonly cardBlockId: string;
  readonly databaseBlockId: string;
  readonly propertyId: string;
  readonly operation: "set";
  /** Zero means that the membership has no value for this property yet. */
  readonly expectedRevision: number;
  readonly value: string | null;
}

export interface UpdateDatabaseSetProperty {
  readonly scope: "database";
  readonly cardBlockId: string;
  readonly databaseBlockId: string;
  readonly propertyId: string;
  readonly operation: "add_remove";
  readonly add: readonly string[];
  readonly remove: readonly string[];
}

export type BlockPropertyFieldMutation =
  | SetIntrinsicBlockProperty
  | SetDatabaseScalarProperty
  | UpdateDatabaseSetProperty;

export interface BlockPropertyMutationRequest {
  readonly version: typeof BLOCK_PROPERTY_MUTATION_CONTRACT_VERSION;
  readonly mutationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly clientSessionId?: string;
  readonly actor: Readonly<Record<string, BlockPropertyJsonValue>>;
  readonly fields: readonly BlockPropertyFieldMutation[];
}

export interface BlockPropertyMutationFieldResult {
  readonly path: string;
  readonly scope: "intrinsic" | "database";
  readonly blockId: string;
  readonly databaseBlockId?: string;
  readonly propertyId?: string;
  readonly propertyKey?: string;
  readonly operation: "set" | "add_remove";
  readonly revision: number;
  readonly value: BlockPropertyJsonValue;
}

export interface BlockPropertyMutationResult {
  readonly version: typeof BLOCK_PROPERTY_MUTATION_CONTRACT_VERSION;
  readonly mutationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly duplicate: boolean;
  readonly fields: readonly BlockPropertyMutationFieldResult[];
  readonly blockMetadataRevisions: Readonly<Record<string, number>>;
  readonly changeLogSeq: number;
  readonly committedAt: string;
}

export type BlockPropertyMutationErrorCode =
  | "invalid_property_mutation_request"
  | "store_epoch_mismatch"
  | "mutation_id_collision"
  | "project_not_found"
  | "block_not_found"
  | "block_not_active"
  | "block_type_mismatch"
  | "database_not_found"
  | "membership_not_found"
  | "property_not_found"
  | "property_type_mismatch"
  | "property_value_invalid"
  | "property_value_corrupt"
  | "property_conflict"
  | "unknown";

export interface BlockPropertyMutationCommandError {
  readonly code: BlockPropertyMutationErrorCode;
  readonly message: string;
  /** True only when replaying the exact same mutation can make progress. */
  readonly retryable: boolean;
  readonly mutationId?: string;
  readonly fieldPath?: string;
  readonly expectedRevision?: number;
  readonly actualRevision?: number;
}

export type BlockPropertyMutationCommandResult =
  | { readonly ok: true; readonly value: BlockPropertyMutationResult }
  | { readonly ok: false; readonly error: BlockPropertyMutationCommandError };

export class BlockPropertyMutationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockPropertyMutationContractError";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new BlockPropertyMutationContractError(`${label} must be an object`);
};

const assertExactKeys = (
  record: Readonly<Record<string, unknown>>,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void => {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (Object.prototype.hasOwnProperty.call(record, key)) continue;
    throw new BlockPropertyMutationContractError(`${label}.${key} is required`);
  }
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue;
    throw new BlockPropertyMutationContractError(
      `${label}.${key} is not supported`,
    );
  }
};

const readBoundedString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  maximumLength = MAX_ID_LENGTH,
): string => {
  const value = record[key];
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim()
  ) {
    return value;
  }
  throw new BlockPropertyMutationContractError(
    `${label}.${key} must be a canonical non-empty string`,
  );
};

const readOptionalBoundedString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  maximumLength = MAX_ID_LENGTH,
): string | undefined => {
  if (record[key] === undefined) return undefined;
  return readBoundedString(record, key, label, maximumLength);
};

const readSafeInteger = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  minimum: number,
): number => {
  const value = record[key];
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
  ) {
    return value;
  }
  throw new BlockPropertyMutationContractError(
    `${label}.${key} must be a safe integer >= ${minimum}`,
  );
};

const readOptionalSafeInteger = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  minimum: number,
): number | undefined => {
  if (record[key] === undefined) return undefined;
  return readSafeInteger(record, key, label, minimum);
};

interface JsonReadState {
  readonly seen: WeakSet<object>;
  nodes: number;
  characters: number;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const uniqueSortedForContract = (
  values: readonly string[],
): readonly string[] => [...new Set(values)].sort(compareStrings);

const readJsonValue = (
  value: unknown,
  label: string,
  depth: number,
  state: JsonReadState,
): BlockPropertyJsonValue => {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES) {
    throw new BlockPropertyMutationContractError(
      `${label} exceeds the JSON node limit`,
    );
  }
  if (depth > MAX_JSON_DEPTH) {
    throw new BlockPropertyMutationContractError(
      `${label} exceeds the JSON depth limit`,
    );
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length <= MAX_JSON_STRING_LENGTH) {
    state.characters += value.length;
    if (state.characters > MAX_CANONICAL_REQUEST_LENGTH) {
      throw new BlockPropertyMutationContractError(
        `${label} exceeds the JSON character budget`,
      );
    }
    return value;
  }
  if (typeof value !== "object" || value === null) {
    throw new BlockPropertyMutationContractError(
      `${label} must contain only JSON values`,
    );
  }
  if (state.seen.has(value)) {
    throw new BlockPropertyMutationContractError(`${label} must not be cyclic`);
  }
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_JSON_NODES) {
        throw new BlockPropertyMutationContractError(
          `${label} exceeds the JSON array limit`,
        );
      }
      return value.map((entry, index) =>
        readJsonValue(entry, `${label}[${index}]`, depth + 1, state),
      );
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new BlockPropertyMutationContractError(
        `${label} must contain only plain JSON objects`,
      );
    }
    const record = value as Readonly<Record<string, unknown>>;
    const entries = Object.keys(record).sort(compareStrings);
    const result = Object.create(null) as Record<
      string,
      BlockPropertyJsonValue
    >;
    for (const key of entries) {
      if (key.length > MAX_JSON_KEY_LENGTH) {
        throw new BlockPropertyMutationContractError(
          `${label} contains an oversized JSON key`,
        );
      }
      state.characters += key.length;
      if (state.characters > MAX_CANONICAL_REQUEST_LENGTH) {
        throw new BlockPropertyMutationContractError(
          `${label} exceeds the JSON character budget`,
        );
      }
      result[key] = readJsonValue(
        record[key],
        `${label}.${key}`,
        depth + 1,
        state,
      );
    }
    return result;
  } finally {
    state.seen.delete(value);
  }
};

const parseJsonValue = (
  value: unknown,
  label: string,
  state: JsonReadState = {
    seen: new WeakSet<object>(),
    nodes: 0,
    characters: 0,
  },
): BlockPropertyJsonValue => readJsonValue(value, label, 0, state);

const readActor = (
  record: Readonly<Record<string, unknown>>,
  state: JsonReadState,
): Readonly<Record<string, BlockPropertyJsonValue>> => {
  const value = parseJsonValue(record.actor, "propertyMutation.actor", state);
  if (isRecord(value)) {
    return value as Readonly<Record<string, BlockPropertyJsonValue>>;
  }
  throw new BlockPropertyMutationContractError(
    "propertyMutation.actor must be a JSON object",
  );
};

const readSetMembers = (
  record: Readonly<Record<string, unknown>>,
  key: "add" | "remove",
  label: string,
  state: JsonReadState,
): readonly string[] => {
  const value = record[key];
  if (!Array.isArray(value) || value.length > MAX_SET_MEMBERS) {
    throw new BlockPropertyMutationContractError(
      `${label}.${key} must be a bounded string array`,
    );
  }
  const members = value.map((entry) => {
    if (
      typeof entry === "string" &&
      entry.length > 0 &&
      entry.length <= MAX_SET_MEMBER_LENGTH &&
      entry === entry.trim()
    ) {
      return entry;
    }
    throw new BlockPropertyMutationContractError(
      `${label}.${key} contains an invalid set member`,
    );
  });
  state.nodes += members.length;
  state.characters += members.reduce(
    (total, member) => total + member.length,
    0,
  );
  if (
    state.nodes > MAX_JSON_NODES ||
    state.characters > MAX_CANONICAL_REQUEST_LENGTH
  ) {
    throw new BlockPropertyMutationContractError(
      `${label}.${key} exceeds the request budget`,
    );
  }
  return [...new Set(members)].sort(compareStrings);
};

const parseField = (
  value: unknown,
  index: number,
  state: JsonReadState,
): BlockPropertyFieldMutation => {
  const label = `propertyMutation.fields[${index}]`;
  const field = readRecord(value, label);
  if (field.scope === "intrinsic") {
    assertExactKeys(field, label, [
      "scope",
      "blockId",
      "propertyKey",
      "operation",
      "expectedRevision",
      "value",
    ]);
    if (field.operation !== "set") {
      throw new BlockPropertyMutationContractError(
        `${label}.operation must be set for intrinsic properties`,
      );
    }
    return {
      scope: "intrinsic",
      blockId: readBoundedString(field, "blockId", label),
      propertyKey: readBoundedString(
        field,
        "propertyKey",
        label,
        MAX_PROPERTY_KEY_LENGTH,
      ),
      operation: "set",
      expectedRevision: readSafeInteger(field, "expectedRevision", label, 0),
      value: parseJsonValue(field.value, `${label}.value`, state),
    };
  }
  if (field.scope !== "database") {
    throw new BlockPropertyMutationContractError(
      `${label}.scope must be intrinsic or database`,
    );
  }
  if (field.operation === "set") {
    assertExactKeys(field, label, [
      "scope",
      "cardBlockId",
      "databaseBlockId",
      "propertyId",
      "operation",
      "expectedRevision",
      "value",
    ]);
    const scalar = parseJsonValue(field.value, `${label}.value`, state);
    if (scalar !== null && typeof scalar !== "string") {
      throw new BlockPropertyMutationContractError(
        `${label}.value must be a string or null`,
      );
    }
    if (typeof scalar === "string" && scalar.length > MAX_JSON_STRING_LENGTH) {
      throw new BlockPropertyMutationContractError(
        `${label}.value exceeds the string limit`,
      );
    }
    return {
      scope: "database",
      cardBlockId: readBoundedString(field, "cardBlockId", label),
      databaseBlockId: readBoundedString(field, "databaseBlockId", label),
      propertyId: readBoundedString(field, "propertyId", label),
      operation: "set",
      expectedRevision: readSafeInteger(field, "expectedRevision", label, 0),
      value: scalar,
    };
  }
  if (field.operation !== "add_remove") {
    throw new BlockPropertyMutationContractError(
      `${label}.operation must be set or add_remove`,
    );
  }
  assertExactKeys(field, label, [
    "scope",
    "cardBlockId",
    "databaseBlockId",
    "propertyId",
    "operation",
    "add",
    "remove",
  ]);
  const add = readSetMembers(field, "add", label, state);
  const remove = readSetMembers(field, "remove", label, state);
  if (add.length === 0 && remove.length === 0) {
    throw new BlockPropertyMutationContractError(
      `${label} must add or remove at least one member`,
    );
  }
  const removed = new Set(remove);
  if (add.some((member) => removed.has(member))) {
    throw new BlockPropertyMutationContractError(
      `${label} cannot add and remove the same member`,
    );
  }
  return {
    scope: "database",
    cardBlockId: readBoundedString(field, "cardBlockId", label),
    databaseBlockId: readBoundedString(field, "databaseBlockId", label),
    propertyId: readBoundedString(field, "propertyId", label),
    operation: "add_remove",
    add,
    remove,
  };
};

export const makeBlockPropertyFieldPath = (
  field: BlockPropertyFieldMutation,
): string => {
  if (field.scope === "intrinsic") {
    return `intrinsic/${encodeURIComponent(field.blockId)}/${encodeURIComponent(field.propertyKey)}`;
  }
  return `database/${encodeURIComponent(field.databaseBlockId)}/${encodeURIComponent(field.cardBlockId)}/${encodeURIComponent(field.propertyId)}`;
};

export const parseBlockPropertyMutationRequest = (
  value: unknown,
): BlockPropertyMutationRequest => {
  const request = readRecord(value, "propertyMutation");
  assertExactKeys(
    request,
    "propertyMutation",
    ["version", "mutationId", "projectId", "storeEpoch", "actor", "fields"],
    ["clientSessionId"],
  );
  if (request.version !== BLOCK_PROPERTY_MUTATION_CONTRACT_VERSION) {
    throw new BlockPropertyMutationContractError(
      `propertyMutation.version must be ${BLOCK_PROPERTY_MUTATION_CONTRACT_VERSION}`,
    );
  }
  if (
    !Array.isArray(request.fields) ||
    request.fields.length < 1 ||
    request.fields.length > MAX_BLOCK_PROPERTY_MUTATION_FIELDS
  ) {
    throw new BlockPropertyMutationContractError(
      `propertyMutation.fields must contain 1-${MAX_BLOCK_PROPERTY_MUTATION_FIELDS} entries`,
    );
  }
  const jsonState: JsonReadState = {
    seen: new WeakSet<object>(),
    nodes: 0,
    characters: 0,
  };
  const actor = readActor(request, jsonState);
  const fields = request.fields
    .map((field, index) => parseField(field, index, jsonState))
    .sort((left, right) =>
      compareStrings(
        makeBlockPropertyFieldPath(left),
        makeBlockPropertyFieldPath(right),
      ),
    );
  const paths = fields.map(makeBlockPropertyFieldPath);
  if (new Set(paths).size !== paths.length) {
    throw new BlockPropertyMutationContractError(
      "propertyMutation.fields contains a duplicate property path",
    );
  }
  const parsed: BlockPropertyMutationRequest = {
    version: BLOCK_PROPERTY_MUTATION_CONTRACT_VERSION,
    mutationId: readBoundedString(request, "mutationId", "propertyMutation"),
    projectId: readBoundedString(request, "projectId", "propertyMutation"),
    storeEpoch: readBoundedString(request, "storeEpoch", "propertyMutation"),
    ...(request.clientSessionId === undefined
      ? {}
      : {
          clientSessionId: readOptionalBoundedString(
            request,
            "clientSessionId",
            "propertyMutation",
          ),
        }),
    actor,
    fields,
  };
  const canonical = stableStringifyBlockPropertyJson(parsed);
  if (canonical.length <= MAX_CANONICAL_REQUEST_LENGTH) return parsed;
  throw new BlockPropertyMutationContractError(
    "propertyMutation exceeds the canonical request size limit",
  );
};

const stableStringifyJson = (value: BlockPropertyJsonValue): string => {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) return serialized;
    throw new BlockPropertyMutationContractError(
      "Cannot serialize a non-JSON property value",
    );
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyJson).join(",")}]`;
  }
  const record = value as Readonly<Record<string, BlockPropertyJsonValue>>;
  return `{${Object.keys(record)
    .sort(compareStrings)
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringifyJson(record[key] ?? null)}`,
    )
    .join(",")}}`;
};

export const stableStringifyBlockPropertyJson = (value: unknown): string =>
  stableStringifyJson(parseJsonValue(value, "property JSON"));

export const canonicalizeBlockPropertyMutationRequest = (
  value: unknown,
): string =>
  stableStringifyBlockPropertyJson(parseBlockPropertyMutationRequest(value));

const parseFieldResult = (
  value: unknown,
  index: number,
): BlockPropertyMutationFieldResult => {
  const label = `propertyMutationResult.fields[${index}]`;
  const field = readRecord(value, label);
  assertExactKeys(
    field,
    label,
    ["path", "scope", "blockId", "operation", "revision", "value"],
    ["databaseBlockId", "propertyId", "propertyKey"],
  );
  if (field.scope !== "intrinsic" && field.scope !== "database") {
    throw new BlockPropertyMutationContractError(
      `${label}.scope must be intrinsic or database`,
    );
  }
  if (field.operation !== "set" && field.operation !== "add_remove") {
    throw new BlockPropertyMutationContractError(
      `${label}.operation must be set or add_remove`,
    );
  }
  const databaseBlockId = readOptionalBoundedString(
    field,
    "databaseBlockId",
    label,
  );
  const propertyId = readOptionalBoundedString(field, "propertyId", label);
  const propertyKey = readOptionalBoundedString(field, "propertyKey", label);
  if (
    (field.scope === "intrinsic" &&
      (databaseBlockId !== undefined ||
        propertyId !== undefined ||
        propertyKey === undefined)) ||
    (field.scope === "database" &&
      (databaseBlockId === undefined ||
        propertyId === undefined ||
        propertyKey !== undefined))
  ) {
    throw new BlockPropertyMutationContractError(
      `${label} has inconsistent scope identifiers`,
    );
  }
  if (field.scope === "intrinsic" && field.operation !== "set") {
    throw new BlockPropertyMutationContractError(
      `${label} intrinsic results must use set`,
    );
  }
  const path = readBoundedString(field, "path", label, 4_096);
  const blockId = readBoundedString(field, "blockId", label);
  const expectedPath =
    field.scope === "intrinsic"
      ? `intrinsic/${encodeURIComponent(blockId)}/${encodeURIComponent(propertyKey ?? "")}`
      : `database/${encodeURIComponent(databaseBlockId ?? "")}/${encodeURIComponent(blockId)}/${encodeURIComponent(propertyId ?? "")}`;
  if (path !== expectedPath) {
    throw new BlockPropertyMutationContractError(
      `${label}.path does not match its scope identifiers`,
    );
  }
  const resultValue = parseJsonValue(field.value, `${label}.value`);
  if (
    field.scope === "database" &&
    field.operation === "set" &&
    resultValue !== null &&
    typeof resultValue !== "string"
  ) {
    throw new BlockPropertyMutationContractError(
      `${label}.value must be a string or null for a Database scalar`,
    );
  }
  if (field.scope === "database" && field.operation === "add_remove") {
    if (
      !Array.isArray(resultValue) ||
      resultValue.some(
        (entry) =>
          typeof entry !== "string" ||
          entry.length === 0 ||
          entry !== entry.trim(),
      )
    ) {
      throw new BlockPropertyMutationContractError(
        `${label}.value must be a string set for add_remove`,
      );
    }
    const canonicalMembers = [...new Set(resultValue as string[])].sort(
      compareStrings,
    );
    if (JSON.stringify(resultValue) !== JSON.stringify(canonicalMembers)) {
      throw new BlockPropertyMutationContractError(
        `${label}.value must be a sorted unique string set`,
      );
    }
  }
  return {
    path,
    scope: field.scope,
    blockId,
    ...(databaseBlockId === undefined ? {} : { databaseBlockId }),
    ...(propertyId === undefined ? {} : { propertyId }),
    ...(propertyKey === undefined ? {} : { propertyKey }),
    operation: field.operation,
    revision: readSafeInteger(field, "revision", label, 1),
    value: resultValue,
  };
};

export const parseBlockPropertyMutationResult = (
  value: unknown,
): BlockPropertyMutationResult => {
  const result = readRecord(value, "propertyMutationResult");
  assertExactKeys(result, "propertyMutationResult", [
    "version",
    "mutationId",
    "projectId",
    "storeEpoch",
    "duplicate",
    "fields",
    "blockMetadataRevisions",
    "changeLogSeq",
    "committedAt",
  ]);
  if (result.version !== BLOCK_PROPERTY_MUTATION_CONTRACT_VERSION) {
    throw new BlockPropertyMutationContractError(
      `propertyMutationResult.version must be ${BLOCK_PROPERTY_MUTATION_CONTRACT_VERSION}`,
    );
  }
  if (typeof result.duplicate !== "boolean") {
    throw new BlockPropertyMutationContractError(
      "propertyMutationResult.duplicate must be a boolean",
    );
  }
  if (
    !Array.isArray(result.fields) ||
    result.fields.length < 1 ||
    result.fields.length > MAX_BLOCK_PROPERTY_MUTATION_FIELDS
  ) {
    throw new BlockPropertyMutationContractError(
      `propertyMutationResult.fields must contain 1-${MAX_BLOCK_PROPERTY_MUTATION_FIELDS} entries`,
    );
  }
  const revisions = readRecord(
    result.blockMetadataRevisions,
    "propertyMutationResult.blockMetadataRevisions",
  );
  const blockMetadataRevisions = Object.fromEntries(
    Object.keys(revisions)
      .sort(compareStrings)
      .map((blockId) => {
        if (blockId.length < 1 || blockId.length > MAX_ID_LENGTH) {
          throw new BlockPropertyMutationContractError(
            "propertyMutationResult contains an invalid Block ID",
          );
        }
        const revision = revisions[blockId];
        if (
          typeof revision !== "number" ||
          !Number.isSafeInteger(revision) ||
          revision < 1
        ) {
          throw new BlockPropertyMutationContractError(
            "propertyMutationResult contains an invalid metadata revision",
          );
        }
        return [blockId, revision];
      }),
  );
  const fields = result.fields.map(parseFieldResult);
  const fieldPaths = fields.map((field) => field.path);
  if (new Set(fieldPaths).size !== fieldPaths.length) {
    throw new BlockPropertyMutationContractError(
      "propertyMutationResult.fields contains a duplicate path",
    );
  }
  const targetBlockIds = uniqueSortedForContract(
    fields.map((field) => field.blockId),
  );
  if (
    JSON.stringify(Object.keys(blockMetadataRevisions).sort(compareStrings)) !==
    JSON.stringify(targetBlockIds)
  ) {
    throw new BlockPropertyMutationContractError(
      "propertyMutationResult metadata revisions must match target Blocks",
    );
  }
  return {
    version: BLOCK_PROPERTY_MUTATION_CONTRACT_VERSION,
    mutationId: readBoundedString(
      result,
      "mutationId",
      "propertyMutationResult",
    ),
    projectId: readBoundedString(result, "projectId", "propertyMutationResult"),
    storeEpoch: readBoundedString(
      result,
      "storeEpoch",
      "propertyMutationResult",
    ),
    duplicate: result.duplicate,
    fields,
    blockMetadataRevisions,
    changeLogSeq: readSafeInteger(
      result,
      "changeLogSeq",
      "propertyMutationResult",
      1,
    ),
    committedAt: readBoundedString(
      result,
      "committedAt",
      "propertyMutationResult",
      128,
    ),
  };
};

export const parseBlockPropertyMutationCommandError = (
  value: unknown,
): BlockPropertyMutationCommandError => {
  const error = readRecord(value, "propertyMutationError");
  assertExactKeys(
    error,
    "propertyMutationError",
    ["code", "message", "retryable"],
    ["mutationId", "fieldPath", "expectedRevision", "actualRevision"],
  );
  const supportedCodes: readonly BlockPropertyMutationErrorCode[] = [
    "invalid_property_mutation_request",
    "store_epoch_mismatch",
    "mutation_id_collision",
    "project_not_found",
    "block_not_found",
    "block_not_active",
    "block_type_mismatch",
    "database_not_found",
    "membership_not_found",
    "property_not_found",
    "property_type_mismatch",
    "property_value_invalid",
    "property_value_corrupt",
    "property_conflict",
    "unknown",
  ];
  if (
    typeof error.code !== "string" ||
    !supportedCodes.includes(error.code as BlockPropertyMutationErrorCode)
  ) {
    throw new BlockPropertyMutationContractError(
      "propertyMutationError.code is not supported",
    );
  }
  if (typeof error.retryable !== "boolean") {
    throw new BlockPropertyMutationContractError(
      "propertyMutationError.retryable must be a boolean",
    );
  }
  const mutationId = readOptionalBoundedString(
    error,
    "mutationId",
    "propertyMutationError",
  );
  const fieldPath = readOptionalBoundedString(
    error,
    "fieldPath",
    "propertyMutationError",
    4_096,
  );
  const expectedRevision = readOptionalSafeInteger(
    error,
    "expectedRevision",
    "propertyMutationError",
    0,
  );
  const actualRevision = readOptionalSafeInteger(
    error,
    "actualRevision",
    "propertyMutationError",
    0,
  );
  if (
    error.code === "property_conflict" &&
    (fieldPath === undefined ||
      expectedRevision === undefined ||
      actualRevision === undefined)
  ) {
    throw new BlockPropertyMutationContractError(
      "property_conflict must carry its path and both revisions",
    );
  }
  return {
    code: error.code as BlockPropertyMutationErrorCode,
    message: readBoundedString(
      error,
      "message",
      "propertyMutationError",
      4_096,
    ),
    retryable: error.retryable,
    ...(mutationId === undefined ? {} : { mutationId }),
    ...(fieldPath === undefined ? {} : { fieldPath }),
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    ...(actualRevision === undefined ? {} : { actualRevision }),
  };
};

export const parseBlockPropertyMutationCommandResult = (
  value: unknown,
): BlockPropertyMutationCommandResult => {
  const result = readRecord(value, "propertyMutationCommandResult");
  if (result.ok === true) {
    assertExactKeys(result, "propertyMutationCommandResult", ["ok", "value"]);
    return {
      ok: true,
      value: parseBlockPropertyMutationResult(result.value),
    };
  }
  if (result.ok === false) {
    assertExactKeys(result, "propertyMutationCommandResult", ["ok", "error"]);
    return {
      ok: false,
      error: parseBlockPropertyMutationCommandError(result.error),
    };
  }
  throw new BlockPropertyMutationContractError(
    "propertyMutationCommandResult.ok must be a boolean",
  );
};
