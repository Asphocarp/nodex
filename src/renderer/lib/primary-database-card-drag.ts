import type {
  DatabaseJsonValue,
  DatabaseMutationOperation,
  SetDatabasePropertyValueOperation,
} from "../../shared/database-kernel";
import type {
  DatabaseReadSnapshot,
  GeneralDatabaseDescriptor,
  GeneralDatabasePropertyDefinition,
  GeneralDatabaseViewQuery,
} from "../../shared/database-query";
import type { MoveCardInput } from "../../shared/types";

export type PrimaryDatabaseCardDragErrorCode =
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
  | "empty_drag_intent";

export class PrimaryDatabaseCardDragError extends Error {
  constructor(
    readonly code: PrimaryDatabaseCardDragErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PrimaryDatabaseCardDragError";
  }
}

export interface PrimaryDatabaseCardDragSnapshot {
  readonly descriptor: DatabaseReadSnapshot<GeneralDatabaseDescriptor>;
  readonly query: DatabaseReadSnapshot<GeneralDatabaseViewQuery>;
}

export interface CompiledPrimaryDatabaseCardDrag {
  readonly databaseBlockId: string;
  readonly viewId: string;
  readonly operations: readonly DatabaseMutationOperation[];
}

const fail = (
  code: PrimaryDatabaseCardDragErrorCode,
  message: string,
): never => {
  throw new PrimaryDatabaseCardDragError(code, message);
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

const compileSetValue = (input: {
  readonly cardBlockId: string;
  readonly databaseBlockId: string;
  readonly property: GeneralDatabasePropertyDefinition;
  readonly current:
    | {
        readonly value: DatabaseJsonValue;
        readonly revision: number;
      }
    | undefined;
  readonly value: DatabaseJsonValue;
}): SetDatabasePropertyValueOperation | null => {
  if (sameJsonValue(input.current?.value, input.value)) return null;
  return {
    kind: "set_value",
    cardBlockId: input.cardBlockId,
    databaseBlockId: input.databaseBlockId,
    propertyId: input.property.id,
    expectedValueRevision: input.current?.revision ?? 0,
    value: input.value,
  };
};

const logicalBeforeCardBlockId = (input: {
  readonly query: GeneralDatabaseViewQuery;
  readonly movingCardBlockId: string;
  readonly targetGroupKey: string | null;
  readonly newOrder: number | undefined;
}): string | undefined => {
  if (input.newOrder === undefined) return undefined;
  if (!Number.isInteger(input.newOrder) || input.newOrder < 0) {
    return fail(
      "position_index_invalid",
      "Database View position must be a non-negative integer",
    );
  }
  const remainingRows = input.query.rows.filter(
    (row) =>
      row.card.blockId !== input.movingCardBlockId &&
      row.effectiveGroupKey === input.targetGroupKey,
  );
  const index = Math.min(input.newOrder, remainingRows.length);
  return remainingRows[index]?.card.blockId;
};

const compilePatchedPropertyValues = (input: {
  readonly move: MoveCardInput;
  readonly descriptor: GeneralDatabaseDescriptor;
  readonly row: GeneralDatabaseViewQuery["rows"][number];
}): readonly SetDatabasePropertyValueOperation[] => {
  if (!input.move.fieldPatch) return [];
  const operations: SetDatabasePropertyValueOperation[] = [];
  for (const key of ["priority", "estimate"] as const) {
    if (!Object.prototype.hasOwnProperty.call(input.move.fieldPatch, key)) {
      continue;
    }
    const property = activePropertyByKey(input.descriptor, key);
    if (!property) {
      return fail(
        "property_not_found",
        `Primary Database has no active ${key} property`,
      );
    }
    const rawValue = input.move.fieldPatch[key];
    const value: DatabaseJsonValue = rawValue ?? null;
    readSelectValue(value, key);
    const operation = compileSetValue({
      cardBlockId: input.move.cardId,
      databaseBlockId: input.descriptor.database.blockId,
      property,
      current: input.row.values[property.id],
      value,
    });
    if (operation) operations.push(operation);
  }
  return operations;
};

/**
 * Compile one user drag from current General Database authority. The result is
 * an ordered semantic intent: status and sort-field values are written before
 * the selected View position, and no client rank key crosses the boundary.
 */
export const compilePrimaryDatabaseCardDrag = (input: {
  readonly move: MoveCardInput;
  readonly snapshot: PrimaryDatabaseCardDragSnapshot;
}): CompiledPrimaryDatabaseCardDrag => {
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
      "Database authority changed while preparing the drag; retry from the refreshed Board",
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
  const row = query.rows.find(
    (candidate) => candidate.card.blockId === input.move.cardId,
  );
  if (!row) {
    return fail(
      "card_not_found",
      `Card ${input.move.cardId} is not in the primary Database View`,
    );
  }
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
  const statusValue = row.values[statusProperty.id];
  const currentStatus = readSelectValue(statusValue?.value, "status");
  if (currentStatus === null) {
    return fail(
      "status_value_invalid",
      `Card ${input.move.cardId} has no status value`,
    );
  }
  if (input.move.fromStatus && currentStatus !== input.move.fromStatus) {
    return fail(
      "source_status_conflict",
      `Card ${input.move.cardId} moved from ${input.move.fromStatus} to ${currentStatus} before this drag committed`,
    );
  }

  const operations: DatabaseMutationOperation[] = [];
  const statusOperation = compileSetValue({
    cardBlockId: input.move.cardId,
    databaseBlockId: descriptor.database.blockId,
    property: statusProperty,
    current: statusValue,
    value: input.move.toStatus,
  });
  if (statusOperation) operations.push(statusOperation);
  operations.push(
    ...compilePatchedPropertyValues({
      move: input.move,
      descriptor,
      row,
    }),
  );

  const usesManualPosition = primaryView.config.sort.some(
    (sort) => sort.field.kind === "manual",
  );
  const crossesGroup = currentStatus !== input.move.toStatus;
  const shouldPosition =
    usesManualPosition &&
    (crossesGroup || input.move.newOrder !== undefined);
  if (shouldPosition) {
    const beforeCardBlockId = logicalBeforeCardBlockId({
      query,
      movingCardBlockId: input.move.cardId,
      targetGroupKey: input.move.toStatus,
      newOrder: input.move.newOrder,
    });
    operations.push({
      kind: "position_card",
      viewId: primaryView.id,
      cardBlockId: input.move.cardId,
      expectedPositionRevision: row.position?.revision ?? 0,
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

export const isRefreshRequiredDatabaseMutationError = (
  code: string,
): boolean =>
  new Set([
    "store_epoch_mismatch",
    "database_not_found",
    "database_not_active",
    "database_schema_conflict",
    "property_not_found",
    "property_conflict",
    "property_value_conflict",
    "membership_conflict",
    "view_not_found",
    "view_conflict",
    "position_conflict",
    "position_anchor_not_found",
    "position_anchor_group_mismatch",
    "position_group_mismatch",
  ]).has(code);
