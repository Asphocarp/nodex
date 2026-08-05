import { stableStringifyBlockPropertyJson } from "./block-property-mutations";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourceOptionId,
  parseDataSourcePropertyId,
  isBuiltInDataSourcePropertyId,
  type DatabaseId,
  type DatabaseViewId,
  type DataSourceId,
  type DataSourceOptionId,
  type DataSourcePropertyId,
  type BuiltInDataSourcePropertyId,
} from "./database-identities";
import { BUILT_IN_DATA_SOURCE_PROPERTY_DEFINITIONS } from "./data-source-built-ins";
import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  MAX_DATABASE_MODULE_V2_BULK_ENTRIES,
  MAX_DATABASE_MODULE_V2_OPERATIONS,
  type DatabaseApplyOperationV2,
  type DatabasePropertyValueInputV2,
  type DatabaseApplyResultV2,
  type DatabaseApplyV2,
  type DatabaseContainerDescriptorV2,
  type DatabaseContainerRecordV2,
  type DatabaseModuleErrorCodeV2,
  type DatabaseModuleErrorV2,
  type DatabaseModuleReadRequestV2,
  type DatabaseModuleReadResultV2,
  type LibraryDatabaseModuleReadRequestV2,
  type LibraryDatabaseModuleReadResultV2,
  type LibraryDatabaseReadV2,
  type LibraryDatabaseApplyV2,
  type LibraryDatabaseApplyResultV2,
  type DatabaseReadValueV2,
  type DatabaseViewQueryResultV2,
  type DatabaseViewRecordV2,
  type DataSourceDescriptorV2,
  type DataSourcePageRowV2,
  type DataSourcePageValueV2,
  type PageIntrinsicPropertyValueV2,
  type DataSourcePropertyRecordV2,
  type DataSourceQueryResultV2,
  type DataSourceRecordV2,
} from "./database-module-v2";
import {
  parseDatabaseViewConfigV2,
  type DatabaseJsonValue,
  type DatabasePropertyValueType,
  type DatabaseViewKind,
} from "./database-kernel";
import { parsePage } from "./page";
import { MAX_PAGE_DESCRIPTION_LENGTH } from "./page-limits";

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

const readUtf8String = (
  value: unknown,
  label: string,
  maximumBytes: number,
): string => {
  const parsed = readString(value, label, maximumBytes);
  if (new TextEncoder().encode(parsed).byteLength <= maximumBytes) return parsed;
  throw new TypeError(`${label} must be at most ${maximumBytes} UTF-8 bytes`);
};

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
    value === "person" ||
    value === "relation"
  ) {
    return value;
  }
  throw new TypeError(`${label} is unsupported`);
};

const readViewKind = (value: unknown, label: string): DatabaseViewKind => {
  if (
    value === "kanban" ||
    value === "list" ||
    value === "calendar"
  ) {
    return value;
  }
  throw new TypeError(`${label} is unsupported`);
};

const validateBuiltInPropertyValueType = (
  propertyId: DataSourcePropertyId,
  valueType: DatabasePropertyValueType,
  label: string,
): void => {
  if (!isBuiltInDataSourcePropertyId(propertyId)) return;
  const builtInPropertyId = propertyId as BuiltInDataSourcePropertyId;
  const expected = BUILT_IN_DATA_SOURCE_PROPERTY_DEFINITIONS[builtInPropertyId].valueType;
  if (expected === valueType) return;
  throw new TypeError(
    `${label} reserved Property ${propertyId} must use ${expected}`,
  );
};

