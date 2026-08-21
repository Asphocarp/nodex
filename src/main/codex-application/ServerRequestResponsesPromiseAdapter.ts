import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { ApprovalCoordinator } from "./ApprovalCoordinator";

export interface ServerRequestResponsesPromiseAdapter {
  readonly respond: (
    threadId: string,
    requestId: string | number,
    occurrenceToken: number,
    response: unknown,
  ) => Promise<boolean>;
  readonly reject: (
    threadId: string,
    requestId: string | number,
    occurrenceToken: number,
    reason: unknown,
  ) => Promise<boolean>;
}

export const makeServerRequestResponsesPromiseAdapter = (
  coordinator: ApprovalCoordinator["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): ServerRequestResponsesPromiseAdapter => ({
  respond: (threadId, _requestId, occurrenceToken, response) =>
    callbacks.runPromise(coordinator.respondToken(threadId, occurrenceToken, response)),
  reject: (threadId, requestId, occurrenceToken, reason) =>
    callbacks.runPromise(
      coordinator.rejectToken(
        threadId,
        occurrenceToken,
        CodexAppServerRequestError.internalError("Codex application request failed", undefined, {
          operation: "handle-request",
          requestId: String(requestId),
          cause: reason,
        }),
      ),
    ),
});
