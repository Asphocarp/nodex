import {
  BlockPropertyMutationV2ContractError,
  parseBlockPropertyMutationRequestV2,
  type BlockPropertyJsonValueV2,
  type BlockPropertyMutationCommandErrorV2,
  type BlockPropertyMutationCommandResultV2,
  type BlockPropertyMutationRequestV2,
} from "./block-property-mutations-v2";

export interface TrustedBlockPropertyMutationIdentityV2 {
  readonly actor: Readonly<Record<string, BlockPropertyJsonValueV2>>;
  readonly clientSessionId?: string;
}

export type TrustedBlockPropertyMutationBindingV2 =
  | { readonly ok: true; readonly value: BlockPropertyMutationRequestV2 }
  | { readonly ok: false; readonly error: BlockPropertyMutationCommandErrorV2 };

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

export const blockPropertyMutationFailureV2 = (
  code: BlockPropertyMutationCommandErrorV2["code"],
  message: string,
  options: {
    readonly mutationId?: string;
    readonly retryable?: boolean;
  } = {},
): BlockPropertyMutationCommandErrorV2 => ({
  code,
  message,
  retryable: options.retryable ?? false,
  ...(options.mutationId === undefined
    ? {}
    : { mutationId: options.mutationId }),
});

/**
 * Enforce route/IPC Project scope, then replace all caller-authored audit
 * identity with identity derived by the trusted host.
 */
export const bindTrustedBlockPropertyMutationV2 = (
  rawRequest: unknown,
  projectId: string,
  identity: TrustedBlockPropertyMutationIdentityV2,
): TrustedBlockPropertyMutationBindingV2 => {
  let request: BlockPropertyMutationRequestV2;
  try {
    request = parseBlockPropertyMutationRequestV2(rawRequest);
  } catch (error) {
    return {
      ok: false,
      error: blockPropertyMutationFailureV2(
        "invalid_property_mutation_request",
        error instanceof BlockPropertyMutationV2ContractError
          ? error.message
          : "Block property mutation v2 request is invalid",
        { mutationId: readMutationIdHint(rawRequest) },
      ),
    };
  }

  if (request.projectId !== projectId) {
    return {
      ok: false,
      error: blockPropertyMutationFailureV2(
        "invalid_property_mutation_request",
        "Block property mutation v2 does not match its Project scope",
        { mutationId: request.mutationId },
      ),
    };
  }

  try {
    return {
      ok: true,
      value: parseBlockPropertyMutationRequestV2({
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
      error: blockPropertyMutationFailureV2(
        "invalid_property_mutation_request",
        error instanceof BlockPropertyMutationV2ContractError
          ? error.message
          : "Trusted Block property mutation v2 identity is invalid",
        { mutationId: request.mutationId },
      ),
    };
  }
};

export const blockPropertyMutationHttpStatusV2 = (
  error: BlockPropertyMutationCommandErrorV2,
): 400 | 404 | 409 | 500 => {
  if (
    error.code === "project_not_found" ||
    error.code === "block_not_found" ||
    error.code === "data_source_not_found" ||
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

export const blockPropertyMutationTransportFailureV2 = (
  request: BlockPropertyMutationRequestV2,
  error: unknown,
): BlockPropertyMutationCommandResultV2 => ({
  ok: false,
  error: blockPropertyMutationFailureV2(
    "unknown",
    error instanceof Error
      ? error.message
      : "The durable Block property mutation v2 writer is unavailable",
    { mutationId: request.mutationId, retryable: true },
  ),
});
