import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import { CodexAppServerNoResponse } from "@nodex/effect-codex-app-server/protocol";
import { parseCodexAppServerMessage } from "../codex/codex-app-server-message-parser";
import {
  CODEX_SERVER_REQUEST_NO_RESPONSE,
  CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN,
  type CodexServerRequest,
} from "./CodexApplicationProtocol";
import { CodexRpcError } from "./CodexGatewayPromiseAdapter";

export interface CodexApplicationServerRequestHandler {
  readonly handle: (request: CodexServerRequest) => Promise<unknown>;
}

export interface CodexApplicationServerRequestHandlerSource {
  readonly current: () => CodexApplicationServerRequestHandler | null;
}

const requestHandlerError = (error: unknown, method: string): CodexAppServerRequestError => {
  if (error instanceof CodexRpcError) {
    return new CodexAppServerRequestError({
      code: error.code,
      errorMessage: error.message,
      ...(error.data === undefined ? {} : { data: error.data }),
      method,
      operation: "handle-request",
      cause: error,
    });
  }
  if (Schema.is(CodexAppServerRequestError)(error)) return error;
  return CodexAppServerRequestError.internalError(
    `Nodex could not handle Codex request '${method}'`,
    undefined,
    { method, operation: "handle-request", cause: error },
  );
};

/**
 * Decodes app-server requests once at the transport/application seam. The source is late-readable
 * only because Codex can issue a server request while the application reducer is being composed;
 * it never owns a callback, fiber, queue, or lifecycle.
 */
export const makeCodexApplicationServerRequests = (
  source: CodexApplicationServerRequestHandlerSource,
): {
  readonly handle: (
    hostId: string,
    generation: number,
    requestId: string | number,
    method: string,
    params: unknown,
    occurrenceToken?: number,
  ) => Effect.Effect<unknown, CodexAppServerRequestError>;
} => ({
  handle: (_hostId, _generation, requestId, method, params, occurrenceToken) => {
    const parsed = parseCodexAppServerMessage({ id: requestId, method, params });
    if (!parsed.success || parsed.data.kind !== "request") {
      return Effect.fail(
        CodexAppServerRequestError.invalidParams(parsed.success ? undefined : parsed.error),
      );
    }
    const request =
      occurrenceToken === undefined
        ? parsed.data.request
        : Object.assign(parsed.data.request, {
            [CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN]: occurrenceToken,
          });
    const handler = source.current();
    if (handler === null) return Effect.fail(CodexAppServerRequestError.methodNotFound(method));
    return Effect.tryPromise({
      try: () => handler.handle(request),
      catch: (error) => requestHandlerError(error, method),
    }).pipe(
      Effect.map((result) =>
        result === CODEX_SERVER_REQUEST_NO_RESPONSE ? CodexAppServerNoResponse : result,
      ),
    );
  },
});
