import type {
  BlockPropertyMutationCommandResultV2,
  BlockPropertyMutationRequestV2,
} from "../shared/block-property-mutations-v2";
import {
  bindTrustedBlockPropertyMutationV2,
  blockPropertyMutationFailureV2,
  blockPropertyMutationTransportFailureV2,
  type TrustedBlockPropertyMutationIdentityV2,
} from "../shared/block-property-mutation-v2-transport";

export const BLOCK_PROPERTY_MUTATION_IPC_CHANNEL =
  "block-properties:mutate" as const;

export type BlockPropertyMutationIpcEvent =
  Parameters<BlockPropertyMutationIpcHandler>[0];

export type BlockPropertyMutationIpcHandler = (
  event: unknown,
  projectId: string,
  request: BlockPropertyMutationRequestV2,
) => Promise<BlockPropertyMutationCommandResultV2>;

export interface BlockPropertyMutationIpcDependencies {
  readonly registerHandle: (
    channel: typeof BLOCK_PROPERTY_MUTATION_IPC_CHANNEL,
    listener: BlockPropertyMutationIpcHandler,
  ) => void;
  readonly resolveTrustedIdentity: (
    event: unknown,
  ) => TrustedBlockPropertyMutationIdentityV2 | null;
  readonly applyMutation: (
    request: BlockPropertyMutationRequestV2,
  ) => Promise<BlockPropertyMutationCommandResultV2>;
}

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
          error: blockPropertyMutationFailureV2(
            "invalid_property_mutation_request",
            "Block property mutations are restricted to a trusted application window",
          ),
        };
      }

      const bound = bindTrustedBlockPropertyMutationV2(
        rawRequest,
        projectId,
        identity,
      );
      if (!bound.ok) return bound;

      try {
        return await dependencies.applyMutation(bound.value);
      } catch (error) {
        return blockPropertyMutationTransportFailureV2(bound.value, error);
      }
    },
  );
};
