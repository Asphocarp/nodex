import type {
  AuthorizedDeliveryPacket,
  LocalCommitApply,
} from "../local-commit-delivery";

export const committedLocalCommit = (
  storeEpoch: string,
  commitSeq: number,
  delivery: AuthorizedDeliveryPacket | null = null,
  manifestHash = "f".repeat(64),
): LocalCommitApply => ({
  status: "committed",
  commit: {
    store_epoch: storeEpoch,
    commit_seq: commitSeq,
    manifest_hash: manifestHash,
  },
  delivery,
});

export const noOpLocalCommit = (
  storeEpoch: string,
  commitHead = 0,
): LocalCommitApply => ({
  status: "no_op",
  observed: {
    store_epoch: storeEpoch,
    commit_head: commitHead,
  },
});
