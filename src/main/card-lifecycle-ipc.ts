import type {
  CardLifecycleMutationCommandResult,
  CardLifecycleMutationRequest,
} from "../shared/card-lifecycle";
import {
  bindTrustedCardLifecycleMutation,
  cardLifecycleMutationFailure,
  cardLifecycleTransportFailure,
  type TrustedCardLifecycleMutationIdentity,
} from "../shared/card-lifecycle-transport";
import type { CardLifecyclePreflightResult } from "../shared/card-lifecycle-runtime";

export const CARD_LIFECYCLE_MUTATION_IPC_CHANNEL =
  "cards:lifecycle:apply" as const;
export const CARD_LIFECYCLE_PREFLIGHT_IPC_CHANNEL =
  "cards:lifecycle:preflight" as const;

export interface CardLifecycleIpcDependencies {
  readonly registerHandle: (
    channel: typeof CARD_LIFECYCLE_MUTATION_IPC_CHANNEL,
    listener: (
      event: unknown,
      projectId: string,
      rawRequest: unknown,
    ) => Promise<CardLifecycleMutationCommandResult>,
  ) => void;
  readonly getTrustedIdentity: (
    event: unknown,
  ) => TrustedCardLifecycleMutationIdentity | null;
  readonly applyMutation: (
    request: CardLifecycleMutationRequest,
  ) => Promise<CardLifecycleMutationCommandResult>;
}

export const registerCardLifecycleIpcHandler = (
  dependencies: CardLifecycleIpcDependencies,
): void => {
  dependencies.registerHandle(
    CARD_LIFECYCLE_MUTATION_IPC_CHANNEL,
    async (event, projectId, rawRequest) => {
      const identity = dependencies.getTrustedIdentity(event);
      if (!identity) {
        return {
          ok: false,
          error: cardLifecycleMutationFailure(
            "invalid_card_lifecycle_request",
            "Card lifecycle mutations are restricted to a trusted application window",
            rawRequest,
          ),
        };
      }
      const bound = bindTrustedCardLifecycleMutation(
        rawRequest,
        projectId,
        identity,
      );
      if (!bound.ok) return bound;
      try {
        return await dependencies.applyMutation(bound.value);
      } catch (error) {
        return cardLifecycleTransportFailure(bound.value, error);
      }
    },
  );
};

export interface CardLifecyclePreflightIpcDependencies {
  readonly registerHandle: (
    channel: typeof CARD_LIFECYCLE_PREFLIGHT_IPC_CHANNEL,
    listener: (
      event: unknown,
      projectId: string,
      cardId: string,
    ) => Promise<CardLifecyclePreflightResult>,
  ) => void;
  readonly readPreflight: (
    projectId: string,
    cardId: string,
  ) => Promise<CardLifecyclePreflightResult>;
}

export const registerCardLifecyclePreflightIpcHandler = (
  dependencies: CardLifecyclePreflightIpcDependencies,
): void => {
  dependencies.registerHandle(
    CARD_LIFECYCLE_PREFLIGHT_IPC_CHANNEL,
    async (_event, projectId, cardId) =>
      await dependencies.readPreflight(projectId, cardId),
  );
};
