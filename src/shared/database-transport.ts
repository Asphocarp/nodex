import {
  DatabaseMutationContractError,
  parseDatabaseMutationCommandError,
  parseDatabaseMutationReceipt,
  parseDatabaseMutationRequest,
  stableStringifyDatabaseJson,
  type DatabaseMutationCommandError,
  type DatabaseMutationCommandResult,
  type DatabaseMutationRequest,
  type DatabaseJsonValue,
} from "./database-kernel";
import type {
  DatabaseCatalogSnapshotCommandResult,
  DatabaseReadCommandError,
  DatabaseReadCommandResult,
  DatabaseViewSnapshotCommandResult,
  GeneralDatabaseDescriptor,
  GeneralDatabaseCatalog,
  GeneralDatabaseViewQuery,
  PrimaryDatabaseViewSnapshotCommandResult,
} from "./database-query";

const MAX_ID_LENGTH = 512;
const DATABASE_READ_ERROR_CODES = new Set<DatabaseReadCommandError["code"]>([
  "invalid_database_read_request",
  "store_not_initialized",
  "project_not_found",
  "database_state_corrupt",
  "unknown",
]);

const readIdentity = (value: unknown, label: string): string => {
  if (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_ID_LENGTH &&
    value === value.trim()
  ) {
    return value;
  }
  throw new TypeError(`${label} must be a canonical non-empty identity`);
};

const readOperationIdHint = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  try {
    return readIdentity(
      (value as Readonly<Record<string, unknown>>).operationId,
      "databaseMutation.operationId",
    );
  } catch {
    return undefined;
  }
};

export const databaseMutationFailure = (
  code: DatabaseMutationCommandError["code"],
  message: string,
  options: {
    readonly operationId?: string;
    readonly retryable?: boolean;
  } = {},
): DatabaseMutationCommandError => ({
  code,
  message,
  retryable: options.retryable ?? false,
  ...(options.operationId === undefined
    ? {}
    : { operationId: options.operationId }),
});

export type BoundDatabaseMutation =
  | { readonly ok: true; readonly value: DatabaseMutationRequest }
  | { readonly ok: false; readonly error: DatabaseMutationCommandError };

export interface TrustedDatabaseMutationIdentity {
  readonly actor: Readonly<Record<string, DatabaseJsonValue>>;
  readonly clientSessionId?: string;
}

/**
 * The Electron host/loopback server attests the transport and Project route,
 * then replaces spoofable renderer/browser actor and session fields with host-
 * derived audit identity. Actor/session do not participate in logical retry
 * identity, so a retry through another trusted transport still returns the
 * first durable outcome and keeps its first-attempt attribution.
 */
