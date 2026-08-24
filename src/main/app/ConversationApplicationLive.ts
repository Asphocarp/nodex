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
  CodexThreadTitlePersistence,
  make as makeCodexThreadTitlePersistence,
} from "../codex-application/CodexThreadTitlePersistence";
import {
  CodexConversationHistoryRuntime,
  make as makeCodexConversationHistoryRuntime,
} from "../codex-application/CodexConversationHistoryRuntime";
import {
  CodexSubagentCatalog,
  make as makeCodexSubagentCatalog,
} from "../codex-application/CodexSubagentCatalog";
import {
  CodexConversationMaterialization,
  make as makeCodexConversationMaterialization,
} from "../codex-application/CodexConversationMaterialization";
import {
  CodexAutomationRunAcceptance,
  make as makeCodexAutomationRunAcceptance,
} from "../codex-application/CodexAutomationRunAcceptance";
import {
  CodexTurnAuthority,
  make as makeCodexTurnAuthority,
} from "../codex-application/CodexTurnAuthority";
import {
  CodexNotificationAdmission,
  make as makeCodexNotificationAdmission,
} from "../codex-application/CodexNotificationAdmission";
import {
  CodexTurnPreparation,
  make as makeCodexTurnPreparation,
} from "../codex-application/CodexTurnPreparation";
import {
  CodexQueuedFollowUps,
  make as makeCodexQueuedFollowUps,
} from "../codex-application/CodexQueuedFollowUps";
import {
  CodexTurnCommands,
  make as makeCodexTurnCommands,
} from "../codex-application/CodexTurnCommands";
import {
  CodexActiveGoalContinuation,
  make as makeCodexActiveGoalContinuation,
} from "../codex-application/CodexActiveGoalContinuation";
import {
  CodexThreadLaunchCompletion,
  make as makeCodexThreadLaunchCompletion,
} from "../codex-application/CodexThreadLaunchCompletion";
import {
  CodexFreshThreadLaunchRuntime,
  make as makeCodexFreshThreadLaunchRuntime,
} from "../codex-application/CodexFreshThreadLaunchRuntime";
import {
  CodexQueuedFollowUpDispatcher,
  make as makeCodexQueuedFollowUpDispatcher,
} from "../codex-application/CodexQueuedFollowUpDispatcher";
import {
  CodexConversationArchive,
  make as makeCodexConversationArchive,
} from "../codex-application/CodexConversationArchive";
import { live as conversationCommandsLive } from "../codex-application/ConversationCommands";
import {
  CodexConversationDeltaBufferRuntime,
  make as makeCodexConversationDeltaBufferRuntime,
} from "../codex-application/CodexConversationDeltaBufferRuntime";
import {
  CodexPostResumeGoalRuntime,
  make as makeCodexPostResumeGoalRuntime,
} from "../codex-application/CodexPostResumeGoalRuntime";
import { live as codexThreadExecutionLive } from "../codex-application/CodexThreadExecution";
import {
  CodexThreadCatalog,
  make as makeCodexThreadCatalog,
} from "../codex-application/CodexThreadCatalog";
import {
  CodexClientThreadIdentity,
  make as makeCodexClientThreadIdentity,
} from "../codex-application/CodexClientThreadIdentity";
import {
  CodexForkSidePanelTransfer,
  make as makeCodexForkSidePanelTransfer,
} from "../codex-application/CodexForkSidePanelTransferRuntime";
import {
  CodexForkTitlePolicy,
  make as makeCodexForkTitlePolicy,
} from "../codex-application/CodexForkTitlePolicy";
import {
  CodexConversationFork,
  make as makeCodexConversationFork,
} from "../codex-application/CodexConversationFork";
import {
  CodexConversationCreation,
  make as makeCodexConversationCreation,
} from "../codex-application/CodexConversationCreation";
import {
  CodexPendingWorktreeRuntime,
  make as makeCodexPendingWorktreeRuntime,
} from "../codex-application/CodexPendingWorktreeRuntime";
import { live as managedWorktreeRetentionLive } from "../codex-application/ManagedWorktreeRetentionRuntime";
import { live as crossHostThreadHandoffLive } from "../codex-application/CrossHostThreadHandoff";
import { live as managedWorktreeHandoffLive } from "../codex-application/ManagedWorktreeHandoff";
import {
  CodexThreadHandoffRuntime,
  make as makeCodexThreadHandoffRuntime,
} from "../codex-application/CodexThreadHandoffRuntime";
import {
  AgentImportRuntime,
  make as makeAgentImportRuntime,
} from "../codex-application/AgentImportRuntime";
import {
  CodexThreadSettingsRuntime,
  make as makeCodexThreadSettingsRuntime,
} from "../codex-application/CodexThreadSettingsRuntime";
import {
  CodexThreadStartNotificationGate,
  make as makeCodexThreadStartNotificationGate,
} from "../codex-application/CodexThreadStartNotificationGate";
import { CodexGateway, CodexThreadHostResolver } from "../codex-runtime/CodexGateway";
import { makePersistedAtomStore } from "../local-store/persisted-atoms";
import { resolveCodexThreadHandoffJournalPath } from "../codex/codex-thread-handoff-journal";
import { makeCodexThreadHandoffJournalStorage } from "../platform/CodexThreadHandoffJournalStorage";
import { CodexPlatform } from "./CodexApplicationLive";
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

