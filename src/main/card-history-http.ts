import type { Context, Hono } from "hono";
import type { CardHistoryCursor, ListCardHistoryRequest } from "../shared/card-history";
import {
  CardHistoryContractError,
  cardHistoryFailure,
  cardHistoryHttpStatus,
  cardHistoryTransportFailure,
  parseListCardHistoryRequest,
  type CardHistoryCommandResult,
} from "../shared/card-history-transport";

export interface CardHistoryHttpDependencies {
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

const respond = (context: Context, result: CardHistoryCommandResult) => {
  context.header("Cache-Control", "no-store");
  return context.json(result, cardHistoryHttpStatus(result));
};

const readCursor = (context: Context): CardHistoryCursor | undefined => {
  const source = context.req.query("beforeSource");
  const occurredAt = context.req.query("beforeOccurredAt");
  const versionId = context.req.query("beforeVersionId");
  const changeSeq = context.req.query("beforeChangeSeq");
  const hasAny =
    source !== undefined ||
    occurredAt !== undefined ||
    versionId !== undefined ||
    changeSeq !== undefined;
  if (!hasAny) return undefined;
  if (
    source === "document_version" &&
    occurredAt !== undefined &&
    versionId !== undefined &&
    changeSeq === undefined
  ) {
    return { source, occurredAt, versionId };
  }
  if (
    source === "change_log" &&
    occurredAt !== undefined &&
    changeSeq !== undefined &&
    versionId === undefined
  ) {
    return { source, occurredAt, changeSeq: Number(changeSeq) };
  }
  throw new CardHistoryContractError(
    "Card history cursor query must be complete and source-specific",
  );
};

export const registerCardHistoryHttpRoute = (
  app: Hono,
  dependencies: CardHistoryHttpDependencies,
): void => {
  app.get(
    "/api/projects/:projectId/cards/:cardBlockId/history",
    async (context) => {
      try {
        const pageSize = context.req.query("pageSize");
        const before = readCursor(context);
        const request = parseListCardHistoryRequest({
          version: 1,
          projectId: context.req.param("projectId").trim(),
          cardBlockId: context.req.param("cardBlockId").trim(),
          ...(pageSize === undefined ? {} : { pageSize: Number(pageSize) }),
          ...(before === undefined ? {} : { before }),
        });
        return respond(
          context,
          await dependencies
            .listHistory(request)
            .catch(cardHistoryTransportFailure),
        );
      } catch (error) {
        return respond(context, invalidResult(error));
      }
    },
  );
};
