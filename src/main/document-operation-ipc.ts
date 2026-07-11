import type {
  DocumentMutationRequest,
  DocumentOperationCommandResult,
} from "../shared/block-documents/document-operations";
import {
  bindTrustedDocumentMutation,
  documentMutationFailure,
  type TrustedDocumentMutationIdentity,
} from "../shared/block-documents/document-operation-transport";

export const DOCUMENT_MUTATION_IPC_CHANNEL =
  "block-documents:mutate" as const;

export type DocumentMutationIpcHandler = (
  event: unknown,
  projectId: string,
  documentId: string,
  request: DocumentMutationRequest,
) => Promise<DocumentOperationCommandResult>;

export interface DocumentMutationIpcDependencies {
  readonly registerHandle: (
    channel: typeof DOCUMENT_MUTATION_IPC_CHANNEL,
    listener: DocumentMutationIpcHandler,
  ) => void;
  readonly resolveTrustedIdentity: (
    event: unknown,
  ) => TrustedDocumentMutationIdentity | null;
  readonly applyMutation: (
    request: DocumentMutationRequest,
  ) => Promise<DocumentOperationCommandResult>;
}

export const registerDocumentMutationIpcHandler = (
  dependencies: DocumentMutationIpcDependencies,
): void => {
  dependencies.registerHandle(
    DOCUMENT_MUTATION_IPC_CHANNEL,
    async (event, projectId, documentId, rawRequest) => {
      const identity = dependencies.resolveTrustedIdentity(event);
      if (!identity) {
        return {
          ok: false,
          error: documentMutationFailure(
            "invalid_document_operation_request",
            "Document mutations are restricted to a trusted application window",
          ),
        };
      }
      const bound = bindTrustedDocumentMutation(
        rawRequest,
        projectId,
        documentId,
        identity,
      );
      if (!bound.ok) return bound;

      try {
        return await dependencies.applyMutation(bound.value);
      } catch (error) {
        return {
          ok: false,
          error: documentMutationFailure(
            "unknown",
            error instanceof Error
              ? error.message
              : "The durable Document mutation writer is unavailable",
            {
              mutationId: bound.value.mutationId,
              retryable: true,
            },
          ),
        };
      }
    },
  );
};
