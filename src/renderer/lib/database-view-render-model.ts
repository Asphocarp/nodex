import {
  WORKFLOW_STATUS_COLUMNS,
  DEFAULT_WORKFLOW_STATUS,
  isWorkflowStatus,
} from "../../shared/workflow-status";
import type {
  DatabaseModuleReadSnapshot,
  DatabaseViewQueryResult,
  DataSourcePageRow,
  DataSourcePropertyRecord,
} from "../../shared/database-module";
import type {
  DatabaseJsonValue,
  DatabasePropertyValueType,
} from "../../shared/database-kernel";
import { readDatabasePropertyOptions } from "./database-view-authoring";
import type { Estimate, Priority } from "./types";

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
  readonly databaseId: string;
  readonly dataSourceId: string;
  readonly databaseName: string;
  readonly dataSourceName: string;
  readonly viewName: string;
  readonly storeEpoch: string;
  readonly changeLogSeq: number;
  readonly columns: readonly DatabaseViewRenderColumn[];
  readonly query: DatabaseViewQueryResult;
  /** Whether the compatibility Board presentation can faithfully render it. */
  readonly primaryWriteCompatible: boolean;
  readonly readOnlyReason: string | null;
}

export interface DatabaseViewRenderRow {
  readonly pageId: string;
  readonly title: string;
  readonly preview: string;
  readonly plainText: string;
  readonly status?: import("../../shared/workflow-status").WorkflowStatus;
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
  properties: readonly DataSourcePropertyRecord[],
  key: string,
): DataSourcePropertyRecord | null =>
  properties.find(
    (property) => property.lifecycle === "active" && property.key === key,
  ) ?? null;

const readValue = (
  row: DataSourcePageRow,
  property: DataSourcePropertyRecord | null,
  valueType?: DatabasePropertyValueType,
): DatabaseJsonValue | undefined => {
  if (!property) return undefined;
  const value = row.values[property.propertyId];
  if (!value || (valueType && value.valueType !== valueType)) return undefined;
  return value.value;
};

