import { randomUUID } from "node:crypto";
import type { RequestId } from "@nodex/codex-app-server-protocol";
import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import { CodexAppServerNoResponse } from "@nodex/effect-codex-app-server/protocol";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type {
  CodexApprovalRequest,
  CodexMcpServerElicitationRequest,
  CodexPermissionRequest,
  CodexUserInputRequest,
} from "../../shared/types";
import type { CodexNotificationConversationFacts } from "../../shared/codex-thread-notification";
import { extractCodexThreadSpawnMetadata } from "../../shared/codex-subagent-metadata";
import type { CodexCanonicalServerRequest } from "../../shared/codex-conversation-state/codex-conversation-state";
import {
  reduceCodexConversationServerRequestResolved,
  reduceCodexConversationServerRequest,
  reduceCodexServerRequestResolvedRawState,
  reduceCodexServerRequestRawState,
  type CodexServerRequestLifecycleResult,
  type CodexServerRequestRawLifecycleResult,
} from "../../shared/codex-conversation-state/codex-server-request-lifecycle";
import { DEFAULT_CODEX_HOST_ID } from "../../shared/codex-host";
import {
  getCodexThreadOwnerNotificationThreadId,
  isCodexThreadOwnerNotification,
} from "../../shared/types";
import { parseThreadStatus } from "./CodexThreadCatalogProjection";
import { parseCodexAppServerMessage } from "../codex/codex-app-server-message-parser";
import {
  CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN,
  type CodexServerNotification,
  type CodexServerRequest,
} from "../codex-runtime/CodexApplicationProtocol";
import {
  CodexApplicationRequestInbox,
  type CodexApplicationNotificationOccurrence,
  type CodexApplicationRequestOccurrence,
} from "../codex-runtime/CodexApplicationRequestInbox";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import { CodexPendingServerRequestRuntime } from "./CodexPendingServerRequestRuntime";
import { CodexRendererConversationCoordinator } from "./CodexRendererConversationCoordinator";
import { CodexRendererConversationRegistry } from "./CodexRendererConversationRegistry";
import { CodexUserInputAutoResolution } from "./CodexUserInputAutoResolution";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

const ProtocolRequestPending = Symbol("CodexApplicationProtocol.ProtocolRequestPending");

export class CodexApplicationProtocol extends Context.Service<
  CodexApplicationProtocol,
  {
    readonly interpret: (occurrence: CodexApplicationRequestOccurrence) => Effect.Effect<void>;
    readonly observe: (occurrence: CodexApplicationNotificationOccurrence) => Effect.Effect<void>;
  }
>()("nodex/main/codex-application/CodexApplicationProtocol") {}

const threadIdForRequest = (request: CodexServerRequest): string | null => {
  if (request.method === "currentTime/read" || request.method === "inbox-items-create") return null;
  if ("threadId" in request.params && typeof request.params.threadId === "string") {
    return request.params.threadId;
  }
  if ("conversationId" in request.params && typeof request.params.conversationId === "string") {
    return request.params.conversationId;
  }
  return null;
};

const parseRequest = (
  occurrence: CodexApplicationRequestOccurrence,
): Effect.Effect<CodexServerRequest, CodexAppServerRequestError> => {
  const parsed = parseCodexAppServerMessage({
    id: occurrence.requestId,
    method: occurrence.method,
    params: occurrence.params,
  });
  if (!parsed.success || parsed.data.kind !== "request") {
    return Effect.fail(
      CodexAppServerRequestError.invalidParams(parsed.success ? undefined : parsed.error),
    );
  }
  return Effect.succeed(
    Object.assign(parsed.data.request, {
      [CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN]: occurrence.occurrenceToken,
    }),
  );
};

const parseNotification = (
  occurrence: CodexApplicationNotificationOccurrence,
): CodexServerNotification | null => {
  const parsed = parseCodexAppServerMessage({
    method: occurrence.method,
    params: occurrence.params,
  });
  return parsed.success && parsed.data.kind === "notification" ? parsed.data.notification : null;
};

const projectId = (
  conversations: ConversationRuntimeMap["Service"],
  threadId: string,
): string | null => conversations.currentConversation(threadId)?.readSnapshot()?.projectId ?? null;

