import type {
  CardProjectTransferCommandResult,
  CardProjectTransferIntent,
} from "../shared/card-project-transfer";
import {
  bindCardProjectTransferIntent,
  cardProjectTransferFailure,
  cardProjectTransferTransportFailure,
  type PublicCardProjectTransferIntent,
  type TrustedCardProjectTransferIdentity,
} from "../shared/card-project-transfer-transport";

export const CARD_PROJECT_TRANSFER_IPC_CHANNEL =
  "cards:project-transfer" as const;

export type CardProjectTransferIpcHandler = (
  event: unknown,
  sourceProjectId: string,
  intent: PublicCardProjectTransferIntent,
) => Promise<CardProjectTransferCommandResult>;

export interface CardProjectTransferIpcDependencies {
  readonly registerHandle: (
    channel: typeof CARD_PROJECT_TRANSFER_IPC_CHANNEL,
    listener: CardProjectTransferIpcHandler,
  ) => void;
  readonly resolveTrustedIdentity: (
    event: unknown,
  ) => TrustedCardProjectTransferIdentity | null;
  readonly transfer: (
    intent: CardProjectTransferIntent,
  ) => Promise<CardProjectTransferCommandResult>;
}

export const registerCardProjectTransferIpcHandler = (
  dependencies: CardProjectTransferIpcDependencies,
): void => {
  dependencies.registerHandle(
    CARD_PROJECT_TRANSFER_IPC_CHANNEL,
    async (event, sourceProjectId, rawIntent) => {
      const identity = dependencies.resolveTrustedIdentity(event);
      if (!identity) {
        return {
          ok: false,
          error: cardProjectTransferFailure(
            "invalid_card_project_transfer_request",
            "Card Project transfer is restricted to a trusted application window",
          ),
        };
      }
      const bound = bindCardProjectTransferIntent(
        rawIntent,
        sourceProjectId,
        identity,
      );
      if (!bound.ok) return bound;
      try {
        return await dependencies.transfer(bound.value);
      } catch (error) {
        return cardProjectTransferTransportFailure(bound.value, error);
      }
    },
  );
};
