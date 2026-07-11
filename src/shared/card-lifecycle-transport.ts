import type { BlockPropertyJsonValue } from "./block-property-mutations";
import {
  CardLifecycleContractError,
  parseCardLifecycleMutationRequest,
  type CardLifecycleMutationCommandError,
  type CardLifecycleMutationCommandResult,
  type CardLifecycleMutationRequest,
} from "./card-lifecycle";

export interface TrustedCardLifecycleMutationIdentity {
  readonly actor: Readonly<Record<string, BlockPropertyJsonValue>>;
  readonly clientSessionId?: string;
}

export type TrustedCardLifecycleMutationBinding =
  | { readonly ok: true; readonly value: CardLifecycleMutationRequest }
  | { readonly ok: false; readonly error: CardLifecycleMutationCommandError };

const readRecord = (
  value: unknown,
): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;

const readBoundedHint = (
  value: unknown,
  key: string,
): string | undefined => {
  const record = readRecord(value);
  const candidate = record?.[key];
  if (
    typeof candidate === "string" &&
    candidate.length > 0 &&
    candidate.length <= 512 &&
    candidate === candidate.trim()
  ) {
    return candidate;
  }
  return undefined;
};

const readCardIdHint = (value: unknown): string | undefined => {
  const operation = readRecord(readRecord(value)?.operation);
  return readBoundedHint(operation, "cardId");
};

export const cardLifecycleMutationFailure = (
  code: CardLifecycleMutationCommandError["code"],
  message: string,
  rawRequest?: unknown,
): CardLifecycleMutationCommandError => ({
  code,
  message,
  retryable: false,
  ...(readBoundedHint(rawRequest, "operationId") === undefined
    ? {}
    : { operationId: readBoundedHint(rawRequest, "operationId") }),
  ...(readCardIdHint(rawRequest) === undefined
    ? {}
    : { cardId: readCardIdHint(rawRequest) }),
});

/**
 * Bind public lifecycle intent to route/IPC scope and host-derived audit
 * identity. Renderer/browser actor and session claims are never authoritative.
 */
export const bindTrustedCardLifecycleMutation = (
  rawRequest: unknown,
  projectId: string,
  identity: TrustedCardLifecycleMutationIdentity,
): TrustedCardLifecycleMutationBinding => {
  let request: CardLifecycleMutationRequest;
  try {
    request = parseCardLifecycleMutationRequest(rawRequest);
  } catch (error) {
    return {
      ok: false,
      error: cardLifecycleMutationFailure(
        "invalid_card_lifecycle_request",
        error instanceof CardLifecycleContractError
          ? error.message
          : "Card lifecycle mutation request is invalid",
        rawRequest,
      ),
    };
  }

  if (request.projectId !== projectId) {
    return {
      ok: false,
      error: cardLifecycleMutationFailure(
        "invalid_card_lifecycle_request",
        "Card lifecycle mutation does not match its Project scope",
        request,
      ),
    };
  }

  try {
    return {
      ok: true,
      value: parseCardLifecycleMutationRequest({
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
      error: cardLifecycleMutationFailure(
        "invalid_card_lifecycle_request",
        error instanceof CardLifecycleContractError
          ? error.message
          : "Trusted Card lifecycle identity is invalid",
        request,
      ),
    };
  }
};

export const cardLifecycleMutationHttpStatus = (
  error: CardLifecycleMutationCommandError,
): 400 | 404 | 409 | 500 => {
  if (
    error.code === "project_not_found" ||
    error.code === "card_not_found" ||
    error.code === "membership_not_found" ||
    error.code === "view_not_found"
  ) {
    return 404;
  }
  if (
    error.code === "store_epoch_mismatch" ||
    error.code === "operation_id_collision" ||
    error.code === "card_identity_collision" ||
    error.code === "card_type_mismatch" ||
    error.code === "card_lifecycle_conflict" ||
    error.code === "metadata_revision_conflict" ||
    error.code === "location_revision_conflict" ||
    error.code === "card_location_invalid" ||
    error.code === "position_anchor_not_found" ||
    error.code === "position_anchor_group_mismatch" ||
    error.code === "delete_evidence_invalid"
  ) {
    return 409;
  }
  if (error.code === "unknown") return 500;
  return 400;
};

export const cardLifecycleTransportFailure = (
  request: CardLifecycleMutationRequest,
  error: unknown,
): CardLifecycleMutationCommandResult => ({
  ok: false,
  error: {
    code: "unknown",
    message:
      error instanceof Error
        ? error.message
        : "The durable Card lifecycle writer is unavailable",
    retryable: true,
    operationId: request.operationId,
    cardId: request.operation.cardId,
  },
});