export const bindDatabaseMutationToProject = (
  rawRequest: unknown,
  rawProjectId: unknown,
  identity: TrustedDatabaseMutationIdentity,
): BoundDatabaseMutation => {
  let projectId: string;
  try {
    projectId = readIdentity(rawProjectId, "projectId");
  } catch (error) {
    return {
      ok: false,
      error: databaseMutationFailure(
        "invalid_database_mutation_request",
        error instanceof Error ? error.message : "Project scope is invalid",
        { operationId: readOperationIdHint(rawRequest) },
      ),
    };
  }

  let request: DatabaseMutationRequest;
  try {
    request = parseDatabaseMutationRequest(rawRequest);
  } catch (error) {
    return {
      ok: false,
      error: databaseMutationFailure(
        "invalid_database_mutation_request",
        error instanceof DatabaseMutationContractError
          ? error.message
          : "Database mutation request is invalid",
        { operationId: readOperationIdHint(rawRequest) },
      ),
    };
  }
  if (request.projectId !== projectId) {
    return {
      ok: false,
      error: databaseMutationFailure(
        "invalid_database_mutation_request",
        "Database mutation does not match its Project route scope",
        { operationId: request.operationId },
      ),
    };
  }
  try {
    return {
      ok: true,
      value: parseDatabaseMutationRequest({
        ...request,
        actor: identity.actor,
        clientSessionId: identity.clientSessionId,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: databaseMutationFailure(
        "invalid_database_mutation_request",
        error instanceof DatabaseMutationContractError
          ? error.message
          : "Trusted Database mutation identity is invalid",
        { operationId: request.operationId },
      ),
    };
  }
};

export const databaseMutationHttpStatus = (
  error: DatabaseMutationCommandError,
): 400 | 404 | 409 | 500 => {
  if (
    error.code === "project_not_found" ||
    error.code === "database_not_found" ||
    error.code === "property_not_found" ||
    error.code === "card_not_found" ||
    error.code === "view_not_found"
  ) {
    return 404;
  }
  if (
    error.code === "store_epoch_mismatch" ||
    error.code === "operation_id_collision" ||
    error.code.endsWith("_conflict") ||
    error.code.endsWith("_collision") ||
    error.code === "membership_unchanged"
  ) {
    return 409;
  }
  if (error.code === "unknown") return 500;
  return 400;
};

export const databaseReadFailure = (
  code: DatabaseReadCommandError["code"],
  message: string,
  retryable = false,
): DatabaseReadCommandError => ({ code, message, retryable });

export type BoundDatabaseReadIdentity =
  | {
      readonly ok: true;
      readonly value: {
        readonly projectId: string;
        readonly resourceId: string;
      };
    }
  | { readonly ok: false; readonly error: DatabaseReadCommandError };

export const bindDatabaseReadIdentity = (
  rawProjectId: unknown,
  rawResourceId: unknown,
): BoundDatabaseReadIdentity => {
  try {
    return {
      ok: true,
      value: {
        projectId: readIdentity(rawProjectId, "projectId"),
        resourceId: readIdentity(rawResourceId, "resourceId"),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: databaseReadFailure(
        "invalid_database_read_request",
        error instanceof Error
          ? error.message
          : "Database read scope is invalid",
      ),
    };
  }
};

export const databaseReadHttpStatus = (
  result:
    | { readonly ok: true }
    | { readonly ok: false; readonly error: DatabaseReadCommandError },
): 200 | 400 | 404 | 409 | 500 => {
  if (result.ok) return 200;
  if (result.error.code === "project_not_found") return 404;
  if (result.error.code === "store_not_initialized") return 409;
  if (result.error.code === "database_state_corrupt") return 500;
  if (result.error.code === "unknown") return 500;
  return 400;
};

export const databaseTransportFailure = (
  request: DatabaseMutationRequest,
  error: unknown,
): DatabaseMutationCommandResult => ({
  ok: false,
  error: databaseMutationFailure(
    "unknown",
    error instanceof Error
      ? error.message
      : "The durable Database writer is unavailable",
    { operationId: request.operationId, retryable: true },
  ),
});

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

export const parseDatabaseMutationCommandResult = (
  value: unknown,
): DatabaseMutationCommandResult => {
  if (!isRecord(value)) {
    throw new DatabaseMutationContractError(
      "Database mutation transport result must be an object",
    );
  }
  if (value.ok === true && hasExactKeys(value, ["ok", "value"])) {
    return { ok: true, value: parseDatabaseMutationReceipt(value.value) };
  }
  if (value.ok === false && hasExactKeys(value, ["ok", "error"])) {
    return {
      ok: false,
      error: parseDatabaseMutationCommandError(value.error),
    };
  }
  throw new DatabaseMutationContractError(
    "Database mutation transport result has an invalid envelope",
  );
};

export const parseDatabaseReadCommandResult = <T>(
  value: unknown,
): DatabaseReadCommandResult<T> => {
  if (!isRecord(value)) {
    throw new TypeError("Database read transport result must be an object");
  }
  if (
    value.ok === false &&
    hasExactKeys(value, ["ok", "error"]) &&
    isRecord(value.error) &&
    hasExactKeys(value.error, ["code", "message", "retryable"])
  ) {
    const code = value.error.code;
    const message = value.error.message;
    const retryable = value.error.retryable;
    if (
      typeof code !== "string" ||
      !DATABASE_READ_ERROR_CODES.has(
        code as DatabaseReadCommandError["code"],
      ) ||
      typeof message !== "string" ||
      typeof retryable !== "boolean"
    ) {
      throw new TypeError("Database read transport error is invalid");
    }
    return {
      ok: false,
      error: {
        code: code as DatabaseReadCommandError["code"],
        message,
        retryable,
      },
    };
  }
  if (
    value.ok !== true ||
    !hasExactKeys(value, ["ok", "value"]) ||
    !isRecord(value.value) ||
    !hasExactKeys(value.value, [
      "version",
      "projectId",
      "storeEpoch",
      "changeLogSeq",
      "value",
    ])
  ) {
    throw new TypeError(
      "Database read transport result has an invalid envelope",
    );
  }
  const snapshot = value.value;
  if (
    snapshot.version !== 1 ||
    typeof snapshot.projectId !== "string" ||
    snapshot.projectId.length === 0 ||
    snapshot.projectId !== snapshot.projectId.trim() ||
    typeof snapshot.storeEpoch !== "string" ||
    snapshot.storeEpoch.length === 0 ||
    snapshot.storeEpoch !== snapshot.storeEpoch.trim() ||
    !Number.isSafeInteger(snapshot.changeLogSeq) ||
    Number(snapshot.changeLogSeq) < 0 ||
    !("value" in snapshot)
  ) {
    throw new TypeError("Database read transport snapshot is invalid");
  }
  const jsonValue = JSON.parse(
    stableStringifyDatabaseJson(snapshot.value),
  ) as T | null;
  return {
    ok: true,
    value: {
      version: 1,
      projectId: snapshot.projectId,
      storeEpoch: snapshot.storeEpoch,
      changeLogSeq: Number(snapshot.changeLogSeq),
      value: jsonValue,
    },
  };
};

export const parseDatabaseViewSnapshotCommandResult = (
  value: unknown,
): DatabaseViewSnapshotCommandResult => {
  if (!isRecord(value)) {
    throw new TypeError(
      "Primary Database View snapshot result must be an object",
    );
  }
  if (value.ok === false) {
    const parsed = parseDatabaseReadCommandResult<never>(value);
    if (!parsed.ok) return parsed;
    throw new TypeError("Primary Database View snapshot error is invalid");
  }
  if (
    value.ok !== true ||
    !hasExactKeys(value, ["ok", "value"]) ||
    !isRecord(value.value) ||
    !hasExactKeys(value.value, ["descriptor", "query"])
  ) {
    throw new TypeError(
      "Primary Database View snapshot result has an invalid envelope",
    );
  }
  const descriptor = parseDatabaseReadCommandResult<GeneralDatabaseDescriptor>({
    ok: true,
    value: value.value.descriptor,
  });
  const query = parseDatabaseReadCommandResult<GeneralDatabaseViewQuery>({
    ok: true,
    value: value.value.query,
  });
  if (!descriptor.ok || !query.ok) {
    throw new TypeError("Primary Database View snapshot is invalid");
  }
  if (
    descriptor.value.projectId !== query.value.projectId ||
    descriptor.value.storeEpoch !== query.value.storeEpoch ||
    descriptor.value.changeLogSeq !== query.value.changeLogSeq
  ) {
    throw new TypeError(
      "Primary Database View snapshot does not share one authority cursor",
    );
  }
  return {
    ok: true,
    value: {
      descriptor: descriptor.value,
      query: query.value,
    },
  };
};

export const parseDatabaseCatalogSnapshotCommandResult = (
  value: unknown,
): DatabaseCatalogSnapshotCommandResult =>
  parseDatabaseReadCommandResult<GeneralDatabaseCatalog>(value);

export const parsePrimaryDatabaseViewSnapshotCommandResult = (
  value: unknown,
): PrimaryDatabaseViewSnapshotCommandResult =>
  parseDatabaseViewSnapshotCommandResult(value);
