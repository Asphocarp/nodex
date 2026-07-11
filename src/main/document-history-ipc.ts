import type {
  CreateDocumentVersionCheckpoint,
  CreatedDocumentVersionSummary,
  DocumentVersionDetail,
  DocumentVersionSummary,
  GetDocumentVersion,
  ListDocumentVersions,
} from "../shared/block-documents/document-history";
import {
  bindTrustedDocumentVersionCheckpoint,
  documentHistoryFailure,
  DocumentHistoryContractError,
  parseGetDocumentVersion,
  parseListDocumentVersions,
  type DocumentHistoryCommandResult,
} from "../shared/block-documents/document-history-transport";
import type {
  DocumentMutationRequest,
  DocumentOperationCommandResult,
} from "../shared/block-documents/document-operations";
import {
  bindTrustedDocumentMutation,
  documentMutationFailure,
  type TrustedDocumentMutationIdentity,
} from "../shared/block-documents/document-operation-transport";

export const DOCUMENT_HISTORY_CHECKPOINT_IPC_CHANNEL =
  "block-documents:history:checkpoint" as const;
export const DOCUMENT_HISTORY_LIST_IPC_CHANNEL =
  "block-documents:history:list" as const;
export const DOCUMENT_HISTORY_GET_IPC_CHANNEL =
  "block-documents:history:get" as const;
export const DOCUMENT_HISTORY_RESTORE_IPC_CHANNEL =
  "block-documents:history:restore" as const;

type RegisterHandle = (
  channel:
    | typeof DOCUMENT_HISTORY_CHECKPOINT_IPC_CHANNEL
    | typeof DOCUMENT_HISTORY_LIST_IPC_CHANNEL
    | typeof DOCUMENT_HISTORY_GET_IPC_CHANNEL
    | typeof DOCUMENT_HISTORY_RESTORE_IPC_CHANNEL,
  listener: (event: unknown, ...args: readonly unknown[]) => unknown,
) => void;

export interface DocumentHistoryIpcDependencies {
  readonly registerHandle: RegisterHandle;
  readonly resolveTrustedIdentity: (
    event: unknown,
  ) => TrustedDocumentMutationIdentity | null;
  readonly createCheckpoint: (
    request: CreateDocumentVersionCheckpoint,
  ) => Promise<DocumentHistoryCommandResult<CreatedDocumentVersionSummary>>;
  readonly listVersions: (
    request: ListDocumentVersions,
  ) => Promise<DocumentHistoryCommandResult<readonly DocumentVersionSummary[]>>;
  readonly getVersion: (
    request: GetDocumentVersion,
  ) => Promise<DocumentHistoryCommandResult<DocumentVersionDetail>>;
  readonly restoreVersion: (
    request: DocumentMutationRequest,
  ) => Promise<DocumentOperationCommandResult>;
}

const unavailable = <T>(error: unknown): DocumentHistoryCommandResult<T> => ({
  ok: false,
  error: documentHistoryFailure(
    "unknown",
    error instanceof Error
      ? error.message
      : "The durable Document history writer is unavailable",
    { retryable: true },
  ),
});

const invalid = <T>(error: unknown): DocumentHistoryCommandResult<T> => ({
  ok: false,
  error: documentHistoryFailure(
    "invalid_document_history_request",
    error instanceof DocumentHistoryContractError
      ? error.message
      : "Document history request is invalid",
  ),
});

export const registerDocumentHistoryIpcHandlers = (
  dependencies: DocumentHistoryIpcDependencies,
): void => {
  dependencies.registerHandle(
    DOCUMENT_HISTORY_CHECKPOINT_IPC_CHANNEL,
    async (event, projectIdValue, documentIdValue, rawRequest) => {
      const identity = dependencies.resolveTrustedIdentity(event);
      if (!identity) return invalid("Document history requires a trusted window");
      if (typeof projectIdValue !== "string" || typeof documentIdValue !== "string") {
        return invalid("Document history scope is invalid");
      }
      try {
        const request = bindTrustedDocumentVersionCheckpoint(
          rawRequest,
          projectIdValue,
          documentIdValue,
          identity.actor,
        );
        return await dependencies.createCheckpoint(request);
      } catch (error) {
        return error instanceof DocumentHistoryContractError
          ? invalid(error)
          : unavailable(error);
      }
    },
  );
  dependencies.registerHandle(
    DOCUMENT_HISTORY_LIST_IPC_CHANNEL,
    async (event, rawRequest) => {
      if (!dependencies.resolveTrustedIdentity(event)) {
        return invalid("Document history requires a trusted window");
      }
      try {
        return await dependencies.listVersions(
          parseListDocumentVersions(rawRequest),
        );
      } catch (error) {
        return error instanceof DocumentHistoryContractError
          ? invalid(error)
          : unavailable(error);
      }
    },
  );
  dependencies.registerHandle(
    DOCUMENT_HISTORY_GET_IPC_CHANNEL,
    async (event, rawRequest) => {
      if (!dependencies.resolveTrustedIdentity(event)) {
        return invalid("Document history requires a trusted window");
      }
      try {
        return await dependencies.getVersion(parseGetDocumentVersion(rawRequest));
      } catch (error) {
        return error instanceof DocumentHistoryContractError
          ? invalid(error)
          : unavailable(error);
      }
    },
  );
  dependencies.registerHandle(
    DOCUMENT_HISTORY_RESTORE_IPC_CHANNEL,
    async (event, projectIdValue, documentIdValue, rawRequest) => {
      const identity = dependencies.resolveTrustedIdentity(event);
      if (
        !identity ||
        typeof projectIdValue !== "string" ||
        typeof documentIdValue !== "string"
      ) {
        return {
          ok: false,
          error: documentMutationFailure(
            "invalid_document_operation_request",
            "Document restore requires a trusted window and valid scope",
          ),
        };
      }
      const bound = bindTrustedDocumentMutation(
        rawRequest,
        projectIdValue,
        documentIdValue,
        identity,
      );
      if (!bound.ok) return bound;
      if (!("versionId" in bound.value)) {
        return {
          ok: false,
          error: documentMutationFailure(
            "invalid_document_operation_request",
            "Document history restore requires a versionId",
            { mutationId: bound.value.mutationId },
          ),
        };
      }
      try {
        return await dependencies.restoreVersion(bound.value);
      } catch (error) {
        return {
          ok: false,
          error: documentMutationFailure(
            "unknown",
            error instanceof Error
              ? error.message
              : "The durable Document restore writer is unavailable",
            { mutationId: bound.value.mutationId, retryable: true },
          ),
        };
      }
    },
  );
};
