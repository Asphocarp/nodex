import type {
  BlockTransferCommandResult,
  BlockTransferIntent,
  BlockTransferUndoCommandResult,
  BlockTransferUndoIntent,
} from "../shared/block-transfer";
import {
  bindBlockTransferIntent,
  bindBlockTransferUndoIntent,
  blockTransferFailure,
  blockTransferTransportFailure,
  type PublicBlockTransferIntent,
  type PublicBlockTransferUndoIntent,
  type TrustedBlockTransferIdentity,
} from "../shared/block-transfer-transport";

export const BLOCK_TRANSFER_IPC_CHANNEL = "blocks:transfer" as const;
export const BLOCK_TRANSFER_UNDO_IPC_CHANNEL = "blocks:transfer:undo" as const;

export type BlockTransferIpcHandler = (
  event: unknown,
  projectId: string,
  intent: PublicBlockTransferIntent,
) => Promise<BlockTransferCommandResult>;

export type BlockTransferUndoIpcHandler = (
  event: unknown,
  projectId: string,
  intent: PublicBlockTransferUndoIntent,
) => Promise<BlockTransferUndoCommandResult>;

export interface BlockTransferIpcDependencies {
  readonly registerHandle: (
    channel: typeof BLOCK_TRANSFER_IPC_CHANNEL,
    listener: BlockTransferIpcHandler,
  ) => void;
  readonly resolveTrustedIdentity: (event: unknown) => TrustedBlockTransferIdentity | null;
  readonly transfer: (intent: BlockTransferIntent) => Promise<BlockTransferCommandResult>;
}

export interface BlockTransferUndoIpcDependencies {
  readonly registerHandle: (
    channel: typeof BLOCK_TRANSFER_UNDO_IPC_CHANNEL,
    listener: BlockTransferUndoIpcHandler,
  ) => void;
  readonly resolveTrustedIdentity: (event: unknown) => unknown | null;
  readonly undo: (intent: BlockTransferUndoIntent) => Promise<BlockTransferUndoCommandResult>;
}

export const registerBlockTransferIpcHandler = (
  dependencies: BlockTransferIpcDependencies,
): void => {
  dependencies.registerHandle(BLOCK_TRANSFER_IPC_CHANNEL, async (event, projectId, rawIntent) => {
    const identity = dependencies.resolveTrustedIdentity(event);
    if (!identity) {
      return {
        ok: false,
        error: blockTransferFailure(
          "invalid_transfer_request",
          "Block transfer is restricted to a trusted application window",
        ),
      };
    }
    const bound = bindBlockTransferIntent(rawIntent, projectId, identity);
    if (!bound.ok) return bound;
    try {
      return await dependencies.transfer(bound.value);
    } catch (error) {
      return blockTransferTransportFailure(bound.value, error);
    }
  });
};

export const registerBlockTransferUndoIpcHandler = (
  dependencies: BlockTransferUndoIpcDependencies,
): void => {
  dependencies.registerHandle(
    BLOCK_TRANSFER_UNDO_IPC_CHANNEL,
    async (event, projectId, rawIntent) => {
      if (!dependencies.resolveTrustedIdentity(event)) {
        return {
          ok: false,
          error: blockTransferFailure(
            "invalid_transfer_request",
            "Block transfer Undo is restricted to a trusted application window",
          ),
        };
      }
      const bound = bindBlockTransferUndoIntent(rawIntent, projectId);
      if (!bound.ok) return bound;
      try {
        return await dependencies.undo(bound.value);
      } catch (error) {
        return {
          ok: false,
          error: blockTransferFailure(
            "unknown",
            error instanceof Error ? error.message : "Block transfer Undo failed",
            { operationId: bound.value.operationId, retryable: true },
          ),
        };
      }
    },
  );
};
