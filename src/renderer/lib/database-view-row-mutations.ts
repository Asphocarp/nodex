import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  MAX_DATABASE_MODULE_V2_BULK_ENTRIES,
  type DatabaseApplyOperationV2,
  type DatabaseApplyReceiptV2,
  type DatabaseApplyResultV2,
  type DatabaseApplyV2,
  type DatabaseModuleErrorV2,
  type DataSourcePageRowV2,
  type DataSourcePropertyRecordV2,
  type LibraryDatabaseApplyReceiptV2,
  type LibraryDatabaseApplyResultV2,
  type LibraryDatabaseApplyV2,
} from "../../shared/database-module-v2";
import { parseDataSourceOptionId } from "../../shared/database-identities";
import {
  stableStringifyDatabaseJson,
  type DatabaseJsonValue,
} from "../../shared/database-kernel";
import { applyDatabaseModule, applyLibraryDatabaseModule } from "./api";
import type { DatabaseViewRenderModel } from "./database-view-render-model";

export class DatabaseViewMutationError extends Error {
  constructor(readonly commandError: DatabaseModuleErrorV2) {
    super(commandError.message);
    this.name = "DatabaseViewMutationError";
  }
}

const localError = (message: string): DatabaseViewMutationError =>
  new DatabaseViewMutationError({
    code: "invalid_request",
    message,
    retryable: false,
  });

const findRow = (
  model: DatabaseViewRenderModel,
  pageId: string,
): DataSourcePageRowV2 => {
  const row = model.query.rows.find(
    (candidate) => candidate.page.pageId === pageId,
  );
  if (row) return row;
  throw localError(`Page is no longer present in View ${model.databaseViewId}`);
};

const findProperty = (
  model: DatabaseViewRenderModel,
  propertyId: string,
): DataSourcePropertyRecordV2 => {
  const property = model.query.properties.find(
    (candidate) =>
      candidate.propertyId === propertyId
      && candidate.lifecycle === "active",
  );
  if (property) return property;
  throw localError(
    `Property is no longer active in Data Source ${model.dataSourceId}`,
  );
};

const stringSet = (value: DatabaseJsonValue | undefined): ReadonlySet<string> =>
  new Set(
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [],
  );

export const buildDatabaseViewPropertyValueOperations = (input: {
  readonly model: DatabaseViewRenderModel;
  readonly pageId: string;
  readonly propertyId: string;
  readonly value: DatabaseJsonValue;
}): readonly DatabaseApplyOperationV2[] => {
  const row = findRow(input.model, input.pageId);
  const property = findProperty(input.model, input.propertyId);
  const current = row.values[property.propertyId];
  if (
    stableStringifyDatabaseJson(current?.value ?? null)
    === stableStringifyDatabaseJson(input.value)
  ) {
    return [];
  }

  if (property.valueType === "multi_select") {
    const before = stringSet(current?.value);
    const after = stringSet(input.value);
    const add = [...after]
      .filter((entry) => !before.has(entry))
      .sort()
      .map((value) => parseDataSourceOptionId({
        propertyId: property.propertyId,
        value,
      }));
    const remove = [...before]
      .filter((entry) => !after.has(entry))
      .sort()
      .map((value) => parseDataSourceOptionId({
        propertyId: property.propertyId,
        value,
      }));
    if (add.length === 0 && remove.length === 0) return [];
    return [{
      kind: "edit_property_values",
      edits: [{
        pageId: row.page.pageId,
        dataSourceId: input.model.dataSourceId,
        propertyId: property.propertyId,
        edit: {
          kind: "patch_set",
          delta: {
            kind: "multi_select",
            addOptionIds: add,
            removeOptionIds: remove,
          },
        },
      }],
    }];
  }

  const value = (() => {
    if (input.value === null) return { kind: "empty" as const };
    switch (property.valueType) {
      case "text":
      case "date":
      case "datetime":
        if (typeof input.value === "string") {
          return { kind: property.valueType, value: input.value };
        }
        break;
      case "number":
        if (typeof input.value === "number") return { kind: "number" as const, value: input.value };
        break;
      case "checkbox":
        if (typeof input.value === "boolean") return { kind: "checkbox" as const, value: input.value };
        break;
      case "select":
        if (typeof input.value === "string") {
          return {
            kind: "select" as const,
            optionId: parseDataSourceOptionId({ propertyId: property.propertyId, value: input.value }),
          };
        }
        break;
      case "person":
        if (typeof input.value === "string") return { kind: "person" as const, personId: input.value };
        break;
      case "relation":
        if (Array.isArray(input.value) && input.value.every((entry) => typeof entry === "string")) {
          return { kind: "relation" as const, pageIds: input.value };
        }
        break;
    }
    throw localError(`Value is incompatible with Property ${property.propertyId}`);
  })();
  return [{
    kind: "edit_property_values",
    edits: [{
      pageId: row.page.pageId,
      dataSourceId: input.model.dataSourceId,
      propertyId: property.propertyId,
      edit: {
        kind: "replace",
        expectedValueRevision: current?.revision ?? 0,
        value,
      },
    }],
  }];
};

