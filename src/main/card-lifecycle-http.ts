import { bodyLimit } from "hono/body-limit";
import type { Hono } from "hono";
import type {
  CardLifecycleMutationCommandResult,
  CardLifecycleMutationRequest,
} from "../shared/card-lifecycle";
import {
  bindTrustedCardLifecycleMutation,
  cardLifecycleMutationFailure,
  cardLifecycleMutationHttpStatus,
  cardLifecycleTransportFailure,
} from "../shared/card-lifecycle-transport";
import type { CardLifecyclePreflightResult } from "../shared/card-lifecycle-runtime";

const MAX_CARD_LIFECYCLE_HTTP_BYTES = 2_100_000;

export interface CardLifecycleHttpDependencies {
  readonly applyMutation: (
    request: CardLifecycleMutationRequest,
  ) => Promise<CardLifecycleMutationCommandResult>;
}

export const registerCardLifecycleHttpRoute = (
  app: Hono,
  dependencies: CardLifecycleHttpDependencies,
): void => {
  app.post(
    "/api/projects/:projectId/card-lifecycle-mutations",
    bodyLimit({
      maxSize: MAX_CARD_LIFECYCLE_HTTP_BYTES,
      onError: (context) =>
        context.json(
          {
            ok: false,
            error: cardLifecycleMutationFailure(
              "invalid_card_lifecycle_request",
              "Card lifecycle mutation body is too large",
            ),
          } satisfies CardLifecycleMutationCommandResult,
          400,
        ),
    }),
    async (context) => {
      context.header("Cache-Control", "no-store");
      const rawRequest = await context.req.json().catch(() => null);
      if (rawRequest === null) {
        const result: CardLifecycleMutationCommandResult = {
          ok: false,
          error: cardLifecycleMutationFailure(
            "invalid_card_lifecycle_request",
            "Card lifecycle mutation body must be valid JSON",
          ),
        };
        return context.json(result, 400);
      }
      const bound = bindTrustedCardLifecycleMutation(
        rawRequest,
        context.req.param("projectId"),
        { actor: { kind: "http_loopback" } },
      );
      if (!bound.ok) {
        return context.json(
          bound,
          cardLifecycleMutationHttpStatus(bound.error),
        );
      }
      let result: CardLifecycleMutationCommandResult;
      try {
        result = await dependencies.applyMutation(bound.value);
      } catch (error) {
        result = cardLifecycleTransportFailure(bound.value, error);
      }
      return context.json(
        result,
        result.ok ? 200 : cardLifecycleMutationHttpStatus(result.error),
      );
    },
  );
};

export interface CardLifecyclePreflightHttpDependencies {
  readonly readPreflight: (
    projectId: string,
    cardId: string,
  ) => Promise<CardLifecyclePreflightResult>;
}

export const registerCardLifecyclePreflightHttpRoute = (
  app: Hono,
  dependencies: CardLifecyclePreflightHttpDependencies,
): void => {
  app.get(
    "/api/projects/:projectId/card-lifecycle-preflight",
    async (context) => {
      context.header("Cache-Control", "no-store");
      const cardId = context.req.query("cardId") ?? "";
      const result = await dependencies.readPreflight(
        context.req.param("projectId"),
        cardId,
      );
      const status = result.ok
        ? 200
        : result.error.code === "project_not_found"
          ? 404
          : result.error.code === "unknown"
            ? 500
            : 400;
      return context.json(result, status);
    },
  );
};
