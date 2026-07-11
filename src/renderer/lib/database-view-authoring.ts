import {
  stableStringifyDatabaseJson,
  type DatabaseJsonValue,
  type DatabasePropertyOption,
  type DatabaseViewFilterClause,
  type DatabaseViewFilterNode,
  type DatabaseViewFilterOperator,
  type DatabaseViewSort,
  type GeneralDatabaseViewConfig,
} from "../../shared/database-kernel";
import type {
  GeneralDatabasePropertyDefinition,
  GeneralDatabaseViewDefinition,
} from "../../shared/database-query";

export const emptyDatabaseViewConfig = (): GeneralDatabaseViewConfig => ({
  schemaKey: "nodex.database-view",
  schemaVersion: 1,
  filter: { kind: "group", operator: "and", children: [] },
  sort: [
    {
      field: { kind: "manual" },
      direction: "asc",
      nulls: "last",
    },
  ],
  group: null,
  display: { propertyIds: [], showTitle: true },
});

export const readDatabasePropertyOptions = (
  property: GeneralDatabasePropertyDefinition,
): readonly DatabasePropertyOption[] => {
  if (property.valueType !== "select" && property.valueType !== "multi_select") {
    return [];
  }
  const options = property.config.options;
  if (!Array.isArray(options)) return [];
  return options.flatMap((option) => {
    if (typeof option !== "object" || option === null || Array.isArray(option)) {
      return [];
    }
    const id = option.id;
    const name = option.name;
    const color = option.color;
    if (typeof id !== "string" || typeof name !== "string") return [];
    if (color !== undefined && typeof color !== "string") return [];
    return [{ id, name, ...(color === undefined ? {} : { color }) }];
  });
};

export const databaseViewConfigsEqual = (
  left: GeneralDatabaseViewConfig,
  right: GeneralDatabaseViewConfig,
): boolean =>
  stableStringifyDatabaseJson(left) === stableStringifyDatabaseJson(right);

/**
 * Resolve the logical anchor for moving one durable View exactly one place.
 * `null` is the explicit append intent; `undefined` means the requested move
 * is already at an edge and should not emit a mutation.
 */
export const databaseViewMoveBeforeId = (
  views: readonly GeneralDatabaseViewDefinition[],
  viewId: string,
  direction: "up" | "down",
): string | null | undefined => {
  const ordered = views
    .filter((view) => view.lifecycle === "active")
    .map((view) => view.id);
  const currentIndex = ordered.indexOf(viewId);
  if (currentIndex < 0) return undefined;
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= ordered.length) return undefined;

  const remaining = ordered.filter((candidate) => candidate !== viewId);
  return remaining[targetIndex] ?? null;
};

export type DatabaseViewFilterPath = readonly number[];

const transformFilterNode = (
  node: DatabaseViewFilterNode,
  path: DatabaseViewFilterPath,
  transform: (current: DatabaseViewFilterNode) => DatabaseViewFilterNode,
): DatabaseViewFilterNode => {
  const [index, ...rest] = path;
  if (index === undefined) return transform(node);
  if (node.kind !== "group" || !node.children[index]) return node;
  return {
    ...node,
    children: node.children.map((child, childIndex) =>
      childIndex === index
        ? transformFilterNode(child, rest, transform)
        : child),
  };
};

export const updateDatabaseViewFilterNode = (
  root: DatabaseViewFilterNode,
  path: DatabaseViewFilterPath,
  next: DatabaseViewFilterNode,
): DatabaseViewFilterNode =>
  transformFilterNode(root, path, () => next);

export const appendDatabaseViewFilterChild = (
  root: DatabaseViewFilterNode,
  path: DatabaseViewFilterPath,
  child: DatabaseViewFilterNode,
): DatabaseViewFilterNode =>
  transformFilterNode(root, path, (node) => {
    if (node.kind !== "group") return node;
    return { ...node, children: [...node.children, child] };
  });

export const removeDatabaseViewFilterNode = (
  root: DatabaseViewFilterNode,
  path: DatabaseViewFilterPath,
): DatabaseViewFilterNode => {
  if (path.length === 0) {
    return { kind: "group", operator: "and", children: [] };
  }
  const parentPath = path.slice(0, -1);
  const targetIndex = path[path.length - 1];
  if (targetIndex === undefined) return root;
  return transformFilterNode(root, parentPath, (node) => {
    if (node.kind !== "group") return node;
    return {
      ...node,
      children: node.children.filter((_, index) => index !== targetIndex),
    };
  });
};

export const filterOperatorsForProperty = (
  property: GeneralDatabasePropertyDefinition,
): readonly DatabaseViewFilterOperator[] => {
  const common = ["equals", "not_equals", "is_empty", "is_not_empty"] as const;
  if (
    property.valueType === "text" ||
    property.valueType === "person" ||
    property.valueType === "multi_select"
  ) {
    return [...common.slice(0, 2), "contains", ...common.slice(2)];
  }
  return common;
};

const firstOptionId = (
  property: GeneralDatabasePropertyDefinition,
): string | null => readDatabasePropertyOptions(property)[0]?.id ?? null;

export const defaultDatabaseFilterValue = (
  property: GeneralDatabasePropertyDefinition,
  operator: DatabaseViewFilterOperator,
): DatabaseJsonValue => {
  if (property.valueType === "checkbox") return false;
  if (property.valueType === "number") return 0;
  if (property.valueType === "select") return firstOptionId(property);
  if (property.valueType === "multi_select") {
    const optionId = firstOptionId(property);
    return operator === "contains" ? optionId : optionId ? [optionId] : [];
  }
  return "";
};

export const createDatabaseViewFilterClause = (
  property: GeneralDatabasePropertyDefinition,
): DatabaseViewFilterClause => ({
  kind: "clause",
  propertyId: property.id,
  operator: "equals",
  value: defaultDatabaseFilterValue(property, "equals"),
});

export const databaseFilterClauseWithOperator = (
  property: GeneralDatabasePropertyDefinition,
  operator: DatabaseViewFilterOperator,
): DatabaseViewFilterClause => {
  if (operator === "is_empty" || operator === "is_not_empty") {
    return { kind: "clause", propertyId: property.id, operator };
  }
  return {
    kind: "clause",
    propertyId: property.id,
    operator,
    value: defaultDatabaseFilterValue(property, operator),
  };
};

export const databaseFilterClauseWithProperty = (
  clause: DatabaseViewFilterClause,
  property: GeneralDatabasePropertyDefinition,
): DatabaseViewFilterClause => {
  const supported = filterOperatorsForProperty(property);
  const operator = supported.includes(clause.operator)
    ? clause.operator
    : "equals";
  return databaseFilterClauseWithOperator(property, operator);
};

export const createDatabaseViewSort = (): DatabaseViewSort => ({
  field: { kind: "title" },
  direction: "asc",
  nulls: "last",
});

export const moveDatabaseViewSort = (
  sorts: readonly DatabaseViewSort[],
  index: number,
  direction: "up" | "down",
): readonly DatabaseViewSort[] => {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= sorts.length || target < 0 || target >= sorts.length) {
    return sorts;
  }
  const next = [...sorts];
  const current = next[index];
  const replacement = next[target];
  if (!current || !replacement) return sorts;
  next[index] = replacement;
  next[target] = current;
  return next;
};