const parseStoredPropertyConfig = (
  _propertyId: DataSourcePropertyId,
  _valueType: DatabasePropertyValueType,
  value: unknown,
  label: string,
): Readonly<Record<string, DatabaseJsonValue>> => {
  const parsed = readJsonRecord(value, label);
  assertExactKeys(parsed, label, []);
  return {};
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

const parsePropertySchema = (
  value: unknown,
  label: string,
): NonNullable<DataSourcePropertyRecordV2["schema"]> => {
  const schema = readRecord(value, label);
  const kind = schema.kind;
  if (kind === "relation") {
    assertExactKeys(schema, label, ["kind", "targetDataSourceId"]);
    return {
      kind,
      targetDataSourceId: readDataSourceId(
        schema.targetDataSourceId,
        `${label}.targetDataSourceId`,
      ),
    };
  }
  if (
    kind === "text" || kind === "number" || kind === "checkbox"
    || kind === "select" || kind === "multi_select" || kind === "date"
    || kind === "datetime" || kind === "person"
  ) {
    assertExactKeys(schema, label, ["kind"]);
    return { kind };
  }
  throw new TypeError(`${label}.kind is unsupported`);
};

const readIdentityArray = (
  value: unknown,
  label: string,
  maximum: number,
): readonly string[] => {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} must contain at most ${maximum} identities`);
  }
  const ids = value.map((entry, index) => readString(entry, `${label}[${index}]`));
  if (new Set(ids).size !== ids.length) {
    throw new TypeError(`${label} must contain unique identities`);
  }
  return ids;
};

const parsePropertyValueInput = (
  value: unknown,
  propertyId: DataSourcePropertyId,
  label: string,
): DatabasePropertyValueInputV2 => {
  const input = readRecord(value, label);
  const kind = input.kind;
  if (kind === "empty") {
    assertExactKeys(input, label, ["kind"]);
    return { kind };
  }
  if (kind === "text" || kind === "date" || kind === "datetime") {
    assertExactKeys(input, label, ["kind", "value"]);
    return { kind, value: readString(input.value, `${label}.value`, 64 * 1024) };
  }
  if (kind === "number") {
    assertExactKeys(input, label, ["kind", "value"]);
    if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
      throw new TypeError(`${label}.value must be finite`);
    }
    return { kind, value: input.value };
  }
  if (kind === "checkbox") {
    assertExactKeys(input, label, ["kind", "value"]);
    return { kind, value: readBoolean(input.value, `${label}.value`) };
  }
  if (kind === "select") {
    assertExactKeys(input, label, ["kind", "optionId"]);
    return { kind, optionId: readOptionId(propertyId, input.optionId, `${label}.optionId`) };
  }
  if (kind === "multi_select") {
    assertExactKeys(input, label, ["kind", "optionIds"]);
    return { kind, optionIds: readOptionIdArray(input.optionIds, propertyId, `${label}.optionIds`) };
  }
  if (kind === "person") {
    assertExactKeys(input, label, ["kind", "personId"]);
    return { kind, personId: readString(input.personId, `${label}.personId`) };
  }
  if (kind === "relation") {
    assertExactKeys(input, label, ["kind", "pageIds"]);
    return {
      kind,
      pageIds: readIdentityArray(input.pageIds, `${label}.pageIds`, 10_000),
    };
  }
  throw new TypeError(`${label}.kind is unsupported`);
};

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
        "schema",
      ],
      ["beforePropertyId"],
    );
    const propertyId = readPropertyId(operation.propertyId, `${label}.propertyId`);
    const schema = parsePropertySchema(operation.schema, `${label}.schema`);
    validateBuiltInPropertyValueType(propertyId, schema.kind, label);
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
      schema,
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

  if (operation.kind === "edit_property_values") {
    assertExactKeys(operation, label, ["kind", "edits"]);
    if (!Array.isArray(operation.edits) || operation.edits.length < 1
      || operation.edits.length > MAX_DATABASE_MODULE_V2_BULK_ENTRIES) {
      throw new TypeError(`${label}.edits must be a non-empty bounded array`);
    }
    const edits = operation.edits.map((rawEdit, editIndex) => {
      const editLabel = `${label}.edits[${editIndex}]`;
      const mutation = readRecord(rawEdit, editLabel);
      assertExactKeys(mutation, editLabel, ["pageId", "dataSourceId", "propertyId", "edit"]);
      const propertyId = readPropertyId(mutation.propertyId, `${editLabel}.propertyId`);
      const edit = readRecord(mutation.edit, `${editLabel}.edit`);
      if (edit.kind === "replace") {
        assertExactKeys(edit, `${editLabel}.edit`, ["kind", "expectedValueRevision", "value"]);
        return {
          pageId: readString(mutation.pageId, `${editLabel}.pageId`),
          dataSourceId: readDataSourceId(mutation.dataSourceId, `${editLabel}.dataSourceId`),
          propertyId,
          edit: {
            kind: "replace" as const,
            expectedValueRevision: readRevision(edit.expectedValueRevision, `${editLabel}.edit.expectedValueRevision`),
            value: parsePropertyValueInput(edit.value, propertyId, `${editLabel}.edit.value`),
          },
        };
      }
      if (edit.kind !== "patch_set") {
        throw new TypeError(`${editLabel}.edit.kind is unsupported`);
      }
      assertExactKeys(edit, `${editLabel}.edit`, ["kind", "delta"]);
      const delta = readRecord(edit.delta, `${editLabel}.edit.delta`);
      let parsedDelta;
      if (delta.kind === "multi_select") {
        assertExactKeys(delta, `${editLabel}.edit.delta`, ["kind", "addOptionIds", "removeOptionIds"]);
        parsedDelta = {
          kind: "multi_select" as const,
          addOptionIds: readOptionIdArray(delta.addOptionIds, propertyId, `${editLabel}.edit.delta.addOptionIds`),
          removeOptionIds: readOptionIdArray(delta.removeOptionIds, propertyId, `${editLabel}.edit.delta.removeOptionIds`),
        };
      } else if (delta.kind === "relation") {
        assertExactKeys(delta, `${editLabel}.edit.delta`, ["kind", "addPageIds", "removePageIds"]);
        parsedDelta = {
          kind: "relation" as const,
          addPageIds: readIdentityArray(
            delta.addPageIds,
            `${editLabel}.edit.delta.addPageIds`,
            MAX_DATABASE_MODULE_V2_BULK_ENTRIES,
          ),
          removePageIds: readIdentityArray(
            delta.removePageIds,
            `${editLabel}.edit.delta.removePageIds`,
            MAX_DATABASE_MODULE_V2_BULK_ENTRIES,
          ),
        };
      } else {
        throw new TypeError(`${editLabel}.edit.delta.kind is unsupported`);
      }
      const add = parsedDelta.kind === "multi_select" ? parsedDelta.addOptionIds : parsedDelta.addPageIds;
      const remove = parsedDelta.kind === "multi_select" ? parsedDelta.removeOptionIds : parsedDelta.removePageIds;
      if (add.some((entry) => remove.includes(entry))) {
        throw new TypeError(`${editLabel}.edit.delta add/remove sets must be disjoint`);
      }
      if (
        parsedDelta.kind === "relation"
        && parsedDelta.addPageIds.length + parsedDelta.removePageIds.length
          > MAX_DATABASE_MODULE_V2_BULK_ENTRIES
      ) {
        throw new TypeError(
          `${editLabel}.edit.delta may change at most ${MAX_DATABASE_MODULE_V2_BULK_ENTRIES} Relation targets`,
        );
      }
      return {
        pageId: readString(mutation.pageId, `${editLabel}.pageId`),
        dataSourceId: readDataSourceId(mutation.dataSourceId, `${editLabel}.dataSourceId`),
        propertyId,
        edit: { kind: "patch_set" as const, delta: parsedDelta },
      };
    });
    const addresses = edits.map((entry) => `${entry.dataSourceId}\u0000${entry.pageId}\u0000${entry.propertyId}`);
    if (new Set(addresses).size !== addresses.length) {
      throw new TypeError(`${label}.edits repeats a Page Property address`);
    }
    return { kind: "edit_property_values", edits };
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

export const bindLibraryDatabaseApplyV2 = (
  raw: unknown,
  trusted: TrustedDatabaseModuleIdentityV2,
): LibraryDatabaseApplyV2 => {
  const request = readRecord(raw, "libraryDatabaseApplyV2");
  assertExactKeys(request, "libraryDatabaseApplyV2", [
    "version",
    "operationId",
    "storeEpoch",
    "operations",
  ]);
  const bound = bindDatabaseApplyV2(
    {
      ...request,
      projectId: "local-library-boundary",
      actor: {},
    },
    "local-library-boundary",
    trusted,
  );
  return {
    version: bound.version,
    operationId: bound.operationId,
    storeEpoch: bound.storeEpoch,
    operations: bound.operations,
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
    if (mode === "database") {
      assertExactKeys(read, "databaseModuleReadV2.read", ["target", "mode"]);
      return {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId,
        read: { target: { kind: "project_default" }, mode },
      };
    }
    if (mode !== "catalog_window") {
      throw new TypeError("Project-default Database read v2 mode is unsupported");
    }
    assertExactKeys(read, "databaseModuleReadV2.read", ["target", "mode"], ["window"]);
    const window = parseReadWindow(read.window, "Database catalog");
    return {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId,
      read: {
        target: { kind: "project_default" },
        mode,
        ...(window === undefined ? {} : { window }),
      },
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

  if (target.kind === "data_source" && mode === "relation_candidate_window") {
    assertExactKeys(target, "databaseModuleReadV2.read.target", ["kind", "dataSourceId"]);
    assertExactKeys(
      read,
      "databaseModuleReadV2.read",
      ["target", "mode"],
      ["query", "window"],
    );
    const query = read.query === undefined
      ? undefined
      : readUtf8String(read.query, "databaseModuleReadV2.read.query", 512);
    const window = parseReadWindow(read.window, "Relation candidate");
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
        ...(query === undefined ? {} : { query }),
        ...(window === undefined ? {} : { window }),
      },
    };
  }

  if (target.kind === "view" && mode === "view") {
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

  if (target.kind === "page_property" && mode === "relation_target_window") {
    assertExactKeys(target, "databaseModuleReadV2.read.target", [
      "kind", "pageId", "dataSourceId", "propertyId",
    ]);
    assertExactKeys(read, "databaseModuleReadV2.read", ["target", "mode"], ["window"]);
    let window;
    if (read.window !== undefined) {
      const rawWindow = readRecord(read.window, "databaseModuleReadV2.read.window");
      assertExactKeys(rawWindow, "databaseModuleReadV2.read.window", [], ["after", "first"]);
      const first = rawWindow.first === undefined
        ? undefined
        : readRevision(rawWindow.first, "databaseModuleReadV2.read.window.first");
      if (first !== undefined && (first < 1 || first > 100)) {
        throw new TypeError("Relation target window first must be between 1 and 100");
      }
      const after = rawWindow.after === undefined || rawWindow.after === null
        ? rawWindow.after
        : readString(rawWindow.after, "databaseModuleReadV2.read.window.after", 4096);
      window = {
        ...(after === undefined ? {} : { after }),
        ...(first === undefined ? {} : { first }),
      };
    }
    return {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId,
      read: {
        target: {
          kind: "page_property",
          pageId: readString(target.pageId, "databaseModuleReadV2.pageId"),
          dataSourceId: readDataSourceId(target.dataSourceId, "databaseModuleReadV2.dataSourceId"),
          propertyId: readPropertyId(target.propertyId, "databaseModuleReadV2.propertyId"),
        },
        mode,
        ...(window === undefined ? {} : { window }),
      },
    };
  }

  if (target.kind === "property" && mode === "option_window") {
    assertExactKeys(target, "databaseModuleReadV2.read.target", [
      "kind", "dataSourceId", "propertyId",
    ]);
    assertExactKeys(read, "databaseModuleReadV2.read", ["target", "mode"], ["window"]);
    let window;
    if (read.window !== undefined) {
      const rawWindow = readRecord(read.window, "databaseModuleReadV2.read.window");
      assertExactKeys(rawWindow, "databaseModuleReadV2.read.window", [], ["after", "first"]);
      const first = rawWindow.first === undefined
        ? undefined
        : readRevision(rawWindow.first, "databaseModuleReadV2.read.window.first");
      if (first !== undefined && (first < 1 || first > 100)) {
        throw new TypeError("Property option window first must be between 1 and 100");
      }
      const after = rawWindow.after === undefined || rawWindow.after === null
        ? rawWindow.after
        : readString(rawWindow.after, "databaseModuleReadV2.read.window.after", 4096);
      window = {
        ...(after === undefined ? {} : { after }),
        ...(first === undefined ? {} : { first }),
      };
    }
    return {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId,
      read: {
        target: {
          kind: "property",
          dataSourceId: readDataSourceId(target.dataSourceId, "databaseModuleReadV2.dataSourceId"),
          propertyId: readPropertyId(target.propertyId, "databaseModuleReadV2.propertyId"),
        },
        mode,
        ...(window === undefined ? {} : { window }),
      },
    };
  }

  throw new TypeError("Database Module v2 read target and mode are incompatible");
};

const parseReadWindow = (
  value: unknown,
  label: string,
): { readonly after?: string | null; readonly first?: number } | undefined => {
  if (value === undefined) return undefined;
  const window = readRecord(value, "databaseModuleReadV2.read.window");
  assertExactKeys(window, "databaseModuleReadV2.read.window", [], ["after", "first"]);
  const first = window.first === undefined
    ? undefined
    : readRevision(window.first, "databaseModuleReadV2.read.window.first");
  if (first !== undefined && (first < 1 || first > 100)) {
    throw new TypeError(`${label} window first must be between 1 and 100`);
  }
  const after = window.after === undefined || window.after === null
    ? window.after
    : readString(window.after, "databaseModuleReadV2.read.window.after", 4096);
  return {
    ...(after === undefined ? {} : { after }),
    ...(first === undefined ? {} : { first }),
  };
};

export const bindLibraryDatabaseModuleReadV2 = (
  raw: unknown,
): LibraryDatabaseModuleReadRequestV2 => {
  const request = readRecord(raw, "libraryDatabaseModuleReadV2");
  assertExactKeys(request, "libraryDatabaseModuleReadV2", ["version", "read"]);
  const bound = bindDatabaseModuleReadV2(
    { ...request, projectId: "local-library-boundary" },
    "local-library-boundary",
  );
  if (bound.read.target.kind === "project_default") {
    throw new TypeError(
      "Library Database reads require a concrete Database, Data Source, or View",
    );
  }
  return { version: bound.version, read: bound.read as LibraryDatabaseReadV2 };
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
    "schema",
    "capabilities",
    "valueType",
    "config",
    "optionCount",
    "rankKey",
    "lifecycle",
    "revision",
    "createdAt",
    "updatedAt",
  ]);
  const propertyId = readPropertyId(record.propertyId, `${label}.propertyId`);
  const valueType = readPropertyValueType(record.valueType, `${label}.valueType`);
  const schema = parsePropertySchema(record.schema, `${label}.schema`);
  if (schema.kind !== valueType) {
    throw new TypeError(`${label}.schema diverges from its derived valueType`);
  }
  const capabilities = readRecord(record.capabilities, `${label}.capabilities`);
  assertExactKeys(capabilities, `${label}.capabilities`, [
    "replace",
    "patchSetMember",
    "filterOperators",
    "sortable",
    "groupable",
  ]);
  const patchSetMember = capabilities.patchSetMember;
  if (patchSetMember !== null && patchSetMember !== "option" && patchSetMember !== "page") {
    throw new TypeError(`${label}.capabilities.patchSetMember is invalid`);
  }
  if (!Array.isArray(capabilities.filterOperators)
    || capabilities.filterOperators.some((operator) => ![
      "equals", "not_equals", "contains", "not_contains", "is_empty", "is_not_empty",
    ].includes(String(operator)))) {
    throw new TypeError(`${label}.capabilities.filterOperators is invalid`);
  }
  const optionCount = readRevision(record.optionCount, `${label}.optionCount`);
  validateBuiltInPropertyValueType(propertyId, valueType, label);
  return {
    propertyId,
    dataSourceId: readDataSourceId(record.dataSourceId, `${label}.dataSourceId`),
    name: readString(record.name, `${label}.name`, MAX_NAME_LENGTH),
    schema,
    capabilities: {
      replace: readBoolean(capabilities.replace, `${label}.capabilities.replace`),
      patchSetMember,
      filterOperators: capabilities.filterOperators as NonNullable<DataSourcePropertyRecordV2["capabilities"]>["filterOperators"],
      sortable: readBoolean(capabilities.sortable, `${label}.capabilities.sortable`),
      groupable: readBoolean(capabilities.groupable, `${label}.capabilities.groupable`),
    },
    valueType,
    config: parseStoredPropertyConfig(
      propertyId,
      valueType,
      record.config,
      `${label}.config`,
    ),
    optionCount,
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

const parseIntrinsicProperty = (
  value: unknown,
  label: string,
): PageIntrinsicPropertyValueV2 => {
  const property = readRecord(value, label);
  assertExactKeys(property, label, ["key", "valueType", "value", "revision"]);
  return {
    key: readString(property.key, `${label}.key`),
    valueType: readString(property.valueType, `${label}.valueType`),
    value: readJsonValue(property.value, `${label}.value`),
    revision: readPositiveRevision(property.revision, `${label}.revision`),
  };
};

const readPageBodyNfm = (value: unknown, label: string): string => {
  if (
    typeof value === "string"
    && value.length <= MAX_PAGE_DESCRIPTION_LENGTH
  ) return value;
  throw new TypeError(`${label} must be a bounded string`);
};

const parseIntrinsicProperties = (
  value: unknown,
  label: string,
): readonly PageIntrinsicPropertyValueV2[] => {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  return value.map((entry, index) =>
    parseIntrinsicProperty(entry, `${label}[${index}]`)
  );
};

const parsePageRow = (value: unknown, label: string): DataSourcePageRowV2 => {
  const row = readRecord(value, label);
  assertExactKeys(row, label, [
    "page",
    "membership",
    "values",
    "position",
    "effectiveGroupKey",
  ], ["bodyNfm", "intrinsicProperties"]);
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
  const bodyNfm = row.bodyNfm === undefined
    ? undefined
    : readPageBodyNfm(row.bodyNfm, `${label}.bodyNfm`);
  const intrinsicProperties = row.intrinsicProperties === undefined
    ? undefined
    : parseIntrinsicProperties(
        row.intrinsicProperties,
        `${label}.intrinsicProperties`,
      );
  let position: DataSourcePageRowV2["position"] = null;
  if (row.position !== null) {
    const candidate = readRecord(row.position, `${label}.position`);
    assertExactKeys(
      candidate,
      `${label}.position`,
      ["groupKey", "rankKey", "revision"],
      ["order"],
    );
    position = {
      groupKey: candidate.groupKey === null
        ? null
        : readString(candidate.groupKey, `${label}.position.groupKey`),
      rankKey: readString(candidate.rankKey, `${label}.position.rankKey`),
      revision: readPositiveRevision(candidate.revision, `${label}.position.revision`),
      ...(candidate.order === undefined
        ? {}
        : { order: readRevision(candidate.order, `${label}.position.order`) }),
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
    ...(bodyNfm === undefined ? {} : { bodyNfm }),
    ...(intrinsicProperties === undefined ? {} : { intrinsicProperties }),
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
  assertExactKeys(result, "databaseModuleReadV2.value", ["kind", "value"]);
  if (result.kind === "catalog_window") {
    const window = readRecord(result.value, "databaseModuleReadV2.value.value");
    assertExactKeys(window, "databaseModuleReadV2.value.value", [
      "databases", "nextCursor", "projectionRevision",
    ]);
    if (!Array.isArray(window.databases) || window.databases.length > 100) {
      throw new TypeError("Database catalog must be a bounded array");
    }
    return {
      kind: "catalog_window",
      value: {
        databases: window.databases.map((database, index) =>
          parseContainerDescriptor(database, `databaseCatalog.databases[${index}]`)
        ),
        nextCursor: window.nextCursor === null
          ? null
          : readString(window.nextCursor, "databaseCatalog.nextCursor", 4096),
        projectionRevision: readRevision(
          window.projectionRevision,
          "databaseCatalog.projectionRevision",
        ),
      },
    };
  }
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
  if (result.kind === "relation_target_window") {
    const window = readRecord(result.value, "databaseModuleReadV2.value.value");
    assertExactKeys(window, "databaseModuleReadV2.value.value", [
      "valueRevision", "totalCount", "targets", "nextCursor", "projectionRevision",
    ]);
    if (!Array.isArray(window.targets)) {
      throw new TypeError("Relation target window targets must be an array");
    }
    const targets = window.targets.map((rawTarget, index) => {
      const target = readRecord(rawTarget, `relationTargetWindow.targets[${index}]`);
      if (target.kind === "restricted") {
        assertExactKeys(target, `relationTargetWindow.targets[${index}]`, ["kind"]);
        return { kind: "restricted" as const };
      }
      assertExactKeys(target, `relationTargetWindow.targets[${index}]`, [
        "kind", "pageId", "title", "lifecycle", "membershipState",
      ]);
      if (target.kind !== "visible") {
        throw new TypeError("Relation target kind is unsupported");
      }
      return {
        kind: "visible" as const,
        pageId: readString(target.pageId, `relationTargetWindow.targets[${index}].pageId`),
        title: typeof target.title === "string" ? target.title : "",
        lifecycle: readString(target.lifecycle, `relationTargetWindow.targets[${index}].lifecycle`),
        membershipState: readString(target.membershipState, `relationTargetWindow.targets[${index}].membershipState`),
      };
    });
    return {
      kind: "relation_target_window",
      value: {
        valueRevision: readRevision(window.valueRevision, "relationTargetWindow.valueRevision"),
        totalCount: readRevision(window.totalCount, "relationTargetWindow.totalCount"),
        targets,
        nextCursor: window.nextCursor === null
          ? null
          : readString(window.nextCursor, "relationTargetWindow.nextCursor", 4096),
        projectionRevision: readRevision(window.projectionRevision, "relationTargetWindow.projectionRevision"),
      },
    };
  }
  if (result.kind === "option_window") {
    const window = readRecord(result.value, "databaseModuleReadV2.value.value");
    assertExactKeys(window, "databaseModuleReadV2.value.value", [
      "options", "nextCursor", "projectionRevision",
    ]);
    if (!Array.isArray(window.options) || window.options.length > 100) {
      throw new TypeError("Property option window options must be a bounded array");
    }
    const options = window.options.map((rawOption, index) => {
      const option = readRecord(rawOption, `optionWindow.options[${index}]`);
      assertExactKeys(option, `optionWindow.options[${index}]`, ["id", "name"], ["color"]);
      const color = option.color === undefined
        ? undefined
        : readString(option.color, `optionWindow.options[${index}].color`, MAX_NAME_LENGTH);
      return {
        id: readString(option.id, `optionWindow.options[${index}].id`),
        name: readString(option.name, `optionWindow.options[${index}].name`, MAX_NAME_LENGTH),
        ...(color === undefined ? {} : { color }),
      };
    });
    if (new Set(options.map((option) => option.id)).size !== options.length) {
      throw new TypeError("Property option window contains duplicate identities");
    }
    return {
      kind: "option_window",
      value: {
        options,
        nextCursor: window.nextCursor === null
          ? null
          : readString(window.nextCursor, "optionWindow.nextCursor", 4096),
        projectionRevision: readRevision(window.projectionRevision, "optionWindow.projectionRevision"),
      },
    };
  }
  if (result.kind === "relation_candidate_window") {
    const window = readRecord(result.value, "databaseModuleReadV2.value.value");
    assertExactKeys(window, "databaseModuleReadV2.value.value", [
      "candidates", "nextCursor", "projectionRevision",
    ]);
    if (!Array.isArray(window.candidates) || window.candidates.length > 100) {
      throw new TypeError("Relation candidate window must be a bounded array");
    }
    const candidates = window.candidates.map((rawCandidate, index) => {
      const candidate = readRecord(rawCandidate, `relationCandidateWindow.candidates[${index}]`);
      assertExactKeys(candidate, `relationCandidateWindow.candidates[${index}]`, [
        "pageId", "title",
      ]);
      return {
        pageId: readString(candidate.pageId, `relationCandidateWindow.candidates[${index}].pageId`),
        title: typeof candidate.title === "string" ? candidate.title : "",
      };
    });
    if (new Set(candidates.map((candidate) => candidate.pageId)).size !== candidates.length) {
      throw new TypeError("Relation candidate window contains duplicate Page identities");
    }
    return {
      kind: "relation_candidate_window",
      value: {
        candidates,
        nextCursor: window.nextCursor === null
          ? null
          : readString(window.nextCursor, "relationCandidateWindow.nextCursor", 4096),
        projectionRevision: readRevision(
          window.projectionRevision,
          "relationCandidateWindow.projectionRevision",
        ),
      },
    };
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
    "commitSeq",
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
      commitSeq: readRevision(snapshot.commitSeq, "databaseModuleReadV2.snapshot.commitSeq"),
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
  "edit_property_values",
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
    "commitSeq",
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
      commitSeq: readRevision(receipt.commitSeq, "databaseApplyV2.receipt.commitSeq"),
      committedAt: readTimestamp(receipt.committedAt, "databaseApplyV2.receipt.committedAt"),
    },
  };
};

const assertLibraryAccessContext = (value: unknown, label: string): void => {
  const context = readRecord(value, label);
  assertExactKeys(context, label, ["kind"]);
  if (context.kind !== "library") {
    throw new TypeError(`${label}.kind must be library`);
  }
};

export const parseLibraryDatabaseModuleReadResultV2 = (
  value: unknown,
): LibraryDatabaseModuleReadResultV2 => {
  const result = parseResultEnvelope(value, "Library Database Module v2 read result");
  if (result.ok === false && Object.prototype.hasOwnProperty.call(result, "error")) {
    return { ok: false, error: parseDatabaseModuleErrorV2(result.error) };
  }
  if (result.ok !== true || !Object.prototype.hasOwnProperty.call(result, "value")) {
    throw new TypeError("Library Database Module v2 read result envelope is invalid");
  }
  const snapshot = readRecord(result.value, "libraryDatabaseModuleReadV2.snapshot");
  assertExactKeys(snapshot, "libraryDatabaseModuleReadV2.snapshot", [
    "version",
    "accessContext",
    "libraryId",
    "storeEpoch",
    "commitSeq",
    "value",
  ]);
  assertLibraryAccessContext(
    snapshot.accessContext,
    "libraryDatabaseModuleReadV2.snapshot.accessContext",
  );
  const { accessContext: _accessContext, ...standardSnapshot } = snapshot;
  void _accessContext;
  const parsed = parseDatabaseModuleReadResultV2({
    ok: true,
    value: {
      ...standardSnapshot,
      projectId: "local-library",
    },
  });
  if (!parsed.ok) return parsed;
  const { projectId: _privateProjectId, ...publicSnapshot } = parsed.value;
  void _privateProjectId;
  return {
    ok: true,
    value: {
      ...publicSnapshot,
      accessContext: { kind: "library" },
    },
  };
};

export const parseLibraryDatabaseApplyResultV2 = (
  value: unknown,
): LibraryDatabaseApplyResultV2 => {
  const result = parseResultEnvelope(value, "Library Database Module v2 apply result");
  if (result.ok === false && Object.prototype.hasOwnProperty.call(result, "error")) {
    return { ok: false, error: parseDatabaseModuleErrorV2(result.error) };
  }
  if (result.ok !== true || !Object.prototype.hasOwnProperty.call(result, "value")) {
    throw new TypeError("Library Database Module v2 apply result envelope is invalid");
  }
  const receipt = readRecord(result.value, "libraryDatabaseApplyV2.receipt");
  assertExactKeys(receipt, "libraryDatabaseApplyV2.receipt", [
    "version",
    "operationId",
    "accessContext",
    "libraryId",
    "storeEpoch",
    "duplicate",
    "operationKinds",
    "affectedDatabaseIds",
    "affectedDataSourceIds",
    "affectedPageIds",
    "affectedViewIds",
    "committedRevisions",
    "commitSeq",
    "committedAt",
  ]);
  assertLibraryAccessContext(
    receipt.accessContext,
    "libraryDatabaseApplyV2.receipt.accessContext",
  );
  const { accessContext: _accessContext, ...standardReceipt } = receipt;
  void _accessContext;
  const parsed = parseDatabaseApplyResultV2({
    ok: true,
    value: { ...standardReceipt, projectId: "local-library" },
  });
  if (!parsed.ok) return parsed;
  const { projectId: _privateProjectId, ...publicReceipt } = parsed.value;
  void _privateProjectId;
  return {
    ok: true,
    value: {
      ...publicReceipt,
      accessContext: { kind: "library" },
    },
  };
};
