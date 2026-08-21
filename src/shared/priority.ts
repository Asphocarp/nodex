export const PRIORITY_VALUES = ["p0-critical", "p1-high", "p2-medium", "p3-low"] as const;

export type Priority = (typeof PRIORITY_VALUES)[number];

export function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && PRIORITY_VALUES.includes(value as Priority);
}

export function parsePriority(value: unknown): Priority {
  if (isPriority(value)) return value;
  throw new TypeError(`Invalid priority "${String(value)}"`);
}

export function priorityRank(priority: Priority): number {
  return PRIORITY_VALUES.indexOf(priority);
}

export function comparePriorities(left: Priority, right: Priority): number {
  return priorityRank(left) - priorityRank(right);
}
