export const BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION = 2 as const;
export const MAX_BLOCK_PROPERTY_MUTATION_V2_FIELDS = 256;

const MAX_ID_LENGTH = 512;
const MAX_PROPERTY_KEY_LENGTH = 128;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 100_000;
const MAX_JSON_KEY_LENGTH = 512;
const MAX_JSON_STRING_LENGTH = 1_000_000;
const MAX_CANONICAL_REQUEST_LENGTH = 2_000_000;
const MAX_FIELD_PATH_LENGTH = 4_096;

export type BlockPropertyJsonValueV2 =
  | null
  | boolean
  | number
  | string
  | readonly BlockPropertyJsonValueV2[]
  | Readonly<{ [key: string]: BlockPropertyJsonValueV2 }>;

export interface SetIntrinsicBlockPropertyV2 {
  readonly scope: "intrinsic";
  readonly blockId: string;
  readonly propertyKey: string;
  readonly operation: "set";
  readonly expectedRevision: number;
  readonly value: BlockPropertyJsonValueV2;
}

export type BlockPropertyFieldMutationV2 = SetIntrinsicBlockPropertyV2;

export interface BlockPropertyMutationRequestV2 {
  readonly version: typeof BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION;
  readonly mutationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly clientSessionId?: string;
  readonly actor: Readonly<Record<string, BlockPropertyJsonValueV2>>;
  readonly fields: readonly BlockPropertyFieldMutationV2[];
}

export type LibraryBlockPropertyMutationRequestV2 = Omit<
  BlockPropertyMutationRequestV2,
  "projectId" | "actor"
>;

export interface IntrinsicBlockPropertyMutationFieldResultV2 {
  readonly path: string;
  readonly scope: "intrinsic";
  readonly blockId: string;
  readonly propertyKey: string;
  readonly operation: "set";
  readonly revision: number;
  readonly value: BlockPropertyJsonValueV2;
}

export type BlockPropertyMutationFieldResultV2 =
  IntrinsicBlockPropertyMutationFieldResultV2;

export interface BlockPropertyMutationResultV2 {
  readonly version: typeof BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION;
  readonly mutationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly duplicate: boolean;
  readonly fields: readonly BlockPropertyMutationFieldResultV2[];
  readonly blockMetadataRevisions: Readonly<Record<string, number>>;
  readonly changeLogSeq: number;
  readonly committedAt: string;
}

export interface LibraryBlockPropertyMutationResultV2
  extends Omit<BlockPropertyMutationResultV2, "projectId"> {
  readonly accessContext: { readonly kind: "library" };
}

export type BlockPropertyMutationErrorCodeV2 =
  | "invalid_property_mutation_request"
  | "store_epoch_mismatch"
  | "mutation_id_collision"
  | "project_not_found"
  | "block_not_found"
  | "block_not_active"
  | "block_type_mismatch"
  | "property_not_found"
  | "property_type_mismatch"
  | "property_value_invalid"
  | "property_value_corrupt"
  | "property_conflict"
  | "unknown";

export interface BlockPropertyMutationCommandErrorV2 {
  readonly code: BlockPropertyMutationErrorCodeV2;
  readonly message: string;
  readonly retryable: boolean;
  readonly mutationId?: string;
  readonly fieldPath?: string;
  readonly expectedRevision?: number;
  readonly actualRevision?: number;
}

export type BlockPropertyMutationCommandResultV2 =
  | { readonly ok: true; readonly value: BlockPropertyMutationResultV2 }
  | { readonly ok: false; readonly error: BlockPropertyMutationCommandErrorV2 };

export type LibraryBlockPropertyMutationCommandResultV2 =
  | { readonly ok: true; readonly value: LibraryBlockPropertyMutationResultV2 }
  | { readonly ok: false; readonly error: BlockPropertyMutationCommandErrorV2 };

export class BlockPropertyMutationV2ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockPropertyMutationV2ContractError";
  }
}

interface JsonReadState {
  readonly seen: WeakSet<object>;
  nodes: number;
  characters: number;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new BlockPropertyMutationV2ContractError(`${label} must be an object`);
};

