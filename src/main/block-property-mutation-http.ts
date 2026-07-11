import { bodyLimit } from "hono/body-limit";
import type { Hono } from "hono";
import type {
  BlockPropertyMutationCommandResult,
  BlockPropertyMutationRequest,
} from "../shared/block-property-mutations";
import {
  bindTrustedBlockPropertyMutation,
  blockPropertyMutationFailure,
  blockPropertyMutationHttpStatus,
} from "../shared/block-property-mutation-transport";

const MAX_BLOCK_PROPERTY_MUTATION_HTTP_BYTES = 2_100_000;
const HTTP_CLIENT_SESSION_ID = "http-loopback";

export interface BlockPropertyMutationHttpDependencies {
  readonly applyMutation: (
    request: BlockPropertyMutationRequest,
  ) => Promise<BlockPropertyMutationCommandResult>;
}

const invalidJsonResult = (): BlockPropertyMutationCommandResult => ({
  ok: false,
  error: blockPropertyMutationFailure(
    "invalid_property_mutation_request",
    "Block property mutation body must be valid JSON",
  ),
});

export const registerBlockPropertyMutationHttpRoute = (
  app: Hono,
  dependencies: BlockPropertyMutationHttpDependencies,
): void => {
  app.post(
    "/api/projects/:projectId/block-property-mutations",
    bodyLimit({
      maxSize: MAX_BLOCK_PROPERTY_MUTATION_HTTP_BYTES,
      onError: (context) =>
        context.json(
          {
            ok: false,
            error: blockPropertyMutationFailure(
              "invalid_property_mutation_request",
              "Block property mutation body is too large",
            ),
          } satisfies BlockPropertyMutationCommandResult,
          400,
        ),
    }),
    async (context) => {
      const projectId = context.req.param("projectId").trim();
      const rawRequest = await context.req.json().catch(() => null);
      if (rawRequest === null) {
        context.header("Cache-Control", "no-store");
        return context.json(invalidJsonResult(), 400);
      }

      const bound = bindTrustedBlockPropertyMutation(rawRequest, projectId, {
        actor: {
          kind: "http_loopback",
          transport: "json",
        },
        clientSessionId: HTTP_CLIENT_SESSION_ID,
      });
      if (!bound.ok) {
        context.header("Cache-Control", "no-store");
        return context.json(
          bound,
          blockPropertyMutationHttpStatus(bound.error),
        );
      }

      let result: BlockPropertyMutationCommandResult;
      try {
        result = await dependencies.applyMutation(bound.value);
      } catch (error) {
        result = {
          ok: false,
          error: blockPropertyMutationFailure(
            "unknown",
            error instanceof Error
              ? error.message
              : "The durable Block property writer is unavailable",
            {
              mutationId: bound.value.mutationId,
              retryable: true,
            },
          ),
        };
      }

      context.header("Cache-Control", "no-store");
      if (result.ok) return context.json(result);
      return context.json(
        result,
        blockPropertyMutationHttpStatus(result.error),
      );
    },
  );
};
