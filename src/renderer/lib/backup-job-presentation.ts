import type { BackupJobPhase, BackupJobStatus } from "../../shared/types";

export interface BackupJobPresentation {
  readonly active: boolean;
  readonly cancellable: boolean;
  readonly phaseLabel: string;
  readonly progressTotal: number;
  readonly progressUnits: number;
}

const backupJobPhaseLabel = (phase: BackupJobPhase): string => {
  switch (phase) {
    case "queued":
      return "Queued";
    case "preparing":
      return "Preparing snapshot";
    case "cancellation_requested":
      return "Cancelling snapshot";
    case "cancelled":
      return "Snapshot cancelled";
    case "database_snapshot":
      return "Copying database";
    case "asset_copy":
      return "Copying assets";
    case "validation":
      return "Checking database integrity";
    case "digest":
      return "Sealing integrity evidence";
    case "commit":
      return "Recording snapshot";
    case "publishing":
      return "Publishing snapshot";
    case "ready":
      return "Snapshot ready";
    case "failed":
      return "Snapshot failed";
  }
};

export function projectBackupJob(job: BackupJobStatus): BackupJobPresentation {
  const active = job.state === "queued" || job.state === "running";
  const progressUnits =
    job.phase === "database_snapshot" && job.progress.databaseTotalPages > 0
      ? job.completedUnits + job.progress.databaseCopiedPages / job.progress.databaseTotalPages
      : job.completedUnits;

  return {
    active,
    cancellable: active && job.phase !== "commit" && job.phase !== "publishing",
    phaseLabel: backupJobPhaseLabel(job.phase),
    progressTotal: Math.max(1, job.totalUnits),
    progressUnits,
  };
}
