import {
  MAX_DATABASE_MUTATION_BULK_ENTRIES,
  type DatabaseJsonValue,
  type DatabaseMutationOperation,
  type SetDatabasePropertyValueEntry,
} from "./database-kernel";
import type {
  GeneralDatabaseDescriptor,
  GeneralDatabasePropertyDefinition,
  PrimaryDatabaseViewSnapshot,
} from "./database-query";
import type { MoveCardsInput } from "./types";

export type DatabaseCardDragManyErrorCode =
  | "invalid_card_set"
  | "snapshot_epoch_mismatch"
  | "snapshot_change_cursor_mismatch"
  | "primary_database_not_found"
  | "primary_view_not_found"
  | "view_query_mismatch"
  | "card_not_found"
  | "source_status_conflict"
  | "status_property_not_found"
  | "status_value_invalid"
  | "property_not_found"
  | "property_value_invalid"
  | "position_index_invalid"
  | "manual_direction_unsupported"
  | "bulk_limit_exceeded"
  | "empty_drag_intent";

export class DatabaseCardDragManyError extends Error {
  constructor(
    readonly code: DatabaseCardDragManyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DatabaseCardDragManyError";
  }
}

export type DatabaseCardDragManySnapshot = PrimaryDatabaseViewSnapshot;

export interface CompiledDatabaseCardDragMany {
  readonly databaseBlockId: string;
  readonly viewId: string;
  readonly operations: readonly DatabaseMutationOperation[];
}

const fail = (
  code: DatabaseCardDragManyErrorCode,
  message: string,
): never => {
  throw new DatabaseCardDragManyError(code, message);
};

const activePropertyByKey = (
  descriptor: GeneralDatabaseDescriptor,
  key: string,
): GeneralDatabasePropertyDefinition | null =>
  descriptor.properties.find(
    (property) => property.lifecycle === "active" && property.key === key,
  ) ?? null;

