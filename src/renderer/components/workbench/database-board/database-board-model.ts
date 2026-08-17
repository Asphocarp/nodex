import type {
  DatabaseJsonValue,
  DatabasePropertyOption,
  DatabasePropertyValueType,
} from "../../../../shared/database-kernel";
import type {
  DataSourcePageRowV2,
  DataSourcePropertyRecordV2,
} from "../../../../shared/database-module-v2";
import type { DatabaseViewRenderColumn } from "@/lib/database-view-render-model";
import { databasePropertyListOptionDotColor } from "@/components/database/property-list-chip";
import { columnStyles } from "@/lib/status-presentation";

export type DatabaseBoardMarker =
  | { readonly kind: "status"; readonly statusId: string }
  | { readonly kind: "priority"; readonly priorityId: string }
  | { readonly kind: "option"; readonly optionId: string; readonly color: string }
  | {
      readonly kind: "property";
      readonly propertyId: DataSourcePropertyRecordV2["propertyId"] | null;
      readonly valueType: DatabasePropertyValueType;
    }
  | {
      readonly kind: "unassigned";
      readonly propertyId: DataSourcePropertyRecordV2["propertyId"];
      readonly valueType: DatabasePropertyValueType;
    };

export interface DatabaseBoardGroupPresentation {
  readonly pathKey: string;
  readonly groupKey: string | null;
  readonly label: string;
  readonly marker: DatabaseBoardMarker;
  readonly accentColor: string;
  readonly surfaceColor: string;
  readonly activeSurfaceColor: string;
}

export interface DatabaseBoardCardPropertySlot {
  readonly property: DataSourcePropertyRecordV2;
  readonly value: DatabaseJsonValue;
  readonly revision: number;
}

const quietAccent = "var(--foreground-tertiary)";

const quietSurfaceColor = (accentColor: string): string =>
  `color-mix(in srgb, ${accentColor} 4%, var(--background))`;

const quietActiveSurfaceColor = (accentColor: string): string =>
  `color-mix(in srgb, ${accentColor} 8%, var(--background))`;

const statusSurfaceColors = (statusId: string): {
  readonly surfaceColor: string;
  readonly activeSurfaceColor: string;
} => {
  const variableStem = statusId === "archived" ? "archive" : statusId;
  return {
    surfaceColor: `var(--column-${variableStem}-header-bg)`,
    activeSurfaceColor: `var(--column-${variableStem}-drop-bg)`,
  };
};

const presentationColors = (
  accentColor: string,
): Pick<DatabaseBoardGroupPresentation, "accentColor" | "surfaceColor" | "activeSurfaceColor"> => ({
  accentColor,
  surfaceColor: quietSurfaceColor(accentColor),
  activeSurfaceColor: quietActiveSurfaceColor(accentColor),
});

const semanticAccent = (propertyId: string, groupKey: string): string | null => {
  if (propertyId === "status") {
    return columnStyles[groupKey]?.accentColor ?? null;
  }
  if (propertyId !== "priority") return null;
  if (groupKey === "p0-critical") return "var(--priority-critical-text)";
  if (groupKey === "p1-high") return "var(--priority-high-text)";
  if (groupKey === "p2-medium") return "var(--priority-medium-text)";
  if (groupKey === "p3-low") return "var(--priority-low-text)";
  return null;
};

const optionIdsForGroupKey = (
  property: DataSourcePropertyRecordV2,
  groupKey: string,
): readonly string[] => {
  if (property.valueType !== "multi_select") return [groupKey];
  try {
    const parsed = JSON.parse(groupKey) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
};

/**
 * Projects one Core-owned grouping value into the visual role used by every
 * Board column and swimlane. Unknown values remain visible and receive a
 * deterministic, quiet accent rather than selecting another presenter.
 */
export const projectDatabaseBoardGroup = ({
  property,
  groupKey,
  label,
  pathKey,
  options,
}: {
  readonly property: DataSourcePropertyRecordV2 | null;
  readonly groupKey: string | null;
  readonly label: string;
  readonly pathKey: string;
  readonly options: readonly DatabasePropertyOption[];
}): DatabaseBoardGroupPresentation => {
  if (!property) {
    return {
      pathKey,
      groupKey,
      label,
      marker: { kind: "property", propertyId: null, valueType: "text" },
      ...presentationColors(quietAccent),
    };
  }
  if (groupKey === null) {
    return {
      pathKey,
      groupKey,
      label,
      marker: {
        kind: "unassigned",
        propertyId: property.propertyId,
        valueType: property.valueType,
      },
      ...presentationColors(quietAccent),
    };
  }
  if (property.propertyId === "status" && columnStyles[groupKey]) {
    const accentColor = columnStyles[groupKey]!.accentColor;
    return {
      pathKey,
      groupKey,
      label,
      marker: { kind: "status", statusId: groupKey },
      accentColor,
      ...statusSurfaceColors(groupKey),
    };
  }
  if (property.propertyId === "priority" && semanticAccent("priority", groupKey)) {
    const accentColor = semanticAccent("priority", groupKey)!;
    return {
      pathKey,
      groupKey,
      label,
      marker: { kind: "priority", priorityId: groupKey },
      ...presentationColors(accentColor),
    };
  }
  const optionIds = optionIdsForGroupKey(property, groupKey);
  const option = optionIds
    .map((optionId) => options.find((candidate) => candidate.id === optionId))
    .find((candidate) => candidate !== undefined);
  const optionBacked = property.valueType === "select"
    || property.valueType === "multi_select"
    || property.propertyId === "priority"
    || property.propertyId === "estimate";
  if (optionBacked && option) {
    const accentColor = semanticAccent(property.propertyId, groupKey)
      ?? databasePropertyListOptionDotColor(option.color, option.id);
    return {
      pathKey,
      groupKey,
      label,
      marker: {
        kind: "option",
        optionId: option.id,
        color: databasePropertyListOptionDotColor(option.color, option.id),
      },
      ...presentationColors(accentColor),
    };
  }
  const accentColor = semanticAccent(property.propertyId, groupKey) ?? quietAccent;
  return {
    pathKey,
    groupKey,
    label,
    marker: {
      kind: "property",
      propertyId: property.propertyId,
      valueType: property.valueType,
    },
    ...presentationColors(accentColor),
  };
};

export const databaseBoardValueIsVisible = (
  value: DatabaseJsonValue | undefined,
): value is DatabaseJsonValue => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

/** Card body projection: structural grouping fields and empty values vanish. */
export const projectDatabaseBoardCardProperties = ({
  authority,
  displayedProperties,
  groupPropertyId,
  subgroupPropertyId,
}: {
  readonly authority: DataSourcePageRowV2;
  readonly displayedProperties: readonly DataSourcePropertyRecordV2[];
  readonly groupPropertyId: string | null;
  readonly subgroupPropertyId: string | null;
}): readonly DatabaseBoardCardPropertySlot[] => displayedProperties.flatMap((property) => {
  if (
    property.propertyId === groupPropertyId
    || property.propertyId === subgroupPropertyId
  ) return [];
  const current = authority.values[property.propertyId];
  if (!current || !databaseBoardValueIsVisible(current.value)) return [];
  return [{ property, value: current.value, revision: current.revision }];
});

export interface DatabaseBoardSubgroupWindow {
  readonly key: string | null;
  readonly name: string | null;
  readonly scopeKey: string;
  readonly rows: DatabaseViewRenderColumn["rows"];
}
