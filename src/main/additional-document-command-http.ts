import { bodyLimit } from "hono/body-limit";
import type { Hono } from "hono";
import type { AdditionalDocumentCommandResult } from "../shared/additional-document-commands";
import {
  additionalDocumentCommandFailure,
  additionalDocumentCommandHttpStatus,
  additionalDocumentCommandTransportFailure,
  bindAdditionalDocumentCommandToProject,
  type PublicAdditionalDocumentCommandRequest,
} from "../shared/additional-document-command-transport";

const MAX_ADDITIONAL_DOCUMENT_COMMAND_HTTP_BYTES = 2_100_000;
const HTTP_ADDITIONAL_DOCUMENT_COMMAND_SESSION = "http-loopback";

export interface AdditionalDocumentCommandHttpDependencies {
  readonly applyCommand: (
    request: PublicAdditionalDocumentCommandRequest,
  ) => Promise<AdditionalDocumentCommandResult>;
}

export const registerAdditionalDocumentCommandHttpRoute = (
  app: Hono,
  dependencies: AdditionalDocumentCommandHttpDependencies,
): void => {
  app.post(
    "/api/projects/:projectId/document-commands",
    bodyLimit({
      maxSize: MAX_ADDITIONAL_DOCUMENT_COMMAND_HTTP_BYTES,
      onError: (context) =>
        context.json(
          {
            ok: false,
            error: additionalDocumentCommandFailure(
              "invalid_request",
              "Additional Document command body is too large",
            ),
          } satisfies AdditionalDocumentCommandResult,
          400,
        ),
    }),
    async (context) => {
      context.header("Cache-Control", "no-store");
      const rawRequest = await context.req.json().catch(() => null);
      if (rawRequest === null) {
        return context.json(
          {
            ok: false,
            error: additionalDocumentCommandFailure(
              "invalid_request",
              "Additional Document command body must be valid JSON",
            ),
          } satisfies AdditionalDocumentCommandResult,
          400,
        );
      }

      const bound = bindAdditionalDocumentCommandToProject(
        rawRequest,
        context.req.param("projectId"),
        {
          actor: { kind: "http_loopback", transport: "json" },
          clientSessionId: HTTP_ADDITIONAL_DOCUMENT_COMMAND_SESSION,
        },
      );
      if (!bound.ok) {
        return context.json(
          bound,
          additionalDocumentCommandHttpStatus(bound.error),
        );
      }

      let result: AdditionalDocumentCommandResult;
      try {
        result = await dependencies.applyCommand(bound.value);
      } catch (error) {
        result = additionalDocumentCommandTransportFailure(bound.value, error);
      }
      return context.json(
        result,
        result.ok ? 200 : additionalDocumentCommandHttpStatus(result.error),
      );
    },
  );
};
