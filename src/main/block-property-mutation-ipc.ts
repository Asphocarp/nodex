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
  blockPropertyMutationTransportFailureV2,
  libraryBlockPropertyMutationTransportFailureV2,
  type TrustedBlockPropertyMutationIdentityV2,
} from "../shared/block-property-mutation-v2-transport";

export const BLOCK_PROPERTY_MUTATION_IPC_CHANNEL = "block-properties:mutate" as const;
export const LIBRARY_BLOCK_PROPERTY_MUTATION_IPC_CHANNEL =
  "library-block-properties:mutate" as const;

export type BlockPropertyMutationIpcEvent = Parameters<BlockPropertyMutationIpcHandler>[0];

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

      const bound = bindTrustedBlockPropertyMutationV2(rawRequest, projectId, identity);
      if (!bound.ok) return bound;

      try {
        return await dependencies.applyMutation(bound.value);
      } catch (error) {
        return blockPropertyMutationTransportFailureV2(bound.value, error);
      }
    },
  );
};

export type LibraryBlockPropertyMutationIpcHandler = (
  event: unknown,
  request: LibraryBlockPropertyMutationRequestV2,
) => Promise<LibraryBlockPropertyMutationCommandResultV2>;

export interface LibraryBlockPropertyMutationIpcDependencies {
  readonly registerHandle: (
    channel: typeof LIBRARY_BLOCK_PROPERTY_MUTATION_IPC_CHANNEL,
    listener: LibraryBlockPropertyMutationIpcHandler,
  ) => void;
  readonly resolveTrustedIdentity: (
    event: unknown,
  ) => TrustedBlockPropertyMutationIdentityV2 | null;
  readonly applyMutation: (input: {
    readonly request: LibraryBlockPropertyMutationRequestV2;
    readonly actor: BlockPropertyMutationRequestV2["actor"];
    readonly accessActor: "app_window";
  }) => Promise<LibraryBlockPropertyMutationCommandResultV2>;
}

export const registerLibraryBlockPropertyMutationIpcHandler = (
  dependencies: LibraryBlockPropertyMutationIpcDependencies,
): void => {
  dependencies.registerHandle(
    LIBRARY_BLOCK_PROPERTY_MUTATION_IPC_CHANNEL,
    async (event, rawRequest) => {
      const identity = dependencies.resolveTrustedIdentity(event);
      if (!identity) {
        return {
          ok: false,
          error: blockPropertyMutationFailureV2(
            "invalid_property_mutation_request",
            "Library Block property mutations are restricted to a trusted application window",
          ),
        };
      }

      const bound = bindTrustedLibraryBlockPropertyMutationV2(rawRequest, identity);
      if (!bound.ok) return bound;

      try {
        return await dependencies.applyMutation({
          request: bound.value,
          actor: bound.actor,
          accessActor: "app_window",
        });
      } catch (error) {
        return libraryBlockPropertyMutationTransportFailureV2(bound.value, error);
      }
    },
  );
};
