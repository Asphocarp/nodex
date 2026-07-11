import {
  stableStringifyBlockPropertyJson,
  type BlockPropertyJsonValue,
} from "./block-property-mutations";

export const DATABASE_MUTATION_CONTRACT_VERSION = 1 as const;
export const MAX_DATABASE_MUTATION_OPERATIONS = 64;

const MAX_ID_LENGTH = 512;
const MAX_KEY_LENGTH = 128;
const MAX_NAME_LENGTH = 256;
const MAX_OPTIONS = 10_000;
const MAX_CANONICAL_REQUEST_LENGTH = 2_000_000;
const MAX_VIEW_CONFIG_LENGTH = 262_144;
const MAX_VIEW_FILTER_DEPTH = 8;
const MAX_VIEW_FILTER_NODES = 1_024;

export type DatabaseJsonValue = BlockPropertyJsonValue;
export type DatabasePropertyValueType =
  | "text"
  | "number"
  | "checkbox"
  | "select"
  | "multi_select"
  | "date"
  | "datetime"
  | "person";
export type GeneralDatabaseViewKind = "kanban" | "list" | "calendar" | "canvas";

export interface DatabasePropertyOption {
  readonly id: string;
  readonly name: string;
  readonly color?: string;
}

export type DatabaseViewFilterOperator =
  "equals" | "not_equals" | "contains" | "is_empty" | "is_not_empty";

export interface DatabaseViewFilterClause {
  readonly kind: "clause";
  readonly propertyId: string;
  readonly operator: DatabaseViewFilterOperator;
  readonly value?: DatabaseJsonValue;
}

export interface DatabaseViewFilterGroup {
  readonly kind: "group";
  readonly operator: "and" | "or";
  readonly children: readonly DatabaseViewFilterNode[];
}

export type DatabaseViewFilterNode =
  DatabaseViewFilterClause | DatabaseViewFilterGroup;

export type DatabaseViewSortField =
  | { readonly kind: "manual" }
  | { readonly kind: "title" }
  | { readonly kind: "property"; readonly propertyId: string };

export interface DatabaseViewSort {
  readonly field: DatabaseViewSortField;
  readonly direction: "asc" | "desc";
  readonly nulls: "first" | "last";
}

export interface GeneralDatabaseViewConfig {
  readonly schemaKey: "nodex.database-view";
  readonly schemaVersion: 1;
  readonly filter: DatabaseViewFilterNode;
  readonly sort: readonly DatabaseViewSort[];
  readonly group: null | { readonly propertyId: string };
  readonly display: {
    readonly propertyIds: readonly string[];
    readonly showTitle: boolean;
  };
}

export interface InitialDatabaseView {
  readonly viewId: string;
  readonly name: string;
  readonly viewKind: GeneralDatabaseViewKind;
  readonly config: GeneralDatabaseViewConfig;
}

export interface CreateDatabaseOperation {
  readonly kind: "create_database";
  readonly databaseBlockId: string;
  readonly name: string;
  readonly isPrimary: boolean;
  readonly initialView: InitialDatabaseView;
  /** Missing appends to the Project's top-level Block order. */
  readonly beforeBlockId?: string;
}

export interface PutDatabasePropertyOperation {
  readonly kind: "put_property";
  readonly databaseBlockId: string;
  readonly propertyId: string;
  readonly expectedDatabaseSchemaRevision: number;
  /** Zero creates a new stable identity; a positive value updates it. */
  readonly expectedPropertyRevision: number;
  readonly key: string;
  readonly name: string;
  readonly valueType: DatabasePropertyValueType;
  readonly config: Readonly<Record<string, DatabaseJsonValue>>;
  /** Missing appends to this Database's property order. */
  readonly beforePropertyId?: string;
}

export interface DeleteDatabasePropertyOperation {
  readonly kind: "delete_property";
  readonly databaseBlockId: string;
  readonly propertyId: string;
  readonly expectedDatabaseSchemaRevision: number;
  readonly expectedPropertyRevision: number;
}

export interface ExpectedDatabaseMembership {
  readonly membershipId: string;
  readonly revision: number;
}

export interface TargetDatabaseMembership {
  readonly databaseBlockId: string;
  readonly membershipId: string;
  readonly viewId: string;
  readonly groupKey: string | null;
  readonly beforeCardBlockId?: string;
}

export interface TransferDatabaseMembershipOperation {
  readonly kind: "transfer_membership";
  readonly cardBlockId: string;
  readonly expectedMembership: ExpectedDatabaseMembership | null;
  readonly target: TargetDatabaseMembership | null;
}

export interface PutDatabaseViewOperation {
  readonly kind: "put_view";
  readonly databaseBlockId: string;
  readonly viewId: string;
  /** Zero creates the View; a positive value updates the same identity. */
  readonly expectedRevision: number;
  readonly name: string;
  readonly viewKind: GeneralDatabaseViewKind;
  readonly config: GeneralDatabaseViewConfig;
  readonly isPrimary: boolean;
  /** Missing appends to this Database's durable View order. */
  readonly beforeViewId?: string;
}

export interface DeleteDatabaseViewOperation {
  readonly kind: "delete_view";
  readonly databaseBlockId: string;
  readonly viewId: string;
  readonly expectedRevision: number;
}

export interface PositionDatabaseViewCardOperation {
  readonly kind: "position_card";
  readonly viewId: string;
  readonly cardBlockId: string;
  /** Zero means that this View has no explicit position for the Card yet. */
  readonly expectedPositionRevision: number;
  readonly groupKey: string | null;
  /** Missing means append to the selected group. */
  readonly beforeCardBlockId?: string;
}

export interface SetDatabasePropertyValueOperation {
  readonly kind: "set_value";
  readonly cardBlockId: string;
  readonly databaseBlockId: string;
  readonly propertyId: string;
  /** Zero means that this membership has no value for the property yet. */
  readonly expectedValueRevision: number;
  readonly value: DatabaseJsonValue;
}

