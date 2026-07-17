import {
  stableStringifyDatabaseJson,
  type DatabaseJsonValue,
  type DatabaseViewSort,
} from "../../shared/database-kernel";

export interface DatabaseViewOrderItem {
  readonly pageId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly rankKey: string | null;
  readonly propertyValues: Readonly<Record<string, DatabaseJsonValue | undefined>>;
}

const isEmptyValue = (value: DatabaseJsonValue | undefined): boolean =>
  value === undefined
  || value === null
  || value === ""
  || (Array.isArray(value) && value.length === 0);

const compareValues = (
  left: DatabaseJsonValue | undefined,
  right: DatabaseJsonValue | undefined,
  nulls: "first" | "last",
  direction: "asc" | "desc",
): number => {
  const leftEmpty = isEmptyValue(left);
  const rightEmpty = isEmptyValue(right);
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return nulls === "first" ? -1 : 1;
  if (rightEmpty) return nulls === "first" ? 1 : -1;
  let comparison: number;
  if (typeof left === "number" && typeof right === "number") {
    comparison = left - right;
  } else if (typeof left === "boolean" && typeof right === "boolean") {
    comparison = Number(left) - Number(right);
  } else {
    comparison = stableStringifyDatabaseJson(left).localeCompare(
      stableStringifyDatabaseJson(right),
    );
  }
  return comparison * (direction === "asc" ? 1 : -1);
};

export const compareDatabaseViewOrderItems = (
  left: DatabaseViewOrderItem,
  right: DatabaseViewOrderItem,
  sort: readonly DatabaseViewSort[],
): number => {
  for (const sortEntry of sort) {
    const leftValue = sortEntry.field.kind === "manual"
      ? left.rankKey
      : sortEntry.field.kind === "title"
        ? left.title
        : sortEntry.field.kind === "created"
          ? left.createdAt
          : left.propertyValues[sortEntry.field.propertyId];
    const rightValue = sortEntry.field.kind === "manual"
      ? right.rankKey
      : sortEntry.field.kind === "title"
        ? right.title
        : sortEntry.field.kind === "created"
          ? right.createdAt
          : right.propertyValues[sortEntry.field.propertyId];
    const comparison = compareValues(
      leftValue,
      rightValue,
      sortEntry.nulls,
      sortEntry.direction,
    );
    if (comparison !== 0) return comparison;
  }
  return left.pageId.localeCompare(right.pageId);
};