const conversationFacts = (
  conversations: ConversationRuntimeMap["Service"],
  threadId: string,
): CodexNotificationConversationFacts => {
  const snapshot = conversations.currentConversation(threadId)?.readSnapshot();
  const parentThreadId = extractCodexThreadSpawnMetadata(snapshot?.source).parentThreadId ?? null;
  return {
    conversationId: threadId,
    title: snapshot?.threadName ?? null,
    threadSource: snapshot?.threadSource ?? null,
    parentThreadId,
    source: snapshot?.source ?? null,
    sideConversationParentNavigationPath:
      snapshot?.source &&
      typeof snapshot.source === "object" &&
      "sideConversationParentNavigationPath" in snapshot.source &&
      typeof snapshot.source.sideConversationParentNavigationPath === "string"
        ? snapshot.source.sideConversationParentNavigationPath
        : null,
  };
};

const approvalPayload = (
  conversations: ConversationRuntimeMap["Service"],
  request: Extract<
    CodexServerRequest,
    {
      method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval";
    }
  >,
  observedAtMs: number,
): CodexApprovalRequest => {
  const params = request.params;
  const kind = request.method === "item/commandExecution/requestApproval" ? "command" : "file";
  return {
    type: "approval",
    requestId: request.id,
    kind,
    projectId: projectId(conversations, params.threadId),
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    approvalId: "approvalId" in params ? (params.approvalId ?? null) : null,
    approvalRequestId: request.id,
    callId: params.itemId,
    reason: params.reason ?? undefined,
    command: "command" in params ? (params.command ?? undefined) : undefined,
    cwd: "cwd" in params ? (params.cwd ?? undefined) : undefined,
    approvalReason: params.reason ?? undefined,
    cmd:
      "command" in params && typeof params.command === "string"
        ? params.command.split(" ").filter((part) => part.trim().length > 0)
        : undefined,
    networkApprovalContext:
      "networkApprovalContext" in params && params.networkApprovalContext
        ? {
            host: params.networkApprovalContext.host,
            protocol: params.networkApprovalContext.protocol,
          }
        : null,
    proposedExecpolicyAmendment:
      "proposedExecpolicyAmendment" in params ? (params.proposedExecpolicyAmendment ?? null) : null,
    proposedNetworkPolicyAmendments:
      "proposedNetworkPolicyAmendments" in params
        ? (params.proposedNetworkPolicyAmendments?.map((amendment) => ({
            host: amendment.host,
            action: amendment.action,
          })) ?? null)
        : null,
    availableDecisions:
      "availableDecisions" in params
        ? (params.availableDecisions
            ?.map((decision) =>
              typeof decision === "string" ? decision : (Object.keys(decision)[0] ?? ""),
            )
            .filter((decision) => decision.length > 0) ?? null)
        : null,
    grantRoot: "grantRoot" in params ? (params.grantRoot ?? null) : null,
    commandActions: "commandActions" in params ? (params.commandActions ?? null) : null,
    createdAt: observedAtMs,
  };
};

const userInputPayload = (
  conversations: ConversationRuntimeMap["Service"],
  request: Extract<CodexServerRequest, { method: "item/tool/requestUserInput" }>,
  observedAtMs: number,
): CodexUserInputRequest => ({
  type: "userInput",
  requestId: request.id,
  projectId: projectId(conversations, request.params.threadId),
  threadId: request.params.threadId,
  turnId: request.params.turnId,
  itemId: request.params.itemId,
  questions: request.params.questions.map((question) => ({
    id: question.id,
    header: question.header,
    question: question.question,
    isOther: question.isOther,
    isSecret: question.isSecret,
    options: question.options?.map((option) => ({
      label: option.label,
      description: option.description,
    })),
  })),
  isBlocking: request.params.isBlocking,
  autoResolutionMs: request.params.autoResolutionMs,
  createdAt: observedAtMs,
});

const permissionPayload = (
  conversations: ConversationRuntimeMap["Service"],
  request: Extract<CodexServerRequest, { method: "item/permissions/requestApproval" }>,
): CodexPermissionRequest => ({
  type: "permissionRequest",
  requestId: request.id,
  projectId: projectId(conversations, request.params.threadId),
  threadId: request.params.threadId,
  turnId: request.params.turnId,
  itemId: request.params.itemId,
  cwd: request.params.cwd,
  reason: request.params.reason,
  permissions: request.params.permissions,
  response: null,
  completed: false,
  createdAt: request.params.startedAtMs,
});

