import { bodyLimit } from "hono/body-limit";
import type { Context, Hono } from "hono";
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
  documentHistoryHttpStatus,
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
  documentMutationHttpStatus,
} from "../shared/block-documents/document-operation-transport";

const MAX_DOCUMENT_HISTORY_HTTP_BYTES = 64 * 1024;
const HTTP_HISTORY_SESSION = "http-loopback:document-history";

export interface DocumentHistoryHttpDependencies {
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

const historyUnavailable = <T>(error: unknown): DocumentHistoryCommandResult<T> => ({
  ok: false,
  error: documentHistoryFailure(
    "unknown",
    error instanceof Error
      ? error.message
      : "The durable Document history writer is unavailable",
    { retryable: true },
  ),
});

const historyInvalid = <T>(error: unknown): DocumentHistoryCommandResult<T> => ({
  ok: false,
  error: documentHistoryFailure(
    "invalid_document_history_request",
    error instanceof DocumentHistoryContractError
      ? error.message
      : "Document history request is invalid",
  ),
});

const respondHistory = <T>(
  context: Context,
  result: DocumentHistoryCommandResult<T>,
) => {
  context.header("Cache-Control", "no-store");
  if (result.ok) return context.json(result);
  return context.json(result, documentHistoryHttpStatus(result.error));
};

export const registerDocumentHistoryHttpRoutes = (
  app: Hono,
  dependencies: DocumentHistoryHttpDependencies,
): void => {
  app.post(
    "/api/projects/:projectId/documents/:documentId/versions/checkpoints",
    bodyLimit({
      maxSize: MAX_DOCUMENT_HISTORY_HTTP_BYTES,
      onError: (context) =>
        respondHistory(
          context,
          historyInvalid("Document checkpoint body is too large"),
        ),
    }),
    async (context) => {
      const rawRequest = await context.req.json().catch(() => null);
      if (rawRequest === null) {
        return respondHistory(
          context,
          historyInvalid("Document checkpoint body must be valid JSON"),
        );
      }
      try {
        const request = bindTrustedDocumentVersionCheckpoint(
          rawRequest,
          context.req.param("projectId").trim(),
          context.req.param("documentId").trim(),
          { kind: "http_loopback", transport: "json" },
        );
        return respondHistory(
          context,
          await dependencies.createCheckpoint(request).catch(historyUnavailable),
        );
      } catch (error) {
        return respondHistory(context, historyInvalid(error));
      }
    },
  );

  app.get(
    "/api/projects/:projectId/documents/:documentId/versions",
    async (context) => {
      const limitValue = context.req.query("limit");
      const beforeHead = context.req.query("beforeHeadSeq");
      const beforeCreatedAt = context.req.query("beforeCreatedAt");
      const beforeVersionId = context.req.query("beforeVersionId");
      const hasAnyCursor =
        beforeHead !== undefined ||
        beforeCreatedAt !== undefined ||
        beforeVersionId !== undefined;
      const hasFullCursor =
        beforeHead !== undefined &&
        beforeCreatedAt !== undefined &&
        beforeVersionId !== undefined;
      if (hasAnyCursor && !hasFullCursor) {
        return respondHistory(
          context,
          historyInvalid("Document version cursor must be complete"),
        );
      }
      try {
        const request = parseListDocumentVersions({
          projectId: context.req.param("projectId").trim(),
          documentId: context.req.param("documentId").trim(),
          ...(limitValue === undefined ? {} : { limit: Number(limitValue) }),
          ...(hasFullCursor
            ? {
                before: {
                  baseHeadSeq: Number(beforeHead),
                  createdAt: beforeCreatedAt,
                  versionId: beforeVersionId,
                },
              }
            : {}),
        });
        return respondHistory(
          context,
          await dependencies.listVersions(request).catch(historyUnavailable),
        );
      } catch (error) {
        return respondHistory(context, historyInvalid(error));
      }
    },
  );

  app.get(
    "/api/projects/:projectId/documents/:documentId/versions/:versionId",
    async (context) => {
      try {
        const request = parseGetDocumentVersion({
          projectId: context.req.param("projectId").trim(),
          documentId: context.req.param("documentId").trim(),
          versionId: context.req.param("versionId").trim(),
        });
        return respondHistory(
          context,
          await dependencies.getVersion(request).catch(historyUnavailable),
        );
      } catch (error) {
        return respondHistory(context, historyInvalid(error));
      }
    },
  );

  app.post(
    "/api/projects/:projectId/documents/:documentId/versions/:versionId/restore",
    bodyLimit({
      maxSize: MAX_DOCUMENT_HISTORY_HTTP_BYTES,
      onError: (context) =>
        context.json(
          {
            ok: false,
            error: documentMutationFailure(
              "invalid_document_operation_request",
              "Document restore body is too large",
            ),
          } satisfies DocumentOperationCommandResult,
          400,
        ),
    }),
    async (context) => {
      const rawRequest = await context.req.json().catch(() => null);
      if (rawRequest === null) {
        return context.json(
          {
            ok: false,
            error: documentMutationFailure(
              "invalid_document_operation_request",
              "Document restore body must be valid JSON",
            ),
          } satisfies DocumentOperationCommandResult,
          400,
        );
      }
      const bound = bindTrustedDocumentMutation(
        rawRequest,
        context.req.param("projectId").trim(),
        context.req.param("documentId").trim(),
        {
          actor: { kind: "http_loopback", transport: "json" },
          clientSessionId: HTTP_HISTORY_SESSION,
        },
      );
      if (!bound.ok) {
        return context.json(bound, documentMutationHttpStatus(bound.error));
      }
      if (
        !("versionId" in bound.value) ||
        bound.value.versionId !== context.req.param("versionId").trim()
      ) {
        const result = {
          ok: false,
          error: documentMutationFailure(
            "invalid_document_operation_request",
            "Document restore does not match its version scope",
            { mutationId: bound.value.mutationId },
          ),
        } satisfies DocumentOperationCommandResult;
        return context.json(result, 400);
      }
      const result = await dependencies
        .restoreVersion(bound.value)
        .catch(
          (error): DocumentOperationCommandResult => ({
            ok: false,
            error: documentMutationFailure(
              "unknown",
              error instanceof Error
                ? error.message
                : "The durable Document restore writer is unavailable",
              { mutationId: bound.value.mutationId, retryable: true },
            ),
          }),
        );
      context.header("Cache-Control", "no-store");
      if (result.ok) return context.json(result);
      return context.json(result, documentMutationHttpStatus(result.error));
    },
  );
};
