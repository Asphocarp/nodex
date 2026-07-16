import {
  DATABASE_MODULE_CONTRACT_VERSION,
  MAX_DATABASE_MODULE_BULK_ENTRIES,
  type DatabaseApply,
  type DatabaseApplyOperation,
  type DatabaseApplyResult,
  type DatabaseModuleError,
  type DatabaseModuleReadResult,
  type DatabaseModuleReadRequest,
} from "./database-module";
import {
  parseDatabasePropertyConfig,
  parseDatabaseViewConfig,
  type DatabaseJsonValue,
  type DatabasePropertyValueType,
  type DatabaseViewKind,
} from "./database-kernel";
import { stableStringifyBlockPropertyJson } from "./block-property-mutations";

const MAX_ID_LENGTH = 512;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const identity = (value: unknown, label: string): string => {
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

const revision = (value: unknown, label: string): number => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  throw new TypeError(`${label} must be a safe non-negative revision`);
};

const optionalIdentity = (
  value: unknown,
  label: string,
): string | undefined =>
  value === undefined ? undefined : identity(value, label);

const jsonValue = (value: unknown, label: string): DatabaseJsonValue => {
  try {
    return JSON.parse(stableStringifyBlockPropertyJson(value)) as DatabaseJsonValue;
  } catch (error) {
    throw new TypeError(`${label} must be bounded plain JSON`, { cause: error });
  }
};

const jsonRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, DatabaseJsonValue>> => {
  const parsed = jsonValue(value, label);
  if (isRecord(parsed)) {
    return parsed as Readonly<Record<string, DatabaseJsonValue>>;
  }
  throw new TypeError(`${label} must be a JSON object`);
};

const propertyValueType = (
  value: unknown,
  label: string,
): DatabasePropertyValueType => {
  if (
    value === "text" ||
    value === "number" ||
    value === "checkbox" ||
    value === "select" ||
    value === "multi_select" ||
    value === "date" ||
    value === "datetime" ||
    value === "person"
  ) {
    return value;
  }
  throw new TypeError(`${label} is unsupported`);
};

const viewKind = (value: unknown, label: string): DatabaseViewKind => {
  if (
    value === "kanban" ||
    value === "list" ||
    value === "calendar" ||
    value === "canvas"
  ) {
    return value;
  }
  throw new TypeError(`${label} is unsupported`);
};

const boolean = (value: unknown, label: string): boolean => {
  if (typeof value === "boolean") return value;
  throw new TypeError(`${label} must be a boolean`);
};

const operationRecord = (
  value: unknown,
  index: number,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new TypeError(`databaseApply.operations[${index}] must be an object`);
};

