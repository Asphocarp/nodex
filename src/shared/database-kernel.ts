import {
  stableStringifyBlockPropertyJson,
  type BlockPropertyJsonValue,
} from "./block-property-mutations";
import { parseDataSourcePropertyId } from "./database-identities";
import {
  MAX_DATA_SOURCE_OPTION_COLOR_LENGTH,
  MAX_DATA_SOURCE_OPTION_NAME_LENGTH,
  MAX_DATA_SOURCE_PROPERTY_OPTIONS,
} from "./data-source-option-registry";

export const MAX_DATABASE_MUTATION_OPERATIONS = 64;
export const MAX_DATABASE_MUTATION_BULK_ENTRIES = 4_096;

const MAX_ID_LENGTH = 512;
const MAX_KEY_LENGTH = 128;
const MAX_NAME_LENGTH = 256;
const MAX_COLLECTION_ENTRIES = 10_000;
const MAX_CANONICAL_REQUEST_LENGTH = 2_000_000;
const MAX_VIEW_CONFIG_LENGTH = 262_144;
const MAX_VIEW_FILTER_DEPTH = 8;
const MAX_VIEW_FILTER_NODES = 1_024;
const UTF8_ENCODER = new TextEncoder();

export type DatabaseJsonValue = BlockPropertyJsonValue;
export type DatabasePropertyValueType =
  | "text"
  | "number"
  | "checkbox"
  | "select"
  | "multi_select"
  | "date"
  | "datetime"
  | "relation";
export type DatabaseViewLayout = "board" | "list";

export type DatabaseViewCompletedRange = "all" | "past_month" | "past_week" | "past_day" | "none";

export type DatabaseViewField =
  | {
      readonly kind: "property";
      readonly propertyId: string;
    }
  | {
      readonly kind: "intrinsic";
      readonly field: "page_key" | "created_at" | "updated_at";
    };

export function databaseGroupValueFromKey(
  valueType: DatabasePropertyValueType,
  groupKey: string | null,
): DatabaseJsonValue {
  if (groupKey === null) return null;
  if (valueType !== "number" && valueType !== "checkbox" && valueType !== "multi_select") {
    return groupKey;
  }
  try {
    return JSON.parse(groupKey) as DatabaseJsonValue;
  } catch {
    return groupKey;
  }
}

export function databaseGroupKeyForValue(value: DatabaseJsonValue | undefined): string | null {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return null;
  }
  if (typeof value === "string") return value;
  return stableStringifyBlockPropertyJson(value);
}

export interface DatabasePropertyOption {
  readonly id: string;
  readonly name: string;
  readonly color?: string;
}

export type DatabaseViewFilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "is_empty"
  | "is_not_empty";

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

export type DatabaseViewFilterNode = DatabaseViewFilterClause | DatabaseViewFilterGroup;

export type DatabaseViewSortField =
  | { readonly kind: "manual" }
  | { readonly kind: "title" }
  | { readonly kind: "created" }
  | { readonly kind: "property"; readonly propertyId: string };

export interface DatabaseViewSort {
  readonly field: DatabaseViewSortField;
  readonly direction: "asc" | "desc";
  readonly nulls: "first" | "last";
}

export interface DatabaseViewConfig {
  readonly schemaKey: "nodex.database-view";
  readonly schemaVersion: 1;
  readonly filter: DatabaseViewFilterNode;
  readonly sort: readonly DatabaseViewSort[];
  readonly group: null | { readonly propertyId: string };
  readonly display: {
    readonly propertyIds: readonly string[];
    readonly showTitle: boolean;
  };
  readonly options?: {
    /** Inline references exclude their host Page unless explicitly included. */
    readonly includeHostPage: boolean;
  };
}

export interface DatabaseViewConfigV2 extends Omit<DatabaseViewConfig, "schemaVersion"> {
  readonly schemaVersion: 2;
}

export interface DatabaseViewLayoutDisplayConfig {
  readonly fields: readonly DatabaseViewField[];
  readonly showEmptyGroups: boolean;
  /** Board-only Page body preview visibility; omitted legacy configs default to visible. */
  readonly showDescription?: boolean;
}

export interface DatabaseViewPresentationConfig {
  readonly sort: readonly DatabaseViewSort[];
  readonly group: null | { readonly propertyId: string };
  readonly subgroup: null | { readonly propertyId: string };
  readonly groupDirection: DatabaseViewSort["direction"];
  readonly completion: {
    readonly range: DatabaseViewCompletedRange;
    readonly orderByRecency: boolean;
  };
  readonly hierarchy: {
    /** Include task children in List projections even when they do not match directly. */
    readonly showSubPages: boolean;
    /** Render task children below their parent instead of as flat occurrences. */
    readonly nestedSubPages: boolean;
  };
  readonly layouts: {
    readonly board: DatabaseViewLayoutDisplayConfig;
    readonly list: DatabaseViewLayoutDisplayConfig;
  };
}

export interface DatabaseViewConfigV4 {
  readonly schemaKey: "nodex.database-view";
  readonly schemaVersion: 4;
  readonly filter: DatabaseViewFilterNode;
  readonly presentation: DatabaseViewPresentationConfig;
}

export interface DatabaseViewPresentationOverride {
  readonly layout?: DatabaseViewLayout;
  readonly sort?: readonly DatabaseViewSort[];
  readonly group?: null | { readonly propertyId: string };
  readonly subgroup?: null | { readonly propertyId: string };
  readonly groupDirection?: DatabaseViewSort["direction"];
  readonly completion?: {
    readonly range?: DatabaseViewCompletedRange;
    readonly orderByRecency?: boolean;
  };
  readonly hierarchy?: {
    readonly showSubPages?: boolean;
    readonly nestedSubPages?: boolean;
  };
  readonly layouts?: {
    readonly board?: Partial<DatabaseViewLayoutDisplayConfig>;
    readonly list?: Partial<DatabaseViewLayoutDisplayConfig>;
  };
}

export interface EffectiveDatabaseViewPresentation {
  readonly layout: DatabaseViewLayout;
  readonly presentation: DatabaseViewPresentationConfig;
}

export interface InitialDatabaseView {
  readonly viewId: string;
  readonly name: string;
  readonly defaultLayout: DatabaseViewLayout;
  readonly config: DatabaseViewConfig;
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
  /** Missing creates membership without an explicit manual View position. */
  readonly viewId?: string;
  readonly groupKey?: string | null;
  readonly beforePageId?: string;
}

