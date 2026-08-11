import type { EffectiveDatabaseViewPresentation } from "../../../../shared/database-kernel";
import { buildDataSourceMultiSelectPatchOperations } from "@/lib/data-source-property-value-operations";
import type {
  DatabaseApplyOperationV2,
  DatabasePropertyValueMutationV2,
  DataSourcePropertyRecordV2,
  SetDatabaseTaskParentOperationV2,
} from "../../../../shared/database-module-v2";
import { buildDatabaseViewBoardDropOperations } from "@/lib/database-view-drag-operations";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";

export type DatabaseListDropPosition = "before" | "after" | "nest" | "root";

export interface DatabaseListDragSourceOccurrence {
  readonly occurrenceKey: string;
  readonly pageId: string;
  readonly groupKey: string | null;
  readonly subgroupKey: string | null;
}

export interface CompiledDatabaseListDrop {
  readonly pageIds: readonly string[];
  readonly propertyMutations: readonly DatabasePropertyValueMutationV2[];
  readonly hierarchyMutations: readonly SetDatabaseTaskParentOperationV2[];
  readonly positionMutations: readonly DatabaseApplyOperationV2[];
  readonly expectedProjectionRevision: number;
  readonly expectedHierarchyRevisions: Readonly<Record<string, number>>;
  readonly confirmation: null;
  readonly operations: readonly DatabaseApplyOperationV2[];
}

export type DatabaseListDropCompileResult =
  | { readonly ok: true; readonly value: CompiledDatabaseListDrop }
  | { readonly ok: false; readonly reason: string };

const projectedModel = (
  model: DatabaseViewRenderModel,
  effective: EffectiveDatabaseViewPresentation,
): DatabaseViewRenderModel => ({
  ...model,
  query: {
    ...model.query,
    view: {
      ...model.query.view,
      defaultLayout: effective.layout,
      config: {
        ...model.query.view.config,
        presentation: effective.presentation,
      },
    },
  },
});

const taskParent = (
  model: DatabaseViewRenderModel,
  pageId: string,
): string | null => model.query.rows.find((row) => row.page.pageId === pageId)
  ?.taskHierarchy?.parentPageId ?? null;

const isAncestor = (
  model: DatabaseViewRenderModel,
  ancestorPageId: string,
  pageId: string,
): boolean => {
  const visited = new Set<string>();
  let cursor: string | null = pageId;
  while (cursor !== null && !visited.has(cursor)) {
    if (cursor === ancestorPageId) return true;
    visited.add(cursor);
    cursor = taskParent(model, cursor);
  }
  return false;
};

const taskDepth = (model: DatabaseViewRenderModel, pageId: string): number => {
  let depth = 0;
  let cursor = taskParent(model, pageId);
  const visited = new Set([pageId]);
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    depth += 1;
    cursor = taskParent(model, cursor);
  }
  return depth;
};

const subtreeHeight = (model: DatabaseViewRenderModel, pageId: string): number => {
  const children = new Map<string, string[]>();
  for (const row of model.query.rows) {
    const parentPageId = row.taskHierarchy?.parentPageId;
    if (!parentPageId) continue;
    children.set(parentPageId, [
      ...(children.get(parentPageId) ?? []),
      row.page.pageId,
    ]);
  }
  const visit = (current: string, path: ReadonlySet<string>): number => {
    if (path.has(current)) return 10;
    const nextPath = new Set(path).add(current);
    return (children.get(current) ?? []).reduce(
      (height, child) => Math.max(height, 1 + visit(child, nextPath)),
      0,
    );
  };
  return visit(pageId, new Set());
};

const activeProperty = (
  model: DatabaseViewRenderModel,
  propertyId: string | undefined,
): DataSourcePropertyRecordV2 | null => {
  if (!propertyId) return null;
  return model.query.properties.find((property) =>
    property.lifecycle === "active" && property.propertyId === propertyId
  ) ?? null;
};

const compactPropertyOperations = (
  operations: readonly DatabaseApplyOperationV2[],
): readonly DatabaseApplyOperationV2[] => {
  const edits = operations.flatMap((operation) =>
    operation.kind === "edit_property_values" ? operation.edits : []
  );
  return edits.length > 0 ? [{ kind: "edit_property_values", edits }] : [];
};