const parseOperation = (
  value: unknown,
  index: number,
): DatabaseApplyOperation => {
  const operation = operationRecord(value, index);
  const label = `databaseApply.operations[${index}]`;
  const kind = operation.kind;
  if (kind === "put_property") {
    const valueType = propertyValueType(
      operation.valueType,
      `${label}.valueType`,
    );
    const beforePropertyId = optionalIdentity(
      operation.beforePropertyId,
      `${label}.beforePropertyId`,
    );
    return {
      kind,
      dataSourceId: identity(operation.dataSourceId, `${label}.dataSourceId`),
      propertyId: identity(operation.propertyId, `${label}.propertyId`),
      expectedDataSourceRevision: revision(
        operation.expectedDataSourceRevision,
        `${label}.expectedDataSourceRevision`,
      ),
      expectedPropertyRevision: revision(
        operation.expectedPropertyRevision,
        `${label}.expectedPropertyRevision`,
      ),
      key: identity(operation.key, `${label}.key`),
      name: identity(operation.name, `${label}.name`),
      valueType,
      config: parseDatabasePropertyConfig(
        valueType,
        jsonRecord(operation.config, `${label}.config`),
      ),
      ...(beforePropertyId ? { beforePropertyId } : {}),
    };
  }
  if (kind === "delete_property") {
    return {
      kind,
      dataSourceId: identity(operation.dataSourceId, `${label}.dataSourceId`),
      propertyId: identity(operation.propertyId, `${label}.propertyId`),
      expectedDataSourceRevision: revision(
        operation.expectedDataSourceRevision,
        `${label}.expectedDataSourceRevision`,
      ),
      expectedPropertyRevision: revision(
        operation.expectedPropertyRevision,
        `${label}.expectedPropertyRevision`,
      ),
    };
  }
  if (kind === "set_value") {
    return {
      kind,
      pageId: identity(operation.pageId, `${label}.pageId`),
      dataSourceId: identity(operation.dataSourceId, `${label}.dataSourceId`),
      propertyId: identity(operation.propertyId, `${label}.propertyId`),
      expectedValueRevision: revision(
        operation.expectedValueRevision,
        `${label}.expectedValueRevision`,
      ),
      value: jsonValue(operation.value, `${label}.value`),
    };
  }
  if (kind === "set_values") {
    if (
      !Array.isArray(operation.values)
      || operation.values.length < 1
      || operation.values.length > MAX_DATABASE_MODULE_BULK_ENTRIES
    ) {
      throw new TypeError(
        `${label}.values must contain between 1 and ${MAX_DATABASE_MODULE_BULK_ENTRIES} entries`,
      );
    }
    return {
      kind,
      values: operation.values.map((rawEntry, valueIndex) => {
        if (!isRecord(rawEntry)) {
          throw new TypeError(`${label}.values[${valueIndex}] must be an object`);
        }
        const valueLabel = `${label}.values[${valueIndex}]`;
        return {
          pageId: identity(rawEntry.pageId, `${valueLabel}.pageId`),
          dataSourceId: identity(
            rawEntry.dataSourceId,
            `${valueLabel}.dataSourceId`,
          ),
          propertyId: identity(rawEntry.propertyId, `${valueLabel}.propertyId`),
          expectedValueRevision: revision(
            rawEntry.expectedValueRevision,
            `${valueLabel}.expectedValueRevision`,
          ),
          value: jsonValue(rawEntry.value, `${valueLabel}.value`),
        };
      }),
    };
  }
  if (kind === "add_remove_value") {
    const readSet = (raw: unknown, setLabel: string): readonly string[] => {
      if (
        !Array.isArray(raw)
        || raw.length > MAX_DATABASE_MODULE_BULK_ENTRIES
      ) {
        throw new TypeError(
          `${setLabel} must be an array of at most ${MAX_DATABASE_MODULE_BULK_ENTRIES} identities`,
        );
      }
      const values = raw.map((entry, entryIndex) =>
        identity(entry, `${setLabel}[${entryIndex}]`));
      if (new Set(values).size !== values.length) {
        throw new TypeError(`${setLabel} must contain unique identities`);
      }
      return values;
    };
    const add = readSet(operation.add, `${label}.add`);
    const remove = readSet(operation.remove, `${label}.remove`);
    if (add.some((entry) => remove.includes(entry))) {
      throw new TypeError(`${label}.add and remove must be disjoint`);
    }
    if (add.length === 0 && remove.length === 0) {
      throw new TypeError(`${label} must change at least one value`);
    }
    return {
      kind,
      pageId: identity(operation.pageId, `${label}.pageId`),
      dataSourceId: identity(operation.dataSourceId, `${label}.dataSourceId`),
      propertyId: identity(operation.propertyId, `${label}.propertyId`),
      add,
      remove,
    };
  }
  if (kind === "transfer_page") {
    const target = operation.target;
    if (!isRecord(target)) {
      throw new TypeError(`${label}.target must be an object`);
    }
    const parsedTarget = target.kind === "library"
      ? {
          kind: "library" as const,
          libraryId: identity(target.libraryId, `${label}.target.libraryId`),
        }
      : target.kind === "page"
        ? {
            kind: "page" as const,
            pageId: identity(target.pageId, `${label}.target.pageId`),
          }
      : target.kind === "data_source"
        ? {
            kind: "data_source" as const,
            dataSourceId: identity(
              target.dataSourceId,
              `${label}.target.dataSourceId`,
            ),
          }
        : null;
    if (!parsedTarget) {
      throw new TypeError(`${label}.target.kind is unsupported`);
    }
    return {
      kind,
      pageId: identity(operation.pageId, `${label}.pageId`),
      expectedParentRevision: revision(
        operation.expectedParentRevision,
        `${label}.expectedParentRevision`,
      ),
      expectedActiveMembershipRevision: revision(
        operation.expectedActiveMembershipRevision,
        `${label}.expectedActiveMembershipRevision`,
      ),
      target: parsedTarget,
    };
  }
  if (kind === "put_view") {
    const beforeViewId = operation.beforeViewId === null
      ? null
      : optionalIdentity(
          operation.beforeViewId,
          `${label}.beforeViewId`,
        );
    return {
      kind,
      databaseId: identity(operation.databaseId, `${label}.databaseId`),
      dataSourceId: identity(operation.dataSourceId, `${label}.dataSourceId`),
      viewId: identity(operation.viewId, `${label}.viewId`),
      expectedRevision: revision(operation.expectedRevision, `${label}.expectedRevision`),
      name: identity(operation.name, `${label}.name`),
      viewKind: viewKind(operation.viewKind, `${label}.viewKind`),
      config: parseDatabaseViewConfig(operation.config),
      isDefault: boolean(operation.isDefault, `${label}.isDefault`),
      ...(beforeViewId === undefined ? {} : { beforeViewId }),
    };
  }
  if (kind === "delete_view") {
    return {
      kind,
      databaseId: identity(operation.databaseId, `${label}.databaseId`),
      viewId: identity(operation.viewId, `${label}.viewId`),
      expectedRevision: revision(operation.expectedRevision, `${label}.expectedRevision`),
    };
  }
  if (kind === "position_page") {
    const beforePageId = optionalIdentity(
      operation.beforePageId,
      `${label}.beforePageId`,
    );
    return {
      kind,
      viewId: identity(operation.viewId, `${label}.viewId`),
      pageId: identity(operation.pageId, `${label}.pageId`),
      expectedPositionRevision: revision(
        operation.expectedPositionRevision,
        `${label}.expectedPositionRevision`,
      ),
      groupKey: operation.groupKey === null
        ? null
        : identity(operation.groupKey, `${label}.groupKey`),
      ...(beforePageId ? { beforePageId } : {}),
    };
  }
  if (kind === "position_pages") {
    if (
      !Array.isArray(operation.pages)
      || operation.pages.length < 1
      || operation.pages.length > MAX_DATABASE_MODULE_BULK_ENTRIES
    ) {
      throw new TypeError(
        `${label}.pages must contain between 1 and ${MAX_DATABASE_MODULE_BULK_ENTRIES} entries`,
      );
    }
    const beforePageId = optionalIdentity(
      operation.beforePageId,
      `${label}.beforePageId`,
    );
    return {
      kind,
      viewId: identity(operation.viewId, `${label}.viewId`),
      pages: operation.pages.map((rawEntry, pageIndex) => {
        if (!isRecord(rawEntry)) {
          throw new TypeError(`${label}.pages[${pageIndex}] must be an object`);
        }
        const pageLabel = `${label}.pages[${pageIndex}]`;
        return {
          pageId: identity(rawEntry.pageId, `${pageLabel}.pageId`),
          expectedPositionRevision: revision(
            rawEntry.expectedPositionRevision,
            `${pageLabel}.expectedPositionRevision`,
          ),
        };
      }),
      groupKey: operation.groupKey === null
        ? null
        : identity(operation.groupKey, `${label}.groupKey`),
      ...(beforePageId ? { beforePageId } : {}),
    };
  }
  throw new TypeError(`${label}.kind is unsupported`);
};

