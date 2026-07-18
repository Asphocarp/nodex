import { bodyLimit } from "hono/body-limit";
import type { Hono } from "hono";
import type {
  BlockPropertyMutationCommandResultV2,
  BlockPropertyMutationRequestV2,
  LibraryBlockPropertyMutationCommandResultV2,
  LibraryBlockPropertyMutationRequestV2,
} from "../shared/block-property-mutations-v2";
import {
  bindTrustedBlockPropertyMutationV2,
  bindTrustedLibraryBlockPropertyMutationV2,
  blockPropertyMutationFailureV2,
  blockPropertyMutationHttpStatusV2,
  blockPropertyMutationTransportFailureV2,
  libraryBlockPropertyMutationTransportFailureV2,
} from "../shared/block-property-mutation-v2-transport";

const MAX_BLOCK_PROPERTY_MUTATION_HTTP_BYTES = 2_100_000;
const HTTP_CLIENT_SESSION_ID = "http-loopback";

export interface BlockPropertyMutationHttpDependencies {
  readonly applyMutation: (
    request: BlockPropertyMutationRequestV2,
  ) => Promise<BlockPropertyMutationCommandResultV2>;
}

const invalidJsonResult = (): BlockPropertyMutationCommandResultV2 => ({
  ok: false,
  error: blockPropertyMutationFailureV2(
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
            error: blockPropertyMutationFailureV2(
              "invalid_property_mutation_request",
              "Block property mutation body is too large",
            ),
          } satisfies BlockPropertyMutationCommandResultV2,
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

      const bound = bindTrustedBlockPropertyMutationV2(rawRequest, projectId, {
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
          blockPropertyMutationHttpStatusV2(bound.error),
        );
      }

      let result: BlockPropertyMutationCommandResultV2;
      try {
        result = await dependencies.applyMutation(bound.value);
      } catch (error) {
        result = blockPropertyMutationTransportFailureV2(bound.value, error);
      }

      context.header("Cache-Control", "no-store");
      if (result.ok) return context.json(result);
      return context.json(
        result,
        blockPropertyMutationHttpStatusV2(result.error),
      );
    },
  );
};

export interface LibraryBlockPropertyMutationHttpDependencies {
  readonly applyMutation: (input: {
    readonly request: LibraryBlockPropertyMutationRequestV2;
    readonly actor: BlockPropertyMutationRequestV2["actor"];
    readonly accessActor: "http_loopback";
  }) => Promise<LibraryBlockPropertyMutationCommandResultV2>;
}

export const registerLibraryBlockPropertyMutationHttpRoute = (
  app: Hono,
  dependencies: LibraryBlockPropertyMutationHttpDependencies,
): void => {
  app.post(
    "/api/library/block-property-mutations",
    bodyLimit({
      maxSize: MAX_BLOCK_PROPERTY_MUTATION_HTTP_BYTES,
      onError: (context) =>
        context.json(
          {
            ok: false,
            error: blockPropertyMutationFailureV2(
              "invalid_property_mutation_request",
              "Library Block property mutation body is too large",
            ),
          } satisfies LibraryBlockPropertyMutationCommandResultV2,
          400,
        ),
    }),
    async (context) => {
      const rawRequest = await context.req.json().catch(() => null);
      if (rawRequest === null) {
        context.header("Cache-Control", "no-store");
        return context.json(invalidJsonResult(), 400);
      }

      const bound = bindTrustedLibraryBlockPropertyMutationV2(rawRequest, {
        actor: { kind: "http_loopback", transport: "json" },
        clientSessionId: HTTP_CLIENT_SESSION_ID,
      });
      if (!bound.ok) {
        context.header("Cache-Control", "no-store");
        return context.json(
          bound,
          blockPropertyMutationHttpStatusV2(bound.error),
        );
      }

      let result: LibraryBlockPropertyMutationCommandResultV2;
      try {
        result = await dependencies.applyMutation({
          request: bound.value,
          actor: bound.actor,
          accessActor: "http_loopback",
        });
      } catch (error) {
        result = libraryBlockPropertyMutationTransportFailureV2(
          bound.value,
          error,
        );
      }

      context.header("Cache-Control", "no-store");
      if (result.ok) return context.json(result);
      return context.json(
        result,
        blockPropertyMutationHttpStatusV2(result.error),
      );
    },
  );
};