const readNullableString = (
  row: DataSourcePageRow,
  property: DataSourcePropertyRecord | null,
): string | undefined => {
  const value = readValue(row, property);
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const readDate = (
  row: DataSourcePageRow,
  property: DataSourcePropertyRecord | null,
): Date | undefined => {
  const value = readNullableString(row, property);
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const readStringList = (
  row: DataSourcePageRow,
  property: DataSourcePropertyRecord | null,
): string[] => {
  const value = readValue(row, property, "multi_select");
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
};

const toRenderRow = (
  row: DataSourcePageRow,
  properties: readonly DataSourcePropertyRecord[],
): DatabaseViewRenderRow => {
  const statusValue = readNullableString(row, propertyByKey(properties, "status"));
  const priorityValue = readNullableString(
    row,
    propertyByKey(properties, "priority"),
  );
  const estimateValue = readNullableString(
    row,
    propertyByKey(properties, "estimate"),
  );
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
    pageId: row.page.pageId,
    title: row.page.title || "Untitled",
    preview: row.page.preview,
    plainText: row.page.plainText,
    ...(isWorkflowStatus(statusValue) ? { status: statusValue } : {}),
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
    metadataRevision: row.page.metadataRevision,
    createdAt: new Date(row.page.createdAt),
  };
};

const hasStatusGroupContract = (
  query: DatabaseViewQueryResult,
  statusProperty: DataSourcePropertyRecord | null,
): boolean => {
  if (!statusProperty) return false;
  if (query.view.config.group?.propertyId !== statusProperty.propertyId) {
    return false;
  }
  return query.rows.every((row) => {
    const value = readNullableString(row, statusProperty);
    return isWorkflowStatus(value) && row.effectiveGroupKey === value;
  });
};

const hasDefaultBoardReadContract = (
  query: DatabaseViewQueryResult,
): boolean => {
  const config = query.view.config;
  if (
    config.filter.kind !== "group"
    || config.filter.operator !== "and"
    || config.filter.children.length !== 0
  ) {
    return false;
  }
  return config.sort.length === 1
    && config.sort[0]?.field.kind === "manual"
    && config.sort[0].direction === "asc"
    && config.sort[0].nulls === "last";
};

const buildColumns = (
  query: DatabaseViewQueryResult,
  statusGrouped: boolean,
): readonly DatabaseViewRenderColumn[] => {
  const rows = query.rows.map((row) => ({
    row,
    renderRow: toRenderRow(row, query.properties),
  }));
  if (!statusGrouped) {
    const groupPropertyId = query.view.config.group?.propertyId;
    if (!groupPropertyId) {
      return [{
        id: DEFAULT_WORKFLOW_STATUS,
        name: query.view.name,
        rows: rows.map(({ renderRow }) => renderRow),
      }];
    }
    const groupProperty = query.properties.find(
      (property) =>
        property.propertyId === groupPropertyId
        && property.lifecycle === "active",
    );
    if (!groupProperty) {
      return [{
        id: DEFAULT_WORKFLOW_STATUS,
        name: query.view.name,
        rows: rows.map(({ renderRow }) => renderRow),
      }];
    }
    const options = readDatabasePropertyOptions(groupProperty);
    const optionNames = new Map(
      options.map((option) => [option.id, option.name]),
    );
    const configuredGroupKeys = [
      ...options.map((option) => option.id),
      ...rows.map(({ row }) => row.effectiveGroupKey),
    ].filter(
      (key, index, all): key is string | null => all.indexOf(key) === index,
    );
    const groupKeys = configuredGroupKeys.length > 0
      ? configuredGroupKeys
      : [null];
    const groupName = (key: string | null): string => {
      if (key === null) return `No ${groupProperty.name}`;
      const optionName = optionNames.get(key);
      if (optionName) return optionName;
      if (groupProperty.valueType === "multi_select") {
        try {
          const optionIds = JSON.parse(key) as unknown;
          if (
            Array.isArray(optionIds)
            && optionIds.every((id) => typeof id === "string")
          ) {
            return optionIds
              .map((id) => optionNames.get(id) ?? id)
              .join(" · ");
          }
        } catch {
          // Unknown canonical group keys remain visible.
        }
      }
      if (key === "true") return "Checked";
      if (key === "false") return "Unchecked";
      return key;
    };
    return groupKeys.map((groupKey) => ({
      id: groupKey ?? `empty:${groupProperty.propertyId}`,
      name: groupName(groupKey),
      rows: rows.flatMap(({ row, renderRow }) =>
        row.effectiveGroupKey === groupKey ? [renderRow] : []),
    }));
  }

  return WORKFLOW_STATUS_COLUMNS.map((column) => ({
    ...column,
    rows: rows.flatMap(({ row, renderRow }) =>
      row.effectiveGroupKey === column.id ? [renderRow] : []),
  }));
};

const queryFromSnapshot = (
  snapshot: DatabaseModuleReadSnapshot,
): DatabaseViewQueryResult => {
  if (snapshot.value.kind === "query") return snapshot.value.value;
  throw new Error("Database View read did not return a query");
};

export const buildDatabaseViewRenderModel = (
  snapshot: DatabaseModuleReadSnapshot,
): DatabaseViewRenderModel => {
  const query = queryFromSnapshot(snapshot);
  if (
    query.database.libraryId !== snapshot.libraryId
    || query.dataSource.libraryId !== snapshot.libraryId
    || query.view.databaseId !== query.database.databaseId
    || query.view.dataSourceId !== query.dataSource.dataSourceId
  ) {
    throw new Error("Database View query has mismatched Library resource identity");
  }
  const statusProperty = propertyByKey(query.properties, "status");
  const statusGrouped = hasStatusGroupContract(query, statusProperty);
  const primaryWriteCompatible =
    query.database.defaultViewId === query.view.viewId
    && query.view.isDefault
    && query.view.kind === "kanban"
    && statusGrouped
    && hasDefaultBoardReadContract(query);

  return {
    projectId: snapshot.projectId,
    databaseViewId: query.view.viewId,
    databaseId: query.database.databaseId,
    dataSourceId: query.dataSource.dataSourceId,
    databaseName: query.database.name,
    dataSourceName: query.dataSource.name,
    viewName: query.view.name,
    storeEpoch: snapshot.storeEpoch,
    changeLogSeq: snapshot.changeLogSeq,
    columns: buildColumns(query, statusGrouped),
    query,
    primaryWriteCompatible,
    readOnlyReason: null,
  };
};