export interface UpdateDatabaseSetValueOperation {
  readonly kind: "add_remove_value";
  readonly cardBlockId: string;
  readonly databaseBlockId: string;
  readonly propertyId: string;
  readonly add: readonly string[];
  readonly remove: readonly string[];
}

export type DatabaseMutationOperation =
  | CreateDatabaseOperation
  | PutDatabasePropertyOperation
  | DeleteDatabasePropertyOperation
  | TransferDatabaseMembershipOperation
  | PutDatabaseViewOperation
  | DeleteDatabaseViewOperation
  | PositionDatabaseViewCardOperation
  | SetDatabasePropertyValueOperation
  | UpdateDatabaseSetValueOperation;

export interface DatabaseMutationRequest {
  readonly version: typeof DATABASE_MUTATION_CONTRACT_VERSION;
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly clientSessionId?: string;
  readonly actor: Readonly<Record<string, DatabaseJsonValue>>;
  /**
   * One ordered semantic intent. Operations commit together and may depend on
   * authority written by an earlier operation in this array (for example a
   * grouped Board drag sets the grouping property before positioning the Card
   * in that group). The server, never the caller, allocates every rank key.
   */
  readonly operations: readonly DatabaseMutationOperation[];
}

export interface DatabaseMutationReceipt {
  readonly version: typeof DATABASE_MUTATION_CONTRACT_VERSION;
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly operationKinds: readonly DatabaseMutationOperation["kind"][];
  readonly duplicate: boolean;
  readonly payload: Readonly<Record<string, DatabaseJsonValue>>;
  readonly changeLogSeq: number;
  readonly committedAt: string;
}

export type DatabaseMutationErrorCode =
  | "invalid_database_mutation_request"
  | "store_epoch_mismatch"
  | "operation_id_collision"
  | "project_not_found"
  | "block_identity_collision"
  | "database_not_found"
  | "database_not_active"
  | "database_schema_conflict"
  | "property_not_found"
  | "property_conflict"
  | "property_key_collision"
  | "property_type_change_with_values"
  | "property_option_in_use"
  | "property_in_use"
  | "property_value_invalid"
  | "property_value_conflict"
  | "card_not_found"
  | "card_not_active"
  | "membership_conflict"
  | "membership_identity_collision"
  | "membership_unchanged"
  | "view_not_found"
  | "view_conflict"
  | "view_identity_collision"
  | "primary_view_required"
  | "position_conflict"
  | "position_anchor_not_found"
  | "position_anchor_group_mismatch"
  | "position_group_mismatch"
  | "rank_rebalance_limit"
  | "unknown";

const DATABASE_MUTATION_ERROR_CODES = new Set<DatabaseMutationErrorCode>([
  "invalid_database_mutation_request",
  "store_epoch_mismatch",
  "operation_id_collision",
  "project_not_found",
  "block_identity_collision",
  "database_not_found",
  "database_not_active",
  "database_schema_conflict",
  "property_not_found",
  "property_conflict",
  "property_key_collision",
  "property_type_change_with_values",
  "property_option_in_use",
  "property_in_use",
  "property_value_invalid",
  "property_value_conflict",
  "card_not_found",
  "card_not_active",
  "membership_conflict",
  "membership_identity_collision",
  "membership_unchanged",
  "view_not_found",
  "view_conflict",
  "view_identity_collision",
  "primary_view_required",
  "position_conflict",
  "position_anchor_not_found",
  "position_anchor_group_mismatch",
  "position_group_mismatch",
  "rank_rebalance_limit",
  "unknown",
]);

export interface DatabaseMutationCommandError {
  readonly code: DatabaseMutationErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly operationId?: string;
  readonly expectedRevision?: number;
  readonly actualRevision?: number;
}

export type DatabaseMutationCommandResult =
  | { readonly ok: true; readonly value: DatabaseMutationReceipt }
  | { readonly ok: false; readonly error: DatabaseMutationCommandError };

export class DatabaseMutationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseMutationContractError";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new DatabaseMutationContractError(`${label} must be an object`);
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
    throw new DatabaseMutationContractError(`${label}.${key} is required`);
  }
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue;
    throw new DatabaseMutationContractError(`${label}.${key} is not supported`);
  }
};

const readString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  maximumLength = MAX_ID_LENGTH,
): string => {
  const value = record[key];
  if (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    value === value.trim()
  ) {
    return value;
  }
  throw new DatabaseMutationContractError(
    `${label}.${key} must be a canonical non-empty string`,
  );
};

const readOptionalString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  maximumLength = MAX_ID_LENGTH,
): string | undefined => {
  if (record[key] === undefined) return undefined;
  return readString(record, key, label, maximumLength);
};

const readNullableString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string | null => {
  if (record[key] === null) return null;
  return readString(record, key, label);
};

const readRevision = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  minimum = 0,
): number => {
  const value = record[key];
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
  ) {
    return value;
  }
  throw new DatabaseMutationContractError(
    `${label}.${key} must be a safe integer >= ${minimum}`,
  );
};

const readBoolean = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): boolean => {
  const value = record[key];
  if (typeof value === "boolean") return value;
  throw new DatabaseMutationContractError(`${label}.${key} must be a boolean`);
};

const canonicalizeJson = (value: unknown, label: string): DatabaseJsonValue => {
  try {
    return JSON.parse(
      stableStringifyBlockPropertyJson(value),
    ) as DatabaseJsonValue;
  } catch (error) {
    throw new DatabaseMutationContractError(
      `${label} must be bounded canonical JSON: ${(error as Error).message}`,
    );
  }
};

const readJsonRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, DatabaseJsonValue>> => {
  const canonical = canonicalizeJson(value, label);
  if (isRecord(canonical)) {
    return canonical as Readonly<Record<string, DatabaseJsonValue>>;
  }
  throw new DatabaseMutationContractError(`${label} must be a JSON object`);
};

