import {
  CARD_STATUS_COLUMNS,
  DEFAULT_CARD_STATUS,
  isCardStatus,
} from "../../shared/card-status";
import type {
  DatabaseJsonValue,
  DatabasePropertyValueType,
} from "../../shared/database-kernel";
import type {
  DatabaseViewSnapshot,
  GeneralDatabasePropertyDefinition,
  GeneralDatabaseRow,
} from "../../shared/database-query";
import type {
  Estimate,
  Priority,
} from "./types";

const PRIORITIES = new Set<Priority>([
  "p0-critical",
  "p1-high",
  "p2-medium",
  "p3-low",
  "p4-later",
]);
const ESTIMATES = new Set<Estimate>(["xs", "s", "m", "l", "xl"]);

export interface DatabaseViewRenderModel {
  readonly projectId: string;
  readonly databaseViewId: string;
  readonly databaseBlockId: string;
  readonly databaseName: string;
  readonly viewName: string;
  readonly storeEpoch: string;
  readonly changeLogSeq: number;
  readonly columns: readonly DatabaseViewRenderColumn[];
  readonly query: NonNullable<DatabaseViewSnapshot["query"]["value"]>;
  readonly primaryWriteCompatible: boolean;
  readonly readOnlyReason: string | null;
}

export interface DatabaseViewRenderRow {
  readonly blockId: string;
  readonly title: string;
  readonly preview: string;
  readonly plainText: string;
  readonly status?: import("../../shared/card-status").CardStatus;
  readonly priority?: Priority;
  readonly estimate?: Estimate;
  readonly tags: readonly string[];
  readonly dueDate?: Date;
  readonly scheduledStart?: Date;
  readonly scheduledEnd?: Date;
  readonly assignee?: string;
  readonly metadataRevision: number;
  readonly createdAt: Date;
}

export interface DatabaseViewRenderColumn {
  readonly id: string;
  readonly name: string;
  readonly rows: readonly DatabaseViewRenderRow[];
}

const propertyByKey = (
  properties: readonly GeneralDatabasePropertyDefinition[],
  key: string,
): GeneralDatabasePropertyDefinition | null =>
  properties.find(
    (property) => property.lifecycle === "active" && property.key === key,
  ) ?? null;

const readValue = (
  row: GeneralDatabaseRow,
  property: GeneralDatabasePropertyDefinition | null,
  valueType?: DatabasePropertyValueType,
): DatabaseJsonValue | undefined => {
  if (!property) return undefined;
  const value = row.values[property.id];
  if (!value || (valueType && value.valueType !== valueType)) return undefined;
  return value.value;
};