const mcpPayload = (
  conversations: ConversationRuntimeMap["Service"],
  request: Extract<CodexServerRequest, { method: "mcpServer/elicitation/request" }>,
  observedAtMs: number,
): CodexMcpServerElicitationRequest => ({
  type: "mcpServerElicitation",
  requestId: request.id,
  projectId: projectId(conversations, request.params.threadId),
  threadId: request.params.threadId,
  turnId: request.params.turnId ?? "",
  itemId: `mcp-server-elicitation-${String(request.id)}`,
  kind: request.params.mode === "url" ? "toolSuggestion" : "generic",
  mode: request.params.mode,
  serverName: request.params.serverName,
  message: request.params.message,
  url: request.params.mode === "url" ? request.params.url : undefined,
  elicitationId: request.params.mode === "url" ? request.params.elicitationId : undefined,
  requestedSchema: request.params.mode !== "url" ? request.params.requestedSchema : undefined,
  meta: request.params._meta,
  createdAt: observedAtMs,
});

type Lifecycle = CodexServerRequestLifecycleResult | CodexServerRequestRawLifecycleResult;

/**
 * Owns the application interpretation of the single transport-ordered protocol stream. Request
 * generations stay interruptible in the pre-endpoint Inbox while per-Thread command lanes provide
 * causal ordering without allowing one conversation to block another.
 */
export const make: Effect.Effect<
  CodexApplicationProtocol["Service"],
  never,
  | CodexApplicationEventHub
  | CodexApplicationRequestInbox
  | CodexPendingServerRequestRuntime
  | CodexRendererConversationCoordinator
  | CodexRendererConversationRegistry
  | CodexUserInputAutoResolution
  | ConversationRuntimeMap
  | Scope.Scope
