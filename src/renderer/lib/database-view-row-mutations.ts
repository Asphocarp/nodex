import {
  DATABASE_MUTATION_CONTRACT_VERSION,
  MAX_DATABASE_MUTATION_BULK_ENTRIES,
  parseDatabaseMutationRequest,
  stableStringifyDatabaseJson,
  type DatabaseJsonValue,
  type DatabaseMutationCommandResult,
  type DatabaseMutationOperation,
  type DatabaseMutationReceipt,
} from "../../shared/database-kernel";
import type {
  GeneralDatabasePropertyDefinition,
  GeneralDatabaseRow,
} from "../../shared/database-query";
import { mutateDatabase } from "./api";
import type { DatabaseViewRenderModel } from "./database-view-render-model";

export class DatabaseViewMutationError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "DatabaseViewMutationError";
  }
}

const findRow = (
  model: DatabaseViewRenderModel,
  cardBlockId: string,
): GeneralDatabaseRow => {
  const row = model.query.rows.find(
    (candidate) => candidate.card.blockId === cardBlockId,
  );
  if (row) return row;
  throw new DatabaseViewMutationError(
    `Card is no longer present in View ${model.databaseViewId}`,
    false,
  );
};

const findProperty = (
  model: DatabaseViewRenderModel,
  propertyId: string,
): GeneralDatabasePropertyDefinition => {
  const property = model.query.properties.find(
    (candidate) => candidate.id === propertyId && candidate.lifecycle === "active",
  );
  if (property) return property;
  throw new DatabaseViewMutationError(
    `Property is no longer active in Database ${model.databaseBlockId}`,
    false,
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
  readonly cardBlockId: string;
  readonly propertyId: string;
  readonly value: DatabaseJsonValue;
}): readonly DatabaseMutationOperation[] => {
  const row = findRow(input.model, input.cardBlockId);
  const property = findProperty(input.model, input.propertyId);
  const current = row.values[property.id];
  if (
    stableStringifyDatabaseJson(current?.value ?? null) ===
    stableStringifyDatabaseJson(input.value)
  ) {
    return [];
  }

  if (property.valueType === "multi_select") {
    const before = stringSet(current?.value);
    const after = stringSet(input.value);
    const add = [...after].filter((entry) => !before.has(entry)).sort();
    const remove = [...before].filter((entry) => !after.has(entry)).sort();
    if (add.length === 0 && remove.length === 0) return [];
    return [{
      kind: "add_remove_value",
      cardBlockId: row.card.blockId,
      databaseBlockId: input.model.databaseBlockId,
      propertyId: property.id,
      add,
      remove,
    }];
  }

  return [{
    kind: "set_value",
    cardBlockId: row.card.blockId,
    databaseBlockId: input.model.databaseBlockId,
    propertyId: property.id,
    expectedValueRevision: current?.revision ?? 0,
    value: input.value,
  }];
};

const hasEmptyAndFilter = (model: DatabaseViewRenderModel): boolean =>
  model.query.view.config.filter.kind === "group" &&
  model.query.view.config.filter.operator === "and" &&
  model.query.view.config.filter.children.length === 0;

export const databaseViewSupportsManualReorder = (
  model: DatabaseViewRenderModel,
): boolean => model.query.view.config.sort[0]?.field.kind === "manual";

/**
 * Compile one visual one-step reorder. An unfiltered View can initialize every
 * missing position atomically. A filtered View only emits a single logical
 * move when the required external anchor already has durable authority.
 */
export const buildDatabaseViewMoveOperations = (input: {
  readonly model: DatabaseViewRenderModel;
  readonly cardBlockId: string;
  readonly direction: "up" | "down";
}): readonly DatabaseMutationOperation[] => {
  if (!databaseViewSupportsManualReorder(input.model)) return [];
  const row = findRow(input.model, input.cardBlockId);
  const visibleGroup = input.model.query.rows.filter(
    (candidate) => candidate.effectiveGroupKey === row.effectiveGroupKey,
  );
  const currentIndex = visibleGroup.findIndex(
    (candidate) => candidate.card.blockId === input.cardBlockId,
  );
  const targetIndex = input.direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= visibleGroup.length) {
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
    if (visibleGroup.length > MAX_DATABASE_MUTATION_BULK_ENTRIES) {
      throw new DatabaseViewMutationError(
        "This View group is too large for one atomic manual-order mutation",
        false,
      );
    }
    return [{
      kind: "position_cards",
      viewId: input.model.databaseViewId,
      cards: authorityOrder.map((candidate) => ({
        cardBlockId: candidate.card.blockId,
        expectedPositionRevision: candidate.position?.revision ?? 0,
      })),
      groupKey: row.effectiveGroupKey,
    }];
  }

  const authorityIndex = authorityOrder.findIndex(
    (candidate) => candidate.card.blockId === input.cardBlockId,
  );
  const anchor = authorityOrder[authorityIndex + 1];
  if (anchor && !anchor.position) return [];
  return [{
    kind: "position_card",
    viewId: input.model.databaseViewId,
    cardBlockId: row.card.blockId,
    expectedPositionRevision: row.position?.revision ?? 0,
    groupKey: row.effectiveGroupKey,
    ...(anchor ? { beforeCardBlockId: anchor.card.blockId } : {}),
  }];
};

export const canMoveDatabaseViewCard = (input: {
  readonly model: DatabaseViewRenderModel;
  readonly cardBlockId: string;
  readonly direction: "up" | "down";
}): boolean => {
  try {
    return buildDatabaseViewMoveOperations(input).length > 0;
  } catch {
    return false;
  }
};

export interface DatabaseViewMutationDependencies {
  readonly mutate: (
    projectId: string,
    request: ReturnType<typeof parseDatabaseMutationRequest>,
  ) => Promise<DatabaseMutationCommandResult>;
}

const defaultDependencies: DatabaseViewMutationDependencies = {
  mutate: mutateDatabase,
};

export const commitDatabaseViewOperations = async (input: {
  readonly model: DatabaseViewRenderModel;
  readonly operations: readonly DatabaseMutationOperation[];
  readonly clientSessionId?: string;
  readonly operationId?: string;
  readonly dependencies?: DatabaseViewMutationDependencies;
}): Promise<DatabaseMutationReceipt | null> => {
  if (input.operations.length === 0) return null;
  const request = parseDatabaseMutationRequest({
    version: DATABASE_MUTATION_CONTRACT_VERSION,
    operationId: input.operationId ?? crypto.randomUUID(),
    projectId: input.model.projectId,
    storeEpoch: input.model.storeEpoch,
    ...(input.clientSessionId ? { clientSessionId: input.clientSessionId } : {}),
    actor: { kind: "renderer_database_view" },
    operations: input.operations,
  });
  const dependencies = input.dependencies ?? defaultDependencies;
  let result: DatabaseMutationCommandResult;
  let retried = false;
  try {
    result = await dependencies.mutate(input.model.projectId, request);
  } catch {
    retried = true;
    result = await dependencies.mutate(input.model.projectId, request);
  }
  if (!result.ok && result.error.retryable && !retried) {
    result = await dependencies.mutate(input.model.projectId, request);
  }
  if (result.ok) return result.value;
  throw new DatabaseViewMutationError(result.error.message, result.error.retryable);
};
