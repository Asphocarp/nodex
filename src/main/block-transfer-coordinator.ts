import {
  blockTransferIntentFromRequest,
  canonicalizeBlockTransferLogicalIntent,
  parseBlockTransferIntent,
  type BlockTransferCommandError,
  type BlockTransferCommandResult,
  type BlockTransferDocumentHead,
  type BlockTransferIntent,
  type BlockTransferPreparation,
  type BlockTransferReceipt,
  type BlockTransferRequest,
} from "../shared/block-transfer";
import type { DocumentRelocationLeaseCoordinator } from "./document-relocation-lease-coordinator";

export interface BlockTransferDurableBackend {
  lookupCommittedBlockTransfer?(
    intent: BlockTransferIntent,
  ): Promise<BlockTransferCommandResult<BlockTransferReceipt | null>>;
  prepareBlockTransfer?(
    intent: BlockTransferIntent,
  ): Promise<BlockTransferCommandResult<BlockTransferPreparation>>;
  applyBlockTransfer?(
    request: BlockTransferRequest,
  ): Promise<BlockTransferCommandResult>;
}

export interface BlockTransferCoordinationHost {
  readonly backend: BlockTransferDurableBackend;
  readonly leaseCoordinator: DocumentRelocationLeaseCoordinator;
  createLeaseId(): string;
  setLeaseBoundary(
    leaseId: string,
    storeEpoch: string,
    heads: readonly BlockTransferDocumentHead[],
  ): void;
  setResultBoundary(
    leaseId: string,
    storeEpoch: string,
    leasedHeads: readonly BlockTransferDocumentHead[],
    receipt: BlockTransferReceipt,
  ): void;
  clearLeaseBoundary(leaseId: string): void;
  fanoutResult(receipt: BlockTransferReceipt): void;
  fanoutResync(receipt: BlockTransferReceipt): void;
  publishReleaseFallback(
    leaseId: string,
    storeEpoch: string,
    leasedHeads: readonly BlockTransferDocumentHead[],
    receipt: BlockTransferReceipt,
  ): void;
}

const failure = <Value>(
  intent: Pick<BlockTransferIntent, "operationId"> | null,
  code: BlockTransferCommandError["code"],
  message: string,
  options: {
    readonly retryable?: boolean;
    readonly reloadRequired?: boolean;
  } = {},
): BlockTransferCommandResult<Value> => ({
  ok: false,
  error: {
    code,
    message,
    retryable: options.retryable ?? false,
    reloadRequired: options.reloadRequired ?? false,
    ...(intent ? { operationId: intent.operationId } : {}),
  },
});

const preparationMatchesIntent = (
  intent: BlockTransferIntent,
  preparation: BlockTransferPreparation,
): boolean => {
  try {
    return canonicalizeBlockTransferLogicalIntent(intent) ===
      canonicalizeBlockTransferLogicalIntent(
        blockTransferIntentFromRequest(preparation.request),
      );
  } catch {
    return false;
  }
};

const sameDocumentClosure = (
  left: readonly BlockTransferDocumentHead[],
  right: readonly BlockTransferDocumentHead[],
): boolean =>
  left.length === right.length &&
  left.every(
    (head, index) => head.documentId === right[index]?.documentId,
  );