> = Effect.gen(function* () {
  const applicationEvents = yield* CodexApplicationEventHub;
  const inbox = yield* CodexApplicationRequestInbox;
  const pending = yield* CodexPendingServerRequestRuntime;
  const renderer = yield* CodexRendererConversationCoordinator;
  const rendererRegistry = yield* CodexRendererConversationRegistry;
  const autoResolution = yield* CodexUserInputAutoResolution;
  const conversations = yield* ConversationRuntimeMap;

  const reduceRequest = (
    threadId: string,
    request: CodexCanonicalServerRequest,
    observedAtMs: number,
  ): Lifecycle => {
    const aggregate = conversations.conversation(threadId);
    const state = aggregate.readServerRequestState();
    const context = { now: () => observedAtMs, isOpenAIFormElicitationsEnabled: true };
    if (state.canonicalState) {
      const lifecycle = reduceCodexConversationServerRequest(
        state.canonicalState,
        request,
        context,
      );
      aggregate.commitServerRequestLifecycle({
        kind: "canonical",
        before: state.canonicalState,
        lifecycle,
        observedAtMs,
        projectReplica: !rendererRegistry.hasOwner(threadId),
      });
      return lifecycle;
    }
    const lifecycle = reduceCodexServerRequestRawState(state.rawState, request, context);
    aggregate.commitServerRequestLifecycle({
      kind: "raw",
      lifecycle,
      observedAtMs,
      projectReplica: !rendererRegistry.hasOwner(threadId),
    });
    return lifecycle;
  };

  const responseEffect = (lifecycle: Lifecycle): unknown | undefined => {
    const response = lifecycle.effects.find((effect) => effect.type === "respond");
    return response?.type === "respond" ? response.response : undefined;
  };

  const publishRequestNotification = (
    threadId: string,
    requestId: RequestId,
    turnId: string,
    input:
      | {
          readonly kind: "approval";
          readonly approvalKind: "commandExecution" | "fileChange" | "permissionRequest";
          readonly reason: string | null;
        }
      | { readonly kind: "user-input"; readonly questionCount: number },
  ): void => {
    applicationEvents.publish({
      kind: "threadNotification",
      value:
        input.kind === "approval"
          ? {
              type: "approval-requested",
              hostId: DEFAULT_CODEX_HOST_ID,
              conversation: conversationFacts(conversations, threadId),
              requestId,
              turnId,
              approvalKind: input.approvalKind,
              reason: input.reason,
            }
          : {
              type: "user-input-requested",
              hostId: DEFAULT_CODEX_HOST_ID,
              conversation: conversationFacts(conversations, threadId),
              requestId,
              turnId,
              questionCount: input.questionCount,
            },
    });
  };

  const storeInteractiveRequest = Effect.fn("CodexApplicationProtocol.storeInteractiveRequest")(
    function* (request: CodexServerRequest, observedAtMs: number) {
      switch (request.method) {
        case "item/commandExecution/requestApproval":
        case "item/fileChange/requestApproval": {
          const payload = approvalPayload(conversations, request, observedAtMs);
          pending.register({
            kind: "approval",
            request: payload,
            occurrenceToken: request[CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN],
          });
          applicationEvents.publish({
            kind: "codex",
            value: { type: "approvalRequested", request: payload },
          });
          publishRequestNotification(payload.threadId, payload.requestId, payload.turnId, {
            kind: "approval",
            approvalKind: payload.kind === "command" ? "commandExecution" : "fileChange",
            reason: payload.reason ?? null,
          });
          break;
        }
        case "item/permissions/requestApproval": {
          const payload = permissionPayload(conversations, request);
          pending.register({
            kind: "permission",
            request: payload,
            occurrenceToken: request[CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN],
          });
          publishRequestNotification(payload.threadId, payload.requestId, payload.turnId, {
            kind: "approval",
            approvalKind: "permissionRequest",
            reason: payload.reason,
          });
          break;
        }
        case "item/tool/requestUserInput": {
          const payload = userInputPayload(conversations, request, observedAtMs);
          pending.register({
            kind: "user-input",
            request: payload,
            occurrenceToken: request[CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN],
          });
          if (!payload.isBlocking)
            yield* autoResolution.observeRequest(payload.threadId, payload.requestId);
          applicationEvents.publish({
            kind: "codex",
            value: { type: "userInputRequested", request: payload },
          });
          publishRequestNotification(payload.threadId, payload.requestId, payload.turnId, {
            kind: "user-input",
            questionCount: payload.questions.length,
          });
          break;
        }
        case "mcpServer/elicitation/request": {
          const payload = mcpPayload(conversations, request, observedAtMs);
          pending.register({
            kind: "mcp-elicitation",
            request: payload,
            occurrenceToken: request[CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN],
          });
          break;
        }
        case "item/tool/requestOptionPicker":
        case "item/tool/requestSetupCodexContextPicker":
          pending.register({
            kind: "private",
            request,
            occurrenceToken: request[CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN],
          });
          break;
        case "item/tool/call":
          pending.register({
            kind: "dynamic-tool",
            request,
            occurrenceToken: request[CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN],
            nodexAuthority: null,
            disposition: "stored",
          });
          break;
        default:
          break;
      }
      const routed = renderer.forwardServerRequest(request as never);
      if (routed) renderer.reconcileOwnership(threadIdForRequest(request) ?? "");
    },
  );

  const handleRequest = Effect.fn("CodexApplicationProtocol.handleRequest")(function* (
    request: CodexServerRequest,
  ) {
    if (request.method === "inbox-items-create") return CodexAppServerNoResponse;
    const threadId = threadIdForRequest(request);
    const observedAtMs = yield* Clock.currentTimeMillis;
    if (!threadId) {
      if (request.method === "currentTime/read") {
        return { currentTimeAt: Math.floor(observedAtMs / 1_000) };
      }
      return CodexAppServerNoResponse;
    }
    const lifecycle = reduceRequest(threadId, request as CodexCanonicalServerRequest, observedAtMs);
    const response = responseEffect(lifecycle);
    if (response !== undefined) return response;
    if (lifecycle.disposition === "dispatched" && request.method === "item/tool/call") {
      if (!rendererRegistry.hasOwner(threadId)) return CodexAppServerNoResponse;
      pending.register({
        kind: "dynamic-tool",
        request,
        occurrenceToken: request[CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN],
        nodexAuthority: null,
        disposition: "dispatched",
      });
      if (!renderer.forwardServerRequest(request)) return CodexAppServerNoResponse;
      renderer.reconcileOwnership(threadId);
      return ProtocolRequestPending;
    }
    if (lifecycle.disposition !== "stored") return CodexAppServerNoResponse;
    if (request.method === "item/plan/requestImplementation") return CodexAppServerNoResponse;
    yield* storeInteractiveRequest(request, observedAtMs);
    return ProtocolRequestPending;
  });

  const settleResolvedRequest = Effect.fn("CodexApplicationProtocol.settleResolvedRequest")(
    function* (threadId: string, requestId: RequestId) {
      renderer.clearRequestDelivery(threadId, requestId);
      yield* autoResolution.observeServerResolution(threadId, requestId);
      applicationEvents.publish({
        kind: "threadNotification",
        value: {
          type: "request-resolved",
          hostId: DEFAULT_CODEX_HOST_ID,
          conversationId: threadId,
          requestId,
        },
      });
      const complete = <Kind extends Parameters<typeof pending.takeAll>[0]>(kind: Kind) => {
        const entries = pending.takeAll(kind, requestId, (entry) => entry.threadId === threadId);
        for (const entry of entries)
          pending.complete(entry as never, CodexAppServerNoResponse as never);
      };
      complete("approval");
      complete("dynamic-tool");
      complete("mcp-elicitation");
      complete("permission");
      complete("private");
      complete("user-input");
    },
  );

  const observeNotification = Effect.fn("CodexApplicationProtocol.observeNotification")(function* (
    notification: CodexServerNotification,
  ) {
    if (!isCodexThreadOwnerNotification(notification)) return;
    const threadId = getCodexThreadOwnerNotificationThreadId(notification);
    const ownerRouted = renderer.forwardNotificationForConversation(threadId, notification);
    const observedAtMs = yield* Clock.currentTimeMillis;
    const aggregate = conversations.currentConversation(threadId);
    if (notification.method === "serverRequest/resolved" && aggregate) {
      const state = aggregate.readServerRequestState();
      if (state.canonicalState) {
        const lifecycle = reduceCodexConversationServerRequestResolved(
          state.canonicalState,
          notification,
          { now: () => observedAtMs },
        );
        aggregate.commitServerRequestLifecycle({
          kind: "canonical",
          before: state.canonicalState,
          lifecycle,
          observedAtMs,
          projectReplica: !ownerRouted,
        });
      } else {
        aggregate.commitServerRequestLifecycle({
          kind: "raw",
          lifecycle: reduceCodexServerRequestResolvedRawState(state.rawState, notification, {
            now: () => observedAtMs,
          }),
          observedAtMs,
          projectReplica: !ownerRouted,
        });
      }
      yield* settleResolvedRequest(threadId, notification.params.requestId);
      return;
    }
    aggregate?.commitProtocolNotification({
      notification,
      observedAtMs,
      projectReplica: !ownerRouted,
      createId: () => randomUUID(),
    });
    if (notification.method !== "thread/status/changed") return;
    const status = parseThreadStatus(notification.params.status);
    applicationEvents.publish({
      kind: "codex",
      value: {
        type: "threadStatus",
        threadId,
        statusType: status.statusType,
        statusActiveFlags: status.statusActiveFlags,
      },
    });
  });

  const interpret: CodexApplicationProtocol["Service"]["interpret"] = (occurrence) =>
    parseRequest(occurrence).pipe(
      Effect.flatMap((request) => {
        const threadId = threadIdForRequest(request);
        const operation = threadId
          ? conversations.runExclusive(threadId, handleRequest(request))
          : handleRequest(request);
        return inbox.interpret(occurrence, operation);
      }),
      Effect.matchEffect({
        onFailure: (error) =>
          inbox.settle(occurrence, {
            kind: "error",
            error:
              error instanceof CodexAppServerRequestError
                ? error
                : CodexAppServerRequestError.internalError(
                    `Nodex could not interpret Codex request '${occurrence.method}'`,
                    undefined,
                    { method: occurrence.method, operation: "handle-request", cause: error },
                  ),
          }),
        onSuccess: (interpretation) => {
          if (
            interpretation.kind === "withdrawn" ||
            interpretation.value === ProtocolRequestPending
          ) {
            return Effect.void;
          }
          return inbox.settle(
            occurrence,
            interpretation.value === CodexAppServerNoResponse
              ? { kind: "abandon" }
              : { kind: "result", value: interpretation.value },
          );
        },
      }),
      Effect.asVoid,
    );

  const observe: CodexApplicationProtocol["Service"]["observe"] = (occurrence) => {
    const notification = parseNotification(occurrence);
    if (!notification) return Effect.void;
    if (!isCodexThreadOwnerNotification(notification)) return Effect.void;
    const threadId = getCodexThreadOwnerNotificationThreadId(notification);
    return conversations.runExclusive(threadId, observeNotification(notification));
  };

  const service = CodexApplicationProtocol.of({ interpret, observe });
  yield* inbox.occurrences.pipe(
    Stream.mapEffect(
      (occurrence) => (occurrence.kind === "request" ? interpret(occurrence) : observe(occurrence)),
      { concurrency: "unbounded", unordered: true },
    ),
    Stream.runDrain,
    Effect.forkScoped({ startImmediately: true }),
  );
  return service;
});

export const live: Layer.Layer<
  CodexApplicationProtocol,
  never,
  | CodexApplicationEventHub
  | CodexApplicationRequestInbox
  | CodexPendingServerRequestRuntime
  | CodexRendererConversationCoordinator
  | CodexRendererConversationRegistry
  | CodexUserInputAutoResolution
  | ConversationRuntimeMap
> = Layer.effect(CodexApplicationProtocol, make);