const readOptions = (
  config: Readonly<Record<string, DatabaseJsonValue>>,
  label: string,
): readonly DatabasePropertyOption[] | undefined => {
  if (config.options === undefined) return undefined;
  if (!Array.isArray(config.options) || config.options.length > MAX_OPTIONS) {
    throw new DatabaseMutationContractError(
      `${label}.options must be a bounded array`,
    );
  }
  const seen = new Set<string>();
  return config.options.map((candidate, index) => {
    const option = readRecord(candidate, `${label}.options[${index}]`);
    assertExactKeys(
      option,
      `${label}.options[${index}]`,
      ["id", "name"],
      ["color"],
    );
    const id = readString(option, "id", `${label}.options[${index}]`);
    if (seen.has(id)) {
      throw new DatabaseMutationContractError(
        `${label}.options contains duplicate stable option ID ${id}`,
      );
    }
    seen.add(id);
    return {
      id,
      name: readString(
        option,
        "name",
        `${label}.options[${index}]`,
        MAX_NAME_LENGTH,
      ),
      ...(option.color === undefined
        ? {}
        : {
            color: readString(
              option,
              "color",
              `${label}.options[${index}]`,
              MAX_NAME_LENGTH,
            ),
          }),
    };
  });
};

const parsePropertyConfig = (
  value: unknown,
  valueType: DatabasePropertyValueType,
  label: string,
): Readonly<Record<string, DatabaseJsonValue>> => {
  const config = readJsonRecord(value, label);
  const allowedKeys =
    valueType === "select" || valueType === "multi_select" ? ["options"] : [];
  for (const key of Object.keys(config)) {
    if (allowedKeys.includes(key)) continue;
    throw new DatabaseMutationContractError(
      `${label}.${key} is not supported by ${valueType} schema version 1`,
    );
  }
  const options = readOptions(config, label);
  if (
    (valueType === "select" || valueType === "multi_select") &&
    options === undefined
  ) {
    throw new DatabaseMutationContractError(
      `${label}.options is required by ${valueType} schema version 1`,
    );
  }
  if (
    options !== undefined &&
    valueType !== "select" &&
    valueType !== "multi_select"
  ) {
    throw new DatabaseMutationContractError(
      `${label}.options is only valid for select properties`,
    );
  }
  if (options === undefined) return config;
  return {
    ...config,
    options: options.map((option) => ({
      id: option.id,
      name: option.name,
      ...(option.color === undefined ? {} : { color: option.color }),
    })),
  };
};

export const parseDatabasePropertyConfig = (
  valueType: DatabasePropertyValueType,
  value: unknown,
): Readonly<Record<string, DatabaseJsonValue>> =>
  parsePropertyConfig(value, valueType, "databaseProperty.config");

export const normalizeDatabasePropertyValue = (
  definition: {
    readonly valueType: DatabasePropertyValueType;
    readonly config: Readonly<Record<string, DatabaseJsonValue>>;
  },
  value: unknown,
): DatabaseJsonValue => {
  const invalid = (message: string): never => {
    throw new DatabaseMutationContractError(message);
  };
  const config = parseDatabasePropertyConfig(
    definition.valueType,
    definition.config,
  );
  if (value === null) return null;
  switch (definition.valueType) {
    case "text":
    case "person":
      if (typeof value === "string") return value;
      return invalid(`${definition.valueType} requires a string or null value`);
    case "date": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return invalid("date requires an ISO date or null value");
      }
      const [yearText, monthText, dayText] = value.split("-");
      const year = Number(yearText);
      const month = Number(monthText);
      const day = Number(dayText);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      ) {
        return value;
      }
      return invalid("date requires an ISO date or null value");
    }
    case "datetime": {
      if (typeof value !== "string") {
        return invalid("datetime requires an ISO datetime or null value");
      }
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString() === value) {
        return value;
      }
      return invalid("datetime requires an ISO datetime or null value");
    }
    case "number":
      if (typeof value === "number" && Number.isFinite(value)) return value;
      return invalid("number requires a finite number or null value");
    case "checkbox":
      if (typeof value === "boolean") return value;
      return invalid("checkbox requires a boolean or null value");
    case "select": {
      if (typeof value !== "string") {
        return invalid("select requires a stable option ID or null value");
      }
      const optionIds = new Set(
        (config.options as readonly DatabaseJsonValue[]).flatMap((option) =>
          isRecord(option) && typeof option.id === "string" ? [option.id] : [],
        ),
      );
      if (optionIds.has(value)) return value;
      return invalid(`select does not define option ID ${value}`);
    }
    case "multi_select": {
      if (
        !Array.isArray(value) ||
        !value.every((entry) => typeof entry === "string")
      ) {
        return invalid("multi_select requires an array of stable option IDs");
      }
      const normalized = [...new Set(value as readonly string[])].sort(
        (left, right) => left.localeCompare(right),
      );
      const optionIds = new Set(
        (config.options as readonly DatabaseJsonValue[]).flatMap((option) =>
          isRecord(option) && typeof option.id === "string" ? [option.id] : [],
        ),
      );
      const unknown = normalized.find((optionId) => !optionIds.has(optionId));
      if (unknown === undefined) return normalized;
      return invalid(`multi_select does not define option ID ${unknown}`);
    }
  }
};

interface ViewFilterParseState {
  nodeCount: number;
}

