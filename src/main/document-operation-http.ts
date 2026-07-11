import { bodyLimit } from "hono/body-limit";
import type { Hono } from "hono";
import type {
  DocumentMutationRequest,
  DocumentOperationCommandResult,
} from "../shared/block-documents/document-operations";
import {
  bindTrustedDocumentMutation,
  documentMutationFailure,
  documentMutationHttpStatus,
} from "../shared/block-documents/document-operation-transport";

const MAX_DOCUMENT_MUTATION_HTTP_BYTES = 2_100_000;
const HTTP_DOCUMENT_MUTATION_SESSION = "http-loopback";

export interface DocumentMutationHttpDependencies {
  readonly applyMutation: (
    request: DocumentMutationRequest,
  ) => Promise<DocumentOperationCommandResult>;
}

export const registerDocumentMutationHttpRoute = (
  app: Hono,
  dependencies: DocumentMutationHttpDependencies,
): void => {
  app.post(
    "/api/projects/:projectId/documents/:documentId/mutations",
    bodyLimit({
      maxSize: MAX_DOCUMENT_MUTATION_HTTP_BYTES,
      onError: (context) =>
        context.json(
          {
            ok: false,
            error: documentMutationFailure(
              "invalid_document_operation_request",
              "Document mutation body is too large",
            ),
          } satisfies DocumentOperationCommandResult,
          400,
        ),
    }),
    async (context) => {
      const projectId = context.req.param("projectId").trim();
      const documentId = context.req.param("documentId").trim();
      const rawRequest = await context.req.json().catch(() => null);
      if (rawRequest === null) {
        context.header("Cache-Control", "no-store");
        return context.json(
          {
            ok: false,
            error: documentMutationFailure(
              "invalid_document_operation_request",
              "Document mutation body must be valid JSON",
            ),
          } satisfies DocumentOperationCommandResult,
          400,
        );
      }

      const bound = bindTrustedDocumentMutation(
        rawRequest,
        projectId,
        documentId,
        {
          actor: { kind: "http_loopback", transport: "json" },
          clientSessionId: HTTP_DOCUMENT_MUTATION_SESSION,
        },
      );
      if (!bound.ok) {
        context.header("Cache-Control", "no-store");
        return context.json(bound, documentMutationHttpStatus(bound.error));
      }

      let result: DocumentOperationCommandResult;
      try {
        result = await dependencies.applyMutation(bound.value);
      } catch (error) {
        result = {
          ok: false,
          error: documentMutationFailure(
            "unknown",
            error instanceof Error
              ? error.message
              : "The durable Document mutation writer is unavailable",
            { mutationId: bound.value.mutationId, retryable: true },
          ),
        };
      }

      context.header("Cache-Control", "no-store");
      if (result.ok) return context.json(result);
      return context.json(result, documentMutationHttpStatus(result.error));
    },
  );
};
