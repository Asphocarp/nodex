import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type { RequestId } from "@nodex/codex-app-server-protocol";
import type { CodexApprovalResponse } from "../../shared/codex-approval-response";
import type { CodexMcpServerElicitationAction } from "../../shared/types";
import type { CodexPendingServerRequestRuntimeService } from "./CodexPendingServerRequestRuntime";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";
import {
  type CodexApprovalResponseInput,
  type CodexMcpElicitationResponseInput,
  type CodexOptionPickerResponseInput,
  type CodexPermissionResponseInput,
  type CodexServerRequestResponseKernelProjection,
  type CodexSetupCodexStepResponseInput,
  type CodexSetupContextPickerResponseInput,
  type CodexUserInputResponseInput,
  makeCodexServerRequestResponseKernel,
} from "./CodexServerRequestResponseKernel";

export type {
  CodexServerRequestConversationProjection,
  CodexServerRequestResolvedEvent,
} from "./CodexServerRequestResponseKernel";

export class CodexServerRequestResponseProjectionError extends Data.TaggedError(
  "CodexServerRequestResponseProjectionError",
)<{
  readonly operation: "observe-user-input-response" | "respond-follower-approval" | "transaction";
  readonly cause: unknown;
}> {}

export interface CodexServerRequestResponseProjection extends CodexServerRequestResponseKernelProjection {
  readonly completePlanImplementation: (input: {
    readonly threadId: string;
    readonly turnId: string;
  }) => void;
  readonly observeUserInputResponse: (
    threadId: string,
    requestId: RequestId,
  ) => Effect.Effect<void, CodexServerRequestResponseProjectionError>;
  readonly respondFollowerApproval: (input: {
    readonly threadId: string;
    readonly requestId: RequestId;
    readonly response: CodexApprovalResponse;
  }) => Effect.Effect<void, CodexServerRequestResponseProjectionError>;
}

export interface CodexServerRequestResponsesService {
  readonly approval: (
    input: CodexApprovalResponseInput,
  ) => Effect.Effect<boolean, CodexServerRequestResponseProjectionError>;
  readonly userInput: (
    input: CodexUserInputResponseInput,
  ) => Effect.Effect<boolean, CodexServerRequestResponseProjectionError>;
  readonly mcpElicitation: (
    input: CodexMcpElicitationResponseInput,
  ) => Effect.Effect<boolean, CodexServerRequestResponseProjectionError>;
  readonly permission: (
    input: CodexPermissionResponseInput,
  ) => Effect.Effect<boolean, CodexServerRequestResponseProjectionError>;
  readonly optionPicker: (
    input: CodexOptionPickerResponseInput,
  ) => Effect.Effect<boolean, CodexServerRequestResponseProjectionError>;
  readonly setupContextPicker: (
    input: CodexSetupContextPickerResponseInput,
  ) => Effect.Effect<boolean, CodexServerRequestResponseProjectionError>;
  readonly setupCodexStep: (
    input: CodexSetupCodexStepResponseInput,
  ) => Effect.Effect<boolean, CodexServerRequestResponseProjectionError>;
  readonly planImplementation: (
    threadId: string,
    turnId: string,
  ) => Effect.Effect<boolean, CodexServerRequestResponseProjectionError>;
  readonly declineAll: (
    threadId: string,
  ) => Effect.Effect<void, CodexServerRequestResponseProjectionError>;
}

export class CodexServerRequestResponses extends Context.Service<
  CodexServerRequestResponses,
  CodexServerRequestResponsesService
>()("nodex/main/codex-application/CodexServerRequestResponses") {}

export interface CodexServerRequestResponsesOptions {
  readonly inbox: CodexPendingServerRequestRuntimeService;
  readonly projection: CodexServerRequestResponseProjection;
}

const transactionError = (cause: unknown): CodexServerRequestResponseProjectionError =>
  new CodexServerRequestResponseProjectionError({ operation: "transaction", cause });