const foundations = Layer.mergeAll(
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

const titlePersistence = Layer.effect(
  CodexThreadTitlePersistence,
  makeCodexThreadTitlePersistence,
).pipe(Layer.provideMerge(foundations));
const history = Layer.effect(
  CodexConversationHistoryRuntime,
  makeCodexConversationHistoryRuntime,
).pipe(Layer.provideMerge(titlePersistence));
const subagents = Layer.effect(CodexSubagentCatalog, makeCodexSubagentCatalog).pipe(
  Layer.provideMerge(history),
);
const materialization = Layer.effect(
  CodexConversationMaterialization,
  makeCodexConversationMaterialization,
).pipe(Layer.provideMerge(subagents));
const automationAcceptance = Layer.effect(
  CodexAutomationRunAcceptance,
  makeCodexAutomationRunAcceptance,
).pipe(Layer.provideMerge(materialization));
const turnAuthority = Layer.effect(CodexTurnAuthority, makeCodexTurnAuthority).pipe(
  Layer.provideMerge(automationAcceptance),
);
const notificationAdmission = Layer.effect(
  CodexNotificationAdmission,
  makeCodexNotificationAdmission,
).pipe(Layer.provideMerge(turnAuthority));
const turnPreparation = Layer.effect(CodexTurnPreparation, makeCodexTurnPreparation).pipe(
  Layer.provideMerge(notificationAdmission),
);
const queuedFollowUps = Layer.effect(CodexQueuedFollowUps, makeCodexQueuedFollowUps).pipe(
  Layer.provideMerge(turnPreparation),
);
const turnCommands = Layer.effect(CodexTurnCommands, makeCodexTurnCommands).pipe(
  Layer.provideMerge(queuedFollowUps),
);
const activeGoalContinuation = Layer.effect(
  CodexActiveGoalContinuation,
  makeCodexActiveGoalContinuation,
).pipe(Layer.provideMerge(turnCommands));
const launchCompletion = Layer.effect(
  CodexThreadLaunchCompletion,
  makeCodexThreadLaunchCompletion,
).pipe(Layer.provideMerge(activeGoalContinuation));
const freshThreadLaunch = Layer.effect(
  CodexFreshThreadLaunchRuntime,
  makeCodexFreshThreadLaunchRuntime,
).pipe(Layer.provideMerge(launchCompletion));
const queuedFollowUpDispatcher = Layer.effect(
  CodexQueuedFollowUpDispatcher,
  makeCodexQueuedFollowUpDispatcher,
).pipe(Layer.provideMerge(freshThreadLaunch));
const conversationArchive = Layer.effect(
  CodexConversationArchive,
  makeCodexConversationArchive,
).pipe(Layer.provideMerge(queuedFollowUpDispatcher));
const commands = conversationCommandsLive.pipe(Layer.provideMerge(conversationArchive));
const deltaBuffer = Layer.effect(
  CodexConversationDeltaBufferRuntime,
  makeCodexConversationDeltaBufferRuntime(),
).pipe(Layer.provideMerge(commands));
const postResumeGoals = Layer.effect(
  CodexPostResumeGoalRuntime,
  makeCodexPostResumeGoalRuntime,
).pipe(Layer.provideMerge(deltaBuffer));
const threadExecution = codexThreadExecutionLive.pipe(Layer.provideMerge(postResumeGoals));

const threadCatalog = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    return Layer.effect(
      CodexThreadCatalog,
      makeCodexThreadCatalog({ foldPathCase: config.platform === "win32" }),
    );
  }),
).pipe(Layer.provideMerge(threadExecution));
const clientThreadIdentity = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    return Layer.effect(
      CodexClientThreadIdentity,
      makeCodexClientThreadIdentity(makePersistedAtomStore(config.nodexHome)),
    );
  }),
).pipe(Layer.provideMerge(threadCatalog));
const forkSidePanelTransfer = Layer.effect(
  CodexForkSidePanelTransfer,
  makeCodexForkSidePanelTransfer,
).pipe(Layer.provideMerge(clientThreadIdentity));
const forkTitlePolicy = Layer.effect(CodexForkTitlePolicy, makeCodexForkTitlePolicy).pipe(
  Layer.provideMerge(forkSidePanelTransfer),
);
const conversationFork = Layer.effect(CodexConversationFork, makeCodexConversationFork).pipe(
  Layer.provideMerge(forkTitlePolicy),
);
const conversationCreation = Layer.effect(
  CodexConversationCreation,
  makeCodexConversationCreation,
).pipe(Layer.provideMerge(conversationFork));
const pendingWorktrees = Layer.effect(
  CodexPendingWorktreeRuntime,
  makeCodexPendingWorktreeRuntime,
).pipe(Layer.provideMerge(conversationCreation));
const managedWorktreeRetention = managedWorktreeRetentionLive({}).pipe(
  Layer.provideMerge(pendingWorktrees),
);
const crossHostThreadHandoff = Layer.unwrap(
  Effect.gen(function* () {
    const platform = yield* CodexPlatform;
    return crossHostThreadHandoffLive({ relayBaseRoot: `${platform.runtimeStateHome}/handoffs` });
  }),
).pipe(Layer.provideMerge(managedWorktreeRetention));
const managedWorktreeHandoff = managedWorktreeHandoffLive.pipe(
  Layer.provideMerge(crossHostThreadHandoff),
);
const threadHandoff = Layer.unwrap(
  Effect.gen(function* () {
    const platform = yield* CodexPlatform;
    return Layer.effect(
      CodexThreadHandoffRuntime,
      makeCodexThreadHandoffRuntime({
        storage: makeCodexThreadHandoffJournalStorage(
          resolveCodexThreadHandoffJournalPath(platform.runtimeStateHome),
        ),
      }),
    );
  }),
).pipe(Layer.provideMerge(managedWorktreeHandoff));
const agentImport = Layer.unwrap(
  Effect.gen(function* () {
    const platform = yield* CodexPlatform;
    return Layer.effect(
      AgentImportRuntime,
      makeAgentImportRuntime({ runtimeStateHome: platform.runtimeStateHome }),
    );
  }),
).pipe(Layer.provideMerge(threadHandoff));

/** Canonical Conversation projections and semantic command capabilities. */
export const live = agentImport;
