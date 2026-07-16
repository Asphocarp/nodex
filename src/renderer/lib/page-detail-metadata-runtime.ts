import type {
  BlockPropertyFieldMutation,
  BlockPropertyMutationCommandResult,
  BlockPropertyMutationRequest,
  BlockPropertyJsonValue,
} from "../../shared/block-property-mutations";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";
import { isWorkflowStatus } from "../../shared/workflow-status";
import type {
  DatabaseApply,
  DatabaseApplyResult,
  SetDataSourcePageValueOperation,
} from "../../shared/database-module";
import type {
  DatabaseJsonValue,
  DatabasePropertyValueType,
} from "../../shared/database-kernel";
import type { PageDetail } from "../../shared/page-detail";
import type {
  PageInput,
  PageRunInTarget,
  Estimate,
  Priority,
} from "../../shared/types";
import { applyDatabaseModule, mutateBlockProperties } from "./api";
import { fetchPageDetail } from "./page-detail-store";
import type { PageStageMetadataMutationResult } from "./page-stage-page";

type MetadataPatch = Partial<PageInput>;

export interface PageDetailMetadataRuntimeDependencies {
  readonly readDetail: (
    projectId: string,
    pageId: string,
  ) => Promise<PageDetail | null>;
  readonly applyDatabase: (
    projectId: string,
    request: DatabaseApply,
  ) => Promise<DatabaseApplyResult>;
  readonly mutateIntrinsic: (
    projectId: string,
    request: BlockPropertyMutationRequest,
  ) => Promise<BlockPropertyMutationCommandResult>;
  readonly refreshDetail: (
    projectId: string,
    pageId: string,
  ) => Promise<unknown>;
}

const DEFAULT_DEPENDENCIES: PageDetailMetadataRuntimeDependencies = {
  readDetail: fetchPageDetail,
  applyDatabase: applyDatabaseModule,
  mutateIntrinsic: mutateBlockProperties,
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
): BlockPropertyJsonValue => {
  try {
    return JSON.parse(
      stableStringifyBlockPropertyJson(value),
    ) as BlockPropertyJsonValue;
  } catch (error) {
    throw new TypeError(`${label} must be bounded portable JSON`, {
      cause: error,
    });
  }
};

const stableEqual = (left: unknown, right: unknown): boolean =>
  stableStringifyBlockPropertyJson(left) ===
  stableStringifyBlockPropertyJson(right);

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
): BlockPropertyJsonValue => {
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

const compileDatabaseOperations = (
  detail: PageDetail,
  patch: MetadataPatch,
): readonly SetDataSourcePageValueOperation[] => {
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
  return requested.flatMap(([field, definition]) => {
    const property = context.properties.find(
      (candidate) => candidate.key === definition.key,
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
    const value = databaseValue(field, patch[field]);
    const current = context.values[property.propertyId];
    const currentValue = current?.value ??
      (property.valueType === "multi_select" ? [] : null);
    if (stableEqual(currentValue, value)) return [];
    return [{
      kind: "set_value",
      pageId: detail.page.pageId,
      dataSourceId: context.dataSource.dataSourceId,
      propertyId: property.propertyId,
      expectedValueRevision: current?.revision ?? 0,
      value,
    }];
  });
};

const compileIntrinsicFields = (
  detail: PageDetail,
  patch: MetadataPatch,
): readonly BlockPropertyFieldMutation[] => {
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

const retryDatabaseApply = async (
  projectId: string,
  request: DatabaseApply,
  dependencies: PageDetailMetadataRuntimeDependencies,
): Promise<DatabaseApplyResult> => {
  try {
    const result = await dependencies.applyDatabase(projectId, request);
    if (result.ok || !result.error.retryable) return result;
  } catch {
    // Durable operation identity makes one exact retry transport-safe.
  }
  return await dependencies.applyDatabase(projectId, request);
};

const retryIntrinsicMutation = async (
  projectId: string,
  request: BlockPropertyMutationRequest,
  dependencies: PageDetailMetadataRuntimeDependencies,
): Promise<BlockPropertyMutationCommandResult> => {
  try {
    const result = await dependencies.mutateIntrinsic(projectId, request);
    if (result.ok || !result.error.retryable) return result;
  } catch {
    // Durable mutation identity makes one exact retry transport-safe.
  }
  return await dependencies.mutateIntrinsic(projectId, request);
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
  const databaseOperations = compileDatabaseOperations(detail, input.patch);
  const intrinsicFields = compileIntrinsicFields(detail, input.patch);
  if (databaseOperations.length === 0 && intrinsicFields.length === 0) {
    await dependencies.refreshDetail(input.projectId, input.pageId);
    return { status: "updated", didMutate: false };
  }

  if (databaseOperations.length > 0) {
    const result = await retryDatabaseApply(
      input.projectId,
      {
        version: 1,
        operationId: `${input.operationId}:data-source`,
        projectId: input.projectId,
        storeEpoch: detail.storeEpoch,
        actor: { kind: "page_stage" },
        operations: databaseOperations,
      },
      dependencies,
    );
    if (!result.ok) {
      if (result.error.code === "revision_conflict") {
        await dependencies.refreshDetail(input.projectId, input.pageId);
        return { status: "conflict" };
      }
      if (result.error.code === "resource_not_found") return { status: "not_found" };
      return { status: "error", error: result.error.message };
    }
  }

  if (intrinsicFields.length > 0) {
    const result = await retryIntrinsicMutation(
      input.projectId,
      {
        version: 1,
        mutationId: `${input.operationId}:intrinsic`,
        projectId: input.projectId,
        storeEpoch: detail.storeEpoch,
        ...(input.clientSessionId ? { clientSessionId: input.clientSessionId } : {}),
        actor: { kind: "page_stage" },
        fields: intrinsicFields,
      },
      dependencies,
    );
    if (!result.ok) {
      if (result.error.code === "property_conflict") {
        await dependencies.refreshDetail(input.projectId, input.pageId);
        return { status: "conflict" };
      }
      if (result.error.code === "block_not_found") return { status: "not_found" };
      return { status: "error", error: result.error.message };
    }
  }

  await dependencies.refreshDetail(input.projectId, input.pageId);
  return { status: "updated", didMutate: true };
};
