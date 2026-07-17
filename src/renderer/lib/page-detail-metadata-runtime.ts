import type {
  BlockPropertyFieldMutationV2,
  BlockPropertyJsonValueV2,
  BlockPropertyMutationCommandResultV2,
  BlockPropertyMutationRequestV2,
} from "../../shared/block-property-mutations-v2";
import { stableStringifyBlockPropertyJsonV2 } from "../../shared/block-property-mutations-v2";
import {
  parseDataSourceId,
  parseDataSourceOptionId,
  parseDataSourcePropertyId,
  type DataSourceOptionId,
} from "../../shared/database-identities";
import { isWorkflowStatus } from "../../shared/workflow-status";
import type {
  DatabaseJsonValue,
  DatabasePropertyValueType,
} from "../../shared/database-kernel";
import { parseDatabasePropertyConfig } from "../../shared/database-kernel";
import type { PageDetail } from "../../shared/page-detail";
import type {
  PageInput,
  PageRunInTarget,
  Estimate,
  Priority,
} from "../../shared/types";
import { mutateBlockProperties } from "./api";
import { fetchPageDetail } from "./page-detail-store";
import type { PageStageMetadataMutationResult } from "./page-stage-page";

type MetadataPatch = Partial<PageInput>;
type DataSourceProperty = Extract<
  PageDetail["dataSourceContext"],
  { readonly kind: "member" }
>["properties"][number];

export interface PageDetailMetadataRuntimeDependencies {
  readonly readDetail: (
    projectId: string,
    pageId: string,
  ) => Promise<PageDetail | null>;
  readonly mutateProperties: (
    projectId: string,
    request: BlockPropertyMutationRequestV2,
  ) => Promise<BlockPropertyMutationCommandResultV2>;
  readonly refreshDetail: (
    projectId: string,
    pageId: string,
  ) => Promise<unknown>;
}

const DEFAULT_DEPENDENCIES: PageDetailMetadataRuntimeDependencies = {
  readDetail: fetchPageDetail,
  mutateProperties: mutateBlockProperties,
  refreshDetail: fetchPageDetail,
};

const DATABASE_FIELDS = {
  status: { key: "status", valueType: "select" },
  priority: { key: "priority", valueType: "select" },
  estimate: { key: "estimate", valueType: "select" },
  tags: { key: "tags", valueType: "multi_select" },
  dueDate: { key: "due_date", valueType: "date" },
  scheduledStart: { key: "scheduled_start", valueType: "datetime" },
  scheduledEnd: { key: "scheduled_end", valueType: "datetime" },
  assignee: { key: "assignee", valueType: "person" },
} as const satisfies Partial<
  Record<
    keyof PageInput,
    { readonly key: string; readonly valueType: DatabasePropertyValueType }
  >
>;

const INTRINSIC_FIELDS = {
  isAllDay: "schedule.isAllDay",
  recurrence: "recurrence.config",
  reminders: "reminders.config",
  scheduleTimezone: "schedule.timezone",
  runInTarget: "run.target",
  runInLocalPath: "run.localPath",
  runInBaseBranch: "run.baseBranch",
  runInWorktreePath: "run.worktreePath",
  runInEnvironmentPath: "run.environmentPath",
} as const satisfies Partial<Record<keyof PageInput, string>>;

const hasOwn = <Key extends PropertyKey>(
  value: object,
  key: Key,
): value is Record<Key, unknown> => Object.hasOwn(value, key);

const DATABASE_FIELD_NAMES = new Set<string>(Object.keys(DATABASE_FIELDS));
const INTRINSIC_FIELD_NAMES = new Set<string>(Object.keys(INTRINSIC_FIELDS));
const PRIORITIES = new Set<Priority>([
  "p0-critical",
  "p1-high",
  "p2-medium",
  "p3-low",
  "p4-later",
]);
const ESTIMATES = new Set<Estimate>(["xs", "s", "m", "l", "xl"]);
const RUN_TARGETS = new Set<PageRunInTarget>([
  "localProject",
  "newWorktree",
  "cloud",
]);

const portableValue = (
  value: unknown,
  label: string,
): BlockPropertyJsonValueV2 => {
  try {
    return JSON.parse(
      stableStringifyBlockPropertyJsonV2(value),
    ) as BlockPropertyJsonValueV2;
  } catch (error) {
    throw new TypeError(`${label} must be bounded portable JSON`, {
      cause: error,
    });
  }
};

const stableEqual = (left: unknown, right: unknown): boolean =>
  stableStringifyBlockPropertyJsonV2(left) ===
  stableStringifyBlockPropertyJsonV2(right);

export const isPageMetadataPatch = (patch: Partial<PageInput>): boolean => {
  const fields = Object.keys(patch);
  return fields.length > 0 && fields.every(
    (field) =>
      DATABASE_FIELD_NAMES.has(field) || INTRINSIC_FIELD_NAMES.has(field),
  );
};

