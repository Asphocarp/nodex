import type { BlockDocumentCompactionScheduler } from "./block-document-compaction-scheduler";

export interface BlockDocumentCompactionRuntime {
  /** Returns true only for the one transition that starts the scheduler. */
  readonly start: () => boolean;
  readonly dispose: () => void;
  readonly isRunning: () => boolean;
}

/** Own the scheduler as a single main-runtime resource. */
export const createBlockDocumentCompactionRuntime = (
  startScheduler: () => BlockDocumentCompactionScheduler,
): BlockDocumentCompactionRuntime => {
  let state: "idle" | "running" | "disposed" = "idle";
  let scheduler: BlockDocumentCompactionScheduler | null = null;

  return {
    start: () => {
      if (state !== "idle") return false;
      scheduler = startScheduler();
      state = "running";
      return true;
    },
    dispose: () => {
      if (state === "disposed") return;
      state = "disposed";
      scheduler?.dispose();
      scheduler = null;
    },
    isRunning: () => state === "running",
  };
};
