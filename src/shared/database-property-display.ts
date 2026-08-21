import type {
  DatabaseJsonValue,
  DatabasePropertyOption,
  DatabasePropertyValueType,
} from "./database-kernel";

const MAX_PROPERTY_DISPLAY_CHARS = 4_096;

function optionNames(
  config: Readonly<Record<string, DatabaseJsonValue>>,
): ReadonlyMap<string, string> {
  const options = Array.isArray(config.options) ? config.options : [];
  return new Map(
    options.flatMap((option) => {
      if (
        typeof option !== "object" ||
        option === null ||
        Array.isArray(option) ||
        typeof option.id !== "string" ||
        typeof option.name !== "string"
      ) {
        return [];
      }
      const typed = option as unknown as DatabasePropertyOption;
      return [[typed.id, typed.name] as const];
    }),
  );
}

function truncateDisplay(value: string): string {
  return value.length <= MAX_PROPERTY_DISPLAY_CHARS
    ? value
    : value.slice(0, MAX_PROPERTY_DISPLAY_CHARS);
}

/**
 * Stable, locale-independent text for Agent discovery and compact read models.
 * Select-like values resolve durable option IDs to canonical schema names.
 */
export function formatDatabasePropertyDisplayValue(
  definition: {
    readonly valueType: DatabasePropertyValueType;
    readonly config: Readonly<Record<string, DatabaseJsonValue>>;
  },
  value: DatabaseJsonValue,
): string {
  if (value === null) return "";
  if (definition.valueType === "select") {
    if (typeof value !== "string") return "";
    return truncateDisplay(optionNames(definition.config).get(value) ?? value);
  }
  if (definition.valueType === "multi_select") {
    if (!Array.isArray(value)) return "";
    const names = optionNames(definition.config);
    return truncateDisplay(
      value
        .flatMap((entry) => (typeof entry === "string" ? [names.get(entry) ?? entry] : []))
        .join(" "),
    );
  }
  if (definition.valueType === "checkbox") {
    return typeof value === "boolean" ? String(value) : "";
  }
  if (definition.valueType === "number") {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  }
  return typeof value === "string" ? truncateDisplay(value) : "";
}