const readNullableString = (
  row: GeneralDatabaseRow,
  property: GeneralDatabasePropertyDefinition | null,
): string | undefined => {
  const value = readValue(row, property);
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const readDate = (
  row: GeneralDatabaseRow,
  property: GeneralDatabasePropertyDefinition | null,
): Date | undefined => {
  const value = readNullableString(row, property);
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const readStringList = (
  row: GeneralDatabaseRow,
  property: GeneralDatabasePropertyDefinition | null,
): string[] => {
  const value = readValue(row, property, "multi_select");
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
};

const toRenderRow = (
  row: GeneralDatabaseRow,
  properties: readonly GeneralDatabasePropertyDefinition[],
): DatabaseViewRenderRow => {
  const statusValue = readNullableString(row, propertyByKey(properties, "status"));
  const status = isCardStatus(statusValue) ? statusValue : DEFAULT_CARD_STATUS;
  const priorityValue = readNullableString(
    row,
    propertyByKey(properties, "priority"),
  );
  const estimateValue = readNullableString(
    row,
    propertyByKey(properties, "estimate"),
  );
  const plainText = row.card.content?.plainText ?? "";
  const descriptionPreview = row.card.content?.preview ?? "";
  const dueDate = readDate(row, propertyByKey(properties, "due_date"));
  const scheduledStart = readDate(
    row,
    propertyByKey(properties, "scheduled_start"),
  );
  const scheduledEnd = readDate(
    row,
    propertyByKey(properties, "scheduled_end"),
  );
  const assignee = readNullableString(
    row,
    propertyByKey(properties, "assignee"),
  );

  return {
    blockId: row.card.blockId,
    title: row.card.content?.title ?? "Untitled",
    preview: descriptionPreview,
    plainText,
    ...(isCardStatus(statusValue) ? { status } : {}),
    ...(priorityValue && PRIORITIES.has(priorityValue as Priority)
      ? { priority: priorityValue as Priority }
      : {}),
    ...(estimateValue && ESTIMATES.has(estimateValue as Estimate)
      ? { estimate: estimateValue as Estimate }
      : {}),
    tags: readStringList(row, propertyByKey(properties, "tags")),
    ...(dueDate ? { dueDate } : {}),
    ...(scheduledStart ? { scheduledStart } : {}),
    ...(scheduledEnd ? { scheduledEnd } : {}),
    ...(assignee ? { assignee } : {}),
    metadataRevision: row.card.metadataRevision,
    createdAt: new Date(row.card.createdAt),
  };
};

const hasStatusGroupContract = (
  snapshot: DatabaseViewSnapshot,
  statusProperty: GeneralDatabasePropertyDefinition | null,
): boolean => {
  const query = snapshot.query.value;
  if (!query || !statusProperty) return false;
  if (query.view.config.group?.propertyId !== statusProperty.id) return false;

  return query.rows.every((row) => {
    const value = readNullableString(row, statusProperty);
    return isCardStatus(value) && row.effectiveGroupKey === value;
  });
};

const hasLegacyPrimaryReadContract = (
  snapshot: DatabaseViewSnapshot,
): boolean => {
  const config = snapshot.query.value?.view.config;
  if (!config) return false;
  if (
    config.filter.kind !== "group" ||
    config.filter.operator !== "and" ||
    config.filter.children.length !== 0
  ) {
    return false;
  }
  return config.sort.length === 1
    && config.sort[0]?.field.kind === "manual"
    && config.sort[0].direction === "asc"
    && config.sort[0].nulls === "last";
};

const buildColumns = (
  snapshot: DatabaseViewSnapshot,
  statusGrouped: boolean,
): readonly DatabaseViewRenderColumn[] => {
  const query = snapshot.query.value;
  if (!query) return [];
  const rows = query.rows.map((row) => ({
    row,
    renderRow: toRenderRow(row, query.properties),
  }));
  if (!statusGrouped) {
    return [{
        id: DEFAULT_CARD_STATUS,
        name: query.view.name,
        rows: rows.map(({ renderRow }) => renderRow),
    }];
  }

  return CARD_STATUS_COLUMNS.map((column) => ({
      ...column,
      rows: rows.flatMap(({ row, renderRow }) =>
        row.effectiveGroupKey === column.id ? [renderRow] : []),
  }));
};

const assertSnapshotIdentity = (snapshot: DatabaseViewSnapshot): void => {
  const descriptor = snapshot.descriptor;
  const query = snapshot.query;
  if (
    descriptor.projectId !== query.projectId ||
    descriptor.storeEpoch !== query.storeEpoch ||
    descriptor.changeLogSeq !== query.changeLogSeq
  ) {
    throw new Error("Database View snapshot does not share one authority cursor");
  }
  if (!descriptor.value || !query.value) {
    throw new Error("Database View no longer exists");
  }
  if (
    descriptor.value.database.blockId !== query.value.database.blockId ||
    query.value.view.databaseBlockId !== query.value.database.blockId
  ) {
    throw new Error("Database View snapshot has mismatched Database identity");
  }
  const descriptorView = descriptor.value.views.find(
    (view) => view.id === query.value?.view.id && view.lifecycle === "active",
  );
  if (!descriptorView || descriptorView.revision !== query.value.view.revision) {
    throw new Error("Database View snapshot has mismatched View revision");
  }
};

export const buildDatabaseViewRenderModel = (
  snapshot: DatabaseViewSnapshot,
): DatabaseViewRenderModel => {
  assertSnapshotIdentity(snapshot);
  const descriptor = snapshot.descriptor.value;
  const query = snapshot.query.value;
  if (!descriptor || !query) {
    throw new Error("Database View no longer exists");
  }
  const statusProperty = propertyByKey(query.properties, "status");
  const statusGrouped = hasStatusGroupContract(snapshot, statusProperty);
  const primaryWriteCompatible =
    descriptor.database.isPrimary &&
    query.view.isPrimary &&
    query.view.kind === "kanban" &&
    statusGrouped &&
    hasLegacyPrimaryReadContract(snapshot);

  return {
    projectId: query.view.projectId,
    databaseViewId: query.view.id,
    databaseBlockId: query.database.blockId,
    databaseName: query.database.name,
    viewName: query.view.name,
    storeEpoch: snapshot.query.storeEpoch,
    changeLogSeq: snapshot.query.changeLogSeq,
    columns: buildColumns(snapshot, statusGrouped),
    query,
    primaryWriteCompatible,
    readOnlyReason: primaryWriteCompatible
      ? null
      : "This durable Database View is read-only until its mutations are modeled against the selected View identity.",
  };
};
