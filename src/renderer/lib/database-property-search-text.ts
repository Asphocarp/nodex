import {
  stableStringifyDatabaseJson,
  type DatabaseJsonValue,
  type DatabasePropertyOption,
} from "../../shared/database-kernel";

interface DatabasePropertyValueSearchContext {
  readonly optionBacked?: boolean;
  readonly options?: readonly DatabasePropertyOption[];
}

/** Human-searchable text without exposing option identities as display text. */
export const databasePropertyValueSearchText = (
  value: DatabaseJsonValue,
  context: DatabasePropertyValueSearchContext = {},
): string => {
  if (!context.optionBacked) return stableStringifyDatabaseJson(value);

  const selectedIds = new Set(
    typeof value === "string"
      ? [value]
      : Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [],
  );
  if (selectedIds.size === 0) return "";
  const labelsById = new Map(
    (context.options ?? []).map((option) => [option.id, option.name] as const),
  );
  return [
    ...new Set([...selectedIds].map((optionId) => labelsById.get(optionId) ?? "Unknown option")),
  ].join(" ");
};