export const make = (
  options: CodexServerRequestResponsesOptions,
): Effect.Effect<CodexServerRequestResponsesService, never, ConversationRuntimeMap | Scope.Scope> =>
  Effect.gen(function* () {
    const conversations = yield* ConversationRuntimeMap;
    const kernel = makeCodexServerRequestResponseKernel(options);
    const runSerial = <A, E>(
      threadId: string,
      operation: Effect.Effect<A, E>,
    ): Effect.Effect<A, E> => conversations.runExclusive(threadId, operation);
    const sync = <A>(
      evaluate: () => A,
    ): Effect.Effect<A, CodexServerRequestResponseProjectionError> =>
      Effect.try({ try: evaluate, catch: transactionError });

    const approval: CodexServerRequestResponsesService["approval"] = (input) =>
      sync(() => kernel.approvalTarget(input)).pipe(
        Effect.flatMap((initial) => {
          if (!initial) return Effect.succeed(false);
          return runSerial(
            initial.threadId,
            sync(() => kernel.approvalTarget(input)).pipe(
              Effect.flatMap((target) => {
                if (!target) return Effect.succeed(false);
                const normalized = { ...input, threadId: target.threadId };
                return (
                  target.follower
                    ? options.projection.respondFollowerApproval(normalized)
                    : Effect.void
                ).pipe(Effect.andThen(sync(() => kernel.approval(normalized))));
              }),
            ),
          );
        }),
      );

    const userInput: CodexServerRequestResponsesService["userInput"] = (input) =>
      sync(
        () => input.threadId?.trim() || options.projection.resolveThreadId(input.requestId),
      ).pipe(
        Effect.flatMap((threadId) => {
          if (!threadId) return Effect.succeed(false);
          return runSerial(
            threadId,
            sync(() => kernel.userInput({ ...input, threadId })).pipe(
              Effect.flatMap((result) => {
                if (!result.accepted || !result.observeResponse || !result.threadId) {
                  return Effect.succeed(result.accepted);
                }
                return options.projection
                  .observeUserInputResponse(result.threadId, input.requestId)
                  .pipe(Effect.as(true));
              }),
            ),
          );
        }),
      );

    const pendingThreadId = (
      kind: "mcp-elicitation" | "permission",
      requestId: RequestId,
      requestedThreadId?: string,
    ): string | null =>
      options.inbox.find(
        kind,
        requestId,
        (candidate) => requestedThreadId === undefined || candidate.threadId === requestedThreadId,
      )?.threadId ?? null;

    const mcpElicitation: CodexServerRequestResponsesService["mcpElicitation"] = (input) =>
      sync(() => pendingThreadId("mcp-elicitation", input.requestId, input.threadId)).pipe(
        Effect.flatMap((threadId) =>
          threadId
            ? runSerial(
                threadId,
                sync(() => kernel.mcpElicitation({ ...input, threadId })),
              )
            : Effect.succeed(false),
        ),
      );

    const permission: CodexServerRequestResponsesService["permission"] = (input) =>
      sync(() => pendingThreadId("permission", input.requestId, input.threadId)).pipe(
        Effect.flatMap((threadId) =>
          threadId
            ? runSerial(
                threadId,
                sync(() => kernel.permission({ ...input, threadId })),
              )
            : Effect.succeed(false),
        ),
      );

    const optionPicker: CodexServerRequestResponsesService["optionPicker"] = (input) =>
      runSerial(
        input.threadId,
        sync(() => kernel.optionPicker(input)),
      );
    const setupContextPicker: CodexServerRequestResponsesService["setupContextPicker"] = (input) =>
      runSerial(
        input.threadId,
        sync(() => kernel.setupContextPicker(input)),
      );
    const setupCodexStep: CodexServerRequestResponsesService["setupCodexStep"] = (input) =>
      runSerial(
        input.threadId,
        sync(() => kernel.setupCodexStep(input)),
      );

    const service = CodexServerRequestResponses.of({
      approval,
      userInput,
      mcpElicitation,
      permission,
      optionPicker,
      setupContextPicker,
      setupCodexStep,
      planImplementation: (threadId, turnId) =>
        runSerial(
          threadId,
          sync(() => {
            options.projection.completePlanImplementation({ threadId, turnId });
            return true;
          }),
        ),
      declineAll: (threadId) =>
        sync(() => [...kernel.requests(threadId)]).pipe(
          Effect.flatMap((requests) =>
            Effect.forEach(
              requests,
              (request) => {
                switch (request.method) {
                  case "item/commandExecution/requestApproval":
                    return approval({
                      threadId,
                      requestId: request.id,
                      response: { kind: "command", decision: "decline" },
                    }).pipe(Effect.asVoid);
                  case "item/fileChange/requestApproval":
                    return approval({
                      threadId,
                      requestId: request.id,
                      response: { kind: "file", decision: "decline" },
                    }).pipe(Effect.asVoid);
                  case "item/permissions/requestApproval":
                    return permission({
                      threadId,
                      requestId: request.id,
                      response: { permissions: {}, scope: "turn" },
                    }).pipe(Effect.asVoid);
                  case "item/tool/requestUserInput":
                    return userInput({ threadId, requestId: request.id, answers: {} }).pipe(
                      Effect.asVoid,
                    );
                  case "item/tool/requestOptionPicker":
                    return optionPicker({
                      threadId,
                      requestId: request.id,
                      response: {
                        action: "dismiss",
                        selectedOptions: [],
                        freeformAnswer: null,
                      },
                    }).pipe(Effect.asVoid);
                  case "item/tool/requestSetupCodexContextPicker":
                    return setupContextPicker({
                      threadId,
                      requestId: request.id,
                      response: { action: "dismiss", selectedSources: [] },
                    }).pipe(Effect.asVoid);
                  case "mcpServer/elicitation/request":
                    return mcpElicitation({
                      threadId,
                      requestId: request.id,
                      response: "decline" as CodexMcpServerElicitationAction,
                    }).pipe(Effect.asVoid);
                  default:
                    return Effect.void;
                }
              },
              { concurrency: 1, discard: true },
            ),
          ),
        ),
    });
    return service;
  });
