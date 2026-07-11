import type {
  BlockPropertyMutationCommandResult,
  BlockPropertyMutationRequest,
} from "../shared/block-property-mutations";
import {
  bindTrustedBlockPropertyMutation,
  blockPropertyMutationFailure,
  type TrustedBlockPropertyMutationIdentity,
} from "../shared/block-property-mutation-transport";

export const BLOCK_PROPERTY_MUTATION_IPC_CHANNEL =
  "block-properties:mutate" as const;

export type BlockPropertyMutationIpcEvent =
  Parameters<BlockPropertyMutationIpcHandler>[0];

export type BlockPropertyMutationIpcHandler = (
  event: unknown,
  projectId: string,
  request: BlockPropertyMutationRequest,
) => Promise<BlockPropertyMutationCommandResult>;

export interface BlockPropertyMutationIpcDependencies {
  readonly registerHandle: (
    channel: typeof BLOCK_PROPERTY_MUTATION_IPC_CHANNEL,
    listener: BlockPropertyMutationIpcHandler,
  ) => void;
  readonly resolveTrustedIdentity: (
    event: unknown,
  ) => TrustedBlockPropertyMutationIdentity | null;
  readonly applyMutation: (
    request: BlockPropertyMutationRequest,
  ) => Promise<BlockPropertyMutationCommandResult>;
}

const transportFailure = (
  request: BlockPropertyMutationRequest,
  error: unknown,
): BlockPropertyMutationCommandResult => ({
  ok: false,
  error: blockPropertyMutationFailure(
    "unknown",
    error instanceof Error
      ? error.message
      : "The durable Block property writer is unavailable",
    { mutationId: request.mutationId, retryable: true },
  ),
});

export const registerBlockPropertyMutationIpcHandler = (
  dependencies: BlockPropertyMutationIpcDependencies,
): void => {
  dependencies.registerHandle(
    BLOCK_PROPERTY_MUTATION_IPC_CHANNEL,
    async (event, projectId, rawRequest) => {
      const identity = dependencies.resolveTrustedIdentity(event);
      if (!identity) {
        return {
          ok: false,
          error: blockPropertyMutationFailure(
            "invalid_property_mutation_request",
            "Block property mutations are restricted to a trusted application window",
          ),
        };
      }

      const bound = bindTrustedBlockPropertyMutation(
        rawRequest,
        projectId,
        identity,
      );
      if (!bound.ok) return bound;

      try {
        return await dependencies.applyMutation(bound.value);
      } catch (error) {
        return transportFailure(bound.value, error);
      }
    },
  );
};
