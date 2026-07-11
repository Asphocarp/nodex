import type Database from "better-sqlite3";

import { requireBlockStoreEpoch } from "./block-store-metadata";
import {
  maintainBlockRetention,
  type BlockRetentionMaintenanceResult,
} from "./block-retention-maintenance";

export interface MaintainStoreBlockRetentionInput {
  readonly storeEpoch: string;
  readonly retainNewestDeletedBlocks: number;
}

export type StoreBlockRetentionProjectResult =
  | {
      readonly status: "completed";
      readonly projectId: string;
      readonly result: BlockRetentionMaintenanceResult;
    }
  | {
      readonly status: "failed";
      readonly projectId: string;
      readonly message: string;
    };

export interface MaintainStoreBlockRetentionResult {
  readonly storeEpoch: string;
  readonly retainNewestDeletedBlocks: number;
  readonly projectResults: readonly StoreBlockRetentionProjectResult[];
  readonly collectedCandidateCount: number;
  readonly coveredCandidateCount: number;
  readonly retainedCandidateCount: number;
  readonly failedCandidateCount: number;
  readonly collectedBlockCount: number;
}

const requireRetentionCount = (value: number): number => {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError("retainNewestDeletedBlocks must be a non-negative integer");
};

const requireEpoch = (value: string): string => {
  if (value.length > 0 && value === value.trim()) return value;
  throw new TypeError("storeEpoch must be non-empty");
};

/**
 * Run one bounded retention pass for every Project on the writer connection.
 * A failed/corrupt Project fails closed without preventing independent
 * Projects from being maintained. The epoch fence rejects work queued before
 * a whole-store restore.
 */
export const maintainStoreBlockRetention = (
  database: Database.Database,
  input: MaintainStoreBlockRetentionInput,
): MaintainStoreBlockRetentionResult => {
  const expectedStoreEpoch = requireEpoch(input.storeEpoch);
  const currentStoreEpoch = requireBlockStoreEpoch(database);
  if (currentStoreEpoch !== expectedStoreEpoch) {
    throw new Error("Block retention maintenance store epoch changed");
  }
  const retainNewestDeletedBlocks = requireRetentionCount(
    input.retainNewestDeletedBlocks,
  );
  const projectIds = (
    database
      .prepare("SELECT id FROM projects ORDER BY created, id")
      .all() as readonly { readonly id: string }[]
  ).map((row) => row.id);
  const projectResults: StoreBlockRetentionProjectResult[] = projectIds.map(
    (projectId) => {
      try {
        return {
          status: "completed" as const,
          projectId,
          result: maintainBlockRetention(database, {
            projectId,
            policy: { retainNewestDeletedBlocks },
          }),
        };
      } catch (error) {
        return {
          status: "failed" as const,
          projectId,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
  let collectedCandidateCount = 0;
  let coveredCandidateCount = 0;
  let retainedCandidateCount = 0;
  let failedCandidateCount = 0;
  let collectedBlockCount = 0;
  for (const project of projectResults) {
    if (project.status === "failed") {
      failedCandidateCount += 1;
      continue;
    }
    for (const candidate of project.result.candidates) {
      if (candidate.status === "collected") {
        collectedCandidateCount += 1;
        collectedBlockCount += candidate.deletedBlockIds.length;
        continue;
      }
      if (candidate.status === "retained") {
        retainedCandidateCount += 1;
        continue;
      }
      if (candidate.status === "covered") {
        coveredCandidateCount += 1;
        continue;
      }
      failedCandidateCount += 1;
    }
  }
  return {
    storeEpoch: currentStoreEpoch,
    retainNewestDeletedBlocks,
    projectResults,
    collectedCandidateCount,
    coveredCandidateCount,
    retainedCandidateCount,
    failedCandidateCount,
    collectedBlockCount,
  };
};