const parseViewFilterNode = (
  value: unknown,
  label: string,
  depth: number,
  state: ViewFilterParseState,
): DatabaseViewFilterNode => {
  if (depth > MAX_VIEW_FILTER_DEPTH) {
    throw new DatabaseMutationContractError(
      `${label} exceeds the maximum filter depth of ${MAX_VIEW_FILTER_DEPTH}`,
    );
  }
  state.nodeCount += 1;
  if (state.nodeCount > MAX_VIEW_FILTER_NODES) {
    throw new DatabaseMutationContractError(
      `${label} exceeds the maximum filter node count of ${MAX_VIEW_FILTER_NODES}`,
    );
  }

  const node = readRecord(value, label);
  if (node.kind === "group") {
    assertExactKeys(node, label, ["kind", "operator", "children"]);
    if (node.operator !== "and" && node.operator !== "or") {
      throw new DatabaseMutationContractError(
        `${label}.operator must be and or or`,
      );
    }
    if (!Array.isArray(node.children)) {
      throw new DatabaseMutationContractError(
        `${label}.children must be an array`,
      );
    }
    return {
      kind: "group",
      operator: node.operator,
      children: node.children.map((child, index) =>
        parseViewFilterNode(
          child,
          `${label}.children[${index}]`,
          depth + 1,
          state,
        ),
      ),
    };
  }
  if (node.kind !== "clause") {
    throw new DatabaseMutationContractError(
      `${label}.kind must be group or clause`,
    );
  }
  assertExactKeys(node, label, ["kind", "propertyId", "operator"], ["value"]);
  if (
    node.operator !== "equals" &&
    node.operator !== "not_equals" &&
    node.operator !== "contains" &&
    node.operator !== "is_empty" &&
    node.operator !== "is_not_empty"
  ) {
    throw new DatabaseMutationContractError(`${label}.operator is unsupported`);
  }
  const requiresValue =
    node.operator !== "is_empty" && node.operator !== "is_not_empty";
  if (requiresValue !== (node.value !== undefined)) {
    throw new DatabaseMutationContractError(
      `${label} has an invalid value arity`,
    );
  }
  return {
    kind: "clause",
    propertyId: readString(node, "propertyId", label),
    operator: node.operator,
    ...(node.value === undefined
      ? {}
      : { value: canonicalizeJson(node.value, `${label}.value`) }),
  };
};

const parseViewConfig = (
  value: unknown,
  label: string,
): GeneralDatabaseViewConfig => {
  let canonical: string;
  try {
    canonical = stableStringifyBlockPropertyJson(value);
  } catch (error) {
    throw new DatabaseMutationContractError(
      `${label} must be bounded canonical JSON: ${(error as Error).message}`,
    );
  }
  if (canonical.length > MAX_VIEW_CONFIG_LENGTH) {
    throw new DatabaseMutationContractError(
      `${label} exceeds the maximum JSON size of ${MAX_VIEW_CONFIG_LENGTH} bytes`,
    );
  }
  const config = readRecord(JSON.parse(canonical) as unknown, label);
  assertExactKeys(config, label, [
    "schemaKey",
    "schemaVersion",
    "filter",
    "sort",
    "group",
    "display",
  ]);
  if (
    config.schemaKey !== "nodex.database-view" ||
    config.schemaVersion !== 1
  ) {
    throw new DatabaseMutationContractError(
      `${label} must use nodex.database-view schema version 1`,
    );
  }
  const filter = parseViewFilterNode(config.filter, `${label}.filter`, 1, {
    nodeCount: 0,
  });
  if (!Array.isArray(config.sort)) {
    throw new DatabaseMutationContractError(`${label}.sort must be an array`);
  }
  const sort = config.sort.map((candidate, index): DatabaseViewSort => {
    const item = readRecord(candidate, `${label}.sort[${index}]`);
    assertExactKeys(item, `${label}.sort[${index}]`, [
      "field",
      "direction",
      "nulls",
    ]);
    if (item.direction !== "asc" && item.direction !== "desc") {
      throw new DatabaseMutationContractError(
        `${label}.sort[${index}].direction is unsupported`,
      );
    }
    if (item.nulls !== "first" && item.nulls !== "last") {
      throw new DatabaseMutationContractError(
        `${label}.sort[${index}].nulls is unsupported`,
      );
    }
    const field = readRecord(item.field, `${label}.sort[${index}].field`);
    if (field.kind === "manual" || field.kind === "title") {
      assertExactKeys(field, `${label}.sort[${index}].field`, ["kind"]);
      return {
        field: { kind: field.kind },
        direction: item.direction,
        nulls: item.nulls,
      };
    }
    if (field.kind !== "property") {
      throw new DatabaseMutationContractError(
        `${label}.sort[${index}].field.kind is unsupported`,
      );
    }
    assertExactKeys(field, `${label}.sort[${index}].field`, [
      "kind",
      "propertyId",
    ]);
    return {
      field: {
        kind: "property",
        propertyId: readString(
          field,
          "propertyId",
          `${label}.sort[${index}].field`,
        ),
      },
      direction: item.direction,
      nulls: item.nulls,
    };
  });
  let group: GeneralDatabaseViewConfig["group"] = null;
  if (config.group !== null) {
    const candidate = readRecord(config.group, `${label}.group`);
    assertExactKeys(candidate, `${label}.group`, ["propertyId"]);
    group = {
      propertyId: readString(candidate, "propertyId", `${label}.group`),
    };
  }
  const display = readRecord(config.display, `${label}.display`);
  assertExactKeys(display, `${label}.display`, ["propertyIds", "showTitle"]);
  if (
    !Array.isArray(display.propertyIds) ||
    !display.propertyIds.every((entry) => typeof entry === "string")
  ) {
    throw new DatabaseMutationContractError(
      `${label}.display.propertyIds must be a string array`,
    );
  }
  const rawPropertyIds = display.propertyIds as readonly string[];
  const propertyIds = rawPropertyIds.map((_, index) =>
    readString(
      { propertyId: rawPropertyIds[index] },
      "propertyId",
      `${label}.display.propertyIds[${index}]`,
    ),
  );
  if (new Set(propertyIds).size !== propertyIds.length) {
    throw new DatabaseMutationContractError(
      `${label}.display.propertyIds contains duplicates`,
    );
  }
  return {
    schemaKey: "nodex.database-view",
    schemaVersion: 1,
    filter,
    sort,
    group,
    display: {
      propertyIds,
      showTitle: readBoolean(display, "showTitle", `${label}.display`),
    },
  };
};

