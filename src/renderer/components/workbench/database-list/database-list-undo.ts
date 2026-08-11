import { databasePropertyReplacementValue } from "@/lib/data-source-property-value-operations";
import type {
  DatabaseViewMutationReceipt,
} from "@/lib/database-view-row-mutations";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import type {
  DatabaseApplyOperationV2,
  DatabasePropertyValueMutationV2,
  SetDatabaseTaskParentOperationV2,
} from "../../../../shared/database-module-v2";
import type { CompiledDatabaseListDrop } from "./compile-list-drop-intent";

const revision = (
  receipt: DatabaseViewMutationReceipt,
  key: string,
  fallback: number,
): number => receipt.committedRevisions[key] ?? fallback;

interface DatabaseListOriginalRun {
  readonly pageIds: readonly string[];
  readonly beforePageId?: string;
}

const contiguousRuns = (
  orderedPageIds: readonly string[],
  movedPageIds: ReadonlySet<string>,
): readonly DatabaseListOriginalRun[] | null => {
  const included = orderedPageIds.filter((pageId) => movedPageIds.has(pageId));
  if (included.length !== movedPageIds.size || included.length === 0) return null;
  const runs: DatabaseListOriginalRun[] = [];
  let pageIds: string[] = [];
  for (const pageId of orderedPageIds) {
    if (movedPageIds.has(pageId)) {
      pageIds.push(pageId);
      continue;
    }
    if (pageIds.length === 0) continue;
    runs.push({ pageIds, beforePageId: pageId });
    pageIds = [];
  }
  if (pageIds.length > 0) runs.push({ pageIds });
  return runs;
};

const inversePropertyEdits = (input: {
  readonly model: DatabaseViewRenderModel;
  readonly compiled: CompiledDatabaseListDrop;
  readonly receipt: DatabaseViewMutationReceipt;
}): readonly DatabasePropertyValueMutationV2[] | null => {
  const rowsById = new Map(input.model.query.rows.map((row) => [
    row.page.pageId,
    row,
  ] as const));
  const propertiesById = new Map(input.model.query.properties.flatMap((property) =>
    property.lifecycle === "active"
      ? [[property.propertyId, property] as const]
      : []
  ));
  const edits: DatabasePropertyValueMutationV2[] = [];
  for (const forward of input.compiled.propertyMutations) {
    const row = rowsById.get(forward.pageId);
    const property = propertiesById.get(forward.propertyId);
    if (!row || !property) return null;
    const current = row.values[property.propertyId];
    const valueRevision = revision(
      input.receipt,
      `value:${input.model.dataSourceId}:${row.membership.membershipId}:${property.propertyId}`,
      (current?.revision ?? 0) + 1,
    );
    if (forward.edit.kind === "patch_set") {
      if (forward.edit.delta.kind !== "multi_select") return null;
      edits.push({
        pageId: row.page.pageId,
        dataSourceId: input.model.dataSourceId,
        propertyId: property.propertyId,
        edit: {
          kind: "patch_set",
          delta: {
            kind: "multi_select",
            addOptionIds: forward.edit.delta.removeOptionIds,
            removeOptionIds: forward.edit.delta.addOptionIds,
          },
        },
      });
      continue;
    }
    if (forward.edit.kind === "clear_relation" || property.valueType === "relation") {
      return null;
    }
    try {
      edits.push({
        pageId: row.page.pageId,
        dataSourceId: input.model.dataSourceId,
        propertyId: property.propertyId,
        edit: {
          kind: "replace",
          expectedValueRevision: valueRevision,
          value: databasePropertyReplacementValue(
            property,
            current?.value ?? null,
          ),
        },
      });
    } catch {
      return null;
    }
  }
  return edits;
};