export interface TrustedDatabaseModuleIdentity {
  readonly actor: Readonly<Record<string, DatabaseJsonValue>>;
}

export const bindDatabaseApply = (
  raw: unknown,
  routeProjectId: unknown,
  trusted: TrustedDatabaseModuleIdentity,
): DatabaseApply => {
  if (!isRecord(raw)) throw new TypeError("databaseApply must be an object");
  const projectId = identity(routeProjectId, "projectId");
  if (identity(raw.projectId, "databaseApply.projectId") !== projectId) {
    throw new TypeError("Database apply does not match its Project route scope");
  }
  if (raw.version !== DATABASE_MODULE_CONTRACT_VERSION) {
    throw new TypeError("Unsupported Database Module contract version");
  }
  if (!Array.isArray(raw.operations) || raw.operations.length < 1 || raw.operations.length > 64) {
    throw new TypeError("databaseApply.operations must contain between 1 and 64 operations");
  }
  return {
    version: DATABASE_MODULE_CONTRACT_VERSION,
    operationId: identity(raw.operationId, "databaseApply.operationId"),
    projectId,
    storeEpoch: identity(raw.storeEpoch, "databaseApply.storeEpoch"),
    actor: trusted.actor,
    operations: raw.operations.map(parseOperation),
  };
};