const hasEmptyAndFilter = (model: DatabaseViewRenderModel): boolean =>
  model.query.view.config.filter.kind === "group"
  && model.query.view.config.filter.operator === "and"
  && model.query.view.config.filter.children.length === 0;

export const databaseViewSupportsManualReorder = (
  model: DatabaseViewRenderModel,
): boolean => model.query.view.config.sort[0]?.field.kind === "manual";

export const buildDatabaseViewMoveOperations = (input: {
  readonly model: DatabaseViewRenderModel;
  readonly pageId: string;
  readonly direction: "up" | "down";
}): readonly DatabaseApplyOperationV2[] => {
  if (!databaseViewSupportsManualReorder(input.model)) return [];
  const row = findRow(input.model, input.pageId);
  const visibleGroup = input.model.query.rows.filter(
    (candidate) => candidate.effectiveGroupKey === row.effectiveGroupKey,
  );
  const currentIndex = visibleGroup.findIndex(
    (candidate) => candidate.page.pageId === input.pageId,
  );
  const targetIndex = input.direction === "up"
    ? currentIndex - 1
    : currentIndex + 1;
  if (
    currentIndex < 0
    || targetIndex < 0
    || targetIndex >= visibleGroup.length
  ) {
    return [];
  }

  const desired = [...visibleGroup];
  const [moving] = desired.splice(currentIndex, 1);
  if (!moving) return [];
  desired.splice(targetIndex, 0, moving);
  const authorityOrder =
    input.model.query.view.config.sort[0]?.direction === "desc"
      ? [...desired].reverse()
      : desired;

  if (hasEmptyAndFilter(input.model)) {
    if (visibleGroup.length > MAX_DATABASE_MODULE_V2_BULK_ENTRIES) {
      throw localError(
        "This View group is too large for one atomic manual-order mutation",
      );
    }
    return [{
      kind: "position_pages",
      viewId: input.model.databaseViewId,
      pages: authorityOrder.map((candidate) => ({
        pageId: candidate.page.pageId,
        expectedPositionRevision: candidate.position?.revision ?? 0,
      })),
      groupKey: row.effectiveGroupKey,
    }];
  }

  const authorityIndex = authorityOrder.findIndex(
    (candidate) => candidate.page.pageId === input.pageId,
  );
  const anchor = authorityOrder[authorityIndex + 1];
  if (anchor && !anchor.position) return [];
  return [{
    kind: "position_page",
    viewId: input.model.databaseViewId,
    pageId: row.page.pageId,
    expectedPositionRevision: row.position?.revision ?? 0,
    groupKey: row.effectiveGroupKey,
    ...(anchor ? { beforePageId: anchor.page.pageId } : {}),
  }];
};

export const canMoveDatabaseViewPage = (input: {
  readonly model: DatabaseViewRenderModel;
  readonly pageId: string;
  readonly direction: "up" | "down";
}): boolean => {
  try {
    return buildDatabaseViewMoveOperations(input).length > 0;
  } catch {
    return false;
  }
};

export interface DatabaseViewMutationDependencies {
  readonly applyProject: (
    projectId: string,
    request: DatabaseApplyV2,
  ) => Promise<DatabaseApplyResultV2>;
  readonly applyLibrary: (
    request: LibraryDatabaseApplyV2,
  ) => Promise<LibraryDatabaseApplyResultV2>;
}

const defaultDependencies: DatabaseViewMutationDependencies = {
  applyProject: applyDatabaseModule,
  applyLibrary: applyLibraryDatabaseModule,
};

export type DatabaseViewMutationReceipt =
  | DatabaseApplyReceiptV2
  | LibraryDatabaseApplyReceiptV2;

export const commitDatabaseViewOperations = async (input: {
  readonly model: DatabaseViewRenderModel;
  readonly operations: readonly DatabaseApplyOperationV2[];
  readonly clientSessionId?: string;
  readonly operationId?: string;
  readonly dependencies?: DatabaseViewMutationDependencies;
}): Promise<DatabaseViewMutationReceipt | null> => {
  if (input.operations.length === 0) return null;
  const commonRequest = {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
    operationId: input.operationId ?? crypto.randomUUID(),
    storeEpoch: input.model.storeEpoch,
    operations: input.operations,
  } as const;
  const dependencies = input.dependencies ?? defaultDependencies;
  const apply = () => input.model.accessContext.kind === "library"
    ? dependencies.applyLibrary(commonRequest)
    : dependencies.applyProject(input.model.accessContext.projectId, {
        ...commonRequest,
        projectId: input.model.accessContext.projectId,
        actor: {
          kind: "renderer_database_view" as const,
          ...(input.clientSessionId
            ? { clientSessionId: input.clientSessionId }
            : {}),
        },
      });
  let result: DatabaseApplyResultV2 | LibraryDatabaseApplyResultV2;
  let retried = false;
  try {
    result = await apply();
  } catch {
    retried = true;
    result = await apply();
  }
  if (!result.ok && result.error.retryable && !retried) {
    result = await apply();
  }
  if (result.ok) return result.value;
  throw new DatabaseViewMutationError(result.error);
};
