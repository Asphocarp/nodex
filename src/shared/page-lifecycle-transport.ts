import type { BlockPropertyJsonValue } from "./block-property-mutations";
import {
  PageLifecycleContractError,
  parsePageLifecycleMutationRequest,
  type PageLifecycleMutationCommandError,
  type PageLifecycleMutationCommandResult,
  type PageLifecycleMutationRequest,
} from "./page-lifecycle";
import type {
  PageLifecyclePreflightErrorCode,
  PageLifecyclePreflightResult,
} from "./page-lifecycle-runtime";

export interface TrustedPageLifecycleMutationIdentity {
  readonly actor: Readonly<Record<string, BlockPropertyJsonValue>>;
  readonly clientSessionId?: string;
}

export type TrustedPageLifecycleMutationBinding =
  | { readonly ok: true; readonly value: PageLifecycleMutationRequest }
  | { readonly ok: false; readonly error: PageLifecycleMutationCommandError };

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

const readPageIdHint = (value: unknown): string | undefined => {
  const operation = readRecord(readRecord(value)?.operation);
  return readBoundedHint(operation, "pageId");
};

const PREFLIGHT_ERROR_CODES = new Set<PageLifecyclePreflightErrorCode>([
  "invalid_request",
  "store_not_initialized",
  "project_not_found",
  "page_not_found",
  "authorization_denied",
  "state_corrupt",
  "unknown",
]);

export const parsePageLifecyclePreflightResult = (
  value: unknown,
): PageLifecyclePreflightResult => {
  const result = readRecord(value);
  if (!result) throw new TypeError("Page lifecycle preflight result is invalid");
  if (result.ok === false) {
    const error = readRecord(result.error);
    if (
      Object.keys(result).length !== 2 ||
      !error ||
      !PREFLIGHT_ERROR_CODES.has(error.code as PageLifecyclePreflightErrorCode) ||
      typeof error.message !== "string" ||
      typeof error.retryable !== "boolean"
    ) {
      throw new TypeError("Page lifecycle preflight error is invalid");
    }
    return value as PageLifecyclePreflightResult;
  }
  const snapshot = readRecord(result.value);
  const preflight = readRecord(snapshot?.value);
  if (
    result.ok !== true ||
    Object.keys(result).length !== 2 ||
    !snapshot ||
    snapshot.version !== 1 ||
    readBoundedHint(snapshot, "projectId") === undefined ||
    readBoundedHint(snapshot, "libraryId") === undefined ||
    readBoundedHint(snapshot, "storeEpoch") === undefined ||
    !Number.isSafeInteger(snapshot.changeLogSeq) ||
    (snapshot.changeLogSeq as number) < 0 ||
    !preflight ||
    preflight.version !== 1 ||
    !readRecord(preflight.defaultView) ||
    (preflight.page !== null && !readRecord(preflight.page)) ||
    (preflight.reservedBlockType !== null &&
      typeof preflight.reservedBlockType !== "string")
  ) {
    throw new TypeError("Page lifecycle preflight snapshot is invalid");
  }
  return value as PageLifecyclePreflightResult;
};

export const pageLifecycleMutationFailure = (
  code: PageLifecycleMutationCommandError["code"],
  message: string,
  rawRequest?: unknown,
): PageLifecycleMutationCommandError => ({
  code,
  message,
  retryable: false,
  ...(readBoundedHint(rawRequest, "operationId") === undefined
    ? {}
    : { operationId: readBoundedHint(rawRequest, "operationId") }),
  ...(readPageIdHint(rawRequest) === undefined
    ? {}
    : { pageId: readPageIdHint(rawRequest) }),
});

/**
 * Bind public lifecycle intent to route/IPC scope and host-derived audit
 * identity. Renderer/browser actor and session claims are never authoritative.
 */
export const bindTrustedPageLifecycleMutation = (
  rawRequest: unknown,
  projectId: string,
  identity: TrustedPageLifecycleMutationIdentity,
): TrustedPageLifecycleMutationBinding => {
  let request: PageLifecycleMutationRequest;
  try {
    request = parsePageLifecycleMutationRequest(rawRequest);
  } catch (error) {
    return {
      ok: false,
      error: pageLifecycleMutationFailure(
        "invalid_page_lifecycle_request",
        error instanceof PageLifecycleContractError
          ? error.message
          : "Page lifecycle mutation request is invalid",
        rawRequest,
      ),
    };
  }

  if (request.projectId !== projectId) {
    return {
      ok: false,
      error: pageLifecycleMutationFailure(
        "invalid_page_lifecycle_request",
        "Page lifecycle mutation does not match its Project scope",
        request,
      ),
    };
  }

  try {
    return {
      ok: true,
      value: parsePageLifecycleMutationRequest({
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
      error: pageLifecycleMutationFailure(
        "invalid_page_lifecycle_request",
        error instanceof PageLifecycleContractError
          ? error.message
          : "Trusted Page lifecycle identity is invalid",
        request,
      ),
    };
  }
};

export const pageLifecycleMutationHttpStatus = (
  error: PageLifecycleMutationCommandError,
): 400 | 403 | 404 | 409 | 500 => {
  if (error.code === "authorization_denied") return 403;
  if (
    error.code === "project_not_found" ||
    error.code === "page_not_found" ||
    error.code === "membership_not_found" ||
    error.code === "view_not_found"
  ) {
    return 404;
  }
  if (
    error.code === "store_epoch_mismatch" ||
    error.code === "operation_id_collision" ||
    error.code === "page_identity_collision" ||
    error.code === "page_type_mismatch" ||
    error.code === "page_lifecycle_conflict" ||
    error.code === "metadata_revision_conflict" ||
    error.code === "parent_revision_conflict" ||
    error.code === "page_parent_invalid" ||
    error.code === "position_anchor_not_found" ||
    error.code === "position_anchor_group_mismatch" ||
    error.code === "delete_evidence_invalid"
  ) {
    return 409;
  }
  if (error.code === "unknown") return 500;
  return 400;
};

export const pageLifecycleTransportFailure = (
  request: PageLifecycleMutationRequest,
  error: unknown,
): PageLifecycleMutationCommandResult => ({
  ok: false,
  error: {
    code: "unknown",
    message:
      error instanceof Error
        ? error.message
        : "The durable Page lifecycle writer is unavailable",
    retryable: true,
    operationId: request.operationId,
    pageId: request.operation.pageId,
  },
});
