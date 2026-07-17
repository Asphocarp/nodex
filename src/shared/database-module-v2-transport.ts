import { stableStringifyBlockPropertyJson } from "./block-property-mutations";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourceOptionId,
  parseDataSourcePropertyId,
  type DatabaseId,
  type DatabaseViewId,
  type DataSourceId,
  type DataSourceOptionId,
  type DataSourcePropertyId,
} from "./database-identities";
import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  MAX_DATABASE_MODULE_V2_BULK_ENTRIES,
  MAX_DATABASE_MODULE_V2_OPERATIONS,
  type DatabaseApplyOperationV2,
  type DatabaseApplyResultV2,
  type DatabaseApplyV2,
  type DatabaseContainerDescriptorV2,
  type DatabaseContainerRecordV2,
  type DatabaseModuleErrorCodeV2,
  type DatabaseModuleErrorV2,
  type DatabaseModuleReadRequestV2,
  type DatabaseModuleReadResultV2,
  type DatabaseReadValueV2,
  type DatabaseViewQueryResultV2,
  type DatabaseViewRecordV2,
  type DataSourceDescriptorV2,
  type DataSourcePageRowV2,
  type DataSourcePageValueV2,
  type DataSourcePropertyRecordV2,
  type DataSourceQueryResultV2,
  type DataSourceRecordV2,
} from "./database-module-v2";
import {
  parseDatabasePropertyConfig,
  parseDatabaseViewConfigV2,
  type DatabaseJsonValue,
  type DatabasePropertyValueType,
  type DatabaseViewKind,
} from "./database-kernel";
import { parsePage } from "./page";

const MAX_ID_LENGTH = 512;
const MAX_NAME_LENGTH = 256;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new TypeError(`${label} must be an object`);
};

