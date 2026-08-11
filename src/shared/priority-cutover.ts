import { isPriority, PRIORITY_VALUES, type Priority } from "./priority";

const LEGACY_P4_PRIORITY = "p4-later";
const LEGACY_PRIORITY_VALUES = [...PRIORITY_VALUES, LEGACY_P4_PRIORITY] as const;

/** Recognizes the retired P4 identity only at versioned migration boundaries. */
export function upgradeLegacyPriority(value: unknown): Priority | null {
  if (isPriority(value)) return value;
  if (value === LEGACY_P4_PRIORITY) return "p3-low";
  return null;
}

export function legacyPrioritySelectionIncludesEveryAssigned(
  values: readonly unknown[],
): boolean {
  return LEGACY_PRIORITY_VALUES.every((priority) => values.includes(priority));
}