const databaseValue = (
  field: keyof typeof DATABASE_FIELDS,
  value: unknown,
): DatabaseJsonValue => {
  if (value === undefined) {
    throw new TypeError(`Page ${field} must be omitted instead of undefined`);
  }
  if (field === "dueDate") {
    if (value === null) return null;
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    throw new TypeError("Page dueDate must be a valid Date or null");
  }
  if (field === "scheduledStart" || field === "scheduledEnd") {
    if (value === null) return null;
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return value.toISOString();
    }
    throw new TypeError(`Page ${field} must be a valid Date or null`);
  }
  if (field === "status") {
    if (isWorkflowStatus(value)) return value;
    throw new TypeError("Page status must be a canonical status");
  }
  if (field === "priority") {
    if (value === null || PRIORITIES.has(value as Priority)) {
      return value as Priority | null;
    }
    throw new TypeError("Page priority is invalid");
  }
  if (field === "estimate") {
    if (value === null || ESTIMATES.has(value as Estimate)) {
      return value as Estimate | null;
    }
    throw new TypeError("Page estimate is invalid");
  }
  if (field === "tags") {
    if (!Array.isArray(value)) throw new TypeError("Page tags must be an array");
    const tags = value.map((tag, index) => {
      if (
        typeof tag === "string" &&
        tag.length > 0 &&
        tag.length <= 512 &&
        tag === tag.trim()
      ) {
        return tag;
      }
      throw new TypeError(`Page tags[${index}] must be a canonical tag`);
    });
    return [...new Set(tags)].sort();
  }
  if (field === "assignee") {
    if (typeof value === "string") return value.trim() || null;
    throw new TypeError("Page assignee must be a string");
  }
  return portableValue(value, `Page ${field}`);
};

const intrinsicValue = (
  field: keyof typeof INTRINSIC_FIELDS,
  value: unknown,
): BlockPropertyJsonValueV2 => {
  if (value === undefined) {
    throw new TypeError(`Page ${field} must be omitted instead of undefined`);
  }
  if (field === "isAllDay") {
    if (typeof value === "boolean") return value;
    if (value === null) return false;
    throw new TypeError("Page isAllDay must be a boolean or null");
  }
  if (field === "reminders") {
    if (Array.isArray(value)) return portableValue(value, "Page reminders");
    throw new TypeError("Page reminders must be an array");
  }
  if (field === "recurrence") {
    if (value === null) return null;
    return portableValue(value, "Page recurrence");
  }
  if (field === "runInTarget") {
    if (RUN_TARGETS.has(value as PageRunInTarget)) {
      return value as PageRunInTarget;
    }
    throw new TypeError("Page runInTarget is invalid");
  }
  if (value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  throw new TypeError(`Page ${field} must be a string or null`);
};

const resolveTagOptionIds = (
  property: DataSourceProperty,
  tagNames: readonly string[],
): readonly DataSourceOptionId[] => {
  const propertyId = parseDataSourcePropertyId(property.propertyId);
  const config = parseDatabasePropertyConfig(property.valueType, property.config);
  if (!Array.isArray(config.options)) {
    throw new Error(`Data Source Property ${property.propertyId} has no option registry`);
  }
  const byName = new Map<string, string>();
  const optionIds = new Set<string>();
  for (const candidate of config.options) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      continue;
    }
    const option = candidate as Readonly<Record<string, DatabaseJsonValue>>;
    if (typeof option.id !== "string" || typeof option.name !== "string") continue;
    if (byName.has(option.name)) {
      throw new Error(
        `Data Source Property ${property.propertyId} has ambiguous option name ${option.name}`,
      );
    }
    byName.set(option.name, option.id);
    optionIds.add(option.id);
  }
  return [...new Set(tagNames.map((tagName) => {
    const optionId = byName.get(tagName) ?? (optionIds.has(tagName) ? tagName : null);
    if (!optionId) {
      throw new Error(
        `Data Source Property ${property.propertyId} has no option named ${tagName}`,
      );
    }
    return parseDataSourceOptionId({ propertyId, value: optionId });
  }))].sort();
};