const assertExactKeys = (
  value: Readonly<Record<string, unknown>>,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void => {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (Object.prototype.hasOwnProperty.call(value, key)) continue;
    throw new TypeError(`${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    throw new TypeError(`${label}.${key} is not supported`);
  }
};

const readString = (
  value: unknown,
  label: string,
  maximumLength = MAX_ID_LENGTH,
): string => {
  if (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return value;
  }
  throw new TypeError(`${label} must be a canonical non-empty string`);
};

const readOptionalString = (
  value: unknown,
  label: string,
  maximumLength = MAX_ID_LENGTH,
): string | undefined =>
  value === undefined ? undefined : readString(value, label, maximumLength);

const readRevision = (value: unknown, label: string): number => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  throw new TypeError(`${label} must be a safe non-negative revision`);
};

const readPositiveRevision = (value: unknown, label: string): number => {
  const parsed = readRevision(value, label);
  if (parsed >= 1) return parsed;
  throw new TypeError(`${label} must be a positive revision`);
};

const readBoolean = (value: unknown, label: string): boolean => {
  if (typeof value === "boolean") return value;
  throw new TypeError(`${label} must be a boolean`);
};

const readTimestamp = (value: unknown, label: string): string => {
  const timestamp = readString(value, label);
  const milliseconds = Date.parse(timestamp);
  if (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === timestamp
  ) {
    return timestamp;
  }
  throw new TypeError(`${label} must be a canonical UTC ISO-8601 timestamp`);
};

const readJsonValue = (value: unknown, label: string): DatabaseJsonValue => {
  try {
    return JSON.parse(
      stableStringifyBlockPropertyJson(value),
    ) as DatabaseJsonValue;
  } catch (error) {
    throw new TypeError(`${label} must be bounded plain JSON`, { cause: error });
  }
};

const readJsonRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, DatabaseJsonValue>> => {
  const parsed = readJsonValue(value, label);
  if (isRecord(parsed)) {
    return parsed as Readonly<Record<string, DatabaseJsonValue>>;
  }
  throw new TypeError(`${label} must be a JSON object`);
};

const readDatabaseId = (value: unknown, label: string): DatabaseId => {
  try {
    return parseDatabaseId(value);
  } catch (error) {
    throw new TypeError(`${label} is invalid`, { cause: error });
  }
};

const readDataSourceId = (value: unknown, label: string): DataSourceId => {
  try {
    return parseDataSourceId(value);
  } catch (error) {
    throw new TypeError(`${label} is invalid`, { cause: error });
  }
};

const readViewId = (value: unknown, label: string): DatabaseViewId => {
  try {
    return parseDatabaseViewId(value);
  } catch (error) {
    throw new TypeError(`${label} is invalid`, { cause: error });
  }
};

const readPropertyId = (
  value: unknown,
  label: string,
): DataSourcePropertyId => {
  try {
    return parseDataSourcePropertyId(value);
  } catch (error) {
    throw new TypeError(`${label} is invalid`, { cause: error });
  }
};

const readOptionId = (
  propertyId: DataSourcePropertyId,
  value: unknown,
  label: string,
): DataSourceOptionId => {
  try {
    return parseDataSourceOptionId({ propertyId, value });
  } catch (error) {
    throw new TypeError(`${label} is invalid for Property ${propertyId}`, {
      cause: error,
    });
  }
};

const readPropertyValueType = (
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

const readViewKind = (value: unknown, label: string): DatabaseViewKind => {
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

const BUILT_IN_PROPERTY_VALUE_TYPES: Readonly<
  Partial<Record<string, DatabasePropertyValueType>>
> = {
  status: "select",
  priority: "select",
  estimate: "select",
  tags: "multi_select",
  due_date: "date",
  scheduled_start: "datetime",
  scheduled_end: "datetime",
  assignee: "person",
};

const validateBuiltInPropertyValueType = (
  propertyId: DataSourcePropertyId,
  valueType: DatabasePropertyValueType,
  label: string,
): void => {
  const expected = BUILT_IN_PROPERTY_VALUE_TYPES[propertyId];
  if (expected === undefined || expected === valueType) return;
  throw new TypeError(
    `${label} reserved Property ${propertyId} must use ${expected}`,
  );
};

const parsePropertyMutationConfig = (
  value: unknown,
  label: string,
): Readonly<Record<string, never>> => {
  const config = readJsonRecord(value, label);
  const key = Object.keys(config)[0];
  if (key === undefined) return {};
  if (key === "options") {
    throw new TypeError(
      `${label}.options is not supported; use put_option or delete_option`,
    );
  }
  throw new TypeError(`${label}.${key} is not supported by Property schema v2`);
};

const parseStoredPropertyConfig = (
  propertyId: DataSourcePropertyId,
  valueType: DatabasePropertyValueType,
  value: unknown,
  label: string,
): Readonly<Record<string, DatabaseJsonValue>> => {
  const parsed = parseDatabasePropertyConfig(
    valueType,
    readJsonRecord(value, label),
  );
  const options = parsed.options;
  if (Array.isArray(options)) {
    for (const [index, rawOption] of options.entries()) {
      const option = readRecord(rawOption, `${label}.options[${index}]`);
      readOptionId(
        propertyId,
        option.id,
        `${label}.options[${index}].id`,
      );
    }
  }
  return parsed;
};

const readOptionIdArray = (
  value: unknown,
  propertyId: DataSourcePropertyId,
  label: string,
): readonly DataSourceOptionId[] => {
  if (!Array.isArray(value) || value.length > MAX_DATABASE_MODULE_V2_BULK_ENTRIES) {
    throw new TypeError(
      `${label} must be an array of at most ${MAX_DATABASE_MODULE_V2_BULK_ENTRIES} option identities`,
    );
  }
  const parsed = value.map((entry, index) =>
    readOptionId(propertyId, entry, `${label}[${index}]`),
  );
  if (new Set(parsed).size !== parsed.length) {
    throw new TypeError(`${label} must contain unique option identities`);
  }
  return parsed;
};

const parseSetValueFields = (
  value: Readonly<Record<string, unknown>>,
  label: string,
): Omit<
  Extract<DatabaseApplyOperationV2, { readonly kind: "set_value" }>,
  "kind"
> => ({
  pageId: readString(value.pageId, `${label}.pageId`),
  dataSourceId: readDataSourceId(value.dataSourceId, `${label}.dataSourceId`),
  propertyId: readPropertyId(value.propertyId, `${label}.propertyId`),
  expectedValueRevision: readRevision(
    value.expectedValueRevision,
    `${label}.expectedValueRevision`,
  ),
  value: readJsonValue(value.value, `${label}.value`),
});

const parseApplyOperation = (
  value: unknown,
  index: number,
): DatabaseApplyOperationV2 => {
  const operation = readRecord(value, `databaseApplyV2.operations[${index}]`);
  const label = `databaseApplyV2.operations[${index}]`;

  if (operation.kind === "put_property") {
    assertExactKeys(
      operation,
      label,
      [
        "kind",
        "dataSourceId",
        "propertyId",
        "expectedDataSourceRevision",
        "expectedPropertyRevision",
        "name",
        "valueType",
        "config",
      ],
      ["beforePropertyId"],
    );
    const propertyId = readPropertyId(operation.propertyId, `${label}.propertyId`);
    const valueType = readPropertyValueType(
      operation.valueType,
      `${label}.valueType`,
    );
    validateBuiltInPropertyValueType(propertyId, valueType, label);
    const beforePropertyId = operation.beforePropertyId === undefined
      ? undefined
      : readPropertyId(operation.beforePropertyId, `${label}.beforePropertyId`);
    return {
      kind: "put_property",
      dataSourceId: readDataSourceId(operation.dataSourceId, `${label}.dataSourceId`),
      propertyId,
      expectedDataSourceRevision: readRevision(
        operation.expectedDataSourceRevision,
        `${label}.expectedDataSourceRevision`,
      ),
      expectedPropertyRevision: readRevision(
        operation.expectedPropertyRevision,
        `${label}.expectedPropertyRevision`,
      ),
      name: readString(operation.name, `${label}.name`, MAX_NAME_LENGTH),
      valueType,
      config: parsePropertyMutationConfig(operation.config, `${label}.config`),
      ...(beforePropertyId === undefined ? {} : { beforePropertyId }),
    };
  }

  if (operation.kind === "delete_property") {
    assertExactKeys(operation, label, [
      "kind",
      "dataSourceId",
      "propertyId",
      "expectedDataSourceRevision",
      "expectedPropertyRevision",
    ]);
    return {
      kind: "delete_property",
      dataSourceId: readDataSourceId(operation.dataSourceId, `${label}.dataSourceId`),
      propertyId: readPropertyId(operation.propertyId, `${label}.propertyId`),
      expectedDataSourceRevision: readRevision(
        operation.expectedDataSourceRevision,
        `${label}.expectedDataSourceRevision`,
      ),
      expectedPropertyRevision: readRevision(
        operation.expectedPropertyRevision,
        `${label}.expectedPropertyRevision`,
      ),
    };
  }

  if (operation.kind === "put_option") {
    assertExactKeys(
      operation,
      label,
      [
        "kind",
        "dataSourceId",
        "propertyId",
        "optionId",
        "name",
        "expectedPropertyRevision",
      ],
      ["color"],
    );
    const propertyId = readPropertyId(operation.propertyId, `${label}.propertyId`);
    const color = readOptionalString(operation.color, `${label}.color`, MAX_NAME_LENGTH);
    return {
      kind: "put_option",
      dataSourceId: readDataSourceId(operation.dataSourceId, `${label}.dataSourceId`),
      propertyId,
      optionId: readOptionId(propertyId, operation.optionId, `${label}.optionId`),
      name: readString(operation.name, `${label}.name`, MAX_NAME_LENGTH),
      ...(color === undefined ? {} : { color }),
      expectedPropertyRevision: readRevision(
        operation.expectedPropertyRevision,
        `${label}.expectedPropertyRevision`,
      ),
    };
  }

  if (operation.kind === "delete_option") {
    assertExactKeys(operation, label, [
      "kind",
      "dataSourceId",
      "propertyId",
      "optionId",
      "expectedPropertyRevision",
    ]);
    const propertyId = readPropertyId(operation.propertyId, `${label}.propertyId`);
    return {
      kind: "delete_option",
      dataSourceId: readDataSourceId(operation.dataSourceId, `${label}.dataSourceId`),
      propertyId,
      optionId: readOptionId(propertyId, operation.optionId, `${label}.optionId`),
      expectedPropertyRevision: readRevision(
        operation.expectedPropertyRevision,
        `${label}.expectedPropertyRevision`,
      ),
    };
  }

  if (operation.kind === "set_value") {
    assertExactKeys(operation, label, [
      "kind",
      "pageId",
      "dataSourceId",
      "propertyId",
      "expectedValueRevision",
      "value",
    ]);
    return { kind: "set_value", ...parseSetValueFields(operation, label) };
  }

  if (operation.kind === "set_values") {
    assertExactKeys(operation, label, ["kind", "values"]);
    if (
      !Array.isArray(operation.values) ||
      operation.values.length < 1 ||
      operation.values.length > MAX_DATABASE_MODULE_V2_BULK_ENTRIES
    ) {
      throw new TypeError(
        `${label}.values must contain between 1 and ${MAX_DATABASE_MODULE_V2_BULK_ENTRIES} entries`,
      );
    }
    const values = operation.values.map((entry, valueIndex) => {
      const valueLabel = `${label}.values[${valueIndex}]`;
      const record = readRecord(entry, valueLabel);
      assertExactKeys(record, valueLabel, [
        "pageId",
        "dataSourceId",
        "propertyId",
        "expectedValueRevision",
        "value",
      ]);
      return parseSetValueFields(record, valueLabel);
    });
    const addresses = values.map(
      (entry) => `${entry.dataSourceId}\u0000${entry.pageId}\u0000${entry.propertyId}`,
    );
    if (new Set(addresses).size !== addresses.length) {
      throw new TypeError(`${label}.values repeats a Page Property address`);
    }
    return { kind: "set_values", values };
  }

  if (operation.kind === "add_remove_value") {
    assertExactKeys(operation, label, [
      "kind",
      "pageId",
      "dataSourceId",
      "propertyId",
      "add",
      "remove",
    ]);
    const propertyId = readPropertyId(operation.propertyId, `${label}.propertyId`);
    const add = readOptionIdArray(operation.add, propertyId, `${label}.add`);
    const remove = readOptionIdArray(operation.remove, propertyId, `${label}.remove`);
    if (add.some((entry) => remove.includes(entry))) {
      throw new TypeError(`${label}.add and remove must be disjoint`);
    }
    if (add.length === 0 && remove.length === 0) {
      throw new TypeError(`${label} must change at least one option`);
    }
    return {
      kind: "add_remove_value",
      pageId: readString(operation.pageId, `${label}.pageId`),
      dataSourceId: readDataSourceId(operation.dataSourceId, `${label}.dataSourceId`),
      propertyId,
      add,
      remove,
    };
  }

  if (operation.kind === "transfer_page") {
    assertExactKeys(operation, label, [
      "kind",
      "pageId",
      "expectedParentRevision",
      "expectedActiveMembershipRevision",
      "target",
    ]);
    const target = readRecord(operation.target, `${label}.target`);
    let parsedTarget: Extract<
      DatabaseApplyOperationV2,
      { readonly kind: "transfer_page" }
    >["target"];
    if (target.kind === "library") {
      assertExactKeys(target, `${label}.target`, ["kind", "libraryId"]);
      parsedTarget = {
        kind: "library",
        libraryId: readString(target.libraryId, `${label}.target.libraryId`),
      };
    } else if (target.kind === "page") {
      assertExactKeys(target, `${label}.target`, ["kind", "pageId"]);
      parsedTarget = {
        kind: "page",
        pageId: readString(target.pageId, `${label}.target.pageId`),
      };
    } else if (target.kind === "data_source") {
      assertExactKeys(target, `${label}.target`, ["kind", "dataSourceId"]);
      parsedTarget = {
        kind: "data_source",
        dataSourceId: readDataSourceId(
          target.dataSourceId,
          `${label}.target.dataSourceId`,
        ),
      };
    } else {
      throw new TypeError(`${label}.target.kind is unsupported`);
    }
    return {
      kind: "transfer_page",
      pageId: readString(operation.pageId, `${label}.pageId`),
      expectedParentRevision: readRevision(
        operation.expectedParentRevision,
        `${label}.expectedParentRevision`,
      ),
      expectedActiveMembershipRevision: readRevision(
        operation.expectedActiveMembershipRevision,
        `${label}.expectedActiveMembershipRevision`,
      ),
      target: parsedTarget,
    };
  }

  if (operation.kind === "put_view") {
    assertExactKeys(
      operation,
      label,
      [
        "kind",
        "databaseId",
        "dataSourceId",
        "viewId",
        "expectedRevision",
        "name",
        "viewKind",
        "config",
        "isDefault",
      ],
      ["beforeViewId"],
    );
    const beforeViewId = operation.beforeViewId === null
      ? null
      : operation.beforeViewId === undefined
        ? undefined
        : readViewId(operation.beforeViewId, `${label}.beforeViewId`);
    return {
      kind: "put_view",
      databaseId: readDatabaseId(operation.databaseId, `${label}.databaseId`),
      dataSourceId: readDataSourceId(operation.dataSourceId, `${label}.dataSourceId`),
      viewId: readViewId(operation.viewId, `${label}.viewId`),
      expectedRevision: readRevision(operation.expectedRevision, `${label}.expectedRevision`),
      name: readString(operation.name, `${label}.name`, MAX_NAME_LENGTH),
      viewKind: readViewKind(operation.viewKind, `${label}.viewKind`),
      config: parseDatabaseViewConfigV2(operation.config),
      isDefault: readBoolean(operation.isDefault, `${label}.isDefault`),
      ...(beforeViewId === undefined ? {} : { beforeViewId }),
    };
  }

  if (operation.kind === "delete_view") {
    assertExactKeys(operation, label, [
      "kind",
      "databaseId",
      "viewId",
      "expectedRevision",
    ]);
    return {
      kind: "delete_view",
      databaseId: readDatabaseId(operation.databaseId, `${label}.databaseId`),
      viewId: readViewId(operation.viewId, `${label}.viewId`),
      expectedRevision: readRevision(operation.expectedRevision, `${label}.expectedRevision`),
    };
  }

  if (operation.kind === "position_page") {
    assertExactKeys(
      operation,
      label,
      [
        "kind",
        "viewId",
        "pageId",
        "expectedPositionRevision",
        "groupKey",
      ],
      ["beforePageId"],
    );
    const beforePageId = readOptionalString(operation.beforePageId, `${label}.beforePageId`);
    return {
      kind: "position_page",
      viewId: readViewId(operation.viewId, `${label}.viewId`),
      pageId: readString(operation.pageId, `${label}.pageId`),
      expectedPositionRevision: readRevision(
        operation.expectedPositionRevision,
        `${label}.expectedPositionRevision`,
      ),
      groupKey: operation.groupKey === null
        ? null
        : readString(operation.groupKey, `${label}.groupKey`),
      ...(beforePageId === undefined ? {} : { beforePageId }),
    };
  }

  if (operation.kind === "position_pages") {
    assertExactKeys(
      operation,
      label,
      ["kind", "viewId", "pages", "groupKey"],
      ["beforePageId"],
    );
    if (
      !Array.isArray(operation.pages) ||
      operation.pages.length < 1 ||
      operation.pages.length > MAX_DATABASE_MODULE_V2_BULK_ENTRIES
    ) {
      throw new TypeError(
        `${label}.pages must contain between 1 and ${MAX_DATABASE_MODULE_V2_BULK_ENTRIES} entries`,
      );
    }
    const pages = operation.pages.map((entry, pageIndex) => {
      const pageLabel = `${label}.pages[${pageIndex}]`;
      const record = readRecord(entry, pageLabel);
      assertExactKeys(record, pageLabel, ["pageId", "expectedPositionRevision"]);
      return {
        pageId: readString(record.pageId, `${pageLabel}.pageId`),
        expectedPositionRevision: readRevision(
          record.expectedPositionRevision,
          `${pageLabel}.expectedPositionRevision`,
        ),
      };
    });
    if (new Set(pages.map((entry) => entry.pageId)).size !== pages.length) {
      throw new TypeError(`${label}.pages repeats a Page identity`);
    }
    const beforePageId = readOptionalString(operation.beforePageId, `${label}.beforePageId`);
    if (beforePageId && pages.some((entry) => entry.pageId === beforePageId)) {
      throw new TypeError(`${label}.beforePageId must be outside the moved Page set`);
    }
    return {
      kind: "position_pages",
      viewId: readViewId(operation.viewId, `${label}.viewId`),
      pages,
      groupKey: operation.groupKey === null
        ? null
        : readString(operation.groupKey, `${label}.groupKey`),
      ...(beforePageId === undefined ? {} : { beforePageId }),
    };
  }

  throw new TypeError(`${label}.kind is unsupported`);
};

export interface TrustedDatabaseModuleIdentityV2 {
  readonly actor: Readonly<Record<string, DatabaseJsonValue>>;
}

export const bindDatabaseApplyV2 = (
  raw: unknown,
  routeProjectId: unknown,
  trusted: TrustedDatabaseModuleIdentityV2,
): DatabaseApplyV2 => {
  const request = readRecord(raw, "databaseApplyV2");
  assertExactKeys(request, "databaseApplyV2", [
    "version",
    "operationId",
    "projectId",
    "storeEpoch",
    "actor",
    "operations",
  ]);
  if (request.version !== DATABASE_MODULE_V2_CONTRACT_VERSION) {
    throw new TypeError("Unsupported Database Module v2 contract version");
  }
  const projectId = readString(routeProjectId, "projectId");
  if (readString(request.projectId, "databaseApplyV2.projectId") !== projectId) {
    throw new TypeError("Database apply v2 does not match its Project route scope");
  }
  if (
    !Array.isArray(request.operations) ||
    request.operations.length < 1 ||
    request.operations.length > MAX_DATABASE_MODULE_V2_OPERATIONS
  ) {
    throw new TypeError(
      `databaseApplyV2.operations must contain between 1 and ${MAX_DATABASE_MODULE_V2_OPERATIONS} operations`,
    );
  }
  return {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
    operationId: readString(request.operationId, "databaseApplyV2.operationId"),
    projectId,
    storeEpoch: readString(request.storeEpoch, "databaseApplyV2.storeEpoch"),
    actor: readJsonRecord(trusted.actor, "trusted.actor"),
    operations: request.operations.map(parseApplyOperation),
  };
};

export const bindDatabaseModuleReadV2 = (
  raw: unknown,
  routeProjectId: unknown,
): DatabaseModuleReadRequestV2 => {
  const request = readRecord(raw, "databaseModuleReadV2");
  assertExactKeys(request, "databaseModuleReadV2", ["version", "projectId", "read"]);
  if (request.version !== DATABASE_MODULE_V2_CONTRACT_VERSION) {
    throw new TypeError("Unsupported Database Module v2 read contract version");
  }
  const projectId = readString(routeProjectId, "projectId");
  if (readString(request.projectId, "databaseModuleReadV2.projectId") !== projectId) {
    throw new TypeError("Database read v2 does not match its Project route scope");
  }
  const read = readRecord(request.read, "databaseModuleReadV2.read");
  const target = readRecord(read.target, "databaseModuleReadV2.read.target");
  const mode = read.mode;

  if (target.kind === "project_default") {
    assertExactKeys(target, "databaseModuleReadV2.read.target", ["kind"]);
    assertExactKeys(read, "databaseModuleReadV2.read", ["target", "mode"]);
    if (mode !== "catalog" && mode !== "database" && mode !== "query") {
      throw new TypeError("Project-default Database read v2 mode is unsupported");
    }
    return {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId,
      read: { target: { kind: "project_default" }, mode },
    };
  }

  if (target.kind === "database" && mode === "database") {
    assertExactKeys(target, "databaseModuleReadV2.read.target", ["kind", "databaseId"]);
    assertExactKeys(read, "databaseModuleReadV2.read", ["target", "mode"]);
    return {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId,
      read: {
        target: {
          kind: "database",
          databaseId: readDatabaseId(
            target.databaseId,
            "databaseModuleReadV2.databaseId",
          ),
        },
        mode,
      },
    };
  }

  if (target.kind === "data_source" && mode === "data_source") {
    assertExactKeys(target, "databaseModuleReadV2.read.target", ["kind", "dataSourceId"]);
    assertExactKeys(read, "databaseModuleReadV2.read", ["target", "mode"]);
    return {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId,
      read: {
        target: {
          kind: "data_source",
          dataSourceId: readDataSourceId(
            target.dataSourceId,
            "databaseModuleReadV2.dataSourceId",
          ),
        },
        mode,
      },
    };
  }

  if (target.kind === "data_source" && mode === "query") {
    assertExactKeys(target, "databaseModuleReadV2.read.target", ["kind", "dataSourceId"]);
    assertExactKeys(read, "databaseModuleReadV2.read", ["target", "mode"], ["filter", "sort"]);
    const config = parseDatabaseViewConfigV2({
      schemaKey: "nodex.database-view",
      schemaVersion: 2,
      filter: read.filter ?? { kind: "group", operator: "and", children: [] },
      sort: read.sort ?? [],
      group: null,
      display: { propertyIds: [], showTitle: true },
    });
    if (config.sort.some((sort) => sort.field.kind === "manual")) {
      throw new TypeError("Data Source queries cannot use manual View order");
    }
    return {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId,
      read: {
        target: {
          kind: "data_source",
          dataSourceId: readDataSourceId(
            target.dataSourceId,
            "databaseModuleReadV2.dataSourceId",
          ),
        },
        mode,
        ...(read.filter === undefined ? {} : { filter: config.filter }),
        ...(read.sort === undefined ? {} : { sort: config.sort }),
      },
    };
  }

  if (target.kind === "view" && (mode === "view" || mode === "query")) {
    assertExactKeys(target, "databaseModuleReadV2.read.target", ["kind", "viewId"]);
    assertExactKeys(read, "databaseModuleReadV2.read", ["target", "mode"]);
    return {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId,
      read: {
        target: {
          kind: "view",
          viewId: readViewId(target.viewId, "databaseModuleReadV2.viewId"),
        },
        mode,
      },
    };
  }

  throw new TypeError("Database Module v2 read target and mode are incompatible");
};

const DATABASE_MODULE_ERROR_CODES = new Set<DatabaseModuleErrorCodeV2>([
  "invalid_request",
  "store_not_initialized",
  "project_not_found",
  "resource_not_found",
  "authorization_denied",
  "revision_conflict",
  "operation_id_collision",
  "identity_conflict",
  "state_corrupt",
  "unsupported_operation",
  "unknown",
]);

const parseDatabaseModuleErrorV2 = (value: unknown): DatabaseModuleErrorV2 => {
  const error = readRecord(value, "databaseModuleErrorV2");
  assertExactKeys(
    error,
    "databaseModuleErrorV2",
    ["code", "message", "retryable"],
    ["operationId", "expectedRevision", "actualRevision"],
  );
  if (
    typeof error.code !== "string" ||
    !DATABASE_MODULE_ERROR_CODES.has(error.code as DatabaseModuleErrorCodeV2)
  ) {
    throw new TypeError("Database Module v2 error code is unsupported");
  }
  const operationId = readOptionalString(
    error.operationId,
    "databaseModuleErrorV2.operationId",
  );
  const expectedRevision = error.expectedRevision === undefined
    ? undefined
    : readRevision(error.expectedRevision, "databaseModuleErrorV2.expectedRevision");
  const actualRevision = error.actualRevision === undefined
    ? undefined
    : readRevision(error.actualRevision, "databaseModuleErrorV2.actualRevision");
  return {
    code: error.code as DatabaseModuleErrorCodeV2,
    message: readString(error.message, "databaseModuleErrorV2.message", 4_096),
    retryable: readBoolean(error.retryable, "databaseModuleErrorV2.retryable"),
    ...(operationId === undefined ? {} : { operationId }),
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    ...(actualRevision === undefined ? {} : { actualRevision }),
  };
};

export const databaseModuleFailureV2 = (
  code: DatabaseModuleErrorCodeV2,
  message: string,
  operationId?: string,
): DatabaseModuleErrorV2 => ({
  code,
  message,
  retryable: code === "unknown" || code === "store_not_initialized",
  ...(operationId === undefined ? {} : { operationId }),
});

export const databaseModuleHttpStatusV2 = (
  error: DatabaseModuleErrorV2,
): 400 | 403 | 404 | 409 | 500 | 503 => {
  if (error.code === "authorization_denied") return 403;
  if (error.code === "project_not_found" || error.code === "resource_not_found") {
    return 404;
  }
  if (
    error.code === "revision_conflict" ||
    error.code === "operation_id_collision" ||
    error.code === "identity_conflict"
  ) {
    return 409;
  }
  if (error.code === "store_not_initialized") return 503;
  if (error.code === "state_corrupt" || error.code === "unknown") return 500;
  return 400;
};

const readLifecycle = <Value extends string>(
  value: unknown,
  label: string,
  allowed: readonly Value[],
): Value => {
  if (typeof value === "string" && allowed.includes(value as Value)) {
    return value as Value;
  }
  throw new TypeError(`${label} is unsupported`);
};

const parseContainerRecord = (
  value: unknown,
  label: string,
): DatabaseContainerRecordV2 => {
  const record = readRecord(value, label);
  assertExactKeys(record, label, [
    "databaseId",
    "libraryId",
    "name",
    "lifecycle",
    "defaultViewId",
    "accessRevision",
    "metadataRevision",
    "createdAt",
    "updatedAt",
  ]);
  return {
    databaseId: readDatabaseId(record.databaseId, `${label}.databaseId`),
    libraryId: readString(record.libraryId, `${label}.libraryId`),
    name: readString(record.name, `${label}.name`, MAX_NAME_LENGTH),
    lifecycle: readLifecycle(record.lifecycle, `${label}.lifecycle`, [
      "active",
      "archived",
      "deleted",
    ] as const),
    defaultViewId: record.defaultViewId === null
      ? null
      : readViewId(record.defaultViewId, `${label}.defaultViewId`),
    accessRevision: readPositiveRevision(record.accessRevision, `${label}.accessRevision`),
    metadataRevision: readPositiveRevision(record.metadataRevision, `${label}.metadataRevision`),
    createdAt: readTimestamp(record.createdAt, `${label}.createdAt`),
    updatedAt: readTimestamp(record.updatedAt, `${label}.updatedAt`),
  };
};

const parseDataSourceRecord = (
  value: unknown,
  label: string,
): DataSourceRecordV2 => {
  const record = readRecord(value, label);
  assertExactKeys(record, label, [
    "dataSourceId",
    "libraryId",
    "homeDatabaseId",
    "name",
    "schemaKey",
    "schemaRevision",
    "lifecycle",
    "rankKey",
    "createdAt",
    "updatedAt",
  ]);
  return {
    dataSourceId: readDataSourceId(record.dataSourceId, `${label}.dataSourceId`),
    libraryId: readString(record.libraryId, `${label}.libraryId`),
    homeDatabaseId: readDatabaseId(record.homeDatabaseId, `${label}.homeDatabaseId`),
    name: readString(record.name, `${label}.name`, MAX_NAME_LENGTH),
    schemaKey: readString(record.schemaKey, `${label}.schemaKey`),
    schemaRevision: readPositiveRevision(record.schemaRevision, `${label}.schemaRevision`),
    lifecycle: readLifecycle(record.lifecycle, `${label}.lifecycle`, [
      "active",
      "archived",
      "deleted",
    ] as const),
    rankKey: readString(record.rankKey, `${label}.rankKey`),
    createdAt: readTimestamp(record.createdAt, `${label}.createdAt`),
    updatedAt: readTimestamp(record.updatedAt, `${label}.updatedAt`),
  };
};

const parsePropertyRecord = (
  value: unknown,
  label: string,
): DataSourcePropertyRecordV2 => {
  const record = readRecord(value, label);
  assertExactKeys(record, label, [
    "propertyId",
    "dataSourceId",
    "name",
    "valueType",
    "config",
    "rankKey",
    "lifecycle",
    "revision",
    "createdAt",
    "updatedAt",
  ]);
  const propertyId = readPropertyId(record.propertyId, `${label}.propertyId`);
  const valueType = readPropertyValueType(record.valueType, `${label}.valueType`);
  validateBuiltInPropertyValueType(propertyId, valueType, label);
  return {
    propertyId,
    dataSourceId: readDataSourceId(record.dataSourceId, `${label}.dataSourceId`),
    name: readString(record.name, `${label}.name`, MAX_NAME_LENGTH),
    valueType,
    config: parseStoredPropertyConfig(
      propertyId,
      valueType,
      record.config,
      `${label}.config`,
    ),
    rankKey: readString(record.rankKey, `${label}.rankKey`),
    lifecycle: readLifecycle(record.lifecycle, `${label}.lifecycle`, [
      "active",
      "deleted",
    ] as const),
    revision: readPositiveRevision(record.revision, `${label}.revision`),
    createdAt: readTimestamp(record.createdAt, `${label}.createdAt`),
    updatedAt: readTimestamp(record.updatedAt, `${label}.updatedAt`),
  };
};

const parseViewRecord = (
  value: unknown,
  label: string,
): DatabaseViewRecordV2 => {
  const record = readRecord(value, label);
  assertExactKeys(record, label, [
    "viewId",
    "databaseId",
    "dataSourceId",
    "name",
    "kind",
    "config",
    "isDefault",
    "revision",
    "rankKey",
    "lifecycle",
    "createdAt",
    "updatedAt",
  ]);
  return {
    viewId: readViewId(record.viewId, `${label}.viewId`),
    databaseId: readDatabaseId(record.databaseId, `${label}.databaseId`),
    dataSourceId: readDataSourceId(record.dataSourceId, `${label}.dataSourceId`),
    name: readString(record.name, `${label}.name`, MAX_NAME_LENGTH),
    kind: readViewKind(record.kind, `${label}.kind`),
    config: parseDatabaseViewConfigV2(record.config),
    isDefault: readBoolean(record.isDefault, `${label}.isDefault`),
    revision: readPositiveRevision(record.revision, `${label}.revision`),
    rankKey: readString(record.rankKey, `${label}.rankKey`),
    lifecycle: readLifecycle(record.lifecycle, `${label}.lifecycle`, [
      "active",
      "deleted",
    ] as const),
    createdAt: readTimestamp(record.createdAt, `${label}.createdAt`),
    updatedAt: readTimestamp(record.updatedAt, `${label}.updatedAt`),
  };
};

const parseContainerDescriptor = (
  value: unknown,
  label: string,
): DatabaseContainerDescriptorV2 => {
  const descriptor = readRecord(value, label);
  assertExactKeys(descriptor, label, ["database", "dataSources", "views"]);
  if (!Array.isArray(descriptor.dataSources) || !Array.isArray(descriptor.views)) {
    throw new TypeError(`${label} collections must be arrays`);
  }
  const database = parseContainerRecord(descriptor.database, `${label}.database`);
  const dataSources = descriptor.dataSources.map((entry, index) =>
    parseDataSourceRecord(entry, `${label}.dataSources[${index}]`),
  );
  const views = descriptor.views.map((entry, index) =>
    parseViewRecord(entry, `${label}.views[${index}]`),
  );
  if (dataSources.some((entry) => entry.homeDatabaseId !== database.databaseId)) {
    throw new TypeError(`${label} contains a Data Source owned by another Database`);
  }
  if (views.some((entry) => entry.databaseId !== database.databaseId)) {
    throw new TypeError(`${label} contains a View owned by another Database`);
  }
  return { database, dataSources, views };
};

const parseDataSourceDescriptor = (
  value: unknown,
  label: string,
): DataSourceDescriptorV2 => {
  const descriptor = readRecord(value, label);
  assertExactKeys(descriptor, label, ["dataSource", "properties"]);
  if (!Array.isArray(descriptor.properties)) {
    throw new TypeError(`${label}.properties must be an array`);
  }
  const dataSource = parseDataSourceRecord(descriptor.dataSource, `${label}.dataSource`);
  const properties = descriptor.properties.map((entry, index) =>
    parsePropertyRecord(entry, `${label}.properties[${index}]`),
  );
  if (properties.some((entry) => entry.dataSourceId !== dataSource.dataSourceId)) {
    throw new TypeError(`${label} contains a Property owned by another Data Source`);
  }
  return { dataSource, properties };
};

const parsePageValue = (
  value: unknown,
  label: string,
): DataSourcePageValueV2 => {
  const record = readRecord(value, label);
  assertExactKeys(record, label, ["propertyId", "valueType", "value", "revision"]);
  return {
    propertyId: readPropertyId(record.propertyId, `${label}.propertyId`),
    valueType: readPropertyValueType(record.valueType, `${label}.valueType`),
    value: readJsonValue(record.value, `${label}.value`),
    revision: readPositiveRevision(record.revision, `${label}.revision`),
  };
};

const parsePageRow = (value: unknown, label: string): DataSourcePageRowV2 => {
  const row = readRecord(value, label);
  assertExactKeys(row, label, [
    "page",
    "membership",
    "values",
    "position",
    "effectiveGroupKey",
  ]);
  const page = parsePage(row.page);
  const membership = readRecord(row.membership, `${label}.membership`);
  assertExactKeys(membership, `${label}.membership`, [
    "membershipId",
    "dataSourceId",
    "revision",
    "createdAt",
  ]);
  const rawValues = readRecord(row.values, `${label}.values`);
  const values = Object.fromEntries(
    Object.entries(rawValues).map(([key, entry]) => {
      const propertyId = readPropertyId(key, `${label}.values key`);
      const parsed = parsePageValue(entry, `${label}.values.${key}`);
      if (parsed.propertyId !== propertyId) {
        throw new TypeError(`${label}.values.${key} has a mismatched propertyId`);
      }
      return [propertyId, parsed] as const;
    }),
  );
  let position: DataSourcePageRowV2["position"] = null;
  if (row.position !== null) {
    const candidate = readRecord(row.position, `${label}.position`);
    assertExactKeys(candidate, `${label}.position`, ["groupKey", "rankKey", "revision"]);
    position = {
      groupKey: candidate.groupKey === null
        ? null
        : readString(candidate.groupKey, `${label}.position.groupKey`),
      rankKey: readString(candidate.rankKey, `${label}.position.rankKey`),
      revision: readPositiveRevision(candidate.revision, `${label}.position.revision`),
    };
  }
  return {
    page,
    membership: {
      membershipId: readString(membership.membershipId, `${label}.membership.membershipId`),
      dataSourceId: readDataSourceId(
        membership.dataSourceId,
        `${label}.membership.dataSourceId`,
      ),
      revision: readPositiveRevision(membership.revision, `${label}.membership.revision`),
      createdAt: readTimestamp(membership.createdAt, `${label}.membership.createdAt`),
    },
    values,
    position,
    effectiveGroupKey: row.effectiveGroupKey === null
      ? null
      : readString(row.effectiveGroupKey, `${label}.effectiveGroupKey`),
  };
};

const parseQueryCollections = (
  value: Readonly<Record<string, unknown>>,
  label: string,
): {
  readonly database: DatabaseContainerRecordV2;
  readonly dataSource: DataSourceRecordV2;
  readonly properties: readonly DataSourcePropertyRecordV2[];
  readonly rows: readonly DataSourcePageRowV2[];
} => {
  if (!Array.isArray(value.properties) || !Array.isArray(value.rows)) {
    throw new TypeError(`${label} properties and rows must be arrays`);
  }
  const database = parseContainerRecord(value.database, `${label}.database`);
  const dataSource = parseDataSourceRecord(value.dataSource, `${label}.dataSource`);
  const properties = value.properties.map((entry, index) =>
    parsePropertyRecord(entry, `${label}.properties[${index}]`),
  );
  const rows = value.rows.map((entry, index) =>
    parsePageRow(entry, `${label}.rows[${index}]`),
  );
  if (dataSource.homeDatabaseId !== database.databaseId) {
    throw new TypeError(`${label} Data Source belongs to another Database`);
  }
  if (properties.some((entry) => entry.dataSourceId !== dataSource.dataSourceId)) {
    throw new TypeError(`${label} contains a Property owned by another Data Source`);
  }
  if (rows.some((entry) => entry.membership.dataSourceId !== dataSource.dataSourceId)) {
    throw new TypeError(`${label} contains a row owned by another Data Source`);
  }
  return { database, dataSource, properties, rows };
};

const parseViewQueryResult = (
  value: unknown,
  label: string,
): DatabaseViewQueryResultV2 => {
  const result = readRecord(value, label);
  assertExactKeys(result, label, ["database", "dataSource", "view", "properties", "rows"]);
  const common = parseQueryCollections(result, label);
  const view = parseViewRecord(result.view, `${label}.view`);
  if (
    view.databaseId !== common.database.databaseId ||
    view.dataSourceId !== common.dataSource.dataSourceId
  ) {
    throw new TypeError(`${label} View has inconsistent ownership`);
  }
  return { ...common, view };
};

const parseDataSourceQueryResult = (
  value: unknown,
  label: string,
): DataSourceQueryResultV2 => {
  const result = readRecord(value, label);
  assertExactKeys(result, label, ["database", "dataSource", "properties", "rows"]);
  return parseQueryCollections(result, label);
};

const parseReadValue = (value: unknown): DatabaseReadValueV2 => {
  const result = readRecord(value, "databaseModuleReadV2.value");
  if (result.kind === "catalog") {
    assertExactKeys(result, "databaseModuleReadV2.value", ["kind", "databases"]);
    if (!Array.isArray(result.databases)) {
      throw new TypeError("databaseModuleReadV2.value.databases must be an array");
    }
    return {
      kind: "catalog",
      databases: result.databases.map((entry, index) =>
        parseContainerDescriptor(entry, `databaseModuleReadV2.value.databases[${index}]`),
      ),
    };
  }
  assertExactKeys(result, "databaseModuleReadV2.value", ["kind", "value"]);
  if (result.kind === "database") {
    return { kind: "database", value: parseContainerDescriptor(result.value, "databaseModuleReadV2.value.value") };
  }
  if (result.kind === "data_source") {
    return { kind: "data_source", value: parseDataSourceDescriptor(result.value, "databaseModuleReadV2.value.value") };
  }
  if (result.kind === "view") {
    return { kind: "view", value: parseViewRecord(result.value, "databaseModuleReadV2.value.value") };
  }
  if (result.kind === "query") {
    return { kind: "query", value: parseViewQueryResult(result.value, "databaseModuleReadV2.value.value") };
  }
  if (result.kind === "data_source_query") {
    return { kind: "data_source_query", value: parseDataSourceQueryResult(result.value, "databaseModuleReadV2.value.value") };
  }
  throw new TypeError("Database Module v2 read value kind is unsupported");
};

const parseResultEnvelope = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  const result = readRecord(value, label);
  const keys = Object.keys(result);
  if (
    keys.length !== 2 ||
    !Object.prototype.hasOwnProperty.call(result, "ok") ||
    (!Object.prototype.hasOwnProperty.call(result, "value") &&
      !Object.prototype.hasOwnProperty.call(result, "error"))
  ) {
    throw new TypeError(`${label} envelope is invalid`);
  }
  return result;
};

export const parseDatabaseModuleReadResultV2 = (
  value: unknown,
): DatabaseModuleReadResultV2 => {
  const result = parseResultEnvelope(value, "Database Module v2 read result");
  if (result.ok === false && Object.prototype.hasOwnProperty.call(result, "error")) {
    return { ok: false, error: parseDatabaseModuleErrorV2(result.error) };
  }
  if (result.ok !== true || !Object.prototype.hasOwnProperty.call(result, "value")) {
    throw new TypeError("Database Module v2 read result envelope is invalid");
  }
  const snapshot = readRecord(result.value, "databaseModuleReadV2.snapshot");
  assertExactKeys(snapshot, "databaseModuleReadV2.snapshot", [
    "version",
    "projectId",
    "libraryId",
    "storeEpoch",
    "changeLogSeq",
    "value",
  ]);
  if (snapshot.version !== DATABASE_MODULE_V2_CONTRACT_VERSION) {
    throw new TypeError("Database Module v2 read snapshot version is invalid");
  }
  return {
    ok: true,
    value: {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: readString(snapshot.projectId, "databaseModuleReadV2.snapshot.projectId"),
      libraryId: readString(snapshot.libraryId, "databaseModuleReadV2.snapshot.libraryId"),
      storeEpoch: readString(snapshot.storeEpoch, "databaseModuleReadV2.snapshot.storeEpoch"),
      changeLogSeq: readRevision(snapshot.changeLogSeq, "databaseModuleReadV2.snapshot.changeLogSeq"),
      value: parseReadValue(snapshot.value),
    },
  };
};

const readUniqueIdentityArray = <Identity extends string>(
  value: unknown,
  label: string,
  parse: (entry: unknown, entryLabel: string) => Identity,
): readonly Identity[] => {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const entries = value.map((entry, index) => parse(entry, `${label}[${index}]`));
  if (new Set(entries).size !== entries.length) {
    throw new TypeError(`${label} must contain unique identities`);
  }
  return entries;
};

const OPERATION_KINDS = new Set<DatabaseApplyOperationV2["kind"]>([
  "put_property",
  "delete_property",
  "put_option",
  "delete_option",
  "set_value",
  "set_values",
  "add_remove_value",
  "transfer_page",
  "put_view",
  "delete_view",
  "position_page",
  "position_pages",
]);

export const parseDatabaseApplyResultV2 = (
  value: unknown,
): DatabaseApplyResultV2 => {
  const result = parseResultEnvelope(value, "Database Module v2 apply result");
  if (result.ok === false && Object.prototype.hasOwnProperty.call(result, "error")) {
    return { ok: false, error: parseDatabaseModuleErrorV2(result.error) };
  }
  if (result.ok !== true || !Object.prototype.hasOwnProperty.call(result, "value")) {
    throw new TypeError("Database Module v2 apply result envelope is invalid");
  }
  const receipt = readRecord(result.value, "databaseApplyV2.receipt");
  assertExactKeys(receipt, "databaseApplyV2.receipt", [
    "version",
    "operationId",
    "projectId",
    "libraryId",
    "storeEpoch",
    "duplicate",
    "operationKinds",
    "affectedDatabaseIds",
    "affectedDataSourceIds",
    "affectedPageIds",
    "affectedViewIds",
    "committedRevisions",
    "changeLogSeq",
    "committedAt",
  ]);
  if (receipt.version !== DATABASE_MODULE_V2_CONTRACT_VERSION) {
    throw new TypeError("Database Module v2 apply receipt version is invalid");
  }
  if (!Array.isArray(receipt.operationKinds)) {
    throw new TypeError("databaseApplyV2.receipt.operationKinds must be an array");
  }
  const operationKinds = receipt.operationKinds.map((entry) => {
    if (typeof entry === "string" && OPERATION_KINDS.has(entry as DatabaseApplyOperationV2["kind"])) {
      return entry as DatabaseApplyOperationV2["kind"];
    }
    throw new TypeError("databaseApplyV2.receipt contains an unsupported operation kind");
  });
  const committedRevisionRecord = readRecord(
    receipt.committedRevisions,
    "databaseApplyV2.receipt.committedRevisions",
  );
  const committedRevisions = Object.fromEntries(
    Object.entries(committedRevisionRecord).map(([key, entry]) => [
      readString(key, "databaseApplyV2.receipt.committedRevisions key", 4_096),
      readRevision(entry, `databaseApplyV2.receipt.committedRevisions.${key}`),
    ]),
  );
  return {
    ok: true,
    value: {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: readString(receipt.operationId, "databaseApplyV2.receipt.operationId"),
      projectId: readString(receipt.projectId, "databaseApplyV2.receipt.projectId"),
      libraryId: readString(receipt.libraryId, "databaseApplyV2.receipt.libraryId"),
      storeEpoch: readString(receipt.storeEpoch, "databaseApplyV2.receipt.storeEpoch"),
      duplicate: readBoolean(receipt.duplicate, "databaseApplyV2.receipt.duplicate"),
      operationKinds,
      affectedDatabaseIds: readUniqueIdentityArray(
        receipt.affectedDatabaseIds,
        "databaseApplyV2.receipt.affectedDatabaseIds",
        readDatabaseId,
      ),
      affectedDataSourceIds: readUniqueIdentityArray(
        receipt.affectedDataSourceIds,
        "databaseApplyV2.receipt.affectedDataSourceIds",
        readDataSourceId,
      ),
      affectedPageIds: readUniqueIdentityArray(
        receipt.affectedPageIds,
        "databaseApplyV2.receipt.affectedPageIds",
        (entry, label) => readString(entry, label),
      ),
      affectedViewIds: readUniqueIdentityArray(
        receipt.affectedViewIds,
        "databaseApplyV2.receipt.affectedViewIds",
        readViewId,
      ),
      committedRevisions,
      changeLogSeq: readRevision(receipt.changeLogSeq, "databaseApplyV2.receipt.changeLogSeq"),
      committedAt: readTimestamp(receipt.committedAt, "databaseApplyV2.receipt.committedAt"),
    },
  };
};