const assertExactKeys = (
  record: Readonly<Record<string, unknown>>,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void => {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (Object.hasOwn(record, key)) continue;
    throw new BlockPropertyMutationV2ContractError(`${label}.${key} is required`);
  }
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue;
    throw new BlockPropertyMutationV2ContractError(
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
  throw new BlockPropertyMutationV2ContractError(
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
  throw new BlockPropertyMutationV2ContractError(
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

const newJsonReadState = (): JsonReadState => ({
  seen: new WeakSet<object>(),
  nodes: 0,
  characters: 0,
});

const readJsonValue = (
  value: unknown,
  label: string,
  depth: number,
  state: JsonReadState,
): BlockPropertyJsonValueV2 => {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES) {
    throw new BlockPropertyMutationV2ContractError(
      `${label} exceeds the JSON node limit`,
    );
  }
  if (depth > MAX_JSON_DEPTH) {
    throw new BlockPropertyMutationV2ContractError(
      `${label} exceeds the JSON depth limit`,
    );
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length <= MAX_JSON_STRING_LENGTH) {
    state.characters += value.length;
    if (state.characters <= MAX_CANONICAL_REQUEST_LENGTH) return value;
    throw new BlockPropertyMutationV2ContractError(
      `${label} exceeds the JSON character limit`,
    );
  }
  if (typeof value !== "object" || value === null) {
    throw new BlockPropertyMutationV2ContractError(
      `${label} must contain only JSON values`,
    );
  }
  if (state.seen.has(value)) {
    throw new BlockPropertyMutationV2ContractError(`${label} must not be cyclic`);
  }
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) =>
        readJsonValue(entry, `${label}[${index}]`, depth + 1, state),
      );
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new BlockPropertyMutationV2ContractError(
        `${label} must contain only plain JSON objects`,
      );
    }
    const record = value as Readonly<Record<string, unknown>>;
    const result = Object.create(null) as Record<
      string,
      BlockPropertyJsonValueV2
    >;
    for (const key of Object.keys(record).sort(compareStrings)) {
      if (key.length > MAX_JSON_KEY_LENGTH) {
        throw new BlockPropertyMutationV2ContractError(
          `${label} contains an oversized JSON key`,
        );
      }
      state.characters += key.length;
      if (state.characters > MAX_CANONICAL_REQUEST_LENGTH) {
        throw new BlockPropertyMutationV2ContractError(
          `${label} exceeds the JSON character limit`,
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
  state: JsonReadState = newJsonReadState(),
): BlockPropertyJsonValueV2 => readJsonValue(value, label, 0, state);

const readActor = (
  value: unknown,
  state: JsonReadState,
): Readonly<Record<string, BlockPropertyJsonValueV2>> => {
  const actor = parseJsonValue(value, "propertyMutationV2.actor", state);
  if (isRecord(actor)) {
    return actor as Readonly<Record<string, BlockPropertyJsonValueV2>>;
  }
  throw new BlockPropertyMutationV2ContractError(
    "propertyMutationV2.actor must be a JSON object",
  );
};

const parseField = (
  value: unknown,
  index: number,
  state: JsonReadState,
): BlockPropertyFieldMutationV2 => {
  const label = `propertyMutationV2.fields[${index}]`;
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
      throw new BlockPropertyMutationV2ContractError(
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
  throw new BlockPropertyMutationV2ContractError(
    `${label}.scope must be intrinsic`,
  );
};

export const makeBlockPropertyFieldPathV2 = (
  field: BlockPropertyFieldMutationV2,
): string => {
  return `intrinsic/${encodeURIComponent(field.blockId)}/${encodeURIComponent(field.propertyKey)}`;
};

const stableStringifyJson = (value: BlockPropertyJsonValueV2): string => {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) return serialized;
    throw new BlockPropertyMutationV2ContractError(
      "Cannot serialize a non-JSON property value",
    );
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyJson).join(",")}]`;
  }
  const record = value as Readonly<Record<string, BlockPropertyJsonValueV2>>;
  return `{${Object.keys(record)
    .sort(compareStrings)
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringifyJson(record[key] ?? null)}`,
    )
    .join(",")}}`;
};

export const stableStringifyBlockPropertyJsonV2 = (value: unknown): string =>
  stableStringifyJson(parseJsonValue(value, "propertyMutationV2 JSON"));

export const parseBlockPropertyMutationRequestV2 = (
  value: unknown,
): BlockPropertyMutationRequestV2 => {
  const request = readRecord(value, "propertyMutationV2");
  assertExactKeys(
    request,
    "propertyMutationV2",
    ["version", "mutationId", "projectId", "storeEpoch", "actor", "fields"],
    ["clientSessionId"],
  );
  if (request.version !== BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION) {
    throw new BlockPropertyMutationV2ContractError(
      `propertyMutationV2.version must be ${BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION}`,
    );
  }
  if (
    !Array.isArray(request.fields) ||
    request.fields.length < 1 ||
    request.fields.length > MAX_BLOCK_PROPERTY_MUTATION_V2_FIELDS
  ) {
    throw new BlockPropertyMutationV2ContractError(
      `propertyMutationV2.fields must contain 1-${MAX_BLOCK_PROPERTY_MUTATION_V2_FIELDS} entries`,
    );
  }
  const state = newJsonReadState();
  const fields = request.fields
    .map((field, index) => parseField(field, index, state))
    .sort((left, right) =>
      compareStrings(
        makeBlockPropertyFieldPathV2(left),
        makeBlockPropertyFieldPathV2(right),
      ),
    );
  const paths = fields.map(makeBlockPropertyFieldPathV2);
  if (new Set(paths).size !== paths.length) {
    throw new BlockPropertyMutationV2ContractError(
      "propertyMutationV2.fields contains a duplicate property path",
    );
  }
  const parsed: BlockPropertyMutationRequestV2 = {
    version: BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION,
    mutationId: readBoundedString(request, "mutationId", "propertyMutationV2"),
    projectId: readBoundedString(request, "projectId", "propertyMutationV2"),
    storeEpoch: readBoundedString(request, "storeEpoch", "propertyMutationV2"),
    ...(request.clientSessionId === undefined
      ? {}
      : {
          clientSessionId: readOptionalBoundedString(
            request,
            "clientSessionId",
            "propertyMutationV2",
          ),
        }),
    actor: readActor(request.actor, state),
    fields,
  };
  const canonical = stableStringifyBlockPropertyJsonV2(parsed);
  if (canonical.length <= MAX_CANONICAL_REQUEST_LENGTH) return parsed;
  throw new BlockPropertyMutationV2ContractError(
    "propertyMutationV2 exceeds the canonical request size limit",
  );
};

export const canonicalizeBlockPropertyMutationRequestV2 = (
  value: unknown,
): string =>
  stableStringifyBlockPropertyJsonV2(parseBlockPropertyMutationRequestV2(value));

const parseFieldResult = (
  value: unknown,
  index: number,
): BlockPropertyMutationFieldResultV2 => {
  const label = `propertyMutationResultV2.fields[${index}]`;
  const field = readRecord(value, label);
  if (field.scope === "intrinsic") {
    assertExactKeys(field, label, [
      "path",
      "scope",
      "blockId",
      "propertyKey",
      "operation",
      "revision",
      "value",
    ]);
    if (field.operation !== "set") {
      throw new BlockPropertyMutationV2ContractError(
        `${label}.operation must be set for intrinsic properties`,
      );
    }
    const blockId = readBoundedString(field, "blockId", label);
    const propertyKey = readBoundedString(
      field,
      "propertyKey",
      label,
      MAX_PROPERTY_KEY_LENGTH,
    );
    const path = readBoundedString(field, "path", label, MAX_FIELD_PATH_LENGTH);
    const expectedPath = makeBlockPropertyFieldPathV2({
      scope: "intrinsic",
      blockId,
      propertyKey,
      operation: "set",
      expectedRevision: 0,
      value: null,
    });
    if (path !== expectedPath) {
      throw new BlockPropertyMutationV2ContractError(
        `${label}.path does not match its scope identifiers`,
      );
    }
    return {
      path,
      scope: "intrinsic",
      blockId,
      propertyKey,
      operation: "set",
      revision: readSafeInteger(field, "revision", label, 1),
      value: parseJsonValue(field.value, `${label}.value`),
    };
  }
  throw new BlockPropertyMutationV2ContractError(
    `${label}.scope must be intrinsic`,
  );
};

const readBlockMetadataRevisions = (
  value: unknown,
): Readonly<Record<string, number>> => {
  const revisions = readRecord(
    value,
    "propertyMutationResultV2.blockMetadataRevisions",
  );
  return Object.fromEntries(
    Object.keys(revisions)
      .sort(compareStrings)
      .map((blockId) => {
        if (
          blockId.length < 1 ||
          blockId.length > MAX_ID_LENGTH ||
          blockId !== blockId.trim()
        ) {
          throw new BlockPropertyMutationV2ContractError(
            "propertyMutationResultV2 contains an invalid Block ID",
          );
        }
        const revision = revisions[blockId];
        if (
          typeof revision !== "number" ||
          !Number.isSafeInteger(revision) ||
          revision < 1
        ) {
          throw new BlockPropertyMutationV2ContractError(
            "propertyMutationResultV2 contains an invalid metadata revision",
          );
        }
        return [blockId, revision];
      }),
  );
};

const readCanonicalTimestamp = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string => {
  const timestamp = readBoundedString(record, key, label, 128);
  if (
    Number.isFinite(Date.parse(timestamp)) &&
    new Date(timestamp).toISOString() === timestamp
  ) {
    return timestamp;
  }
  throw new BlockPropertyMutationV2ContractError(
    `${label}.${key} must be a canonical ISO timestamp`,
  );
};

export const parseBlockPropertyMutationResultV2 = (
  value: unknown,
): BlockPropertyMutationResultV2 => {
  const result = readRecord(value, "propertyMutationResultV2");
  assertExactKeys(result, "propertyMutationResultV2", [
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
  if (result.version !== BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION) {
    throw new BlockPropertyMutationV2ContractError(
      `propertyMutationResultV2.version must be ${BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION}`,
    );
  }
  if (typeof result.duplicate !== "boolean") {
    throw new BlockPropertyMutationV2ContractError(
      "propertyMutationResultV2.duplicate must be a boolean",
    );
  }
  if (
    !Array.isArray(result.fields) ||
    result.fields.length < 1 ||
    result.fields.length > MAX_BLOCK_PROPERTY_MUTATION_V2_FIELDS
  ) {
    throw new BlockPropertyMutationV2ContractError(
      `propertyMutationResultV2.fields must contain 1-${MAX_BLOCK_PROPERTY_MUTATION_V2_FIELDS} entries`,
    );
  }
  const fields = result.fields.map(parseFieldResult);
  const fieldPaths = fields.map((field) => field.path);
  if (new Set(fieldPaths).size !== fieldPaths.length) {
    throw new BlockPropertyMutationV2ContractError(
      "propertyMutationResultV2.fields contains a duplicate path",
    );
  }
  const blockMetadataRevisions = readBlockMetadataRevisions(
    result.blockMetadataRevisions,
  );
  const targetBlockIds = [...new Set(fields.map((field) => field.blockId))].sort(
    compareStrings,
  );
  if (
    JSON.stringify(Object.keys(blockMetadataRevisions)) !==
    JSON.stringify(targetBlockIds)
  ) {
    throw new BlockPropertyMutationV2ContractError(
      "propertyMutationResultV2 metadata revisions must match target Blocks",
    );
  }
  return {
    version: BLOCK_PROPERTY_MUTATION_V2_CONTRACT_VERSION,
    mutationId: readBoundedString(
      result,
      "mutationId",
      "propertyMutationResultV2",
    ),
    projectId: readBoundedString(
      result,
      "projectId",
      "propertyMutationResultV2",
    ),
    storeEpoch: readBoundedString(
      result,
      "storeEpoch",
      "propertyMutationResultV2",
    ),
    duplicate: result.duplicate,
    fields,
    blockMetadataRevisions,
    changeLogSeq: readSafeInteger(
      result,
      "changeLogSeq",
      "propertyMutationResultV2",
      1,
    ),
    committedAt: readCanonicalTimestamp(
      result,
      "committedAt",
      "propertyMutationResultV2",
    ),
  };
};

const SUPPORTED_ERROR_CODES: readonly BlockPropertyMutationErrorCodeV2[] = [
  "invalid_property_mutation_request",
  "store_epoch_mismatch",
  "mutation_id_collision",
  "project_not_found",
  "block_not_found",
  "block_not_active",
  "block_type_mismatch",
  "property_not_found",
  "property_type_mismatch",
  "property_value_invalid",
  "property_value_corrupt",
  "property_conflict",
  "unknown",
];

export const parseBlockPropertyMutationCommandErrorV2 = (
  value: unknown,
): BlockPropertyMutationCommandErrorV2 => {
  const error = readRecord(value, "propertyMutationErrorV2");
  assertExactKeys(
    error,
    "propertyMutationErrorV2",
    ["code", "message", "retryable"],
    ["mutationId", "fieldPath", "expectedRevision", "actualRevision"],
  );
  if (
    typeof error.code !== "string" ||
    !SUPPORTED_ERROR_CODES.includes(
      error.code as BlockPropertyMutationErrorCodeV2,
    )
  ) {
    throw new BlockPropertyMutationV2ContractError(
      "propertyMutationErrorV2.code is not supported",
    );
  }
  if (typeof error.retryable !== "boolean") {
    throw new BlockPropertyMutationV2ContractError(
      "propertyMutationErrorV2.retryable must be a boolean",
    );
  }
  const mutationId = readOptionalBoundedString(
    error,
    "mutationId",
    "propertyMutationErrorV2",
  );
  const fieldPath = readOptionalBoundedString(
    error,
    "fieldPath",
    "propertyMutationErrorV2",
    MAX_FIELD_PATH_LENGTH,
  );
  const expectedRevision = readOptionalSafeInteger(
    error,
    "expectedRevision",
    "propertyMutationErrorV2",
    0,
  );
  const actualRevision = readOptionalSafeInteger(
    error,
    "actualRevision",
    "propertyMutationErrorV2",
    0,
  );
  if (
    error.code === "property_conflict" &&
    (fieldPath === undefined ||
      expectedRevision === undefined ||
      actualRevision === undefined)
  ) {
    throw new BlockPropertyMutationV2ContractError(
      "property_conflict must carry its path and both revisions",
    );
  }
  return {
    code: error.code as BlockPropertyMutationErrorCodeV2,
    message: readBoundedString(
      error,
      "message",
      "propertyMutationErrorV2",
      MAX_FIELD_PATH_LENGTH,
    ),
    retryable: error.retryable,
    ...(mutationId === undefined ? {} : { mutationId }),
    ...(fieldPath === undefined ? {} : { fieldPath }),
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    ...(actualRevision === undefined ? {} : { actualRevision }),
  };
};

export const parseBlockPropertyMutationCommandResultV2 = (
  value: unknown,
): BlockPropertyMutationCommandResultV2 => {
  const result = readRecord(value, "propertyMutationCommandResultV2");
  if (result.ok === true) {
    assertExactKeys(result, "propertyMutationCommandResultV2", ["ok", "value"]);
    return { ok: true, value: parseBlockPropertyMutationResultV2(result.value) };
  }
  if (result.ok === false) {
    assertExactKeys(result, "propertyMutationCommandResultV2", ["ok", "error"]);
    return {
      ok: false,
      error: parseBlockPropertyMutationCommandErrorV2(result.error),
    };
  }
  throw new BlockPropertyMutationV2ContractError(
    "propertyMutationCommandResultV2.ok must be a boolean",
  );
};

export const toLibraryBlockPropertyMutationCommandResultV2 = (
  result: BlockPropertyMutationCommandResultV2,
): LibraryBlockPropertyMutationCommandResultV2 => {
  if (!result.ok) return result;
  const { projectId: _privateProjectId, ...receipt } = result.value;
  void _privateProjectId;
  return {
    ok: true,
    value: {
      ...receipt,
      accessContext: { kind: "library" },
    },
  };
};

export const parseLibraryBlockPropertyMutationCommandResultV2 = (
  value: unknown,
): LibraryBlockPropertyMutationCommandResultV2 => {
  const result = readRecord(value, "libraryPropertyMutationCommandResultV2");
  if (result.ok === false) {
    assertExactKeys(result, "libraryPropertyMutationCommandResultV2", [
      "ok",
      "error",
    ]);
    return {
      ok: false,
      error: parseBlockPropertyMutationCommandErrorV2(result.error),
    };
  }
  if (result.ok !== true) {
    throw new BlockPropertyMutationV2ContractError(
      "libraryPropertyMutationCommandResultV2.ok must be a boolean",
    );
  }
  assertExactKeys(result, "libraryPropertyMutationCommandResultV2", [
    "ok",
    "value",
  ]);
  const receipt = readRecord(
    result.value,
    "libraryPropertyMutationCommandResultV2.value",
  );
  assertExactKeys(receipt, "libraryPropertyMutationCommandResultV2.value", [
    "version",
    "mutationId",
    "accessContext",
    "storeEpoch",
    "duplicate",
    "fields",
    "blockMetadataRevisions",
    "changeLogSeq",
    "committedAt",
  ]);
  const accessContext = readRecord(
    receipt.accessContext,
    "libraryPropertyMutationCommandResultV2.value.accessContext",
  );
  assertExactKeys(
    accessContext,
    "libraryPropertyMutationCommandResultV2.value.accessContext",
    ["kind"],
  );
  if (accessContext.kind !== "library") {
    throw new BlockPropertyMutationV2ContractError(
      "Library property mutation access context must be library",
    );
  }
  const { accessContext: _libraryAccessContext, ...standardReceipt } = receipt;
  void _libraryAccessContext;
  const parsed = parseBlockPropertyMutationCommandResultV2({
    ok: true,
    value: {
      ...standardReceipt,
      projectId: "local-library",
    },
  });
  if (!parsed.ok) return parsed;
  return toLibraryBlockPropertyMutationCommandResultV2(parsed);
};