export const parseGeneralDatabaseViewConfig = (
  value: unknown,
): GeneralDatabaseViewConfig => parseViewConfig(value, "databaseViewConfig");

const parseInitialView = (
  value: unknown,
  label: string,
): InitialDatabaseView => {
  const view = readRecord(value, label);
  assertExactKeys(view, label, ["viewId", "name", "viewKind", "config"]);
  if (
    view.viewKind !== "kanban" &&
    view.viewKind !== "list" &&
    view.viewKind !== "calendar" &&
    view.viewKind !== "canvas"
  ) {
    throw new DatabaseMutationContractError(`${label}.viewKind is unsupported`);
  }
  return {
    viewId: readString(view, "viewId", label),
    name: readString(view, "name", label, MAX_NAME_LENGTH),
    viewKind: view.viewKind,
    config: parseViewConfig(view.config, `${label}.config`),
  };
};

const parseOperation = (value: unknown): DatabaseMutationOperation => {
  const operation = readRecord(value, "databaseMutation.operation");
  const label = `databaseMutation.operation(${String(operation.kind)})`;
  if (operation.kind === "create_database") {
    assertExactKeys(
      operation,
      label,
      ["kind", "databaseBlockId", "name", "isPrimary", "initialView"],
      ["beforeBlockId"],
    );
    return {
      kind: "create_database",
      databaseBlockId: readString(operation, "databaseBlockId", label),
      name: readString(operation, "name", label, MAX_NAME_LENGTH),
      isPrimary: readBoolean(operation, "isPrimary", label),
      initialView: parseInitialView(
        operation.initialView,
        `${label}.initialView`,
      ),
      ...(operation.beforeBlockId === undefined
        ? {}
        : {
            beforeBlockId: readOptionalString(
              operation,
              "beforeBlockId",
              label,
            ),
          }),
    };
  }
  if (operation.kind === "put_property") {
    assertExactKeys(
      operation,
      label,
      [
        "kind",
        "databaseBlockId",
        "propertyId",
        "expectedDatabaseSchemaRevision",
        "expectedPropertyRevision",
        "key",
        "name",
        "valueType",
        "config",
      ],
      ["beforePropertyId"],
    );
    if (
      operation.valueType !== "text" &&
      operation.valueType !== "number" &&
      operation.valueType !== "checkbox" &&
      operation.valueType !== "select" &&
      operation.valueType !== "multi_select" &&
      operation.valueType !== "date" &&
      operation.valueType !== "datetime" &&
      operation.valueType !== "person"
    ) {
      throw new DatabaseMutationContractError(
        `${label}.valueType is unsupported`,
      );
    }
    return {
      kind: "put_property",
      databaseBlockId: readString(operation, "databaseBlockId", label),
      propertyId: readString(operation, "propertyId", label),
      expectedDatabaseSchemaRevision: readRevision(
        operation,
        "expectedDatabaseSchemaRevision",
        label,
        1,
      ),
      expectedPropertyRevision: readRevision(
        operation,
        "expectedPropertyRevision",
        label,
      ),
      key: readString(operation, "key", label, MAX_KEY_LENGTH),
      name: readString(operation, "name", label, MAX_NAME_LENGTH),
      valueType: operation.valueType,
      config: parsePropertyConfig(
        operation.config,
        operation.valueType,
        `${label}.config`,
      ),
      ...(operation.beforePropertyId === undefined
        ? {}
        : {
            beforePropertyId: readOptionalString(
              operation,
              "beforePropertyId",
              label,
            ),
          }),
    };
  }
  if (operation.kind === "delete_property") {
    assertExactKeys(operation, label, [
      "kind",
      "databaseBlockId",
      "propertyId",
      "expectedDatabaseSchemaRevision",
      "expectedPropertyRevision",
    ]);
    return {
      kind: "delete_property",
      databaseBlockId: readString(operation, "databaseBlockId", label),
      propertyId: readString(operation, "propertyId", label),
      expectedDatabaseSchemaRevision: readRevision(
        operation,
        "expectedDatabaseSchemaRevision",
        label,
        1,
      ),
      expectedPropertyRevision: readRevision(
        operation,
        "expectedPropertyRevision",
        label,
        1,
      ),
    };
  }
  if (operation.kind === "transfer_membership") {
    assertExactKeys(operation, label, [
      "kind",
      "cardBlockId",
      "expectedMembership",
      "target",
    ]);
    const expected = operation.expectedMembership;
    const target = operation.target;
    const parsedExpected =
      expected === null
        ? null
        : (() => {
            const record = readRecord(expected, `${label}.expectedMembership`);
            assertExactKeys(record, `${label}.expectedMembership`, [
              "membershipId",
              "revision",
            ]);
            return {
              membershipId: readString(
                record,
                "membershipId",
                `${label}.expectedMembership`,
              ),
              revision: readRevision(
                record,
                "revision",
                `${label}.expectedMembership`,
                1,
              ),
            };
          })();
    const parsedTarget =
      target === null
        ? null
        : (() => {
            const record = readRecord(target, `${label}.target`);
            assertExactKeys(
              record,
              `${label}.target`,
              ["databaseBlockId", "membershipId", "viewId", "groupKey"],
              ["beforeCardBlockId"],
            );
            return {
              databaseBlockId: readString(
                record,
                "databaseBlockId",
                `${label}.target`,
              ),
              membershipId: readString(
                record,
                "membershipId",
                `${label}.target`,
              ),
              viewId: readString(record, "viewId", `${label}.target`),
              groupKey: readNullableString(
                record,
                "groupKey",
                `${label}.target`,
              ),
              ...(record.beforeCardBlockId === undefined
                ? {}
                : {
                    beforeCardBlockId: readOptionalString(
                      record,
                      "beforeCardBlockId",
                      `${label}.target`,
                    ),
                  }),
            };
          })();
    return {
      kind: "transfer_membership",
      cardBlockId: readString(operation, "cardBlockId", label),
      expectedMembership: parsedExpected,
      target: parsedTarget,
    };
  }
  if (operation.kind === "put_view") {
    assertExactKeys(
      operation,
      label,
      [
        "kind",
        "databaseBlockId",
        "viewId",
        "expectedRevision",
        "name",
        "viewKind",
        "config",
        "isPrimary",
      ],
      ["beforeViewId"],
    );
    if (
      operation.viewKind !== "kanban" &&
      operation.viewKind !== "list" &&
      operation.viewKind !== "calendar" &&
      operation.viewKind !== "canvas"
    ) {
      throw new DatabaseMutationContractError(
        `${label}.viewKind is unsupported`,
      );
    }
    return {
      kind: "put_view",
      databaseBlockId: readString(operation, "databaseBlockId", label),
      viewId: readString(operation, "viewId", label),
      expectedRevision: readRevision(operation, "expectedRevision", label),
      name: readString(operation, "name", label, MAX_NAME_LENGTH),
      viewKind: operation.viewKind,
      config: parseViewConfig(operation.config, `${label}.config`),
      isPrimary: readBoolean(operation, "isPrimary", label),
      ...(operation.beforeViewId === undefined
        ? {}
        : {
            beforeViewId: readOptionalString(operation, "beforeViewId", label),
          }),
    };
  }
  if (operation.kind === "delete_view") {
    assertExactKeys(operation, label, [
      "kind",
      "databaseBlockId",
      "viewId",
      "expectedRevision",
    ]);
    return {
      kind: "delete_view",
      databaseBlockId: readString(operation, "databaseBlockId", label),
      viewId: readString(operation, "viewId", label),
      expectedRevision: readRevision(operation, "expectedRevision", label, 1),
    };
  }
  if (operation.kind === "position_card") {
    assertExactKeys(
      operation,
      label,
      ["kind", "viewId", "cardBlockId", "expectedPositionRevision", "groupKey"],
      ["beforeCardBlockId"],
    );
    return {
      kind: "position_card",
      viewId: readString(operation, "viewId", label),
      cardBlockId: readString(operation, "cardBlockId", label),
      expectedPositionRevision: readRevision(
        operation,
        "expectedPositionRevision",
        label,
      ),
      groupKey: readNullableString(operation, "groupKey", label),
      ...(operation.beforeCardBlockId === undefined
        ? {}
        : {
            beforeCardBlockId: readOptionalString(
              operation,
              "beforeCardBlockId",
              label,
            ),
          }),
    };
  }
  if (operation.kind === "set_value") {
    assertExactKeys(operation, label, [
      "kind",
      "cardBlockId",
      "databaseBlockId",
      "propertyId",
      "expectedValueRevision",
      "value",
    ]);
    return {
      kind: "set_value",
      cardBlockId: readString(operation, "cardBlockId", label),
      databaseBlockId: readString(operation, "databaseBlockId", label),
      propertyId: readString(operation, "propertyId", label),
      expectedValueRevision: readRevision(
        operation,
        "expectedValueRevision",
        label,
      ),
      value: canonicalizeJson(operation.value, `${label}.value`),
    };
  }
  if (operation.kind === "add_remove_value") {
    assertExactKeys(operation, label, [
      "kind",
      "cardBlockId",
      "databaseBlockId",
      "propertyId",
      "add",
      "remove",
    ]);
    const readMembers = (key: "add" | "remove"): readonly string[] => {
      const value = operation[key];
      if (!Array.isArray(value) || value.length > MAX_OPTIONS) {
        throw new DatabaseMutationContractError(
          `${label}.${key} must be a bounded array`,
        );
      }
      const members = value.map((_, index) =>
        readString(
          { member: value[index] },
          "member",
          `${label}.${key}[${index}]`,
        ),
      );
      return [...new Set(members)].sort();
    };
    const add = readMembers("add");
    const remove = readMembers("remove");
    if (add.length === 0 && remove.length === 0) {
      throw new DatabaseMutationContractError(
        `${label} must add or remove at least one value`,
      );
    }
    const removed = new Set(remove);
    if (add.some((member) => removed.has(member))) {
      throw new DatabaseMutationContractError(
        `${label} cannot add and remove the same value`,
      );
    }
    return {
      kind: "add_remove_value",
      cardBlockId: readString(operation, "cardBlockId", label),
      databaseBlockId: readString(operation, "databaseBlockId", label),
      propertyId: readString(operation, "propertyId", label),
      add,
      remove,
    };
  }
  throw new DatabaseMutationContractError(`${label}.kind is unsupported`);
};

