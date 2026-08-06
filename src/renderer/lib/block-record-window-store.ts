import type {
  BlockRecordApplyInput,
  BlockRecordCommittedValue,
  BlockRecordRead,
} from "../../shared/core-modules/block-record-module";
import {
  applyLocalCommitToBlockRecordWindow,
  blockRecordCommitToLocalCommit,
  blockRecordSnapshotToWindow,
  type BlockRecordWindow,
  type BlockRecordWindowCommitResult,
} from "../../shared/block-records";
import type { LocalCommitEnvelope } from "../../shared/local-commit";
import {
  applyBlockRecord,
  readBlockRecord,
  subscribeBlockRecordCommits,
} from "./api";

export interface BlockRecordWindowStore {
  getSnapshot(): BlockRecordWindow | null;
  read(read: BlockRecordRead): Promise<BlockRecordWindow>;
  load(read: BlockRecordRead): Promise<BlockRecordWindow>;
  apply(input: BlockRecordApplyInput): Promise<BlockRecordCommittedValue>;
  applyCommit(envelope: LocalCommitEnvelope): BlockRecordWindowCommitResult | null;
  subscribe(listener: (window: BlockRecordWindow) => void): () => void;
  startCommitSubscription(): () => void;
}

const isAtLeastCursor = (
  candidate: BlockRecordWindow["observedLocalCommit"],
  floor: LocalCommitEnvelope["cursor"],
): boolean => candidate.storeEpoch === floor.storeEpoch
  && candidate.commitSeq >= floor.commitSeq;

const doesNotRegress = (
  candidate: BlockRecordWindow["observedLocalCommit"],
  current: BlockRecordWindow["observedLocalCommit"] | undefined,
): boolean => !current
  || candidate.storeEpoch !== current.storeEpoch
  || candidate.commitSeq >= current.commitSeq;

export const createBlockRecordWindowStore = (): BlockRecordWindowStore => {
  let snapshot: BlockRecordWindow | null = null;
  let lastRead: BlockRecordRead | null = null;
  const listeners = new Set<(window: BlockRecordWindow) => void>();
  let stopCommitSubscription: (() => void) | null = null;

  const publish = (next: BlockRecordWindow): void => {
    snapshot = next;
    for (const listener of listeners) listener(next);
  };

  const rereadAfterProjectionGap = (minimum: LocalCommitEnvelope["cursor"]): void => {
    const read = lastRead;
    if (!read) return;
    void readBlockRecord(read)
      .then((next) => {
        const projected = blockRecordSnapshotToWindow(next, read);
        if (!isAtLeastCursor(projected.observedLocalCommit, minimum)) return;
        if (!doesNotRegress(projected.observedLocalCommit, snapshot?.observedLocalCommit)) {
          return;
        }
        publish(projected);
      })
      .catch(() => {
        // The canonical read remains the recovery path. A transient read
        // failure must not roll back the already admitted LocalCommit.
      });
  };

  const readWindow = async (read: BlockRecordRead): Promise<BlockRecordWindow> =>
    blockRecordSnapshotToWindow(await readBlockRecord(read), read);

  return {
    getSnapshot: () => snapshot,
    read: readWindow,
    load: async (read) => {
      const next = await readWindow(read);
      const sameRead = lastRead !== null
        && JSON.stringify(lastRead) === JSON.stringify(read);
      if (
        sameRead
        && snapshot
        && !doesNotRegress(next.observedLocalCommit, snapshot.observedLocalCommit)
      ) {
        return snapshot;
      }
      lastRead = read;
      publish(next);
      return next;
    },
    apply: async (input) => {
      const committed = await applyBlockRecord(input);
      const envelope = blockRecordCommitToLocalCommit(committed);
      const result = snapshot ? applyLocalCommitToBlockRecordWindow(snapshot, envelope) : null;
      if (result?.kind === "applied") publish(result.window);
      if (result?.kind === "requires_read") rereadAfterProjectionGap(envelope.cursor);
      return committed;
    },
    applyCommit: (envelope) => {
      if (!snapshot) return null;
      const result = applyLocalCommitToBlockRecordWindow(snapshot, envelope);
      if (result.kind === "applied") publish(result.window);
      if (result.kind === "requires_read") rereadAfterProjectionGap(envelope.cursor);
      return result;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    startCommitSubscription: () => {
      stopCommitSubscription?.();
      stopCommitSubscription = subscribeBlockRecordCommits((envelope) => {
        const result = snapshot
          ? applyLocalCommitToBlockRecordWindow(snapshot, envelope)
          : null;
        if (result?.kind === "applied") publish(result.window);
        if (result?.kind === "requires_read") rereadAfterProjectionGap(envelope.cursor);
      });
      return () => {
        stopCommitSubscription?.();
        stopCommitSubscription = null;
      };
    },
  };
};