export interface TransferDatabaseMembershipOperation {
  readonly kind: "transfer_membership";
  readonly pageId: string;
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
  readonly defaultLayout: DatabaseViewLayout;
  readonly config: DatabaseViewConfig;
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

export interface PositionDatabaseViewPageOperation {
  readonly kind: "position_page";
  readonly viewId: string;
  readonly pageId: string;
  /** Zero means that this View has no explicit position for the Page yet. */
  readonly expectedPositionRevision: number;
  /** Missing means append to the View-global manual order. */
  readonly beforePageId?: string;
}

export interface SetDatabasePropertyValueOperation {
  readonly kind: "set_value";
  readonly pageId: string;
  readonly databaseBlockId: string;
  readonly propertyId: string;
  /** Zero means that this membership has no value for the property yet. */
  readonly expectedValueRevision: number;
  readonly value: DatabaseJsonValue;
}

export interface SetDatabasePropertyValueEntry {
  readonly pageId: string;
  readonly propertyId: string;
  /** Zero means that this membership has no value for the property yet. */
  readonly expectedValueRevision: number;
  readonly value: DatabaseJsonValue;
}

/** One ordered, bounded field batch in a single Database. */
export interface SetDatabasePropertyValuesOperation {
  readonly kind: "set_values";
  readonly databaseBlockId: string;
  readonly entries: readonly SetDatabasePropertyValueEntry[];
}

export interface PositionDatabaseViewPageEntry {
  readonly pageId: string;
  /** Zero means that this View has no explicit position for the Page yet. */
  readonly expectedPositionRevision: number;
}

/** Move an ordered Page set as one contiguous run before one external anchor. */
export interface PositionDatabaseViewPagesOperation {
  readonly kind: "position_pages";
  readonly viewId: string;
  readonly pages: readonly PositionDatabaseViewPageEntry[];
  /** Missing appends the run to the View-global manual order. */
  readonly beforePageId?: string;
}

export interface UpdateDatabaseSetValueOperation {
  readonly kind: "add_remove_value";
  readonly pageId: string;
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
  | PositionDatabaseViewPageOperation
  | PositionDatabaseViewPagesOperation
  | SetDatabasePropertyValueOperation
  | SetDatabasePropertyValuesOperation
  | UpdateDatabaseSetValueOperation;

export interface DatabaseMutationRequest {
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly clientSessionId?: string;
  readonly actor: Readonly<Record<string, DatabaseJsonValue>>;
  /**
   * One ordered semantic intent. Operations commit together and may depend on
   * authority written by an earlier operation in this array (for example a
   * grouped Board drag sets the grouping property before positioning the Page
   * in that group). The server, never the caller, allocates every rank key.
   */
  readonly operations: readonly DatabaseMutationOperation[];
}

export interface DatabaseMutationReceipt {
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly operationKinds: readonly DatabaseMutationOperation["kind"][];
  /** Active Database authorities touched by this atomic receipt. */
  readonly affectedDatabaseBlockIds: readonly string[];
  readonly duplicate: boolean;
  readonly payload: Readonly<Record<string, DatabaseJsonValue>>;
  readonly commitSeq: number;
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
  | "page_not_found"
  | "page_not_active"
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
  "page_not_found",
  "page_not_active",
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

const readRecord = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
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
  throw new DatabaseMutationContractError(`${label}.${key} must be a canonical non-empty string`);
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

const readUtf8String = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  maximumBytes: number,
): string => {
  const value = readString(record, key, label, maximumBytes);
  if (UTF8_ENCODER.encode(value).byteLength <= maximumBytes) return value;
  throw new DatabaseMutationContractError(
    `${label}.${key} must contain at most ${maximumBytes} UTF-8 bytes`,
  );
};

const readCanonicalStringArray = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): readonly string[] => {
  const value = record[key];
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_ENTRIES) {
    throw new DatabaseMutationContractError(`${label}.${key} must be a bounded string array`);
  }
  const entries = value.map((entry, index) =>
    readString({ value: entry }, "value", `${label}.${key}[${index}]`),
  );
  if (new Set(entries).size !== entries.length) {
    throw new DatabaseMutationContractError(`${label}.${key} must not contain duplicate IDs`);
  }
  return entries;
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
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= minimum) {
    return value;
  }
  throw new DatabaseMutationContractError(`${label}.${key} must be a safe integer >= ${minimum}`);
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
    return JSON.parse(stableStringifyBlockPropertyJson(value)) as DatabaseJsonValue;
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
  if (!Array.isArray(config.options) || config.options.length > MAX_DATA_SOURCE_PROPERTY_OPTIONS) {
    throw new DatabaseMutationContractError(`${label}.options must be a bounded array`);
  }
  const seen = new Set<string>();
  return config.options.map((candidate, index) => {
    const option = readRecord(candidate, `${label}.options[${index}]`);
    assertExactKeys(option, `${label}.options[${index}]`, ["id", "name"], ["color"]);
    const id = readString(option, "id", `${label}.options[${index}]`);
    if (seen.has(id)) {
      throw new DatabaseMutationContractError(
        `${label}.options contains duplicate stable option ID ${id}`,
      );
    }
    seen.add(id);
    return {
      id,
      name: readUtf8String(
        option,
        "name",
        `${label}.options[${index}]`,
        MAX_DATA_SOURCE_OPTION_NAME_LENGTH,
      ),
      ...(option.color === undefined
        ? {}
        : {
            color: readUtf8String(
              option,
              "color",
              `${label}.options[${index}]`,
              MAX_DATA_SOURCE_OPTION_COLOR_LENGTH,
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
  const allowedKeys = valueType === "select" || valueType === "multi_select" ? ["options"] : [];
  for (const key of Object.keys(config)) {
    if (allowedKeys.includes(key)) continue;
    throw new DatabaseMutationContractError(
      `${label}.${key} is not supported by ${valueType} schema version 1`,
    );
  }
  const options = readOptions(config, label);
  if ((valueType === "select" || valueType === "multi_select") && options === undefined) {
    throw new DatabaseMutationContractError(
      `${label}.options is required by ${valueType} schema version 1`,
    );
  }
  if (options !== undefined && valueType !== "select" && valueType !== "multi_select") {
    throw new DatabaseMutationContractError(`${label}.options is only valid for select properties`);
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
  const config = parseDatabasePropertyConfig(definition.valueType, definition.config);
  if (value === null) return null;
  switch (definition.valueType) {
    case "text":
      if (typeof value === "string") return value;
      return invalid(`${definition.valueType} requires a string or null value`);
    case "relation":
      return invalid("relation values require the typed Database edit contract");
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
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
        return invalid("multi_select requires an array of stable option IDs");
      }
      const normalized = [...new Set(value as readonly string[])].sort((left, right) =>
        left.localeCompare(right),
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
      throw new DatabaseMutationContractError(`${label}.operator must be and or or`);
    }
    if (!Array.isArray(node.children)) {
      throw new DatabaseMutationContractError(`${label}.children must be an array`);
    }
    return {
      kind: "group",
      operator: node.operator,
      children: node.children.map((child, index) =>
        parseViewFilterNode(child, `${label}.children[${index}]`, depth + 1, state),
      ),
    };
  }
  if (node.kind !== "clause") {
    throw new DatabaseMutationContractError(`${label}.kind must be group or clause`);
  }
  assertExactKeys(node, label, ["kind", "propertyId", "operator"], ["value"]);
  if (
    node.operator !== "equals" &&
    node.operator !== "not_equals" &&
    node.operator !== "contains" &&
    node.operator !== "not_contains" &&
    node.operator !== "is_empty" &&
    node.operator !== "is_not_empty"
  ) {
    throw new DatabaseMutationContractError(`${label}.operator is unsupported`);
  }
  const requiresValue = node.operator !== "is_empty" && node.operator !== "is_not_empty";
  if (requiresValue !== (node.value !== undefined)) {
    throw new DatabaseMutationContractError(`${label} has an invalid value arity`);
  }
  return {
    kind: "clause",
    propertyId: readString(node, "propertyId", label),
    operator: node.operator,
    ...(node.value === undefined ? {} : { value: canonicalizeJson(node.value, `${label}.value`) }),
  };
};

const parseViewSorts = (value: unknown, label: string): readonly DatabaseViewSort[] => {
  if (!Array.isArray(value)) {
    throw new DatabaseMutationContractError(`${label} must be an array`);
  }
  if (value.length > 4) {
    throw new DatabaseMutationContractError(`${label} exceeds the maximum of 4 rules`);
  }
  return value.map((candidate, index): DatabaseViewSort => {
    const item = readRecord(candidate, `${label}[${index}]`);
    assertExactKeys(item, `${label}[${index}]`, ["field", "direction", "nulls"]);
    if (item.direction !== "asc" && item.direction !== "desc") {
      throw new DatabaseMutationContractError(`${label}[${index}].direction is unsupported`);
    }
    if (item.nulls !== "first" && item.nulls !== "last") {
      throw new DatabaseMutationContractError(`${label}[${index}].nulls is unsupported`);
    }
    const field = readRecord(item.field, `${label}[${index}].field`);
    if (field.kind === "manual" || field.kind === "title" || field.kind === "created") {
      assertExactKeys(field, `${label}[${index}].field`, ["kind"]);
      return {
        field: { kind: field.kind },
        direction: item.direction,
        nulls: item.nulls,
      };
    }
    if (field.kind !== "property") {
      throw new DatabaseMutationContractError(`${label}[${index}].field.kind is unsupported`);
    }
    assertExactKeys(field, `${label}[${index}].field`, ["kind", "propertyId"]);
    return {
      field: {
        kind: "property",
        propertyId: readString(field, "propertyId", `${label}[${index}].field`),
      },
      direction: item.direction,
      nulls: item.nulls,
    };
  });
};

const parseViewConfig = (
  value: unknown,
  label: string,
  schemaVersion: 1 | 2,
): DatabaseViewConfig | DatabaseViewConfigV2 => {
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
  assertExactKeys(
    config,
    label,
    ["schemaKey", "schemaVersion", "filter", "sort", "group", "display"],
    ["options"],
  );
  if (config.schemaKey !== "nodex.database-view" || config.schemaVersion !== schemaVersion) {
    throw new DatabaseMutationContractError(
      `${label} must use nodex.database-view schema version ${schemaVersion}`,
    );
  }
  const filter = parseViewFilterNode(config.filter, `${label}.filter`, 1, {
    nodeCount: 0,
  });
  const sort = parseViewSorts(config.sort, `${label}.sort`);
  let group: DatabaseViewConfig["group"] = null;
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
    throw new DatabaseMutationContractError(`${label}.display.propertyIds must be a string array`);
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
    throw new DatabaseMutationContractError(`${label}.display.propertyIds contains duplicates`);
  }
  let options: DatabaseViewConfig["options"];
  if (config.options !== undefined) {
    const candidate = readRecord(config.options, `${label}.options`);
    assertExactKeys(candidate, `${label}.options`, ["includeHostPage"]);
    options = {
      includeHostPage: readBoolean(candidate, "includeHostPage", `${label}.options`),
    };
  }
  return {
    schemaKey: "nodex.database-view",
    schemaVersion,
    filter,
    sort,
    group,
    display: {
      propertyIds,
      showTitle: readBoolean(display, "showTitle", `${label}.display`),
    },
    ...(options ? { options } : {}),
  };
};

export const parseDatabaseViewConfig = (value: unknown): DatabaseViewConfig =>
  parseViewConfig(value, "databaseViewConfig", 1) as DatabaseViewConfig;

const visitViewPropertyIds = (
  config: DatabaseViewConfigV2,
  visit: (propertyId: string) => void,
): void => {
  const visitFilter = (filter: DatabaseViewFilterNode): void => {
    if (filter.kind === "clause") {
      visit(filter.propertyId);
      return;
    }
    filter.children.forEach(visitFilter);
  };

  visitFilter(config.filter);
  for (const sort of config.sort) {
    if (sort.field.kind !== "property") continue;
    visit(sort.field.propertyId);
  }
  if (config.group) visit(config.group.propertyId);
  config.display.propertyIds.forEach(visit);
};

export const databaseViewReferencedPropertyIds = (
  config: DatabaseViewConfigV2,
): readonly string[] => {
  const propertyIds = new Set<string>();
  visitViewPropertyIds(config, (propertyId) => propertyIds.add(propertyId));
  return [...propertyIds];
};

export const parseDatabaseViewConfigV2 = (value: unknown): DatabaseViewConfigV2 => {
  const parsed = parseViewConfig(value, "databaseViewConfig", 2) as DatabaseViewConfigV2;
  visitViewPropertyIds(parsed, (propertyId) => {
    parseDataSourcePropertyId(propertyId);
  });
  return parsed;
};

const parseViewGroup = (value: unknown, label: string): { readonly propertyId: string } | null => {
  if (value === null) return null;
  const group = readRecord(value, label);
  assertExactKeys(group, label, ["propertyId"]);
  return { propertyId: readString(group, "propertyId", label) };
};

const parseViewLayoutDisplay = (value: unknown, label: string): DatabaseViewLayoutDisplayConfig => {
  const display = readRecord(value, label);
  assertExactKeys(display, label, ["fields", "showEmptyGroups"], ["showDescription"]);
  if (!Array.isArray(display.fields) || display.fields.length > 64) {
    throw new DatabaseMutationContractError(`${label}.fields must contain at most 64 fields`);
  }
  const fields = display.fields.map((candidate, index): DatabaseViewField => {
    const field = readRecord(candidate, `${label}.fields[${index}]`);
    if (field.kind === "property") {
      assertExactKeys(field, `${label}.fields[${index}]`, ["kind", "propertyId"]);
      return {
        kind: "property",
        propertyId: readString(field, "propertyId", `${label}.fields[${index}]`),
      };
    }
    if (field.kind !== "intrinsic") {
      throw new DatabaseMutationContractError(`${label}.fields[${index}].kind is unsupported`);
    }
    assertExactKeys(field, `${label}.fields[${index}]`, ["kind", "field"]);
    if (
      field.field !== "page_key" &&
      field.field !== "created_at" &&
      field.field !== "updated_at"
    ) {
      throw new DatabaseMutationContractError(`${label}.fields[${index}].field is unsupported`);
    }
    return { kind: "intrinsic", field: field.field };
  });
  const identities = fields.map((field) =>
    field.kind === "property" ? `property:${field.propertyId}` : `intrinsic:${field.field}`,
  );
  if (new Set(identities).size !== identities.length) {
    throw new DatabaseMutationContractError(`${label}.fields contains duplicates`);
  }
  return {
    fields,
    showEmptyGroups: readBoolean(display, "showEmptyGroups", label),
    showDescription:
      display.showDescription === undefined ? true : readBoolean(display, "showDescription", label),
  };
};

const visitViewConfigV4PropertyIds = (
  config: DatabaseViewConfigV4,
  visit: (propertyId: string) => void,
): void => {
  const visitFilter = (filter: DatabaseViewFilterNode): void => {
    if (filter.kind === "clause") {
      visit(filter.propertyId);
      return;
    }
    filter.children.forEach(visitFilter);
  };
  visitFilter(config.filter);
  for (const sort of config.presentation.sort) {
    if (sort.field.kind === "property") visit(sort.field.propertyId);
  }
  if (config.presentation.group) visit(config.presentation.group.propertyId);
  if (config.presentation.subgroup) visit(config.presentation.subgroup.propertyId);
  for (const layout of [config.presentation.layouts.board, config.presentation.layouts.list]) {
    for (const field of layout.fields) {
      if (field.kind === "property") visit(field.propertyId);
    }
  }
};

export const parseDatabaseViewConfigV4 = (value: unknown): DatabaseViewConfigV4 => {
  let canonical: string;
  try {
    canonical = stableStringifyBlockPropertyJson(value);
  } catch (error) {
    throw new DatabaseMutationContractError(
      `databaseViewConfig must be bounded canonical JSON: ${(error as Error).message}`,
    );
  }
  if (canonical.length > MAX_VIEW_CONFIG_LENGTH) {
    throw new DatabaseMutationContractError(
      `databaseViewConfig exceeds the maximum JSON size of ${MAX_VIEW_CONFIG_LENGTH} bytes`,
    );
  }
  const config = readRecord(JSON.parse(canonical) as unknown, "databaseViewConfig");
  assertExactKeys(config, "databaseViewConfig", [
    "schemaKey",
    "schemaVersion",
    "filter",
    "presentation",
  ]);
  if (config.schemaKey !== "nodex.database-view" || config.schemaVersion !== 4) {
    throw new DatabaseMutationContractError(
      "databaseViewConfig must use nodex.database-view schema version 4",
    );
  }
  const presentation = readRecord(config.presentation, "databaseViewConfig.presentation");
  assertExactKeys(presentation, "databaseViewConfig.presentation", [
    "sort",
    "group",
    "subgroup",
    "groupDirection",
    "completion",
    "hierarchy",
    "layouts",
  ]);
  const group = parseViewGroup(presentation.group, "databaseViewConfig.presentation.group");
  const subgroup = parseViewGroup(
    presentation.subgroup,
    "databaseViewConfig.presentation.subgroup",
  );
  if (group && subgroup && group.propertyId === subgroup.propertyId) {
    throw new DatabaseMutationContractError(
      "databaseViewConfig group and subgroup must be different",
    );
  }
  const groupDirection = presentation.groupDirection;
  if (groupDirection !== "asc" && groupDirection !== "desc") {
    throw new DatabaseMutationContractError(
      "databaseViewConfig.presentation.groupDirection is unsupported",
    );
  }
  const completion = readRecord(
    presentation.completion,
    "databaseViewConfig.presentation.completion",
  );
  assertExactKeys(completion, "databaseViewConfig.presentation.completion", [
    "range",
    "orderByRecency",
  ]);
  if (
    completion.range !== "all" &&
    completion.range !== "past_month" &&
    completion.range !== "past_week" &&
    completion.range !== "past_day" &&
    completion.range !== "none"
  ) {
    throw new DatabaseMutationContractError(
      "databaseViewConfig.presentation.completion.range is unsupported",
    );
  }
  const hierarchy = readRecord(presentation.hierarchy, "databaseViewConfig.presentation.hierarchy");
  assertExactKeys(hierarchy, "databaseViewConfig.presentation.hierarchy", [
    "showSubPages",
    "nestedSubPages",
  ]);
  const showSubPages = readBoolean(
    hierarchy,
    "showSubPages",
    "databaseViewConfig.presentation.hierarchy",
  );
  const nestedSubPages = readBoolean(
    hierarchy,
    "nestedSubPages",
    "databaseViewConfig.presentation.hierarchy",
  );
  if (!showSubPages && nestedSubPages) {
    throw new DatabaseMutationContractError(
      "databaseViewConfig nested sub-pages require visible sub-pages",
    );
  }
  const layouts = readRecord(presentation.layouts, "databaseViewConfig.presentation.layouts");
  assertExactKeys(layouts, "databaseViewConfig.presentation.layouts", ["board", "list"]);
  const parsed: DatabaseViewConfigV4 = {
    schemaKey: "nodex.database-view",
    schemaVersion: 4,
    filter: parseViewFilterNode(config.filter, "databaseViewConfig.filter", 1, {
      nodeCount: 0,
    }),
    presentation: {
      sort: parseViewSorts(presentation.sort, "databaseViewConfig.presentation.sort"),
      group,
      subgroup,
      groupDirection,
      completion: {
        range: completion.range,
        orderByRecency: readBoolean(
          completion,
          "orderByRecency",
          "databaseViewConfig.presentation.completion",
        ),
      },
      hierarchy: { showSubPages, nestedSubPages },
      layouts: {
        board: parseViewLayoutDisplay(
          layouts.board,
          "databaseViewConfig.presentation.layouts.board",
        ),
        list: parseViewLayoutDisplay(layouts.list, "databaseViewConfig.presentation.layouts.list"),
      },
    },
  };
  visitViewConfigV4PropertyIds(parsed, (propertyId) => {
    parseDataSourcePropertyId(propertyId);
  });
  return parsed;
};

export function databaseViewReferencedPropertyIdsV4(
  config: DatabaseViewConfigV4,
): readonly string[] {
  const propertyIds = new Set<string>();
  visitViewConfigV4PropertyIds(config, (propertyId) => propertyIds.add(propertyId));
  return [...propertyIds];
}

const parseViewLayoutDisplayOverride = (
  value: unknown,
  label: string,
): Partial<DatabaseViewLayoutDisplayConfig> => {
  const display = readRecord(value, label);
  assertExactKeys(display, label, [], ["fields", "showEmptyGroups", "showDescription"]);
  return {
    ...(display.fields === undefined
      ? {}
      : {
          fields: parseViewLayoutDisplay(
            {
              fields: display.fields,
              showEmptyGroups: false,
            },
            label,
          ).fields,
        }),
    ...(display.showEmptyGroups === undefined
      ? {}
      : {
          showEmptyGroups: readBoolean(display, "showEmptyGroups", label),
        }),
    ...(display.showDescription === undefined
      ? {}
      : {
          showDescription: readBoolean(display, "showDescription", label),
        }),
  };
};

/** Strict boundary parser for Profile-local sparse presentation patches. */
export const parseDatabaseViewPresentationOverride = (
  value: unknown,
): DatabaseViewPresentationOverride => {
  let canonical: string;
  try {
    canonical = stableStringifyBlockPropertyJson(value);
  } catch (error) {
    throw new DatabaseMutationContractError(
      `databaseViewPresentationOverride must be bounded canonical JSON: ${(error as Error).message}`,
    );
  }
  if (canonical.length > MAX_VIEW_CONFIG_LENGTH) {
    throw new DatabaseMutationContractError(
      `databaseViewPresentationOverride exceeds the maximum JSON size of ${MAX_VIEW_CONFIG_LENGTH} bytes`,
    );
  }
  const override = readRecord(JSON.parse(canonical) as unknown, "databaseViewPresentationOverride");
  assertExactKeys(
    override,
    "databaseViewPresentationOverride",
    [],
    ["layout", "sort", "group", "subgroup", "groupDirection", "completion", "hierarchy", "layouts"],
  );
  if (override.layout !== undefined && override.layout !== "board" && override.layout !== "list") {
    throw new DatabaseMutationContractError(
      "databaseViewPresentationOverride.layout is unsupported",
    );
  }
  const group =
    override.group === undefined
      ? undefined
      : parseViewGroup(override.group, "databaseViewPresentationOverride.group");
  const subgroup =
    override.subgroup === undefined
      ? undefined
      : parseViewGroup(override.subgroup, "databaseViewPresentationOverride.subgroup");
  if (group && subgroup && group.propertyId === subgroup.propertyId) {
    throw new DatabaseMutationContractError(
      "databaseViewPresentationOverride group and subgroup must be different",
    );
  }
  if (
    override.groupDirection !== undefined &&
    override.groupDirection !== "asc" &&
    override.groupDirection !== "desc"
  ) {
    throw new DatabaseMutationContractError(
      "databaseViewPresentationOverride.groupDirection is unsupported",
    );
  }
  const completion =
    override.completion === undefined
      ? undefined
      : readRecord(override.completion, "databaseViewPresentationOverride.completion");
  if (completion) {
    assertExactKeys(
      completion,
      "databaseViewPresentationOverride.completion",
      [],
      ["range", "orderByRecency"],
    );
    if (
      completion.range !== undefined &&
      completion.range !== "all" &&
      completion.range !== "past_month" &&
      completion.range !== "past_week" &&
      completion.range !== "past_day" &&
      completion.range !== "none"
    ) {
      throw new DatabaseMutationContractError(
        "databaseViewPresentationOverride.completion.range is unsupported",
      );
    }
  }
  const hierarchy =
    override.hierarchy === undefined
      ? undefined
      : readRecord(override.hierarchy, "databaseViewPresentationOverride.hierarchy");
  if (hierarchy) {
    assertExactKeys(
      hierarchy,
      "databaseViewPresentationOverride.hierarchy",
      [],
      ["showSubPages", "nestedSubPages"],
    );
  }
  const layouts =
    override.layouts === undefined
      ? undefined
      : readRecord(override.layouts, "databaseViewPresentationOverride.layouts");
  if (layouts) {
    assertExactKeys(layouts, "databaseViewPresentationOverride.layouts", [], ["board", "list"]);
  }
  const parsed: DatabaseViewPresentationOverride = {
    ...(override.layout === undefined ? {} : { layout: override.layout }),
    ...(override.sort === undefined
      ? {}
      : {
          sort: parseViewSorts(override.sort, "databaseViewPresentationOverride.sort"),
        }),
    ...(override.group === undefined ? {} : { group: group ?? null }),
    ...(override.subgroup === undefined ? {} : { subgroup: subgroup ?? null }),
    ...(override.groupDirection === undefined ? {} : { groupDirection: override.groupDirection }),
    ...(completion
      ? {
          completion: {
            ...(completion.range === undefined
              ? {}
              : { range: completion.range as DatabaseViewCompletedRange }),
            ...(completion.orderByRecency === undefined
              ? {}
              : {
                  orderByRecency: readBoolean(
                    completion,
                    "orderByRecency",
                    "databaseViewPresentationOverride.completion",
                  ),
                }),
          },
        }
      : {}),
    ...(hierarchy
      ? {
          hierarchy: {
            ...(hierarchy.showSubPages === undefined
              ? {}
              : {
                  showSubPages: readBoolean(
                    hierarchy,
                    "showSubPages",
                    "databaseViewPresentationOverride.hierarchy",
                  ),
                }),
            ...(hierarchy.nestedSubPages === undefined
              ? {}
              : {
                  nestedSubPages: readBoolean(
                    hierarchy,
                    "nestedSubPages",
                    "databaseViewPresentationOverride.hierarchy",
                  ),
                }),
          },
        }
      : {}),
    ...(layouts
      ? {
          layouts: {
            ...(layouts.board === undefined
              ? {}
              : {
                  board: parseViewLayoutDisplayOverride(
                    layouts.board,
                    "databaseViewPresentationOverride.layouts.board",
                  ),
                }),
            ...(layouts.list === undefined
              ? {}
              : {
                  list: parseViewLayoutDisplayOverride(
                    layouts.list,
                    "databaseViewPresentationOverride.layouts.list",
                  ),
                }),
          },
        }
      : {}),
  };
  const propertyIds = new Set<string>();
  parsed.sort?.forEach((sort) => {
    if (sort.field.kind === "property") propertyIds.add(sort.field.propertyId);
  });
  if (parsed.group) propertyIds.add(parsed.group.propertyId);
  if (parsed.subgroup) propertyIds.add(parsed.subgroup.propertyId);
  for (const layout of [parsed.layouts?.board, parsed.layouts?.list]) {
    layout?.fields?.forEach((field) => {
      if (field.kind === "property") propertyIds.add(field.propertyId);
    });
  }
  propertyIds.forEach(parseDataSourcePropertyId);
  return parsed;
};

const parseInitialView = (value: unknown, label: string): InitialDatabaseView => {
  const view = readRecord(value, label);
  assertExactKeys(view, label, ["viewId", "name", "defaultLayout", "config"]);
  if (view.defaultLayout !== "board" && view.defaultLayout !== "list") {
    throw new DatabaseMutationContractError(`${label}.defaultLayout is unsupported`);
  }
  return {
    viewId: readString(view, "viewId", label),
    name: readString(view, "name", label, MAX_NAME_LENGTH),
    defaultLayout: view.defaultLayout,
    config: parseViewConfig(view.config, `${label}.config`, 1) as DatabaseViewConfig,
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
      initialView: parseInitialView(operation.initialView, `${label}.initialView`),
      ...(operation.beforeBlockId === undefined
        ? {}
        : {
            beforeBlockId: readOptionalString(operation, "beforeBlockId", label),
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
      operation.valueType !== "datetime"
    ) {
      throw new DatabaseMutationContractError(`${label}.valueType is unsupported`);
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
      expectedPropertyRevision: readRevision(operation, "expectedPropertyRevision", label),
      key: readString(operation, "key", label, MAX_KEY_LENGTH),
      name: readString(operation, "name", label, MAX_NAME_LENGTH),
      valueType: operation.valueType,
      config: parsePropertyConfig(operation.config, operation.valueType, `${label}.config`),
      ...(operation.beforePropertyId === undefined
        ? {}
        : {
            beforePropertyId: readOptionalString(operation, "beforePropertyId", label),
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
      expectedPropertyRevision: readRevision(operation, "expectedPropertyRevision", label, 1),
    };
  }
  if (operation.kind === "transfer_membership") {
    assertExactKeys(operation, label, ["kind", "pageId", "expectedMembership", "target"]);
    const expected = operation.expectedMembership;
    const target = operation.target;
    const parsedExpected =
      expected === null
        ? null
        : (() => {
            const record = readRecord(expected, `${label}.expectedMembership`);
            assertExactKeys(record, `${label}.expectedMembership`, ["membershipId", "revision"]);
            return {
              membershipId: readString(record, "membershipId", `${label}.expectedMembership`),
              revision: readRevision(record, "revision", `${label}.expectedMembership`, 1),
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
              ["databaseBlockId", "membershipId"],
              ["viewId", "groupKey", "beforePageId"],
            );
            const viewId =
              record.viewId === undefined
                ? undefined
                : readString(record, "viewId", `${label}.target`);
            if (
              (viewId === undefined &&
                (record.groupKey !== undefined || record.beforePageId !== undefined)) ||
              (viewId !== undefined && record.groupKey === undefined)
            ) {
              throw new DatabaseMutationContractError(
                `${label}.target View position requires viewId and groupKey together`,
              );
            }
            return {
              databaseBlockId: readString(record, "databaseBlockId", `${label}.target`),
              membershipId: readString(record, "membershipId", `${label}.target`),
              ...(viewId === undefined
                ? {}
                : {
                    viewId,
                    groupKey: readNullableString(record, "groupKey", `${label}.target`),
                  }),
              ...(record.beforePageId === undefined
                ? {}
                : {
                    beforePageId: readOptionalString(record, "beforePageId", `${label}.target`),
                  }),
            };
          })();
    return {
      kind: "transfer_membership",
      pageId: readString(operation, "pageId", label),
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
        "defaultLayout",
        "config",
        "isPrimary",
      ],
      ["beforeViewId"],
    );
    if (operation.defaultLayout !== "board" && operation.defaultLayout !== "list") {
      throw new DatabaseMutationContractError(`${label}.defaultLayout is unsupported`);
    }
    return {
      kind: "put_view",
      databaseBlockId: readString(operation, "databaseBlockId", label),
      viewId: readString(operation, "viewId", label),
      expectedRevision: readRevision(operation, "expectedRevision", label),
      name: readString(operation, "name", label, MAX_NAME_LENGTH),
      defaultLayout: operation.defaultLayout,
      config: parseViewConfig(operation.config, `${label}.config`, 1) as DatabaseViewConfig,
      isPrimary: readBoolean(operation, "isPrimary", label),
      ...(operation.beforeViewId === undefined
        ? {}
        : {
            beforeViewId: readOptionalString(operation, "beforeViewId", label),
          }),
    };
  }
  if (operation.kind === "delete_view") {
    assertExactKeys(operation, label, ["kind", "databaseBlockId", "viewId", "expectedRevision"]);
    return {
      kind: "delete_view",
      databaseBlockId: readString(operation, "databaseBlockId", label),
      viewId: readString(operation, "viewId", label),
      expectedRevision: readRevision(operation, "expectedRevision", label, 1),
    };
  }
  if (operation.kind === "position_page") {
    assertExactKeys(
      operation,
      label,
      ["kind", "viewId", "pageId", "expectedPositionRevision"],
      ["beforePageId"],
    );
    return {
      kind: "position_page",
      viewId: readString(operation, "viewId", label),
      pageId: readString(operation, "pageId", label),
      expectedPositionRevision: readRevision(operation, "expectedPositionRevision", label),
      ...(operation.beforePageId === undefined
        ? {}
        : {
            beforePageId: readOptionalString(operation, "beforePageId", label),
          }),
    };
  }
  if (operation.kind === "position_pages") {
    assertExactKeys(operation, label, ["kind", "viewId", "pages"], ["beforePageId"]);
    if (
      !Array.isArray(operation.pages) ||
      operation.pages.length < 1 ||
      operation.pages.length > MAX_DATABASE_MUTATION_BULK_ENTRIES
    ) {
      throw new DatabaseMutationContractError(
        `${label}.pages must contain 1-${MAX_DATABASE_MUTATION_BULK_ENTRIES} entries`,
      );
    }
    const pages = operation.pages.map((candidate, index) => {
      const entryLabel = `${label}.pages[${index}]`;
      const entry = readRecord(candidate, entryLabel);
      assertExactKeys(entry, entryLabel, ["pageId", "expectedPositionRevision"]);
      return {
        pageId: readString(entry, "pageId", entryLabel),
        expectedPositionRevision: readRevision(entry, "expectedPositionRevision", entryLabel),
      };
    });
    const pageIds = new Set(pages.map((entry) => entry.pageId));
    if (pageIds.size !== pages.length) {
      throw new DatabaseMutationContractError(`${label}.pages must use unique Page IDs`);
    }
    const beforePageId = readOptionalString(operation, "beforePageId", label);
    if (beforePageId && pageIds.has(beforePageId)) {
      throw new DatabaseMutationContractError(
        `${label}.beforePageId must be external to the moved Page set`,
      );
    }
    return {
      kind: "position_pages",
      viewId: readString(operation, "viewId", label),
      pages,
      ...(beforePageId === undefined ? {} : { beforePageId }),
    };
  }
  if (operation.kind === "set_value") {
    assertExactKeys(operation, label, [
      "kind",
      "pageId",
      "databaseBlockId",
      "propertyId",
      "expectedValueRevision",
      "value",
    ]);
    return {
      kind: "set_value",
      pageId: readString(operation, "pageId", label),
      databaseBlockId: readString(operation, "databaseBlockId", label),
      propertyId: readString(operation, "propertyId", label),
      expectedValueRevision: readRevision(operation, "expectedValueRevision", label),
      value: canonicalizeJson(operation.value, `${label}.value`),
    };
  }
  if (operation.kind === "set_values") {
    assertExactKeys(operation, label, ["kind", "databaseBlockId", "entries"]);
    if (
      !Array.isArray(operation.entries) ||
      operation.entries.length < 1 ||
      operation.entries.length > MAX_DATABASE_MUTATION_BULK_ENTRIES
    ) {
      throw new DatabaseMutationContractError(
        `${label}.entries must contain 1-${MAX_DATABASE_MUTATION_BULK_ENTRIES} entries`,
      );
    }
    return {
      kind: "set_values",
      databaseBlockId: readString(operation, "databaseBlockId", label),
      entries: operation.entries.map((candidate, index) => {
        const entryLabel = `${label}.entries[${index}]`;
        const entry = readRecord(candidate, entryLabel);
        assertExactKeys(entry, entryLabel, [
          "pageId",
          "propertyId",
          "expectedValueRevision",
          "value",
        ]);
        return {
          pageId: readString(entry, "pageId", entryLabel),
          propertyId: readString(entry, "propertyId", entryLabel),
          expectedValueRevision: readRevision(entry, "expectedValueRevision", entryLabel),
          value: canonicalizeJson(entry.value, `${entryLabel}.value`),
        };
      }),
    };
  }
  if (operation.kind === "add_remove_value") {
    assertExactKeys(operation, label, [
      "kind",
      "pageId",
      "databaseBlockId",
      "propertyId",
      "add",
      "remove",
    ]);
    const readMembers = (key: "add" | "remove"): readonly string[] => {
      const value = operation[key];
      if (!Array.isArray(value) || value.length > MAX_COLLECTION_ENTRIES) {
        throw new DatabaseMutationContractError(`${label}.${key} must be a bounded array`);
      }
      const members = value.map((_, index) =>
        readString({ member: value[index] }, "member", `${label}.${key}[${index}]`),
      );
      return [...new Set(members)].sort();
    };
    const add = readMembers("add");
    const remove = readMembers("remove");
    if (add.length === 0 && remove.length === 0) {
      throw new DatabaseMutationContractError(`${label} must add or remove at least one value`);
    }
    const removed = new Set(remove);
    if (add.some((member) => removed.has(member))) {
      throw new DatabaseMutationContractError(`${label} cannot add and remove the same value`);
    }
    return {
      kind: "add_remove_value",
      pageId: readString(operation, "pageId", label),
      databaseBlockId: readString(operation, "databaseBlockId", label),
      propertyId: readString(operation, "propertyId", label),
      add,
      remove,
    };
  }
  throw new DatabaseMutationContractError(`${label}.kind is unsupported`);
};

export const databaseMutationOperationPaths = (
  operation: DatabaseMutationOperation,
): readonly string[] => {
  switch (operation.kind) {
    case "create_database":
      return [`database/${encodeURIComponent(operation.databaseBlockId)}`];
    case "put_property":
    case "delete_property":
      return [
        `database/${encodeURIComponent(operation.databaseBlockId)}/property/${encodeURIComponent(operation.propertyId)}`,
      ];
    case "transfer_membership":
      return [`page/${encodeURIComponent(operation.pageId)}/membership`];
    case "put_view":
    case "delete_view":
      return [
        `database/${encodeURIComponent(operation.databaseBlockId)}/view/${encodeURIComponent(operation.viewId)}`,
      ];
    case "position_page":
      return [
        `view/${encodeURIComponent(operation.viewId)}/position/${encodeURIComponent(operation.pageId)}`,
      ];
    case "position_pages":
      return operation.pages.map(
        (entry) =>
          `view/${encodeURIComponent(operation.viewId)}/position/${encodeURIComponent(entry.pageId)}`,
      );
    case "set_value":
    case "add_remove_value":
      return [
        `database/${encodeURIComponent(operation.databaseBlockId)}/page/${encodeURIComponent(operation.pageId)}/property/${encodeURIComponent(operation.propertyId)}`,
      ];
    case "set_values":
      return operation.entries.map(
        (entry) =>
          `database/${encodeURIComponent(operation.databaseBlockId)}/page/${encodeURIComponent(entry.pageId)}/property/${encodeURIComponent(entry.propertyId)}`,
      );
  }
};

const operationEntities = (operation: DatabaseMutationOperation): ReadonlySet<string> => {
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
      add("page", operation.pageId);
      if (operation.expectedMembership) {
        add("membership", operation.expectedMembership.membershipId);
      }
      if (operation.target) {
        add("database", operation.target.databaseBlockId);
        add("membership", operation.target.membershipId);
        if (operation.target.viewId) add("view", operation.target.viewId);
      }
      break;
    case "put_view":
    case "delete_view":
      add("database", operation.databaseBlockId);
      add("view", operation.viewId);
      break;
    case "position_page":
      add("view", operation.viewId);
      add("page", operation.pageId);
      break;
    case "position_pages":
      add("view", operation.viewId);
      for (const entry of operation.pages) add("page", entry.pageId);
      break;
    case "set_value":
    case "add_remove_value":
      add("database", operation.databaseBlockId);
      add("page", operation.pageId);
      add("property", operation.propertyId);
      break;
    case "set_values":
      add("database", operation.databaseBlockId);
      for (const entry of operation.entries) {
        add("page", entry.pageId);
        add("property", entry.propertyId);
      }
      break;
  }
  return entities;
};

type DatabasePageMutationTarget =
  | {
      readonly kind: "position";
      readonly pageId: string;
      readonly viewId: string;
    }
  | {
      readonly kind: "value";
      readonly pageId: string;
      readonly databaseBlockId: string;
    };

const databasePageMutationTargets = (
  operation: DatabaseMutationOperation,
): readonly DatabasePageMutationTarget[] => {
  switch (operation.kind) {
    case "position_page":
      return [
        {
          kind: "position",
          pageId: operation.pageId,
          viewId: operation.viewId,
        },
      ];
    case "position_pages":
      return operation.pages.map((entry) => ({
        kind: "position" as const,
        pageId: entry.pageId,
        viewId: operation.viewId,
      }));
    case "set_value":
    case "add_remove_value":
      return [
        {
          kind: "value",
          pageId: operation.pageId,
          databaseBlockId: operation.databaseBlockId,
        },
      ];
    case "set_values":
      return operation.entries.map((entry) => ({
        kind: "value" as const,
        pageId: entry.pageId,
        databaseBlockId: operation.databaseBlockId,
      }));
    default:
      return [];
  }
};

const validateDatabaseMutationOperations = (
  operations: readonly DatabaseMutationOperation[],
): void => {
  if (operations.length < 1 || operations.length > MAX_DATABASE_MUTATION_OPERATIONS) {
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
  const positionedPages = new Set<string>();

  operations.forEach((operation, index) => {
    for (const path of databaseMutationOperationPaths(operation)) {
      if (paths.has(path)) {
        throw new DatabaseMutationContractError(
          `databaseMutation.operations contains conflicting writes to ${path}`,
        );
      }
      paths.add(path);
    }

    const entities = operationEntities(operation);
    if (index > 0 && ![...entities].some((entity) => connectedEntities.has(entity))) {
      throw new DatabaseMutationContractError(
        `databaseMutation.operations[${index}] is not connected to the same semantic intent`,
      );
    }
    for (const entity of entities) connectedEntities.add(entity);

    if (operation.kind === "transfer_membership") {
      membershipTransfers.set(operation.pageId, operation);
      return;
    }
    for (const target of databasePageMutationTargets(operation)) {
      if (target.kind === "position") {
        positionedPages.add(target.pageId);
        continue;
      }
      if (positionedPages.has(target.pageId)) {
        throw new DatabaseMutationContractError(
          `databaseMutation.operations must update Page ${target.pageId} property values before positioning it`,
        );
      }
    }
  });

  for (const [pageId, transfer] of membershipTransfers) {
    for (const operation of operations) {
      for (const target of databasePageMutationTargets(operation)) {
        if (target.pageId !== pageId) continue;
        if (transfer.target === null) {
          throw new DatabaseMutationContractError(
            `databaseMutation.operations cannot mutate Page ${pageId} while removing its Database membership`,
          );
        }
        if (
          target.kind === "position" &&
          transfer.target.viewId !== undefined &&
          target.viewId === transfer.target.viewId
        ) {
          throw new DatabaseMutationContractError(
            `databaseMutation.operations must express the initial View position on transfer_membership.target`,
          );
        }
        if (target.kind === "value" && target.databaseBlockId !== transfer.target.databaseBlockId) {
          throw new DatabaseMutationContractError(
            `databaseMutation.operations cannot write Page ${pageId} in a Database other than its transfer target`,
          );
        }
      }
    }
  }
};

export const parseDatabaseMutationRequest = (value: unknown): DatabaseMutationRequest => {
  const request = readRecord(value, "databaseMutation");
  assertExactKeys(
    request,
    "databaseMutation",
    ["operationId", "projectId", "storeEpoch", "actor", "operations"],
    ["clientSessionId"],
  );
  if (!Array.isArray(request.operations)) {
    throw new DatabaseMutationContractError("databaseMutation.operations must be an array");
  }
  const operations = request.operations.map((operation) => parseOperation(operation));
  validateDatabaseMutationOperations(operations);
  const parsed: DatabaseMutationRequest = {
    operationId: readString(request, "operationId", "databaseMutation"),
    projectId: readString(request, "projectId", "databaseMutation"),
    storeEpoch: readString(request, "storeEpoch", "databaseMutation"),
    ...(request.clientSessionId === undefined
      ? {}
      : {
          clientSessionId: readOptionalString(request, "clientSessionId", "databaseMutation"),
        }),
    actor: readJsonRecord(request.actor, "databaseMutation.actor"),
    operations,
  };
  if (canonicalizeDatabaseMutationIntent(parsed).length <= MAX_CANONICAL_REQUEST_LENGTH) {
    return parsed;
  }
  throw new DatabaseMutationContractError(
    "databaseMutation exceeds the canonical request size limit",
  );
};

export const stableStringifyDatabaseJson = (value: unknown): string =>
  stableStringifyBlockPropertyJson(value);

const isEmptyDatabaseViewValue = (value: DatabaseJsonValue | undefined): boolean =>
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
    stableStringifyDatabaseJson(current ?? null) === stableStringifyDatabaseJson(expected ?? null);
  if (clause.operator === "equals") return equals;
  if (clause.operator === "not_equals") return !equals;
  if (typeof current === "string" && typeof expected === "string") {
    const contains = current.includes(expected);
    return clause.operator === "not_contains" ? !contains : contains;
  }
  if (!Array.isArray(current)) return clause.operator === "not_contains";
  const expectedKey = stableStringifyDatabaseJson(expected ?? null);
  const contains = current.some(
    (candidate) => stableStringifyDatabaseJson(candidate) === expectedKey,
  );
  return clause.operator === "not_contains" ? !contains : contains;
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
    return filter.children.every((child) => evaluateDatabaseViewFilter(child, valueForPropertyId));
  }
  return filter.children.some((child) => evaluateDatabaseViewFilter(child, valueForPropertyId));
};

/** Actor/session are first-seen audit attribution, not logical retry identity. */
export const canonicalizeDatabaseMutationIntent = (value: unknown): string => {
  const request = isRecord(value)
    ? (value as unknown as DatabaseMutationRequest)
    : parseDatabaseMutationRequest(value);
  return stableStringifyDatabaseJson({
    operationId: request.operationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    operations: request.operations,
  });
};

export const parseDatabaseMutationReceipt = (value: unknown): DatabaseMutationReceipt => {
  const receipt = readRecord(value, "databaseMutationReceipt");
  assertExactKeys(receipt, "databaseMutationReceipt", [
    "operationId",
    "projectId",
    "storeEpoch",
    "operationKinds",
    "affectedDatabaseBlockIds",
    "duplicate",
    "payload",
    "commitSeq",
    "committedAt",
  ]);
  const supportedKinds = new Set<DatabaseMutationOperation["kind"]>([
    "create_database",
    "put_property",
    "delete_property",
    "transfer_membership",
    "put_view",
    "delete_view",
    "position_page",
    "position_pages",
    "set_value",
    "set_values",
    "add_remove_value",
  ]);
  if (
    !Array.isArray(receipt.operationKinds) ||
    receipt.operationKinds.length < 1 ||
    receipt.operationKinds.length > MAX_DATABASE_MUTATION_OPERATIONS ||
    !receipt.operationKinds.every(
      (kind) =>
        typeof kind === "string" && supportedKinds.has(kind as DatabaseMutationOperation["kind"]),
    )
  ) {
    throw new DatabaseMutationContractError(
      "databaseMutationReceipt.operationKinds is unsupported",
    );
  }
  const operationKinds = receipt.operationKinds as DatabaseMutationOperation["kind"][];
  return {
    operationId: readString(receipt, "operationId", "databaseMutationReceipt"),
    projectId: readString(receipt, "projectId", "databaseMutationReceipt"),
    storeEpoch: readString(receipt, "storeEpoch", "databaseMutationReceipt"),
    operationKinds,
    affectedDatabaseBlockIds: readCanonicalStringArray(
      receipt,
      "affectedDatabaseBlockIds",
      "databaseMutationReceipt",
    ),
    duplicate: readBoolean(receipt, "duplicate", "databaseMutationReceipt"),
    payload: readJsonRecord(receipt.payload, "databaseMutationReceipt.payload"),
    commitSeq: readRevision(receipt, "commitSeq", "databaseMutationReceipt", 1),
    committedAt: readString(receipt, "committedAt", "databaseMutationReceipt"),
  };
};

export const parseDatabaseMutationCommandError = (value: unknown): DatabaseMutationCommandError => {
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
    throw new DatabaseMutationContractError("databaseMutationError.code is invalid");
  }
  return {
    code: error.code as DatabaseMutationErrorCode,
    message: readString(error, "message", "databaseMutationError", 4_096),
    retryable: readBoolean(error, "retryable", "databaseMutationError"),
    ...(error.operationId === undefined
      ? {}
      : {
          operationId: readOptionalString(error, "operationId", "databaseMutationError"),
        }),
    ...(error.expectedRevision === undefined
      ? {}
      : {
          expectedRevision: readRevision(error, "expectedRevision", "databaseMutationError"),
        }),
    ...(error.actualRevision === undefined
      ? {}
      : {
          actualRevision: readRevision(error, "actualRevision", "databaseMutationError"),
        }),
  };
};