const inverseHierarchy = (input: {
  readonly model: DatabaseViewRenderModel;
  readonly compiled: CompiledDatabaseListDrop;
  readonly receipt: DatabaseViewMutationReceipt;
}): readonly SetDatabaseTaskParentOperationV2[] | null => {
  if (input.compiled.hierarchyMutations.length === 0) return [];
  const movedPageIds = new Set(input.compiled.pageIds);
  const rowsById = new Map(input.model.query.rows.map((row) => [
    row.page.pageId,
    row,
  ] as const));
  const movedRows = input.compiled.pageIds.flatMap((pageId) => {
    const row = rowsById.get(pageId);
    return row ? [row] : [];
  });
  if (movedRows.length !== movedPageIds.size) return null;
  const parentPageIds = [...new Set(movedRows.map((row) =>
    row.taskHierarchy?.parentPageId ?? null
  ))];
  const operations: SetDatabaseTaskParentOperationV2[] = [];
  for (const parentPageId of parentPageIds) {
    const movedInParent = new Set(movedRows.flatMap((row) =>
      (row.taskHierarchy?.parentPageId ?? null) === parentPageId
        ? [row.page.pageId]
        : []
    ));
    const siblings = input.model.query.rows.filter((row) =>
      (row.taskHierarchy?.parentPageId ?? null) === parentPageId
    );
    const runs = contiguousRuns(
      siblings.map((row) => row.page.pageId),
      movedInParent,
    );
    if (!runs) return null;
    for (const run of [...runs].reverse()) {
      operations.push({
        kind: "set_task_parent",
        dataSourceId: input.model.dataSourceId,
        pages: run.pageIds.map((pageId) => ({
          pageId,
          expectedHierarchyRevision: revision(
            input.receipt,
            `task_hierarchy:${pageId}`,
            (rowsById.get(pageId)?.taskHierarchy?.revision ?? 0) + 1,
          ),
        })),
        ...(parentPageId ? { parentPageId } : {}),
        ...(run.beforePageId ? { beforePageId: run.beforePageId } : {}),
      });
    }
  }
  return operations;
};

const inversePosition = (input: {
  readonly model: DatabaseViewRenderModel;
  readonly compiled: CompiledDatabaseListDrop;
  readonly receipt: DatabaseViewMutationReceipt;
}): readonly DatabaseApplyOperationV2[] | null => {
  if (input.compiled.positionMutations.length === 0) return [];
  const movedPageIds = new Set(input.compiled.pageIds);
  const rowsById = new Map(input.model.query.rows.map((row) => [
    row.page.pageId,
    row,
  ] as const));
  const scopeKey = (pageId: string): string => {
    const row = rowsById.get(pageId);
    return JSON.stringify([row?.effectiveGroupKey ?? null, row?.effectiveSubgroupKey ?? null]);
  };
  const scopeKeys = [...new Set(input.compiled.pageIds.map(scopeKey))];
  const operations: DatabaseApplyOperationV2[] = [];
  for (const key of scopeKeys) {
    const movedInScope = new Set(input.compiled.pageIds.filter((pageId) =>
      scopeKey(pageId) === key
    ));
    const orderedPageIds = input.model.query.rows.flatMap((row) =>
      scopeKey(row.page.pageId) === key ? [row.page.pageId] : []
    );
    const runs = contiguousRuns(orderedPageIds, movedInScope);
    if (!runs) return null;
    for (const run of [...runs].reverse()) {
      operations.push({
        kind: "position_pages",
        viewId: input.model.databaseViewId,
        pages: run.pageIds.map((pageId) => ({
          pageId,
          expectedPositionRevision: revision(
            input.receipt,
            `position:${input.model.databaseViewId}:${pageId}`,
            (rowsById.get(pageId)?.position?.revision ?? 0) + 1,
          ),
        })),
        ...(run.beforePageId ? { beforePageId: run.beforePageId } : {}),
      });
    }
  }
  if (operations.flatMap((operation) =>
    operation.kind === "position_pages" ? operation.pages : []
  ).length !== movedPageIds.size) return null;
  return operations;
};

/**
 * Builds a CAS-protected inverse of one acknowledged drop. Disjoint runs and
 * mixed original parents are restored from their original scopes in reverse
 * order, so every admitted multi-page drop remains one atomic undo batch.
 */
export const buildDatabaseListDropUndoOperations = (input: {
  readonly model: DatabaseViewRenderModel;
  readonly compiled: CompiledDatabaseListDrop;
  readonly receipt: DatabaseViewMutationReceipt;
}): readonly DatabaseApplyOperationV2[] | null => {
  const propertyEdits = inversePropertyEdits(input);
  if (propertyEdits === null) return null;
  const hierarchy = inverseHierarchy(input);
  if (hierarchy === null) return null;
  const positions = inversePosition(input);
  if (positions === null) return null;
  return [
    ...(propertyEdits.length > 0
      ? [{ kind: "edit_property_values" as const, edits: propertyEdits }]
      : []),
    ...hierarchy,
    ...positions,
  ];
};
