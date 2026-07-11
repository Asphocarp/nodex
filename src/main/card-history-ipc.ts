import type { ListCardHistoryRequest } from "../shared/card-history";
import {
  CardHistoryContractError,
  cardHistoryFailure,
  cardHistoryTransportFailure,
  parseListCardHistoryRequest,
  type CardHistoryCommandResult,
} from "../shared/card-history-transport";

export const CARD_HISTORY_LIST_IPC_CHANNEL = "cards:history:list" as const;

export interface CardHistoryIpcDependencies {
  readonly registerHandle: (
    channel: typeof CARD_HISTORY_LIST_IPC_CHANNEL,
    listener: (
      event: unknown,
      rawRequest: unknown,
    ) => Promise<CardHistoryCommandResult>,
  ) => void;
  readonly isTrustedEvent: (event: unknown) => boolean;
  readonly listHistory: (
    request: ListCardHistoryRequest,
  ) => Promise<CardHistoryCommandResult>;
}

const invalidResult = (error: unknown): CardHistoryCommandResult => ({
  ok: false,
  error: cardHistoryFailure(
    "invalid_card_history_request",
    error instanceof CardHistoryContractError
      ? error.message
      : "Card history request is invalid",
  ),
});

export const registerCardHistoryIpcHandler = (
  dependencies: CardHistoryIpcDependencies,
): void => {
  dependencies.registerHandle(
    CARD_HISTORY_LIST_IPC_CHANNEL,
    async (event, rawRequest) => {
      if (!dependencies.isTrustedEvent(event)) {
        return invalidResult("Card history requires a trusted window");
      }
      try {
        const request = parseListCardHistoryRequest(rawRequest);
        return await dependencies
          .listHistory(request)
          .catch(cardHistoryTransportFailure);
      } catch (error) {
        return invalidResult(error);
      }
    },
  );
};
