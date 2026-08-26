import { useCallback, useEffect, useEffectEvent, useState } from "react";
import type {
  BackupCapacity,
  BackupJobStatus,
  BackupRecord,
  SnapshotStorageOptimization,
} from "../../shared/types";
import { resolveFormErrorMessage } from "./forms";
import { projectBackupJob } from "./backup-job-presentation";

type BackupInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

export interface StoreBackupRuntimeNotice {
  readonly message: string;
  readonly tone: "error" | "status";
}

export interface UseStoreBackupRuntimeInput {
  readonly invoke: BackupInvoke;
  readonly open: boolean;
}

/** Owns snapshot inventory, durable job convergence, cancellation, and polling. */
export function useStoreBackupRuntime({ invoke, open }: UseStoreBackupRuntimeInput) {
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [capacity, setCapacity] = useState<BackupCapacity | null>(null);
  const [storageOptimization, setStorageOptimization] =
    useState<SnapshotStorageOptimization | null>(null);
  const [job, setJob] = useState<BackupJobStatus | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [notice, setNotice] = useState<StoreBackupRuntimeNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);

  const reloadInventory = useCallback(async () => {
    const [records, nextCapacity] = await Promise.all([
      invoke("backup:list") as Promise<BackupRecord[]>,
      invoke("backup:capacity:get") as Promise<BackupCapacity>,
    ]);
    setBackups(Array.isArray(records) ? records : []);
    setCapacity(nextCapacity);
  }, [invoke]);

  const reloadStorageOptimization = useCallback(async () => {
    const next = (await invoke("backup:storage-optimization:get")) as SnapshotStorageOptimization;
    setStorageOptimization(next);
  }, [invoke]);

  const reloadJob = useCallback(async () => {
    setJob((await invoke("backup:job:get")) as BackupJobStatus | null);
  }, [invoke]);

  const refresh = useCallback(async () => {
    setNotice(null);
    await Promise.all([reloadInventory(), reloadStorageOptimization(), reloadJob()]);
  }, [reloadInventory, reloadJob, reloadStorageOptimization]);

  const settleJob = useEffectEvent(async (settled: BackupJobStatus) => {
    if (settled.state === "completed") {
      await reloadInventory();
      setNotice({ message: "Manual snapshot created.", tone: "status" });
      return;
    }
    if (settled.state === "failed") {
      setNotice({ message: settled.error ?? "Could not create snapshot.", tone: "error" });
      return;
    }
    if (settled.state === "cancelled") {
      setNotice({ message: "Snapshot cancelled before publication.", tone: "status" });
    }
  });

  const presentation = job ? projectBackupJob(job) : null;
  const activeJobId = presentation?.active ? job?.jobId : null;
  useEffect(() => {
    if (!open || !activeJobId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = (await invoke("backup:job:get", activeJobId)) as BackupJobStatus | null;
        if (disposed) return;
        if (!next) {
          timer = setTimeout(poll, 250);
          return;
        }
        setNotice(null);
        setJob(next);
        if (projectBackupJob(next).active) {
          timer = setTimeout(poll, 250);
          return;
        }
        await settleJob(next);
      } catch (cause) {
        if (disposed) return;
        setNotice({
          message: resolveFormErrorMessage(cause) ?? "Could not read snapshot progress.",
          tone: "error",
        });
        timer = setTimeout(poll, 1_000);
      }
    };
    timer = setTimeout(poll, 250);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeJobId, invoke, open]);

  useEffect(() => {
    if (!open || !storageOptimization?.optimizing) return;
    const timer = setInterval(() => void reloadStorageOptimization(), 2_000);
    return () => clearInterval(timer);
  }, [open, reloadStorageOptimization, storageOptimization?.optimizing]);

  useEffect(() => {
    if (open) return;
    setNotice(null);
  }, [open]);

  const cancelJob = useCallback(async () => {
    if (!job || !projectBackupJob(job).cancellable) return;
    setCancelPending(true);
    setNotice(null);
    try {
      const cancelled = (await invoke("backup:cancel", job.jobId)) as BackupJobStatus;
      setJob(cancelled);
      if (cancelled.state === "cancelled") {
        setNotice({ message: "Snapshot cancelled before publication.", tone: "status" });
      }
    } catch (cause) {
      setNotice({
        message: resolveFormErrorMessage(cause) ?? "Could not cancel snapshot.",
        tone: "error",
      });
    } finally {
      setCancelPending(false);
    }
  }, [invoke, job]);

  return {
    backups,
    cancelJob,
    cancelPending,
    capacity,
    clearNotice,
    installJob: setJob,
    job,
    notice,
    presentation,
    refresh,
    reloadInventory,
    storageOptimization,
  } as const;
}
