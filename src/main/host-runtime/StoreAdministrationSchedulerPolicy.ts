import type { DesktopStoreMaintenanceInput } from "../core-client/desktop-store-administration-bridge";

export const STORE_MAINTENANCE_SCHEDULES = {
  revision: { initial: 15_000, interval: 30_000 },
  document: { initial: 30_000, interval: 15 * 60_000 },
  block: { initial: 45_000, interval: 15 * 60_000 },
} as const;

export type StoreMaintenanceLane = keyof typeof STORE_MAINTENANCE_SCHEDULES;

const requireNonNegativeInteger = (value: number, field: string): number => {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError(`${field} must be a non-negative safe integer`);
};

export const maintenanceInput = (
  lane: StoreMaintenanceLane,
  blockRetentionCount: number,
): DesktopStoreMaintenanceInput => {
  if (lane === "revision") return { tasks: ["document_revision_finalize"] };
  if (lane === "document") return { tasks: ["document_compaction", "history_retention"] };
  return {
    tasks: ["block_retention"],
    blockRetentionCount: requireNonNegativeInteger(blockRetentionCount, "history retention"),
  };
};
