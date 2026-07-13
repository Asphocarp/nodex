import {
  type CardDetailCommandResult,
  type CardDetailReadError,
} from "../shared/card-detail";
import {
  CardDetailStoreError,
  readCardDetail,
} from "./local-store/card-detail";

const failure = (error: CardDetailReadError): CardDetailCommandResult => ({
  ok: false,
  error,
});

const boundedMessage = (value: unknown, fallback: string): string => {
  const message = value instanceof Error ? value.message : String(value ?? "");
  return message.trim().slice(0, 512) || fallback;
};

export const readCardDetailCommand = (
  projectId: string,
  cardBlockId: string,
): CardDetailCommandResult => {
  try {
    const detail = readCardDetail(projectId, cardBlockId);
    if (detail) return { ok: true, value: detail };
    return failure({
      code: "card_not_found",
      message: "Card does not exist in the requested Project",
      retryable: false,
    });
  } catch (error) {
    if (error instanceof CardDetailStoreError) {
      return failure({
        code: error.code,
        message: boundedMessage(error, "Card Detail is invalid"),
        retryable: false,
      });
    }
    return failure({
      code: "unknown",
      message: boundedMessage(error, "Card Detail is temporarily unavailable"),
      retryable: true,
    });
  }
};