export const bindDatabaseModuleRead = (
  raw: unknown,
  routeProjectId: unknown,
): DatabaseModuleReadRequest => {
  if (!isRecord(raw)) throw new TypeError("databaseModuleRead must be an object");
  const projectId = identity(routeProjectId, "projectId");
  if (identity(raw.projectId, "databaseModuleRead.projectId") !== projectId) {
    throw new TypeError("Database read does not match its Project route scope");
  }
  if (raw.version !== DATABASE_MODULE_CONTRACT_VERSION || !isRecord(raw.read)) {
    throw new TypeError("Database Module read contract is invalid");
  }
  const read = raw.read;
  if (!isRecord(read.target)) throw new TypeError("databaseModuleRead.read.target must be an object");
  const mode = read.mode;
  if (read.target.kind === "project_default") {
    if (mode !== "catalog" && mode !== "database" && mode !== "query") {
      throw new TypeError("Project-default Database read mode is unsupported");
    }
    return { version: DATABASE_MODULE_CONTRACT_VERSION, projectId, read: { target: { kind: "project_default" }, mode } };
  }
  if (read.target.kind === "database" && mode === "database") {
    return { version: DATABASE_MODULE_CONTRACT_VERSION, projectId, read: { target: { kind: "database", databaseId: identity(read.target.databaseId, "databaseModuleRead.databaseId") }, mode } };
  }
  if (read.target.kind === "data_source" && mode === "data_source") {
    return { version: DATABASE_MODULE_CONTRACT_VERSION, projectId, read: { target: { kind: "data_source", dataSourceId: identity(read.target.dataSourceId, "databaseModuleRead.dataSourceId") }, mode } };
  }
  if (read.target.kind === "data_source" && mode === "query") {
    const queryConfig = parseDatabaseViewConfig({
      schemaKey: "nodex.database-view",
      schemaVersion: 1,
      filter: read.filter ?? { kind: "group", operator: "and", children: [] },
      sort: read.sort ?? [],
      group: null,
      display: { propertyIds: [], showTitle: true },
    });
    if (queryConfig.sort.some((sort) => sort.field.kind === "manual")) {
      throw new TypeError("Data Source queries cannot use manual View order");
    }
    return {
      version: DATABASE_MODULE_CONTRACT_VERSION,
      projectId,
      read: {
        target: {
          kind: "data_source",
          dataSourceId: identity(
            read.target.dataSourceId,
            "databaseModuleRead.dataSourceId",
          ),
        },
        mode,
        ...(read.filter === undefined
          ? {}
          : { filter: queryConfig.filter }),
        ...(read.sort === undefined
          ? {}
          : { sort: queryConfig.sort }),
      },
    };
  }
  if (read.target.kind === "view" && (mode === "view" || mode === "query")) {
    return { version: DATABASE_MODULE_CONTRACT_VERSION, projectId, read: { target: { kind: "view", viewId: identity(read.target.viewId, "databaseModuleRead.viewId") }, mode } };
  }
  throw new TypeError("Database Module read target and mode are incompatible");
};

export const databaseModuleFailure = (
  code: DatabaseModuleError["code"],
  message: string,
  operationId?: string,
): DatabaseModuleError => ({
  code,
  message,
  retryable: code === "unknown" || code === "store_not_initialized",
  ...(operationId ? { operationId } : {}),
});

export const databaseModuleHttpStatus = (
  error: DatabaseModuleError,
): 400 | 403 | 404 | 409 | 500 | 503 => {
  if (error.code === "authorization_denied") return 403;
  if (error.code === "project_not_found" || error.code === "resource_not_found") return 404;
  if (error.code === "revision_conflict" || error.code === "operation_id_collision") return 409;
  if (error.code === "store_not_initialized") return 503;
  if (error.code === "state_corrupt" || error.code === "unknown") return 500;
  return 400;
};

