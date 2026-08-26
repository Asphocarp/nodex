import { describe, expect, test } from "vite-plus/test";
import type { BackupJobStatus } from "../../shared/types";
import { projectBackupJob } from "./backup-job-presentation";

const job = (overrides: Partial<BackupJobStatus> = {}): BackupJobStatus => ({
  jobId: "job-1",
  state: "running",
  phase: "database_snapshot",
  completedUnits: 1,
  totalUnits: 7,
  startedAt: 1,
  updatedAt: 2,
  backup: null,
  error: null,
  progress: {
    databaseCopiedPages: 25,
    databaseTotalPages: 100,
    databaseBusyRetries: 0,
    assetBytesCopied: 0,
    databaseCopyMs: 0,
    assetCopyMs: 0,
    validationMs: 0,
    digestMs: 0,
    publishMs: 0,
    writerHeldMs: 0,
  },
  ...overrides,
});

describe("projectBackupJob", () => {
  test("projects durable database progress into the bounded snapshot meter", () => {
    expect(projectBackupJob(job())).toMatchObject({
      active: true,
      cancellable: true,
      phaseLabel: "Copying database",
      progressTotal: 7,
      progressUnits: 1.25,
    });
  });

  test.each(["commit", "publishing"] as const)(
    "closes cancellation when the job reaches %s",
    (phase) => {
      expect(projectBackupJob(job({ phase })).cancellable).toBe(false);
    },
  );
});
