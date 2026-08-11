import {
  databaseGroupValueFromKey,
  type DatabaseJsonValue,
} from "../../shared/database-kernel";
import type {
  DatabaseApplyOperationV2,
  DatabasePropertyValueMutationV2,
  DataSourcePropertyRecordV2,
} from "../../shared/database-module-v2";
import type { DatabaseViewRenderModel } from "./database-view-render-model";
import {
  buildDatabaseViewPropertyValueOperations,
  databaseViewSupportsManualReorder,
} from "./database-view-row-mutations";

const activeProperty = (
  model: DatabaseViewRenderModel,
  propertyId: string | undefined,
): DataSourcePropertyRecordV2 | null => {
  if (!propertyId) return null;
  return model.query.properties.find((property) =>
    property.lifecycle === "active" && property.propertyId === propertyId
  ) ?? null;
};

const propertyValueOperations = (input: {
  readonly model: DatabaseViewRenderModel;
  readonly pageIds: readonly string[];
  readonly property: DataSourcePropertyRecordV2 | null;
  readonly groupKey: string | null;
  readonly readCurrentKey: (
    row: DatabaseViewRenderModel["query"]["rows"][number],
  ) => string | null;
}): readonly DatabaseApplyOperationV2[] => {
  const property = input.property;
  if (!property) return [];
  const value: DatabaseJsonValue = databaseGroupValueFromKey(
    property.valueType,
    input.groupKey,
  );
  return input.pageIds.flatMap((pageId) => {
    const row = input.model.query.rows.find(
      (candidate) => candidate.page.pageId === pageId,
    );
    if (!row || input.readCurrentKey(row) === input.groupKey) return [];
    return buildDatabaseViewPropertyValueOperations({
      model: input.model,
      pageId,
      propertyId: property.propertyId,
      value,
    });
  });
};

const compactValueEdits = (
  operations: readonly DatabaseApplyOperationV2[],
): readonly DatabaseApplyOperationV2[] => {
  const edits: DatabasePropertyValueMutationV2[] = [];
  const other: DatabaseApplyOperationV2[] = [];
  for (const operation of operations) {
    if (operation.kind === "edit_property_values") {
      edits.push(...operation.edits);
      continue;
    }
    other.push(operation);
  }
  return edits.length === 0
    ? other
    : [{ kind: "edit_property_values", edits }, ...other];
};

/**
 * Compiles one Board drop into a single Database transaction: grouping values
 * move first, then the same View-global manual rank positions the visual run.
 */
export const buildDatabaseViewBoardDropOperations = (input: {
  readonly model: DatabaseViewRenderModel;
  readonly pageIds: readonly string[];
  readonly target: {
    readonly groupKey: string | null;
    readonly subgroupKey: string | null;
    readonly beforePageId?: string;
  };
}): readonly DatabaseApplyOperationV2[] => {
  if (input.model.readOnlyReason) return [];
  const pageIds = [...new Set(input.pageIds)];
  if (pageIds.length === 0) return [];
  const rowsById = new Map(
    input.model.query.rows.map((row) => [row.page.pageId, row] as const),
  );
  if (pageIds.some((pageId) => !rowsById.has(pageId))) return [];
  if (
    input.target.beforePageId
    && (pageIds.includes(input.target.beforePageId)
      || !rowsById.has(input.target.beforePageId))
  ) return [];

  const presentation = input.model.query.view.config.presentation;
  const groupProperty = activeProperty(
    input.model,
    presentation.group?.propertyId,
  );
  const subgroupProperty = activeProperty(
    input.model,
    presentation.subgroup?.propertyId,
  );
  const valueOperations = compactValueEdits([
    ...propertyValueOperations({
      model: input.model,
      pageIds,
      property: groupProperty,
      groupKey: input.target.groupKey,
      readCurrentKey: (row) => row.effectiveGroupKey,
    }),
    ...propertyValueOperations({
      model: input.model,
      pageIds,
      property: subgroupProperty,
      groupKey: input.target.subgroupKey,
      readCurrentKey: (row) => row.effectiveSubgroupKey,
    }),
  ]);
  const positionOperation: DatabaseApplyOperationV2[] =
    databaseViewSupportsManualReorder(input.model)
      ? [{
          kind: "position_pages",
          viewId: input.model.databaseViewId,
          pages: pageIds.map((pageId) => ({
            pageId,
            expectedPositionRevision: rowsById.get(pageId)?.position?.revision ?? 0,
          })),
          ...(input.target.beforePageId
            ? { beforePageId: input.target.beforePageId }
            : {}),
        }]
      : [];
  return [...valueOperations, ...positionOperation];
};