export const databaseMutationOperationPath = (
  operation: DatabaseMutationOperation,
): string => {
  switch (operation.kind) {
    case "create_database":
      return `database/${encodeURIComponent(operation.databaseBlockId)}`;
    case "put_property":
    case "delete_property":
      return `database/${encodeURIComponent(operation.databaseBlockId)}/property/${encodeURIComponent(operation.propertyId)}`;
    case "transfer_membership":
      return `card/${encodeURIComponent(operation.cardBlockId)}/membership`;
    case "put_view":
    case "delete_view":
      return `database/${encodeURIComponent(operation.databaseBlockId)}/view/${encodeURIComponent(operation.viewId)}`;
    case "position_card":
      return `view/${encodeURIComponent(operation.viewId)}/position/${encodeURIComponent(operation.cardBlockId)}`;
    case "set_value":
    case "add_remove_value":
      return `database/${encodeURIComponent(operation.databaseBlockId)}/card/${encodeURIComponent(operation.cardBlockId)}/property/${encodeURIComponent(operation.propertyId)}`;
  }
};

const operationEntities = (
  operation: DatabaseMutationOperation,
): ReadonlySet<string> => {
  const entities = new Set<string>();
  const add = (kind: string, id: string): void => {
    entities.add(`${kind}:${id}`);
  };
  switch (operation.kind) {
    case "create_database":
      add("database", operation.databaseBlockId);
      add("view", operation.initialView.viewId);
      break;
    case "put_property":
    case "delete_property":
      add("database", operation.databaseBlockId);
      add("property", operation.propertyId);
      break;
    case "transfer_membership":
      add("card", operation.cardBlockId);
      if (operation.expectedMembership) {
        add("membership", operation.expectedMembership.membershipId);
      }
      if (operation.target) {
        add("database", operation.target.databaseBlockId);
        add("membership", operation.target.membershipId);
        add("view", operation.target.viewId);
      }
      break;
    case "put_view":
    case "delete_view":
      add("database", operation.databaseBlockId);
      add("view", operation.viewId);
      break;
    case "position_card":
      add("view", operation.viewId);
      add("card", operation.cardBlockId);
      break;
    case "set_value":
    case "add_remove_value":
      add("database", operation.databaseBlockId);
      add("card", operation.cardBlockId);
      add("property", operation.propertyId);
      break;
  }
  return entities;
};

