import {
  BlockPropertyMutationContractError,
  parseBlockPropertyMutationRequest,
  type BlockPropertyJsonValue,
  type BlockPropertyMutationCommandError,
  type BlockPropertyMutationRequest,
} from "./block-property-mutations";

export interface TrustedBlockPropertyMutationIdentity {
  readonly actor: Readonly<Record<string, BlockPropertyJsonValue>>;
  readonly clientSessionId?: string;
}

export type TrustedBlockPropertyMutationBinding =
  | { readonly ok: true; readonly value: BlockPropertyMutationRequest }
  | { readonly ok: false; readonly error: BlockPropertyMutationCommandError };

const readMutationIdHint = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const mutationId = (value as Readonly<Record<string, unknown>>).mutationId;
  if (
    typeof mutationId !== "string" ||
    mutationId.length === 0 ||
    mutationId.length > 512 ||
    mutationId !== mutationId.trim()
  ) {
    return undefined;
  }
  return mutationId;
};

export const blockPropertyMutationFailure = (
  code: BlockPropertyMutationCommandError["code"],
  message: string,
  options: {
    readonly mutationId?: string;
    readonly retryable?: boolean;
  } = {},
): BlockPropertyMutationCommandError => ({
  code,
  message,
  retryable: options.retryable ?? false,
  ...(options.mutationId === undefined
    ? {}
    : { mutationId: options.mutationId }),
});

/**
 * Parse the public mutation envelope, enforce its route/IPC Project scope,
 * then replace audit identity with identity derived by the trusted host.
 * Renderer/browser supplied actor and session fields are never persisted.
 */
export const bindTrustedBlockPropertyMutation = (
  rawRequest: unknown,
  projectId: string,
  identity: TrustedBlockPropertyMutationIdentity,
): TrustedBlockPropertyMutationBinding => {
  let request: BlockPropertyMutationRequest;
  try {
    request = parseBlockPropertyMutationRequest(rawRequest);
  } catch (error) {
    return {
      ok: false,
      error: blockPropertyMutationFailure(
        "invalid_property_mutation_request",
        error instanceof BlockPropertyMutationContractError
          ? error.message
          : "Block property mutation request is invalid",
        { mutationId: readMutationIdHint(rawRequest) },
      ),
    };
  }

  if (request.projectId !== projectId) {
    return {
      ok: false,
      error: blockPropertyMutationFailure(
        "invalid_property_mutation_request",
        "Block property mutation does not match its Project scope",
        { mutationId: request.mutationId },
      ),
    };
  }

  try {
    return {
      ok: true,
      value: parseBlockPropertyMutationRequest({
        ...request,
        projectId,
        actor: identity.actor,
        ...(identity.clientSessionId === undefined
          ? { clientSessionId: undefined }
          : { clientSessionId: identity.clientSessionId }),
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: blockPropertyMutationFailure(
        "invalid_property_mutation_request",
        error instanceof BlockPropertyMutationContractError
          ? error.message
          : "Trusted Block property mutation identity is invalid",
        { mutationId: request.mutationId },
      ),
    };
  }
};

export const blockPropertyMutationHttpStatus = (
  error: BlockPropertyMutationCommandError,
): 400 | 404 | 409 | 500 => {
  if (
    error.code === "project_not_found" ||
    error.code === "block_not_found" ||
    error.code === "database_not_found" ||
    error.code === "membership_not_found" ||
    error.code === "property_not_found"
  ) {
    return 404;
  }
  if (
    error.code === "store_epoch_mismatch" ||
    error.code === "mutation_id_collision" ||
    error.code === "block_not_active" ||
    error.code === "property_conflict"
  ) {
    return 409;
  }
  if (error.code === "unknown") return 500;
  return 400;
};