const multiSelectGroupOperations = (input: {
  readonly model: DatabaseViewRenderModel;
  readonly pageIds: readonly string[];
  readonly property: DataSourcePropertyRecordV2 | null;
  readonly axis: "groupKey" | "subgroupKey";
  readonly targetKey: string | null;
  readonly sourceOccurrences: readonly DatabaseListDragSourceOccurrence[];
}): readonly DatabaseApplyOperationV2[] => {
  const property = input.property;
  if (property?.valueType !== "multi_select") return [];
  return compactPropertyOperations(input.pageIds.flatMap((pageId) => {
    const row = input.model.query.rows.find((candidate) =>
      candidate.page.pageId === pageId
    );
    if (!row) return [];
    const currentValue = row.values[property.propertyId]?.value;
    const current = new Set(
      Array.isArray(currentValue)
        ? currentValue.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    );
    const sourceKeys = new Set(input.sourceOccurrences.flatMap((occurrence) =>
      occurrence.pageId === pageId && occurrence[input.axis] !== null
        ? [occurrence[input.axis]!]
        : []
    ));
    const addOptionIds = input.targetKey !== null && !current.has(input.targetKey)
      ? [input.targetKey]
      : [];
    const removeOptionIds = [...sourceKeys].filter((optionId) =>
      optionId !== input.targetKey && current.has(optionId)
    );
    return buildDataSourceMultiSelectPatchOperations({
      pageId,
      dataSourceId: input.model.dataSourceId,
      property,
      addOptionIds,
      removeOptionIds,
    });
  }));
};

const nextSibling = (input: {
  readonly model: DatabaseViewRenderModel;
  readonly targetPageId: string;
  readonly parentPageId: string | null;
  readonly movedPageIds: ReadonlySet<string>;
  readonly groupKey: string | null;
  readonly subgroupKey: string | null;
}): string | undefined => {
  const candidates = input.model.query.rows.filter((row) => {
    if (input.movedPageIds.has(row.page.pageId)) return false;
    if ((row.taskHierarchy?.parentPageId ?? null) !== input.parentPageId) return false;
    if (input.parentPageId !== null) return true;
    return row.effectiveGroupKey === input.groupKey
      && row.effectiveSubgroupKey === input.subgroupKey;
  });
  const index = candidates.findIndex((row) => row.page.pageId === input.targetPageId);
  return index < 0 ? undefined : candidates[index + 1]?.page.pageId;
};

