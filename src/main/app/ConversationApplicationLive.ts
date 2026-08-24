import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  CodexConversationContext,
  make as makeCodexConversationContext,
} from "../codex-application/CodexConversationContext";
import {
  CodexConversationProjection,
  make as makeCodexConversationProjection,
} from "../codex-application/CodexConversationProjection";
import {
  CodexConversationRelationships,
  make as makeCodexConversationRelationships,
} from "../codex-application/CodexConversationRelationships";
import {
  CodexExternalAgentImportRuntime,
  make as makeCodexExternalAgentImportRuntime,
} from "../codex-application/CodexExternalAgentImportRuntime";
import { CodexGitProbe, make as makeCodexGitProbe } from "../codex-application/CodexGitProbe";
import {
  CodexHeartbeatTurnCompletion,
  CodexHeartbeatTurnCompletionError,
  make as makeCodexHeartbeatTurnCompletion,
} from "../codex-application/CodexHeartbeatTurnCompletion";
import {
  CodexInternalThreadRegistry,
  make as makeCodexInternalThreadRegistry,
} from "../codex-application/CodexInternalThreadRegistry";
import {
  CodexSidebarSyncRuntime,
  make as makeCodexSidebarSyncRuntime,
} from "../codex-application/CodexSidebarSyncRuntime";
import {
  CodexStructuredThreadTitle,
  CodexStructuredThreadTitleError,
  make as makeCodexStructuredThreadTitle,
} from "../codex-application/CodexStructuredThreadTitle";
import {
  CodexThreadDirectory,
  make as makeCodexThreadDirectory,
} from "../codex-application/CodexThreadDirectory";
import { live as codexThreadGoalRuntimeLive } from "../codex-application/CodexThreadGoalRuntime";
import {
  CodexThreadSettingsRuntime,
  make as makeCodexThreadSettingsRuntime,
} from "../codex-application/CodexThreadSettingsRuntime";
import {
  CodexThreadStartNotificationGate,
  make as makeCodexThreadStartNotificationGate,
} from "../codex-application/CodexThreadStartNotificationGate";
import { CodexGateway, CodexThreadHostResolver } from "../codex-runtime/CodexGateway";
import { MainConfig } from "./MainConfig";

const conversationContext = Layer.effect(CodexConversationContext, makeCodexConversationContext);
const conversationProjection = Layer.effect(
  CodexConversationProjection,
  makeCodexConversationProjection,
);
const internalThreadRegistry = Layer.effect(
  CodexInternalThreadRegistry,
  makeCodexInternalThreadRegistry,
);
const threadStartNotifications = Layer.effect(
  CodexThreadStartNotificationGate,
  makeCodexThreadStartNotificationGate,
);

const threadDirectory = Layer.effect(CodexThreadDirectory, makeCodexThreadDirectory).pipe(
  Layer.provideMerge(conversationProjection),
);
const conversationRelationships = Layer.effect(
  CodexConversationRelationships,
  makeCodexConversationRelationships,
).pipe(Layer.provideMerge(threadDirectory));

const sidebarSync = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    return Layer.effect(
      CodexSidebarSyncRuntime,
      makeCodexSidebarSyncRuntime({ foldPathCase: config.platform === "win32" }),
    );
  }),
).pipe(Layer.provideMerge(Layer.mergeAll(threadDirectory, internalThreadRegistry)));

const gitProbe = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    return Layer.succeed(CodexGitProbe, makeCodexGitProbe({ environment: config.environment }));
  }),
);
const externalAgentImport = Layer.effect(
  CodexExternalAgentImportRuntime,
  makeCodexExternalAgentImportRuntime(),
);
const heartbeatTurnCompletion = Layer.unwrap(
  Effect.gen(function* () {
    const gateway = yield* CodexGateway;
    const hostResolver = yield* CodexThreadHostResolver;
    return Layer.effect(
      CodexHeartbeatTurnCompletion,
      makeCodexHeartbeatTurnCompletion({
        events: gateway.events,
        resolveHost: (threadId) =>
          hostResolver.resolve(threadId).pipe(
            Effect.mapError(
              (cause) =>
                new CodexHeartbeatTurnCompletionError({
                  reason: "request-failed",
                  message: `Could not resolve the execution host for heartbeat thread ${threadId}`,
                  cause,
                  threadId,
                }),
            ),
          ),
        request: (hostId, params) =>
          gateway.requestOnHost(hostId, "turn/start", params).pipe(
            Effect.mapError(
              (cause) =>
                new CodexHeartbeatTurnCompletionError({
                  reason: "request-failed",
                  message: `Could not start the heartbeat turn on host ${hostId}`,
                  cause,
                  threadId: params.threadId,
                }),
            ),
          ),
      }),
    );
  }),
);

const structuredThreadTitle = Layer.unwrap(
  Effect.gen(function* () {
    const gateway = yield* CodexGateway;
    return Layer.effect(
      CodexStructuredThreadTitle,
      makeCodexStructuredThreadTitle({
        hostId: gateway.localHostId,
        events: gateway.events,
        startThread: (params) =>
          gateway.requestLocal("thread/start", params).pipe(
            Effect.mapError(
              (cause) =>
                new CodexStructuredThreadTitleError({
                  reason: "request-failed",
                  message: "Structured thread title thread/start failed",
                  cause,
                }),
            ),
          ),
        startTurn: (params) =>
          gateway.requestLocal("turn/start", params).pipe(
            Effect.mapError(
              (cause) =>
                new CodexStructuredThreadTitleError({
                  reason: "request-failed",
                  message: "Structured thread title turn/start failed",
                  cause,
                  threadId: params.threadId,
                }),
            ),
          ),
        interruptTurn: (threadId, turnId) =>
          gateway.requestLocal("turn/interrupt", { threadId, turnId }).pipe(
            Effect.mapError(
              (cause) =>
                new CodexStructuredThreadTitleError({
                  reason: "request-failed",
                  message: "Structured thread title turn/interrupt failed",
                  cause,
                  threadId,
                  turnId,
                }),
            ),
          ),
        unsubscribeThread: (threadId) =>
          gateway.requestLocal("thread/unsubscribe", { threadId }).pipe(
            Effect.mapError(
              (cause) =>
                new CodexStructuredThreadTitleError({
                  reason: "request-failed",
                  message: "Structured thread title thread/unsubscribe failed",
                  cause,
                  threadId,
                }),
            ),
          ),
      }),
    );
  }),
).pipe(Layer.provideMerge(Layer.merge(internalThreadRegistry, threadStartNotifications)));

const threadSettings = Layer.effect(
  CodexThreadSettingsRuntime,
  makeCodexThreadSettingsRuntime,
).pipe(Layer.provideMerge(Layer.merge(conversationProjection, sidebarSync)));
const threadGoals = codexThreadGoalRuntimeLive.pipe(
  Layer.provideMerge(Layer.merge(conversationProjection, threadSettings)),
);

/** Canonical Conversation projections and catalog foundations shared by all semantic commands. */
export const live = Layer.mergeAll(
  conversationContext,
  conversationRelationships,
  externalAgentImport,
  gitProbe,
  heartbeatTurnCompletion,
  sidebarSync,
  structuredThreadTitle,
  threadGoals,
  threadStartNotifications,
);
