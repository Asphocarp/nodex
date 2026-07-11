import { bodyLimit } from "hono/body-limit";
import type { Hono } from "hono";
import type {
  CardProjectTransferCommandResult,
  CardProjectTransferIntent,
} from "../shared/card-project-transfer";
import {
  bindCardProjectTransferIntent,
  cardProjectTransferFailure,
  cardProjectTransferHttpStatus,
  cardProjectTransferTransportFailure,
} from "../shared/card-project-transfer-transport";

const MAX_CARD_PROJECT_TRANSFER_BYTES = 64 * 1024;

export interface CardProjectTransferHttpDependencies {
  readonly transfer: (
    intent: CardProjectTransferIntent,
  ) => Promise<CardProjectTransferCommandResult>;
}

export const registerCardProjectTransferHttpRoute = (
  app: Hono,
  dependencies: CardProjectTransferHttpDependencies,
): void => {
  app.post(
    "/api/projects/:sourceProjectId/card-transfers",
    bodyLimit({
      maxSize: MAX_CARD_PROJECT_TRANSFER_BYTES,
      onError: (context) =>
        context.json(
          {
            ok: false,
            error: cardProjectTransferFailure(
              "invalid_card_project_transfer_request",
              "Card Project transfer body is too large",
            ),
          } satisfies CardProjectTransferCommandResult,
          400,
        ),
    }),
    async (context) => {
      context.header("Cache-Control", "no-store");
      const rawIntent = await context.req.json().catch(() => null);
      if (rawIntent === null) {
        return context.json(
          {
            ok: false,
            error: cardProjectTransferFailure(
              "invalid_card_project_transfer_request",
              "Card Project transfer body must be valid JSON",
            ),
          } satisfies CardProjectTransferCommandResult,
          400,
        );
      }
      const bound = bindCardProjectTransferIntent(
        rawIntent,
        context.req.param("sourceProjectId"),
        {
          clientSessionId: "http-loopback:card-project-transfer",
          actor: { kind: "http_loopback", transport: "json" },
        },
      );
      if (!bound.ok) {
        return context.json(
          bound,
          cardProjectTransferHttpStatus(bound.error),
        );
      }

      let result: CardProjectTransferCommandResult;
      try {
        result = await dependencies.transfer(bound.value);
      } catch (error) {
        result = cardProjectTransferTransportFailure(bound.value, error);
      }
      return context.json(
        result,
        result.ok ? 200 : cardProjectTransferHttpStatus(result.error),
      );
    },
  );
};