export const coordinateBlockTransfer = async (
  rawIntent: BlockTransferIntent,
  host: BlockTransferCoordinationHost,
): Promise<BlockTransferCommandResult> => {
  let intent: BlockTransferIntent;
  try {
    intent = parseBlockTransferIntent(rawIntent);
  } catch (error) {
    return failure(
      null,
      "invalid_transfer_request",
      error instanceof Error ? error.message : String(error),
    );
  }
  const lookup = host.backend.lookupCommittedBlockTransfer;
  const prepare = host.backend.prepareBlockTransfer;
  const apply = host.backend.applyBlockTransfer;
  if (!lookup || !prepare || !apply) {
    return failure(
      intent,
      "unknown",
      "The durable Block transfer writer is unavailable",
      { retryable: true },
    );
  }

  let committed;
  try {
    committed = await lookup(intent);
  } catch {
    return failure(intent, "unknown", "Block transfer receipt lookup failed", {
      retryable: true,
    });
  }
  if (!committed.ok) return committed;
  if (committed.value) {
    host.fanoutResync(committed.value);
    return { ok: true, value: committed.value };
  }

  let initial;
  try {
    initial = await prepare(intent);
  } catch {
    return failure(intent, "unknown", "Block transfer preparation failed", {
      retryable: true,
    });
  }
  if (!initial.ok) return initial;
  if (!preparationMatchesIntent(intent, initial.value)) {
    return failure(
      intent,
      "invalid_transfer_request",
      "The durable writer prepared a different Block transfer intent",
    );
  }

  if (initial.value.leaseDocuments.length === 0) {
    let directResult: BlockTransferCommandResult;
    try {
      directResult = await apply(initial.value.request);
    } catch {
      return failure(intent, "unknown", "Block transfer commit failed", {
        retryable: true,
      });
    }
    if (!directResult.ok) return directResult;
    host.fanoutResult(directResult.value);
    return directResult;
  }

  const leaseId = host.createLeaseId();
  host.setLeaseBoundary(
    leaseId,
    intent.storeEpoch,
    initial.value.leaseDocuments,
  );
  let preparedLease;
  try {
    preparedLease = await host.leaseCoordinator.prepare({
      leaseId,
      documents: initial.value.leaseDocuments,
    });
  } catch {
    host.leaseCoordinator.cancel(leaseId);
    host.clearLeaseBoundary(leaseId);
    return failure(
      intent,
      "transfer_lease_timeout",
      "Block transfer write lease preparation failed",
      { retryable: true },
    );
  }
  if (!preparedLease.ok) {
    host.clearLeaseBoundary(leaseId);
    return failure(
      intent,
      preparedLease.error.code === "invalid_request" ||
          preparedLease.error.code === "lease_id_collision"
        ? "invalid_transfer_request"
        : "transfer_lease_timeout",
      preparedLease.error.message,
      {
        retryable:
          preparedLease.error.code !== "invalid_request" &&
          preparedLease.error.code !== "lease_id_collision",
      },
    );
  }

  let flushed;
  try {
    flushed = await prepare(intent);
  } catch {
    host.leaseCoordinator.cancel(leaseId);
    host.clearLeaseBoundary(leaseId);
    return failure(
      intent,
      "unknown",
      "Block transfer flush verification failed",
      { retryable: true },
    );
  }
  if (!flushed.ok) {
    host.leaseCoordinator.cancel(leaseId);
    host.clearLeaseBoundary(leaseId);
    return flushed;
  }
  if (!preparationMatchesIntent(intent, flushed.value)) {
    host.leaseCoordinator.cancel(leaseId);
    host.clearLeaseBoundary(leaseId);
    return failure(
      intent,
      "invalid_transfer_request",
      "The flushed preparation changed Block transfer intent",
    );
  }
  const resolvedHeads = new Map(
    preparedLease.value.resolvedHeads.map((head) => [head.documentId, head]),
  );
  const observedEveryHead = flushed.value.leaseDocuments.every((document) => {
    const resolved = resolvedHeads.get(document.documentId);
    return resolved !== undefined &&
      resolved.generation === document.generation &&
      document.expectedHeadSeq >= resolved.headSeq;
  });
  if (
    !sameDocumentClosure(
      initial.value.leaseDocuments,
      flushed.value.leaseDocuments,
    ) ||
    resolvedHeads.size !== flushed.value.leaseDocuments.length ||
    !observedEveryHead
  ) {
    host.leaseCoordinator.cancel(leaseId);
    host.clearLeaseBoundary(leaseId);
    return failure(
      intent,
      "source_head_mismatch",
      "The writer did not observe every leased Document head in the final Block transfer closure",
      { retryable: true, reloadRequired: true },
    );
  }
  host.setLeaseBoundary(
    leaseId,
    intent.storeEpoch,
    flushed.value.leaseDocuments,
  );

  let result: BlockTransferCommandResult;
  try {
    result = await apply(flushed.value.request);
  } catch {
    host.leaseCoordinator.cancel(leaseId);
    host.clearLeaseBoundary(leaseId);
    return failure(intent, "unknown", "Block transfer commit failed", {
      retryable: true,
    });
  }
  if (!result.ok) {
    host.leaseCoordinator.cancel(leaseId);
    host.clearLeaseBoundary(leaseId);
    return result;
  }

  host.setResultBoundary(
    leaseId,
    intent.storeEpoch,
    flushed.value.leaseDocuments,
    result.value,
  );
  try {
    host.fanoutResult(result.value);
  } catch {
    host.fanoutResync(result.value);
  }
  const released = host.leaseCoordinator.release(leaseId);
  if (!released.ok) {
    host.publishReleaseFallback(
      leaseId,
      intent.storeEpoch,
      flushed.value.leaseDocuments,
      result.value,
    );
    host.fanoutResync(result.value);
  }
  host.clearLeaseBoundary(leaseId);
  return result;
};
