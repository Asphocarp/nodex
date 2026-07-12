import type {
  BlockTransferCommandResult,
  BlockTransferIntent,
} from "../shared/block-transfer";
import {
  bindBlockTransferIntent,
  blockTransferFailure,
  blockTransferTransportFailure,
  type PublicBlockTransferIntent,
  type TrustedBlockTransferIdentity,
} from "../shared/block-transfer-transport";

export const BLOCK_TRANSFER_IPC_CHANNEL = "blocks:transfer" as const;

export type BlockTransferIpcHandler = (
  event: unknown,
  projectId: string,
  intent: PublicBlockTransferIntent,
) => Promise<BlockTransferCommandResult>;

export interface BlockTransferIpcDependencies {
  readonly registerHandle: (
    channel: typeof BLOCK_TRANSFER_IPC_CHANNEL,
    listener: BlockTransferIpcHandler,
  ) => void;
  readonly resolveTrustedIdentity: (
    event: unknown,
  ) => TrustedBlockTransferIdentity | null;
  readonly transfer: (
    intent: BlockTransferIntent,
  ) => Promise<BlockTransferCommandResult>;
}

export const registerBlockTransferIpcHandler = (
  dependencies: BlockTransferIpcDependencies,
): void => {
  dependencies.registerHandle(
    BLOCK_TRANSFER_IPC_CHANNEL,
    async (event, projectId, rawIntent) => {
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
    },
  );
};