const compileDataSourceFields = (
  detail: PageDetail,
  patch: MetadataPatch,
): readonly BlockPropertyFieldMutationV2[] => {
  const entries = Object.entries(DATABASE_FIELDS) as Array<
    [
      keyof typeof DATABASE_FIELDS,
      { readonly key: string; readonly valueType: DatabasePropertyValueType },
    ]
  >;
  const requested = entries.filter(([field]) => hasOwn(patch, field));
  if (requested.length === 0) return [];
  if (detail.dataSourceContext.kind !== "member") {
    throw new Error("This Page has no Data Source properties");
  }
  const context = detail.dataSourceContext;
  return requested.flatMap<BlockPropertyFieldMutationV2>(([
    field,
    definition,
  ]) => {
    const property = context.properties.find(
      (candidate) => candidate.propertyId === definition.key,
    );
    if (!property) {
      throw new Error(
        `Data Source ${context.dataSource.dataSourceId} has no ${definition.key} property`,
      );
    }
    if (property.valueType !== definition.valueType) {
      throw new Error(
        `Data Source property ${property.propertyId} has incompatible type ${property.valueType}`,
      );
    }
    const requestedValue = databaseValue(field, patch[field]);
    const current = context.values[property.propertyId];
    const currentValue = current?.value ??
      (property.valueType === "multi_select" ? [] : null);
    const propertyId = parseDataSourcePropertyId(property.propertyId);
    const dataSourceId = parseDataSourceId(context.dataSource.dataSourceId);
    if (property.valueType === "multi_select") {
      if (!Array.isArray(requestedValue)) {
        throw new Error(`Data Source Property ${property.propertyId} requires option names`);
      }
      const value = resolveTagOptionIds(property, requestedValue);
      if (!Array.isArray(currentValue) || !currentValue.every((entry) => typeof entry === "string")) {
        throw new Error(`Data Source Property ${property.propertyId} has a corrupt value`);
      }
      const currentIds = currentValue.map((optionId) =>
        parseDataSourceOptionId({ propertyId, value: optionId })
      );
      const currentSet = new Set(currentIds);
      const nextSet = new Set(value);
      const add = value.filter((optionId) => !currentSet.has(optionId));
      const remove = currentIds.filter((optionId) => !nextSet.has(optionId));
      if (add.length === 0 && remove.length === 0) return [];
      return [{
        scope: "data_source" as const,
        pageId: detail.page.pageId,
        dataSourceId,
        propertyId,
        operation: "add_remove" as const,
        add,
        remove,
      }];
    }
    if (typeof requestedValue !== "string" && requestedValue !== null) {
      throw new Error(`Data Source Property ${property.propertyId} requires a scalar value`);
    }
    if (stableEqual(currentValue, requestedValue)) return [];
    return [{
      scope: "data_source" as const,
      pageId: detail.page.pageId,
      dataSourceId,
      propertyId,
      operation: "set" as const,
      expectedRevision: current?.revision ?? 0,
      value: requestedValue,
    }];
  });
};

const compileIntrinsicFields = (
  detail: PageDetail,
  patch: MetadataPatch,
): readonly BlockPropertyFieldMutationV2[] => {
  const entries = Object.entries(INTRINSIC_FIELDS) as Array<
    [keyof typeof INTRINSIC_FIELDS, string]
  >;
  return entries.flatMap(([field, propertyKey]) => {
    if (!hasOwn(patch, field)) return [];
    const current = detail.intrinsicProperties.find(
      (property) => property.key === propertyKey,
    );
    const value = intrinsicValue(field, patch[field]);
    if (current && stableEqual(current.value, value)) return [];
    return [{
      scope: "intrinsic" as const,
      blockId: detail.page.pageId,
      propertyKey,
      operation: "set" as const,
      expectedRevision: current?.revision ?? 0,
      value,
    }];
  });
};

const retryPropertyMutation = async (
  projectId: string,
  request: BlockPropertyMutationRequestV2,
  dependencies: PageDetailMetadataRuntimeDependencies,
): Promise<BlockPropertyMutationCommandResultV2> => {
  try {
    const result = await dependencies.mutateProperties(projectId, request);
    if (result.ok || !result.error.retryable) return result;
  } catch {
    // Durable mutation identity makes one exact retry transport-safe.
  }
  return await dependencies.mutateProperties(projectId, request);
};

export const commitPageDetailMetadataPatch = async (input: {
  readonly projectId: string;
  readonly pageId: string;
  readonly operationId: string;
  readonly clientSessionId?: string;
  readonly patch: MetadataPatch;
  readonly dependencies?: PageDetailMetadataRuntimeDependencies;
}): Promise<PageStageMetadataMutationResult> => {
  const dependencies = input.dependencies ?? DEFAULT_DEPENDENCIES;
  if (!isPageMetadataPatch(input.patch)) {
    throw new TypeError("Page metadata patch contains unsupported fields");
  }
  const detail = await dependencies.readDetail(input.projectId, input.pageId);
  if (!detail) return { status: "not_found" };
  const dataSourceFields = compileDataSourceFields(detail, input.patch);
  const intrinsicFields = compileIntrinsicFields(detail, input.patch);
  const fields = [...dataSourceFields, ...intrinsicFields];
  if (fields.length === 0) {
    await dependencies.refreshDetail(input.projectId, input.pageId);
    return { status: "updated", didMutate: false };
  }

  const result = await retryPropertyMutation(
      input.projectId,
      {
        version: 2,
        mutationId: input.operationId,
        projectId: input.projectId,
        storeEpoch: detail.storeEpoch,
        ...(input.clientSessionId ? { clientSessionId: input.clientSessionId } : {}),
        actor: { kind: "page_stage" },
        fields,
      },
      dependencies,
    );
    if (!result.ok) {
      if (result.error.code === "property_conflict") {
        await dependencies.refreshDetail(input.projectId, input.pageId);
        return { status: "conflict" };
      }
      if (
        result.error.code === "block_not_found" ||
        result.error.code === "data_source_not_found" ||
        result.error.code === "membership_not_found" ||
        result.error.code === "property_not_found" ||
        result.error.code === "project_not_found"
      ) {
        return { status: "not_found" };
      }
      return { status: "error", error: result.error.message };
    }

  await dependencies.refreshDetail(input.projectId, input.pageId);
  return { status: "updated", didMutate: true };
};