export const compileDatabaseListDropIntent = (input: {
  readonly model: DatabaseViewRenderModel;
  readonly effective: EffectiveDatabaseViewPresentation;
  readonly pageIds: readonly string[];
  readonly sourceOccurrences?: readonly DatabaseListDragSourceOccurrence[];
  readonly targetPageId?: string;
  readonly position: DatabaseListDropPosition;
  readonly groupKey: string | null;
  readonly subgroupKey: string | null;
}): DatabaseListDropCompileResult => {
  if (input.model.readOnlyReason) {
    return { ok: false, reason: input.model.readOnlyReason };
  }
  const pageIds = [...new Set(input.pageIds)];
  if (pageIds.length === 0) return { ok: false, reason: "No Pages were selected" };
  const rowsById = new Map(
    input.model.query.rows.map((row) => [row.page.pageId, row] as const),
  );
  if (pageIds.some((pageId) => !rowsById.has(pageId))) {
    return { ok: false, reason: "A selected Page is outside this List window" };
  }
  const selected = new Set(pageIds);
  const sourceOccurrences = (input.sourceOccurrences ?? []).filter((occurrence) =>
    selected.has(occurrence.pageId)
  );
  for (const pageId of pageIds) {
    if (pageIds.some((candidate) =>
      candidate !== pageId && isAncestor(input.model, candidate, pageId)
    )) {
      return {
        ok: false,
        reason: "Move either a parent Page or its sub-pages, not both",
      };
    }
  }
  const targetPageId = input.targetPageId;
  if (input.position !== "root" && !targetPageId) {
    return { ok: false, reason: "This drop has no target Page" };
  }
  if (targetPageId && selected.has(targetPageId)) {
    return { ok: false, reason: "A Page cannot be dropped onto itself" };
  }

  let parentPageId: string | null = null;
  let beforeHierarchyPageId: string | undefined;
  let beforeRootPageId: string | undefined;
  if (input.position === "nest") {
    parentPageId = targetPageId ?? null;
  } else if (input.position === "before" || input.position === "after") {
    parentPageId = taskParent(input.model, targetPageId!);
    const beforePageId = input.position === "before"
      ? targetPageId
      : nextSibling({
          model: input.model,
          targetPageId: targetPageId!,
          parentPageId,
          movedPageIds: selected,
          groupKey: input.groupKey,
          subgroupKey: input.subgroupKey,
        });
    if (parentPageId === null) beforeRootPageId = beforePageId;
    else beforeHierarchyPageId = beforePageId;
  }

  if (parentPageId !== null) {
    if (pageIds.some((pageId) => isAncestor(input.model, pageId, parentPageId!))) {
      return { ok: false, reason: "This nesting would create a cycle" };
    }
    const parentDepth = taskDepth(input.model, parentPageId);
    if (pageIds.some((pageId) => parentDepth + 1 + subtreeHeight(input.model, pageId) > 10)) {
      return { ok: false, reason: "Task nesting cannot exceed ten levels" };
    }
  }

  const effectiveModel = projectedModel(input.model, input.effective);
  const groupProperty = activeProperty(
    input.model,
    input.effective.presentation.group?.propertyId,
  );
  const subgroupProperty = activeProperty(
    input.model,
    input.effective.presentation.subgroup?.propertyId,
  );
  const scalarModel: DatabaseViewRenderModel = {
    ...effectiveModel,
    query: {
      ...effectiveModel.query,
      view: {
        ...effectiveModel.query.view,
        config: {
          ...effectiveModel.query.view.config,
          presentation: {
            ...effectiveModel.query.view.config.presentation,
            group: groupProperty?.valueType === "multi_select"
              ? null
              : effectiveModel.query.view.config.presentation.group,
            subgroup: subgroupProperty?.valueType === "multi_select"
              ? null
              : effectiveModel.query.view.config.presentation.subgroup,
          },
        },
      },
    },
  };
  const baseOperations = buildDatabaseViewBoardDropOperations({
    model: scalarModel,
    pageIds,
    target: {
      groupKey: input.groupKey,
      subgroupKey: input.subgroupKey,
      ...(beforeRootPageId ? { beforePageId: beforeRootPageId } : {}),
    },
  });
  const propertyOperations = baseOperations.filter(
    (operation) => operation.kind === "edit_property_values",
  );
  const multiSelectPropertyOperations = compactPropertyOperations([
    ...multiSelectGroupOperations({
      model: input.model,
      pageIds,
      property: groupProperty,
      axis: "groupKey",
      targetKey: input.groupKey,
      sourceOccurrences,
    }),
    ...multiSelectGroupOperations({
      model: input.model,
      pageIds,
      property: subgroupProperty,
      axis: "subgroupKey",
      targetKey: input.subgroupKey,
      sourceOccurrences,
    }),
  ]);
  const allPropertyOperations = compactPropertyOperations([
    ...propertyOperations,
    ...multiSelectPropertyOperations,
  ]);
  const positionOperations = parentPageId === null
    ? baseOperations.filter((operation) => operation.kind === "position_pages")
    : [];
  const hierarchyMutation: SetDatabaseTaskParentOperationV2 = {
    kind: "set_task_parent",
    dataSourceId: input.model.dataSourceId,
    pages: pageIds.map((pageId) => ({
      pageId,
      expectedHierarchyRevision: rowsById.get(pageId)?.taskHierarchy?.revision ?? 0,
    })),
    ...(parentPageId === null ? {} : { parentPageId }),
    ...(beforeHierarchyPageId ? { beforePageId: beforeHierarchyPageId } : {}),
  };
  const hierarchyNeeded = parentPageId !== null || pageIds.some((pageId) =>
    taskParent(input.model, pageId) !== null
  );
  const hierarchyMutations = hierarchyNeeded ? [hierarchyMutation] : [];
  const propertyMutations = allPropertyOperations.flatMap((operation) =>
    operation.kind === "edit_property_values" ? operation.edits : []
  );
  const operations = [
    ...allPropertyOperations,
    ...hierarchyMutations,
    ...positionOperations,
  ];
  if (operations.length === 0) {
    return { ok: false, reason: "The Pages are already at this position" };
  }
  return {
    ok: true,
    value: {
      pageIds,
      propertyMutations,
      hierarchyMutations,
      positionMutations: positionOperations,
      expectedProjectionRevision: input.model.commitSeq,
      expectedHierarchyRevisions: Object.fromEntries(pageIds.map((pageId) => [
        pageId,
        rowsById.get(pageId)?.taskHierarchy?.revision ?? 0,
      ])),
      confirmation: null,
      operations,
    },
  };
};