const validateDatabaseMutationOperations = (
  operations: readonly DatabaseMutationOperation[],
): void => {
  if (
    operations.length < 1 ||
    operations.length > MAX_DATABASE_MUTATION_OPERATIONS
  ) {
    throw new DatabaseMutationContractError(
      `databaseMutation.operations must contain 1-${MAX_DATABASE_MUTATION_OPERATIONS} operations`,
    );
  }

  const paths = new Set<string>();
  const connectedEntities = new Set<string>();
  const membershipTransfers = new Map<
    string,
    Extract<DatabaseMutationOperation, { readonly kind: "transfer_membership" }>
  >();
  const positionedCards = new Set<string>();

  operations.forEach((operation, index) => {
    const path = databaseMutationOperationPath(operation);
    if (paths.has(path)) {
      throw new DatabaseMutationContractError(
        `databaseMutation.operations contains conflicting writes to ${path}`,
      );
    }
    paths.add(path);

    const entities = operationEntities(operation);
    if (
      index > 0 &&
      ![...entities].some((entity) => connectedEntities.has(entity))
    ) {
      throw new DatabaseMutationContractError(
        `databaseMutation.operations[${index}] is not connected to the same semantic intent`,
      );
    }
    for (const entity of entities) connectedEntities.add(entity);

    if (operation.kind === "transfer_membership") {
      membershipTransfers.set(operation.cardBlockId, operation);
      return;
    }
    if (
      operation.kind !== "position_card" &&
      operation.kind !== "set_value" &&
      operation.kind !== "add_remove_value"
    ) {
      return;
    }
    if (operation.kind === "position_card") {
      positionedCards.add(operation.cardBlockId);
    } else if (positionedCards.has(operation.cardBlockId)) {
      throw new DatabaseMutationContractError(
        `databaseMutation.operations must update Card ${operation.cardBlockId} property values before positioning it`,
      );
    }
  });

  for (const [cardBlockId, transfer] of membershipTransfers) {
    for (const operation of operations) {
      if (
        operation.kind !== "position_card" &&
        operation.kind !== "set_value" &&
        operation.kind !== "add_remove_value"
      ) {
        continue;
      }
      if (operation.cardBlockId !== cardBlockId) continue;
      if (transfer.target === null) {
        throw new DatabaseMutationContractError(
          `databaseMutation.operations cannot mutate Card ${cardBlockId} while removing its Database membership`,
        );
      }
      if (
        operation.kind === "position_card" &&
        operation.viewId === transfer.target.viewId
      ) {
        throw new DatabaseMutationContractError(
          `databaseMutation.operations must express the initial View position on transfer_membership.target`,
        );
      }
      if (
        (operation.kind === "set_value" ||
          operation.kind === "add_remove_value") &&
        operation.databaseBlockId !== transfer.target.databaseBlockId
      ) {
        throw new DatabaseMutationContractError(
          `databaseMutation.operations cannot write Card ${cardBlockId} in a Database other than its transfer target`,
        );
      }
    }
  }
};

export const parseDatabaseMutationRequest = (
  value: unknown,
): DatabaseMutationRequest => {
  const request = readRecord(value, "databaseMutation");
  assertExactKeys(
    request,
    "databaseMutation",
    [
      "version",
      "operationId",
      "projectId",
      "storeEpoch",
      "actor",
      "operations",
    ],
    ["clientSessionId"],
  );
  if (request.version !== DATABASE_MUTATION_CONTRACT_VERSION) {
    throw new DatabaseMutationContractError(
      `databaseMutation.version must be ${DATABASE_MUTATION_CONTRACT_VERSION}`,
    );
  }
  if (!Array.isArray(request.operations)) {
    throw new DatabaseMutationContractError(
      "databaseMutation.operations must be an array",
    );
  }
  const operations = request.operations.map((operation) =>
    parseOperation(operation),
  );
  validateDatabaseMutationOperations(operations);
  const parsed: DatabaseMutationRequest = {
    version: DATABASE_MUTATION_CONTRACT_VERSION,
    operationId: readString(request, "operationId", "databaseMutation"),
    projectId: readString(request, "projectId", "databaseMutation"),
    storeEpoch: readString(request, "storeEpoch", "databaseMutation"),
    ...(request.clientSessionId === undefined
      ? {}
      : {
          clientSessionId: readOptionalString(
            request,
            "clientSessionId",
            "databaseMutation",
          ),
        }),
    actor: readJsonRecord(request.actor, "databaseMutation.actor"),
    operations,
  };
  if (
    canonicalizeDatabaseMutationIntent(parsed).length <=
    MAX_CANONICAL_REQUEST_LENGTH
  ) {
    return parsed;
  }
  throw new DatabaseMutationContractError(
    "databaseMutation exceeds the canonical request size limit",
  );
};

export const stableStringifyDatabaseJson = (value: unknown): string =>
  stableStringifyBlockPropertyJson(value);

const isEmptyDatabaseViewValue = (
  value: DatabaseJsonValue | undefined,
): boolean =>
  value === undefined ||
  value === null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

