import { readRelationValuePreview } from "@/lib/data-source-relation-value";
import type { DatabaseJsonValue } from "../../../../shared/database-kernel";
import type { DataSourcePropertyRecordV2 } from "../../../../shared/database-module-v2";
import {
  WORKFLOW_STATUS_LABELS,
  isWorkflowStatus,
} from "../../../../shared/workflow-status";

export const DATABASE_LIST_MUTED_ICON_COLOR = "var(--database-list-icon-muted)";
export const DATABASE_LIST_DUE_NOW_ICON_COLOR = "lch(58% 73 29)";
export const DATABASE_LIST_DUE_FUTURE_ICON_COLOR = "lch(66% 80 48)";

export const databaseListGroupLabel = (
  propertyId: string | undefined,
  key: string | null,
  configuredOptionName?: string,
): string => {
  if (key === null) return "No value";
  if (propertyId === "status" && isWorkflowStatus(key)) {
    return WORKFLOW_STATUS_LABELS[key];
  }
  if (configuredOptionName) return configuredOptionName;
  if (key === "true") return "Yes";
  if (key === "false") return "No";
  return key;
};

const calendarDateStamp = (value: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return null;
  return year * 10_000 + month * 100 + day;
};

export const databaseListDueDateIconColor = (
  value: DatabaseJsonValue | undefined,
  today = new Date(),
): string => {
  if (typeof value !== "string") return DATABASE_LIST_MUTED_ICON_COLOR;
  const dueStamp = calendarDateStamp(value);
  if (dueStamp === null) return DATABASE_LIST_MUTED_ICON_COLOR;
  const todayStamp = today.getFullYear() * 10_000
    + (today.getMonth() + 1) * 100
    + today.getDate();
  return dueStamp <= todayStamp
    ? DATABASE_LIST_DUE_NOW_ICON_COLOR
    : DATABASE_LIST_DUE_FUTURE_ICON_COLOR;
};

export const databaseListPropertyHasValue = (
  property: DataSourcePropertyRecordV2,
  value: DatabaseJsonValue | undefined,
): boolean => {
  if (value === null || value === undefined) return false;
  if (property.valueType === "relation") {
    return (readRelationValuePreview(value)?.totalCount ?? 0) > 0;
  }
  if (property.valueType === "checkbox") return value === true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
};
