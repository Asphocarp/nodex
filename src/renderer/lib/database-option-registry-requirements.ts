import type { DatabaseViewFilterNode } from "../../shared/database-kernel";
import type {
  DataSourcePageRowV2,
  DataSourcePropertyRecordV2,
} from "../../shared/database-module-v2";
import { resolveDataSourcePropertyPresentationRole } from "./data-source-property-presentation-role";

const usesExternalOptionRegistry = (property: DataSourcePropertyRecordV2): boolean => {
  if (property.lifecycle !== "active") return false;
  if (property.valueType !== "select" && property.valueType !== "multi_select") return false;
  const role = resolveDataSourcePropertyPresentationRole(property);
  return role.kind !== "status" && role.kind !== "priority" && role.kind !== "estimate";
};

const addStringValues = (target: Set<string>, value: unknown): void => {
  if (typeof value === "string") {
    if (value.length > 0) target.add(value);
    return;
  }
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) target.add(item);
  }
};

const collectFilterValues = (
  node: DatabaseViewFilterNode,
  selectedByProperty: ReadonlyMap<string, Set<string>>,
): void => {
  if (node.kind === "clause") {
    const selected = selectedByProperty.get(node.propertyId);
    if (selected) addStringValues(selected, node.value);
    return;
  }
  for (const child of node.children) collectFilterValues(child, selectedByProperty);
};

/**
 * Collects canonical option identities whose labels must be available before
 * a row, Filter editor, or active-rule summary is rendered.
 */
export const collectRequiredPropertyOptionIds = (input: {
  readonly properties: readonly DataSourcePropertyRecordV2[];
  readonly rows: readonly DataSourcePageRowV2[];
  readonly filter?: DatabaseViewFilterNode;
  readonly propertyIds?: ReadonlySet<string>;
}): Readonly<Record<string, readonly string[]>> => {
  const optionProperties = input.properties.filter(
    (property) =>
      usesExternalOptionRegistry(property) &&
      (!input.propertyIds || input.propertyIds.has(property.propertyId)),
  );
  const selectedByProperty = new Map<string, Set<string>>(
    optionProperties.map((property) => [property.propertyId, new Set()]),
  );
  for (const row of input.rows) {
    for (const property of optionProperties) {
      addStringValues(
        selectedByProperty.get(property.propertyId)!,
        row.values[property.propertyId]?.value,
      );
    }
  }
  if (input.filter) collectFilterValues(input.filter, selectedByProperty);
  return Object.fromEntries(
    [...selectedByProperty]
      .filter(([, optionIds]) => optionIds.size > 0)
      .map(([propertyId, optionIds]) => [propertyId, [...optionIds].sort()]),
  );
};