const hasResultEnvelope = (
  value: Readonly<Record<string, unknown>>,
  branch: "value" | "error",
): boolean => {
  const keys = new Set(Object.keys(value));
  return keys.size === 2 && keys.has("ok") && keys.has(branch);
};

const parseModuleError = (value: unknown): DatabaseModuleError => {
  if (!isRecord(value)) throw new TypeError("Database Module error is invalid");
  const code = value.code;
  if (
    code !== "invalid_request" &&
    code !== "store_not_initialized" &&
    code !== "project_not_found" &&
    code !== "resource_not_found" &&
    code !== "authorization_denied" &&
    code !== "revision_conflict" &&
    code !== "operation_id_collision" &&
    code !== "state_corrupt" &&
    code !== "unsupported_operation" &&
    code !== "unknown"
  ) {
    throw new TypeError("Database Module error code is unsupported");
  }
  if (typeof value.message !== "string" || typeof value.retryable !== "boolean") {
    throw new TypeError("Database Module error payload is invalid");
  }
  const operationId = optionalIdentity(value.operationId, "error.operationId");
  const expectedRevision = value.expectedRevision === undefined
    ? undefined
    : revision(value.expectedRevision, "error.expectedRevision");
  const actualRevision = value.actualRevision === undefined
    ? undefined
    : revision(value.actualRevision, "error.actualRevision");
  return {
    code,
    message: value.message,
    retryable: value.retryable,
    ...(operationId ? { operationId } : {}),
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    ...(actualRevision === undefined ? {} : { actualRevision }),
  };
};

export const parseDatabaseModuleReadResult = (
  value: unknown,
): DatabaseModuleReadResult => {
  if (!isRecord(value)) throw new TypeError("Database Module read result is invalid");
  if (value.ok === false && hasResultEnvelope(value, "error")) {
    return { ok: false, error: parseModuleError(value.error) };
  }
  if (value.ok !== true || !hasResultEnvelope(value, "value") || !isRecord(value.value)) {
    throw new TypeError("Database Module read result envelope is invalid");
  }
  const snapshot = value.value;
  if (
    snapshot.version !== DATABASE_MODULE_CONTRACT_VERSION ||
    !Number.isSafeInteger(snapshot.changeLogSeq) ||
    (snapshot.changeLogSeq as number) < 0 ||
    !isRecord(snapshot.value)
  ) {
    throw new TypeError("Database Module read snapshot is invalid");
  }
  identity(snapshot.projectId, "snapshot.projectId");
  identity(snapshot.libraryId, "snapshot.libraryId");
  identity(snapshot.storeEpoch, "snapshot.storeEpoch");
  return value as unknown as DatabaseModuleReadResult;
};

export const parseDatabaseApplyResult = (
  value: unknown,
): DatabaseApplyResult => {
  if (!isRecord(value)) throw new TypeError("Database Module apply result is invalid");
  if (value.ok === false && hasResultEnvelope(value, "error")) {
    return { ok: false, error: parseModuleError(value.error) };
  }
  if (value.ok !== true || !hasResultEnvelope(value, "value") || !isRecord(value.value)) {
    throw new TypeError("Database Module apply result envelope is invalid");
  }
  const receipt = value.value;
  if (
    receipt.version !== DATABASE_MODULE_CONTRACT_VERSION ||
    typeof receipt.duplicate !== "boolean" ||
    !Array.isArray(receipt.operationKinds) ||
    !Array.isArray(receipt.affectedDatabaseIds) ||
    !Array.isArray(receipt.affectedDataSourceIds) ||
    !Array.isArray(receipt.affectedPageIds) ||
    !Array.isArray(receipt.affectedViewIds) ||
    !isRecord(receipt.committedRevisions) ||
    !Number.isSafeInteger(receipt.changeLogSeq) ||
    typeof receipt.committedAt !== "string"
  ) {
    throw new TypeError("Database Module apply receipt is invalid");
  }
  identity(receipt.operationId, "receipt.operationId");
  identity(receipt.projectId, "receipt.projectId");
  identity(receipt.libraryId, "receipt.libraryId");
  identity(receipt.storeEpoch, "receipt.storeEpoch");
  return value as unknown as DatabaseApplyResult;
};