const sameJsonValue = (
  left: DatabaseJsonValue | undefined,
  right: DatabaseJsonValue,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const readSelectValue = (
  value: DatabaseJsonValue | undefined,
  propertyKey: string,
): string | null => {
  if (value === null || typeof value === "string") return value;
  return fail(
    "property_value_invalid",
    `Database property ${propertyKey} is not a scalar select value`,
  );
};

const resolveTargetIndex = (
  newOrder: number | undefined,
  remainingCount: number,
): number => {
  if (newOrder === undefined) return remainingCount;
  if (!Number.isInteger(newOrder) || newOrder < 0) {
    return fail(
      "position_index_invalid",
      "Database View position must be a non-negative integer",
    );
  }
  return Math.min(newOrder, remainingCount);
};

const compileValueEntry = (input: {
  readonly cardBlockId: string;
  readonly property: GeneralDatabasePropertyDefinition;
  readonly current:
    | { readonly value: DatabaseJsonValue; readonly revision: number }
    | undefined;
  readonly value: DatabaseJsonValue;
}): SetDatabasePropertyValueEntry | null => {
  if (sameJsonValue(input.current?.value, input.value)) return null;
  return {
    cardBlockId: input.cardBlockId,
    propertyId: input.property.id,
    expectedValueRevision: input.current?.revision ?? 0,
    value: input.value,
  };
};

/**
 * Compile one visual multi-Card drag from one current primary Database
 * snapshot. Card order is the caller's order; numeric order is converted to a
 * post-removal external anchor and no rank key crosses the boundary.
 */
export const compileDatabaseCardDragMany = (input: {
  readonly move: MoveCardsInput;
  readonly snapshot: DatabaseCardDragManySnapshot;
}): CompiledDatabaseCardDragMany => {
  const cardBlockIds = input.move.cardIds;
  if (
    cardBlockIds.length < 1 ||
    new Set(cardBlockIds).size !== cardBlockIds.length
  ) {
    return fail(
      "invalid_card_set",
      "A multi-Card drag requires unique Card IDs in visual order",
    );
  }
  if (cardBlockIds.length > MAX_DATABASE_MUTATION_BULK_ENTRIES) {
    return fail(
      "bulk_limit_exceeded",
      `A multi-Card drag supports at most ${MAX_DATABASE_MUTATION_BULK_ENTRIES} Cards`,
    );
  }

  const { descriptor: descriptorSnapshot, query: querySnapshot } =
    input.snapshot;
  if (
    descriptorSnapshot.projectId !== querySnapshot.projectId ||
    descriptorSnapshot.storeEpoch !== querySnapshot.storeEpoch
  ) {
    return fail(
      "snapshot_epoch_mismatch",
      "Database descriptor and View query are from different store epochs",
    );
  }
  if (descriptorSnapshot.changeLogSeq !== querySnapshot.changeLogSeq) {
    return fail(
      "snapshot_change_cursor_mismatch",
      "Database authority changed while preparing the multi-Card drag",
    );
  }
  const descriptor = descriptorSnapshot.value;
  if (!descriptor?.database.isPrimary) {
    return fail(
      "primary_database_not_found",
      "The Project primary Database is unavailable",
    );
  }
  const primaryView = descriptor.views.find(
    (view) =>
      view.lifecycle === "active" &&
      view.isPrimary &&
      view.kind === "kanban",
  );
  if (!primaryView) {
    return fail(
      "primary_view_not_found",
      "The primary Database has no active primary Kanban View",
    );
  }
  const query = querySnapshot.value;
  if (
    !query ||
    query.database.blockId !== descriptor.database.blockId ||
    query.view.id !== primaryView.id ||
    query.view.revision !== primaryView.revision
  ) {
    return fail(
      "view_query_mismatch",
      "The primary Database View changed while preparing the drag",
    );
  }
  const rowsById = new Map(
    query.rows.map((row) => [row.card.blockId, row] as const),
  );
  const rows = cardBlockIds.map((cardBlockId) => {
    const row = rowsById.get(cardBlockId);
    if (row) return row;
    return fail(
      "card_not_found",
      `Card ${cardBlockId} is not in the primary Database View`,
    );
  });
  const statusProperty = activePropertyByKey(descriptor, "status");
  if (
    !statusProperty ||
    primaryView.config.group?.propertyId !== statusProperty.id
  ) {
    return fail(
      "status_property_not_found",
      "The primary Kanban View is not grouped by its active status property",
    );
  }

  const currentStatuses = rows.map((row) => {
    const status = readSelectValue(row.values[statusProperty.id]?.value, "status");
    if (status !== null) return status;
    return fail(
      "status_value_invalid",
      `Card ${row.card.blockId} has no status value`,
    );
  });
  if (input.move.fromStatus) {
    const staleIndex = currentStatuses.findIndex(
      (status) => status !== input.move.fromStatus,
    );
    if (staleIndex >= 0) {
      return fail(
        "source_status_conflict",
        `Card ${cardBlockIds[staleIndex]} left ${input.move.fromStatus} before this drag committed`,
      );
    }
  }

  const patchProperties = (["priority", "estimate"] as const).flatMap(
    (key) => {
      if (!input.move.fieldPatch || !Object.hasOwn(input.move.fieldPatch, key)) {
        return [];
      }
      const property = activePropertyByKey(descriptor, key);
      if (property) return [{ key, property }] as const;
      return fail(
        "property_not_found",
        `Primary Database has no active ${key} property`,
      );
    },
  );

  const valueEntries: SetDatabasePropertyValueEntry[] = [];
  rows.forEach((row) => {
    const statusEntry = compileValueEntry({
      cardBlockId: row.card.blockId,
      property: statusProperty,
      current: row.values[statusProperty.id],
      value: input.move.toStatus,
    });
    if (statusEntry) valueEntries.push(statusEntry);
    for (const { key, property } of patchProperties) {
      const rawValue = input.move.fieldPatch?.[key];
      const value: DatabaseJsonValue = rawValue ?? null;
      readSelectValue(value, key);
      const entry = compileValueEntry({
        cardBlockId: row.card.blockId,
        property,
        current: row.values[property.id],
        value,
      });
      if (entry) valueEntries.push(entry);
    }
  });
  if (valueEntries.length > MAX_DATABASE_MUTATION_BULK_ENTRIES) {
    return fail(
      "bulk_limit_exceeded",
      `A multi-Card drag supports at most ${MAX_DATABASE_MUTATION_BULK_ENTRIES} value writes`,
    );
  }

  const selected = new Set(cardBlockIds);
  const currentTargetOrder = query.rows
    .filter((row) => row.effectiveGroupKey === input.move.toStatus)
    .map((row) => row.card.blockId);
  const remainingTargetOrder = currentTargetOrder.filter(
    (cardBlockId) => !selected.has(cardBlockId),
  );
  const targetIndex = resolveTargetIndex(
    input.move.newOrder,
    remainingTargetOrder.length,
  );
  const nextTargetOrder = [...remainingTargetOrder];
  nextTargetOrder.splice(targetIndex, 0, ...cardBlockIds);
  const crossesGroup = currentStatuses.some(
    (status) => status !== input.move.toStatus,
  );
  const positionChanged =
    crossesGroup ||
    currentTargetOrder.join("\u0000") !== nextTargetOrder.join("\u0000");
  const manualSort = primaryView.config.sort.find(
    (sort) => sort.field.kind === "manual",
  );
  if (manualSort?.direction === "desc" && positionChanged) {
    return fail(
      "manual_direction_unsupported",
      "Descending manual Views require a visual-direction-aware bulk anchor",
    );
  }

  const operations: DatabaseMutationOperation[] = [];
  if (valueEntries.length > 0) {
    operations.push({
      kind: "set_values",
      databaseBlockId: descriptor.database.blockId,
      entries: valueEntries,
    });
  }
  if (manualSort && positionChanged) {
    const beforeCardBlockId = remainingTargetOrder[targetIndex];
    operations.push({
      kind: "position_cards",
      viewId: primaryView.id,
      cards: rows.map((row) => ({
        cardBlockId: row.card.blockId,
        expectedPositionRevision: row.position?.revision ?? 0,
      })),
      groupKey: input.move.toStatus,
      ...(beforeCardBlockId === undefined ? {} : { beforeCardBlockId }),
    });
  }
  if (operations.length === 0) {
    return fail(
      "empty_drag_intent",
      "The selected Database View does not permit this drag to change authority",
    );
  }
  return {
    databaseBlockId: descriptor.database.blockId,
    viewId: primaryView.id,
    operations,
  };
};