const evaluateDatabaseViewFilterClause = (
  clause: DatabaseViewFilterClause,
  valueForPropertyId: (propertyId: string) => DatabaseJsonValue | undefined,
): boolean => {
  const current = valueForPropertyId(clause.propertyId);
  if (clause.operator === "is_empty") {
    return isEmptyDatabaseViewValue(current);
  }
  if (clause.operator === "is_not_empty") {
    return !isEmptyDatabaseViewValue(current);
  }
  const expected = clause.value;
  const equals =
    stableStringifyDatabaseJson(current ?? null) ===
    stableStringifyDatabaseJson(expected ?? null);
  if (clause.operator === "equals") return equals;
  if (clause.operator === "not_equals") return !equals;
  if (typeof current === "string" && typeof expected === "string") {
    return current.includes(expected);
  }
  if (!Array.isArray(current)) return false;
  const expectedKey = stableStringifyDatabaseJson(expected ?? null);
  return current.some(
    (candidate) => stableStringifyDatabaseJson(candidate) === expectedKey,
  );
};

/** Empty AND groups match; empty OR groups do not match. */
export const evaluateDatabaseViewFilter = (
  filter: DatabaseViewFilterNode,
  valueForPropertyId: (propertyId: string) => DatabaseJsonValue | undefined,
): boolean => {
  if (filter.kind === "clause") {
    return evaluateDatabaseViewFilterClause(filter, valueForPropertyId);
  }
  if (filter.operator === "and") {
    return filter.children.every((child) =>
      evaluateDatabaseViewFilter(child, valueForPropertyId),
    );
  }
  return filter.children.some((child) =>
    evaluateDatabaseViewFilter(child, valueForPropertyId),
  );
};

/** Actor/session are first-seen audit attribution, not logical retry identity. */
export const canonicalizeDatabaseMutationIntent = (value: unknown): string => {
  const request =
    isRecord(value) && value.version === DATABASE_MUTATION_CONTRACT_VERSION
      ? (value as unknown as DatabaseMutationRequest)
      : parseDatabaseMutationRequest(value);
  return stableStringifyDatabaseJson({
    version: request.version,
    operationId: request.operationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    operations: request.operations,
  });
};

export const parseDatabaseMutationReceipt = (
  value: unknown,
): DatabaseMutationReceipt => {
  const receipt = readRecord(value, "databaseMutationReceipt");
  assertExactKeys(receipt, "databaseMutationReceipt", [
    "version",
    "operationId",
    "projectId",
    "storeEpoch",
    "operationKinds",
    "duplicate",
    "payload",
    "changeLogSeq",
    "committedAt",
  ]);
  if (receipt.version !== DATABASE_MUTATION_CONTRACT_VERSION) {
    throw new DatabaseMutationContractError(
      `databaseMutationReceipt.version must be ${DATABASE_MUTATION_CONTRACT_VERSION}`,
    );
  }
  const supportedKinds = new Set<DatabaseMutationOperation["kind"]>([
    "create_database",
    "put_property",
    "delete_property",
    "transfer_membership",
    "put_view",
    "delete_view",
    "position_card",
    "set_value",
    "add_remove_value",
  ]);
  if (
    !Array.isArray(receipt.operationKinds) ||
    receipt.operationKinds.length < 1 ||
    receipt.operationKinds.length > MAX_DATABASE_MUTATION_OPERATIONS ||
    !receipt.operationKinds.every(
      (kind) =>
        typeof kind === "string" &&
        supportedKinds.has(kind as DatabaseMutationOperation["kind"]),
    )
  ) {
    throw new DatabaseMutationContractError(
      "databaseMutationReceipt.operationKinds is unsupported",
    );
  }
  const operationKinds =
    receipt.operationKinds as DatabaseMutationOperation["kind"][];
  return {
    version: DATABASE_MUTATION_CONTRACT_VERSION,
    operationId: readString(receipt, "operationId", "databaseMutationReceipt"),
    projectId: readString(receipt, "projectId", "databaseMutationReceipt"),
    storeEpoch: readString(receipt, "storeEpoch", "databaseMutationReceipt"),
    operationKinds,
    duplicate: readBoolean(receipt, "duplicate", "databaseMutationReceipt"),
    payload: readJsonRecord(receipt.payload, "databaseMutationReceipt.payload"),
    changeLogSeq: readRevision(
      receipt,
      "changeLogSeq",
      "databaseMutationReceipt",
      1,
    ),
    committedAt: readString(receipt, "committedAt", "databaseMutationReceipt"),
  };
};

export const parseDatabaseMutationCommandError = (
  value: unknown,
): DatabaseMutationCommandError => {
  const error = readRecord(value, "databaseMutationError");
  assertExactKeys(
    error,
    "databaseMutationError",
    ["code", "message", "retryable"],
    ["operationId", "expectedRevision", "actualRevision"],
  );
  if (
    typeof error.code !== "string" ||
    !DATABASE_MUTATION_ERROR_CODES.has(error.code as DatabaseMutationErrorCode)
  ) {
    throw new DatabaseMutationContractError(
      "databaseMutationError.code is invalid",
    );
  }
  return {
    code: error.code as DatabaseMutationErrorCode,
    message: readString(error, "message", "databaseMutationError", 4_096),
    retryable: readBoolean(error, "retryable", "databaseMutationError"),
    ...(error.operationId === undefined
      ? {}
      : {
          operationId: readOptionalString(
            error,
            "operationId",
            "databaseMutationError",
          ),
        }),
    ...(error.expectedRevision === undefined
      ? {}
      : {
          expectedRevision: readRevision(
            error,
            "expectedRevision",
            "databaseMutationError",
          ),
        }),
    ...(error.actualRevision === undefined
      ? {}
      : {
          actualRevision: readRevision(
            error,
            "actualRevision",
            "databaseMutationError",
          ),
        }),
  };
};
