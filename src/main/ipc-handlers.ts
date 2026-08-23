import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import {
  BrowserWindow,
  dialog,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from "electron";
import { MainConfig } from "./app/MainConfig";
import type { CodexService } from "./codex/codex-service";
import type { CodexManualCompactionRuntime } from "./codex-application/CodexManualCompactionRuntime";
import type { CodexThreadGoalRuntime } from "./codex-application/CodexThreadGoalRuntime";
import type { CodexThreadSettingsRuntime } from "./codex-application/CodexThreadSettingsRuntime";
import type { CodexThreadCatalog } from "./codex-application/CodexThreadCatalog";
import type { CodexThreadTitlePersistence } from "./codex-application/CodexThreadTitlePersistence";
import type { ConversationCommands } from "./codex-application/ConversationCommands";
import type { CodexBackgroundProcesses } from "./codex-application/CodexBackgroundProcesses";
import type { CodexSubagentCatalog } from "./codex-application/CodexSubagentCatalog";
import type { CodexServerRequestResponsesService } from "./codex-application/CodexServerRequestResponses";
import type { CodexSidebarSyncRuntime } from "./codex-application/CodexSidebarSyncRuntime";
import type { CodexThreadReadState } from "./codex-application/CodexThreadReadState";
import type { AgentImportRuntime } from "./codex-application/AgentImportRuntime";
import type { CodexConversationHistoryRuntime } from "./codex-application/CodexConversationHistoryRuntime";
import type { CodexConversationResumeRuntime } from "./codex-application/CodexConversationResumeRuntime";
import type { CodexQueuedFollowUpRuntime } from "./codex-application/CodexQueuedFollowUpRuntime";
import type { CodexFreshThreadLaunchRuntimeService } from "./codex-application/CodexFreshThreadLaunchRuntime";
import type { CodexStructuredThreadTitle } from "./codex-application/CodexStructuredThreadTitle";
import type { ManagedWorktreeCatalog } from "./codex-application/ManagedWorktreeCatalog";
import { parseCodexApprovalResponse } from "../shared/codex-approval-response";
import {
  createCodexProjectlessWorkspace,
  parseCodexProjectlessThreadCwdInput,
} from "./codex/codex-projectless-workspace";
import type {
  CodexBackgroundProcessRunActionInput,
  CodexApprovalResponse,
  CodexCollaborationModeKind,
  CodexProtocolRequestId,
} from "../shared/types";
import type {
  AgentImportApplyInput,
  AgentImportScanInput,
  AgentImportSourceKind,
} from "../shared/agent-import";
import type { ThreadBackgroundTerminal } from "@nodex/codex-app-server-protocol/v2/ThreadBackgroundTerminal";
import type {
  RendererClientRuntimeService,
  RendererClientWebContents,
} from "./codex/renderer-client-runtime-contracts";
import { requireTrustedAppRendererSender as requireTrustedAppRendererSenderWithOrigin } from "./platform/electron/TrustedRendererSender";
import { captureMainException } from "./observability/sentry-main";
import { ElectronIpc } from "./platform/electron/ElectronIpc";
import { WindowRuntime } from "./window-runtime/WindowRuntime";
import type { IpcApi } from "../shared/ipc-api";
import type {
  CodexBackgroundSubagentThreadsHydrateInput,
  CodexSubagentPanelHydrateInput,
  CodexConversationThreadSettingsPatch,
  CodexSideChatStartInput,
  CodexThreadGoalSetActionInput,
  CodexThreadStartForSessionInput,
  CodexTurnStartOptions,
} from "../shared/types";
import {
  approximateJsonPayloadBytes,
  getDevRuntimeMetricDurationMs,
  getDevRuntimeMetricStart,
  logDevRuntimeMetric,
  recordDevRuntimeMetricCounter,
} from "./dev-runtime-metrics";

type TypedIpcHandler<Channel extends keyof IpcApi> = (
  event: IpcMainInvokeEvent,
  ...args: [...IpcApi[Channel]["args"], signal?: AbortSignal]
) => IpcApi[Channel]["result"] | Promise<IpcApi[Channel]["result"]>;

type TypedEffectIpcHandler<Channel extends keyof IpcApi> = (
  event: IpcMainInvokeEvent,
  ...args: IpcApi[Channel]["args"]
) => Effect.Effect<IpcApi[Channel]["result"], CodexIpcError>;

function requireNonBlankStringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new Error(`${label} must contain only non-empty strings`);
  }
  return [...value];
}

async function showDirectoryPicker(
  event: IpcMainInvokeEvent,
  options: OpenDialogOptions,
): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(event.sender);
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0] ?? null;
}

interface CodexIpcOptions {
  codexService: CodexService;
  managedWorktreeCatalog: ManagedWorktreeCatalog["Service"];
  manualCompaction: CodexManualCompactionRuntime["Service"];
  threadGoals: CodexThreadGoalRuntime["Service"];
  threadSettings: CodexThreadSettingsRuntime["Service"];
  threadCatalog: CodexThreadCatalog["Service"];
  threadTitles: CodexThreadTitlePersistence["Service"];
  conversationCommands: ConversationCommands["Service"];
  sidebarSync: CodexSidebarSyncRuntime["Service"];
  threadReadState: CodexThreadReadState["Service"];
  agentImport: AgentImportRuntime["Service"];
  conversationHistory: CodexConversationHistoryRuntime["Service"];
  conversationResume: CodexConversationResumeRuntime["Service"];
  queuedFollowUps: CodexQueuedFollowUpRuntime["Service"];
  freshThreadLaunch: CodexFreshThreadLaunchRuntimeService;
  structuredThreadTitle: CodexStructuredThreadTitle["Service"];
  backgroundProcesses: CodexBackgroundProcesses["Service"];
  subagentCatalog: CodexSubagentCatalog["Service"];
  serverRequestResponses: CodexServerRequestResponsesService;
  rendererClientRouter: RendererClientRuntimeService;
}

export class CodexIpcError extends Schema.TaggedError<CodexIpcError>()("CodexIpcError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export const codexIpcLive = (
  options: CodexIpcOptions,
): Layer.Layer<never, never, ElectronIpc | MainConfig | WindowRuntime> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const { codexService } = options;
      const config = yield* MainConfig;
      const ipc = yield* ElectronIpc;
      const windows = yield* WindowRuntime;
      const registrations: Array<Effect.Effect<void, never, Scope.Scope>> = [];
      const authorize = (event: IpcMainInvokeEvent) =>
        Effect.try({
          try: () => {
            requireTrustedAppRendererSenderWithOrigin(
              event,
              "Codex application",
              config.rendererUrl,
            );
            if (!windows.has(event.sender.id)) {
              throw new Error("Codex application access requires an active Nodex window");
            }
          },
          catch: (cause) => new CodexIpcError({ operation: "authorize-renderer", cause }),
        });
      const registerEffectHandle = <Channel extends keyof IpcApi>(
        channel: Channel,
        listener: TypedEffectIpcHandler<Channel>,
      ): void => {
        registrations.push(
          ipc.handle(channel, (event, ...args: IpcApi[Channel]["args"]) =>
            authorize(event).pipe(
              Effect.andThen(Effect.suspend(() => listener(event, ...args))),
              Effect.tapError((error) =>
                Effect.sync(() =>
                  captureMainException(error.cause, {
                    tags: { channel, mechanism: "ipc" },
                    extra: {
                      channel,
                      senderWebContentsId: event.sender.id,
                      argCount: args.length,
                    },
                  }),
                ),
              ),
            ),
          ),
        );
      };
      const registerHandle = <Channel extends keyof IpcApi>(
        channel: Channel,
        listener: TypedIpcHandler<Channel>,
      ): void => {
        registerEffectHandle(channel, (event, ...args) =>
          Effect.tryPromise({
            try: (signal) => Promise.resolve(listener(event, ...args, signal)),
            catch: (cause) => new CodexIpcError({ operation: channel, cause }),
          }),
        );
      };
      const requireTrustedAppRendererSender = (
        event: IpcMainInvokeEvent,
        capabilityName: string,
      ): void => {
        requireTrustedAppRendererSenderWithOrigin(event, capabilityName, config.rendererUrl);
      };
      const requireAssignedWindowSessionId = (senderId: number): string => {
        const windowSessionId = windows.resolveSessionId(senderId);
        if (!windowSessionId) {
          throw new Error("The requesting window has no assigned Window Session");
        }
        return windowSessionId;
      };
      const resolveRendererClientId = (event: IpcMainInvokeEvent): string =>
        options.rendererClientRouter.ensureClient(event.sender as RendererClientWebContents)
          .clientId;

      // Codex
      registerEffectHandle("codex:threads:list", (_, projectId, input) =>
        options.threadCatalog
          .listProject(projectId, input)
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:threads:list", cause }),
            ),
          ),
      );

      registerEffectHandle("codex:sidebar:snapshot", (_, input) => {
        const startedAt = getDevRuntimeMetricStart();
        return options.sidebarSync
          .sync({
            includeArchived: input?.includeArchived,
            policy: input?.refresh ? "force" : "read",
            reason: "manual",
          })
          .pipe(
            Effect.map((result) => result.snapshot),
            Effect.tap((snapshot) =>
              Effect.sync(() =>
                logDevRuntimeMetric("ipc.codex_sidebar_snapshot", {
                  refresh: input?.refresh === true,
                  includeArchived: input?.includeArchived === true,
                  itemCount: snapshot.items.length,
                  pinnedThreadCount: snapshot.pinnedThreadIds.length,
                  projectAssignmentCount: Object.keys(snapshot.projectAssignments).length,
                  projectlessThreadCount: snapshot.projectlessThreadIds.length,
                  approxPayloadBytes: approximateJsonPayloadBytes(snapshot),
                  durationMs: getDevRuntimeMetricDurationMs(startedAt),
                }),
              ),
            ),
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:sidebar:snapshot", cause }),
            ),
          );
      });

      registerEffectHandle("codex:sidebar:sync", (_, input) => {
        const startedAt = getDevRuntimeMetricStart();
        return options.sidebarSync.sync(input).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              const approxPayloadBytes = approximateJsonPayloadBytes(result);
              logDevRuntimeMetric("ipc.codex_sidebar_sync", {
                policy: input?.policy ?? "stale",
                reason: input?.reason ?? "manual",
                includeArchived: input?.includeArchived === true,
                source: result.source,
                refreshed: result.refreshed,
                itemCount: result.snapshot.items.length,
                changedProjectCount: result.changedProjectIds.length,
                projectlessChanged: result.projectlessChanged,
                materializedSessionCount: result.materializedSessionIds.length,
                failedThreadCount: result.failedThreadIds.length,
                approxPayloadBytes,
                durationMs: getDevRuntimeMetricDurationMs(startedAt),
              });
              recordDevRuntimeMetricCounter(
                "ipc.codex_sidebar_sync.burst_window",
                {
                  policy: input?.policy ?? "stale",
                  reason: input?.reason ?? "manual",
                  includeArchived: input?.includeArchived === true,
                  approxPayloadBytes,
                },
                {
                  groupBy: ["policy", "reason", "includeArchived"],
                  windowMs: 1_000,
                  burstThreshold: 5,
                  burstMetric: "ipc.codex_sidebar_sync.burst",
                },
              );
            }),
          ),
          Effect.mapError((cause) => new CodexIpcError({ operation: "codex:sidebar:sync", cause })),
        );
      });

      registerEffectHandle("codex:sidebar:thread:move", (_, input) =>
        options.threadCatalog
          .move(input)
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:sidebar:thread:move", cause }),
            ),
          ),
      );

      registerEffectHandle("codex:threads:pinned:list", () =>
        options.threadCatalog.listPinned.pipe(
          Effect.map((threadIds) => [...threadIds]),
          Effect.mapError(
            (cause) => new CodexIpcError({ operation: "codex:threads:pinned:list", cause }),
          ),
        ),
      );

      registerEffectHandle("codex:threads:pinned:set", (_, threadId: string, input) =>
        options.threadCatalog
          .setPinned(threadId, input.pinned)
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:threads:pinned:set", cause }),
            ),
          ),
      );

      registerEffectHandle("codex:threads:pinned:reorder", (_, orderedThreadIds) =>
        Effect.try({
          try: () => requireNonBlankStringArray(orderedThreadIds, "Pinned thread order"),
          catch: (cause) => new CodexIpcError({ operation: "codex:threads:pinned:reorder", cause }),
        }).pipe(
          Effect.flatMap(options.threadCatalog.reorderPinned),
          Effect.mapError((cause) =>
            cause instanceof CodexIpcError
              ? cause
              : new CodexIpcError({ operation: "codex:threads:pinned:reorder", cause }),
          ),
        ),
      );

      registerEffectHandle("codex:thread:ensure-session", (_, threadId: string) =>
        options.threadCatalog
          .ensureSession(threadId)
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:thread:ensure-session", cause }),
            ),
          ),
      );

      registerEffectHandle("codex:threads:palette:list", (_, input) =>
        options.threadCatalog.listPalette(input).pipe(
          Effect.map((threads) => [...threads]),
          Effect.mapError(
            (cause) => new CodexIpcError({ operation: "codex:threads:palette:list", cause }),
          ),
        ),
      );

      registerEffectHandle("codex:threads:palette:search", (_, input) =>
        options.threadCatalog.searchPalette(input).pipe(
          Effect.map((results) => [...results]),
          Effect.mapError(
            (cause) => new CodexIpcError({ operation: "codex:threads:palette:search", cause }),
          ),
        ),
      );

      registerEffectHandle("codex:thread:summary:get", (_, threadId: string) =>
        options.threadCatalog
          .resolve(threadId)
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:thread:summary:get", cause }),
            ),
          ),
      );

      const parseAgentImportSourceKind = (value: unknown): AgentImportSourceKind => {
        if (value === "claude-code" || value === "codex" || value === "open-interpreter") {
          return value;
        }
        throw new Error("Invalid agent import source");
      };
      registerEffectHandle("agent-import:scan", (_, input: AgentImportScanInput) =>
        Effect.try({
          try: () => parseAgentImportSourceKind(input?.sourceKind),
          catch: (cause) => new CodexIpcError({ operation: "agent-import:scan", cause }),
        }).pipe(
          Effect.flatMap(options.agentImport.scan),
          Effect.mapError((cause) =>
            cause instanceof CodexIpcError
              ? cause
              : new CodexIpcError({ operation: "agent-import:scan", cause }),
          ),
        ),
      );
      registerEffectHandle("agent-import:scan-picked-home", (event, input: AgentImportScanInput) =>
        Effect.try({
          try: () => {
            const sourceKind = parseAgentImportSourceKind(input?.sourceKind);
            if (sourceKind === "claude-code") {
              throw new Error("Claude Code imports use its standard home directory");
            }
            return sourceKind;
          },
          catch: (cause) =>
            new CodexIpcError({ operation: "agent-import:scan-picked-home", cause }),
        }).pipe(
          Effect.flatMap((sourceKind) =>
            Effect.tryPromise({
              try: () =>
                showDirectoryPicker(event, {
                  buttonLabel: "Scan",
                  message: "The selected directory is read-only during import.",
                  properties: ["openDirectory"],
                  title: `Select ${sourceKind === "codex" ? "Codex" : "Open Interpreter"} home`,
                }),
              catch: (cause) =>
                new CodexIpcError({ operation: "agent-import:scan-picked-home", cause }),
            }).pipe(
              Effect.flatMap((sourceHome) =>
                sourceHome
                  ? options.agentImport.scan(sourceKind, sourceHome)
                  : Effect.succeed(null),
              ),
            ),
          ),
          Effect.mapError((cause) =>
            cause instanceof CodexIpcError
              ? cause
              : new CodexIpcError({ operation: "agent-import:scan-picked-home", cause }),
          ),
        ),
      );
      registerEffectHandle("agent-import:apply", (_, input: AgentImportApplyInput) =>
        Effect.try({
          try: () => {
            if (
              typeof input !== "object" ||
              input === null ||
              typeof input.scanId !== "string" ||
              !Array.isArray(input.itemIds) ||
              !input.itemIds.every((itemId) => typeof itemId === "string")
            ) {
              throw new Error("Invalid agent import selection");
            }
            return { itemIds: input.itemIds, scanId: input.scanId };
          },
          catch: (cause) => new CodexIpcError({ operation: "agent-import:apply", cause }),
        }).pipe(
          Effect.flatMap(options.agentImport.apply),
          Effect.mapError((cause) =>
            cause instanceof CodexIpcError
              ? cause
              : new CodexIpcError({ operation: "agent-import:apply", cause }),
          ),
        ),
      );

      registerHandle("codex:projectless-thread-cwd", (_, rawInput) => {
        const input = parseCodexProjectlessThreadCwdInput(rawInput);
        return createCodexProjectlessWorkspace({
          prompt: input.prompt,
          directoryName: input.directoryName,
          createSplitDirectories: input.createSplitDirectories !== false,
        });
      });

      registerHandle(
        "codex:thread:start-for-session",
        async (event, input: CodexThreadStartForSessionInput, fiberSignal) => {
          const controller = new AbortController();
          const abortWhenRendererCloses = (): void => controller.abort();
          event.sender.once("destroyed", abortWhenRendererCloses);
          try {
            return await codexService.startThreadForSession(input, {
              signal: fiberSignal
                ? AbortSignal.any([fiberSignal, controller.signal])
                : controller.signal,
              browserViewScopeId:
                windows.resolveSessionId(event.sender.id) ?? `headless:${input.sessionId}`,
              ownerClientId: resolveRendererClientId(event),
            });
          } finally {
            event.sender.removeListener("destroyed", abortWhenRendererCloses);
          }
        },
      );

      registerHandle("codex:thread:side-chat:start", (_, input: CodexSideChatStartInput) =>
        codexService.startSideChat(input),
      );

      registerHandle("codex:thread:side-chat:discard", (_, threadId: string) =>
        codexService.discardSideChat(threadId),
      );

      registerEffectHandle("worktrees:list", () =>
        options.managedWorktreeCatalog.list.pipe(
          Effect.map((records) => [...records]),
          Effect.mapError((cause) => new CodexIpcError({ operation: "worktrees:list", cause })),
        ),
      );
      registerEffectHandle("worktrees:settings:get", () =>
        options.managedWorktreeCatalog.settings.pipe(
          Effect.mapError(
            (cause) => new CodexIpcError({ operation: "worktrees:settings:get", cause }),
          ),
        ),
      );
      registerEffectHandle("worktrees:settings:update", (_, input) =>
        options.managedWorktreeCatalog
          .updateSettings(input)
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "worktrees:settings:update", cause }),
            ),
          ),
      );
      registerEffectHandle("worktrees:thread:availability", (_, threadId: string) =>
        options.managedWorktreeCatalog
          .inspectThread(threadId)
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "worktrees:thread:availability", cause }),
            ),
          ),
      );
      registerEffectHandle("worktrees:thread:restore", (_, threadId: string) =>
        options.managedWorktreeCatalog
          .restoreThread(threadId)
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "worktrees:thread:restore", cause }),
            ),
          ),
      );

      registerEffectHandle("worktrees:delete", (_, hostId: string, worktreePath: string) =>
        options.managedWorktreeCatalog
          .delete(hostId, worktreePath)
          .pipe(
            Effect.mapError((cause) => new CodexIpcError({ operation: "worktrees:delete", cause })),
          ),
      );

      registerEffectHandle("codex:thread:snapshot:request", (_, threadId: string) =>
        options.conversationResume
          .snapshot(threadId)
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:thread:snapshot:request", cause }),
            ),
          ),
      );

      registerEffectHandle("codex:thread:resume:request", (event, threadId: string) =>
        Effect.try({
          try: () => {
            const ownerClientId = resolveRendererClientId(event);
            if (!ownerClientId) throw new Error("Renderer client is not registered");
            return ownerClientId;
          },
          catch: (cause) => new CodexIpcError({ operation: "codex:thread:resume:request", cause }),
        }).pipe(
          Effect.flatMap((ownerClientId) =>
            options.conversationResume.resumeForRenderer(threadId, ownerClientId),
          ),
          Effect.mapError((cause) =>
            cause instanceof CodexIpcError
              ? cause
              : new CodexIpcError({ operation: "codex:thread:resume:request", cause }),
          ),
        ),
      );

      registerEffectHandle(
        "codex:thread:fresh-owner:adopt",
        (event, threadId: string, launchId: string) =>
          Effect.try({
            try: () => resolveRendererClientId(event),
            catch: (cause) =>
              new CodexIpcError({ operation: "codex:thread:fresh-owner:adopt", cause }),
          }).pipe(
            Effect.flatMap((ownerClientId) =>
              options.freshThreadLaunch.adopt({ threadId, launchId, ownerClientId }),
            ),
            Effect.mapError((cause) =>
              cause instanceof CodexIpcError
                ? cause
                : new CodexIpcError({ operation: "codex:thread:fresh-owner:adopt", cause }),
            ),
          ),
      );

      registerEffectHandle(
        "codex:thread:background-subagents:hydrate",
        (_, input: CodexBackgroundSubagentThreadsHydrateInput) =>
          options.subagentCatalog.hydrateBackground(input).pipe(
            Effect.map((summaries) => [...summaries]),
            Effect.mapError(
              (cause) =>
                new CodexIpcError({
                  operation: "codex:thread:background-subagents:hydrate",
                  cause,
                }),
            ),
          ),
      );

      registerEffectHandle(
        "codex:thread:subagents-panel:hydrate",
        (_, input: CodexSubagentPanelHydrateInput) =>
          options.subagentCatalog.hydratePanel(input).pipe(
            Effect.map((summaries) => [...summaries]),
            Effect.mapError(
              (cause) =>
                new CodexIpcError({
                  operation: "codex:thread:subagents-panel:hydrate",
                  cause,
                }),
            ),
          ),
      );

      registerEffectHandle("codex:subagent-thread:opened", (_, threadId: string) =>
        options.subagentCatalog.open(threadId),
      );

      registerEffectHandle("codex:thread:resume-buffer:release", (_, threadId: string) =>
        options.conversationResume
          .releaseBuffer(threadId)
          .pipe(
            Effect.mapError(
              (cause) =>
                new CodexIpcError({ operation: "codex:thread:resume-buffer:release", cause }),
            ),
          ),
      );

      registerEffectHandle("codex:thread:turns:load-older", (_, threadId) =>
        options.conversationHistory
          .loadPage(threadId)
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:thread:turns:load-older", cause }),
            ),
          ),
      );
      registerEffectHandle("codex:thread:turns:load-complete", (_, threadId) =>
        options.conversationHistory
          .loadComplete(threadId, false)
          .pipe(
            Effect.mapError(
              (cause) =>
                new CodexIpcError({ operation: "codex:thread:turns:load-complete", cause }),
            ),
          ),
      );

      registerEffectHandle("codex:thread:name:set", (_, threadId: string, name: string) =>
        options.threadTitles
          .set({ threadId, name, normalization: "manual" })
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:thread:name:set", cause }),
            ),
          ),
      );

      registerEffectHandle("codex:thread:name:set-generated", (_, threadId: string, name: string) =>
        options.threadTitles
          .set({ threadId, name, normalization: "trim" })
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:thread:name:set-generated", cause }),
            ),
          ),
      );

      registerEffectHandle(
        "codex:thread:title:generate",
        (_, input: { hostId: string; prompt: string; cwd: string | null }) => {
          void input.hostId;
          return options.structuredThreadTitle.generate(input).pipe(
            Effect.map((title) => ({ title })),
            Effect.catch((error) =>
              Effect.logWarning("Could not generate Thread title").pipe(
                Effect.annotateLogs({ error: String(error.cause) }),
                Effect.as({ title: null }),
              ),
            ),
          );
        },
      );

      registerEffectHandle("codex:thread:archive", (_, threadId: string) =>
        options.conversationCommands
          .archive(threadId)
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:thread:archive", cause }),
            ),
          ),
      );

      registerEffectHandle("codex:thread:unarchive", (_, threadId: string) =>
        options.conversationCommands
          .unarchive(threadId)
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:thread:unarchive", cause }),
            ),
          ),
      );

      registerEffectHandle(
        "codex:thread:collaboration-mode:set",
        (_, threadId: string, collaborationMode: CodexCollaborationModeKind) =>
          options.threadSettings.update({ threadId, patch: { collaborationMode } }).pipe(
            Effect.mapError(
              (cause) =>
                new CodexIpcError({
                  operation: "codex:thread:collaboration-mode:set",
                  cause,
                }),
            ),
            Effect.flatMap((settings) =>
              settings.collaborationMode
                ? Effect.succeed(settings.collaborationMode)
                : Effect.fail(
                    new CodexIpcError({
                      operation: "codex:thread:collaboration-mode:set",
                      cause: new Error("Thread settings projection omitted collaboration mode"),
                    }),
                  ),
            ),
          ),
      );

      registerEffectHandle(
        "codex:thread:settings:update",
        (_, threadId: string, patch: CodexConversationThreadSettingsPatch) =>
          options.threadSettings
            .update({ threadId, patch })
            .pipe(
              Effect.mapError(
                (cause) => new CodexIpcError({ operation: "codex:thread:settings:update", cause }),
              ),
            ),
      );

      registerEffectHandle(
        "codex:thread:plan-implementation:remove",
        (_, threadId: string, turnId: string) =>
          options.serverRequestResponses.planImplementation(threadId, turnId).pipe(
            Effect.mapError(
              (cause) =>
                new CodexIpcError({
                  operation: "codex:thread:plan-implementation:remove",
                  cause,
                }),
            ),
          ),
      );

      registerHandle(
        "codex:turn:start",
        (_, threadId: string, prompt: string, opts?: CodexTurnStartOptions) => {
          return codexService.startTurn(threadId, prompt, opts);
        },
      );

      registerEffectHandle(
        "codex:thread:follow-up:enqueue",
        (_, threadId: string, prompt: string, opts?: CodexTurnStartOptions) =>
          options.queuedFollowUps
            .enqueue({
              threadId,
              prompt,
              collaborationMode: opts?.collaborationMode,
              serviceTier: opts?.serviceTier,
              promptInput: opts?.promptInput,
              summary: opts?.summary,
            })
            .pipe(
              Effect.asVoid,
              Effect.mapError(
                (cause) =>
                  new CodexIpcError({ operation: "codex:thread:follow-up:enqueue", cause }),
              ),
            ),
      );

      registerEffectHandle(
        "codex:thread:follow-up:remove",
        (_, threadId: string, followUpId: string) =>
          options.queuedFollowUps.remove(threadId, followUpId).pipe(Effect.asVoid),
      );

      registerEffectHandle(
        "codex:thread:follow-up:reorder",
        (_, threadId: string, orderedFollowUpIds: string[]) =>
          options.queuedFollowUps.reorder(threadId, orderedFollowUpIds),
      );

      registerEffectHandle(
        "codex:thread:follow-up:send-now",
        (_, threadId: string, followUpId: string) =>
          options.queuedFollowUps
            .sendNow(threadId, followUpId)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new CodexIpcError({ operation: "codex:thread:follow-up:send-now", cause }),
              ),
            ),
      );

      registerEffectHandle("codex:thread:compact:start", (_, threadId: string) =>
        options.manualCompaction
          .start(threadId)
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:thread:compact:start", cause }),
            ),
          ),
      );

      registerEffectHandle("codex:thread:goal:get", (_, threadId: string) =>
        options.threadGoals
          .get(threadId)
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:thread:goal:get", cause }),
            ),
          ),
      );

      registerEffectHandle("codex:thread:goal:set", (_, params: CodexThreadGoalSetActionInput) =>
        options.threadGoals
          .set(params)
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:thread:goal:set", cause }),
            ),
          ),
      );

      registerEffectHandle("codex:thread:goal:clear", (_, threadId: string) =>
        options.threadGoals
          .clear(threadId)
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:thread:goal:clear", cause }),
            ),
          ),
      );

      registerHandle("codex:turn:steer", (_, input) => codexService.steerTurn(input));

      registerEffectHandle(
        "codex:thread:background-processes:list",
        (
          _,
          input: {
            threadId: string;
            observedTerminals?: ThreadBackgroundTerminal[];
          },
        ) =>
          options.backgroundProcesses.list(input).pipe(
            Effect.mapError(
              (cause) =>
                new CodexIpcError({
                  operation: "codex:thread:background-processes:list",
                  cause,
                }),
            ),
          ),
      );

      registerEffectHandle(
        "codex:thread:background-processes:run-action",
        (event, input: CodexBackgroundProcessRunActionInput) =>
          Effect.try({
            try: () => ({
              action: input,
              owner: {
                webContentsId: event.sender.id,
                windowSessionId: requireAssignedWindowSessionId(event.sender.id),
              },
            }),
            catch: (cause) =>
              new CodexIpcError({
                operation: "codex:thread:background-processes:run-action",
                cause,
              }),
          }).pipe(
            Effect.flatMap(options.backgroundProcesses.runAction),
            Effect.mapError(
              (cause) =>
                new CodexIpcError({
                  operation: "codex:thread:background-processes:run-action",
                  cause,
                }),
            ),
          ),
      );

      registerHandle("mcp-app:open-external", async (event, value) => {
        requireTrustedAppRendererSender(event, "MCP external navigation");
        if (value.length > 8_192) throw new Error("MCP external URL is too long");
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password) {
          throw new Error("MCP external navigation requires a credential-free HTTPS URL");
        }
        await shell.openExternal(url.toString());
      });

      registerEffectHandle(
        "codex:approval:respond",
        (
          _,
          conversationId: string,
          requestId: CodexProtocolRequestId,
          response: CodexApprovalResponse,
        ) =>
          Effect.suspend(() => {
            const parsedResponse = parseCodexApprovalResponse(response);
            if (!parsedResponse) {
              return Effect.fail(
                new CodexIpcError({
                  operation: "codex:approval:respond",
                  cause: new Error("Invalid Codex approval response for approval kind."),
                }),
              );
            }
            return options.serverRequestResponses
              .approval({ threadId: conversationId, requestId, response: parsedResponse })
              .pipe(
                Effect.mapError(
                  (cause) => new CodexIpcError({ operation: "codex:approval:respond", cause }),
                ),
              );
          }),
      );

      registerEffectHandle(
        "codex:user-input:respond",
        (_, conversationId: string, requestId: CodexProtocolRequestId, answers) =>
          options.serverRequestResponses
            .userInput({ threadId: conversationId, requestId, answers })
            .pipe(
              Effect.mapError(
                (cause) => new CodexIpcError({ operation: "codex:user-input:respond", cause }),
              ),
            ),
      );

      registerEffectHandle(
        "codex:mcp-elicitation:respond",
        (_, conversationId: string, requestId: CodexProtocolRequestId, response) =>
          options.serverRequestResponses
            .mcpElicitation({ threadId: conversationId, requestId, response })
            .pipe(
              Effect.mapError(
                (cause) => new CodexIpcError({ operation: "codex:mcp-elicitation:respond", cause }),
              ),
            ),
      );

      registerEffectHandle(
        "codex:permission-request:respond",
        (_, conversationId: string, requestId: CodexProtocolRequestId, response) =>
          options.serverRequestResponses
            .permission({ threadId: conversationId, requestId, response })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new CodexIpcError({ operation: "codex:permission-request:respond", cause }),
              ),
            ),
      );

      registerEffectHandle(
        "codex:option-picker:respond",
        (_, conversationId: string, requestId: CodexProtocolRequestId, response) =>
          options.serverRequestResponses
            .optionPicker({ threadId: conversationId, requestId, response })
            .pipe(
              Effect.mapError(
                (cause) => new CodexIpcError({ operation: "codex:option-picker:respond", cause }),
              ),
            ),
      );

      registerEffectHandle(
        "codex:setup-context-picker:respond",
        (_, conversationId: string, requestId: CodexProtocolRequestId, response) =>
          options.serverRequestResponses
            .setupContextPicker({ threadId: conversationId, requestId, response })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new CodexIpcError({ operation: "codex:setup-context-picker:respond", cause }),
              ),
            ),
      );

      registerEffectHandle(
        "codex:setup-codex-step:respond",
        (_, conversationId: string, requestId: CodexProtocolRequestId, response) =>
          options.serverRequestResponses
            .setupCodexStep({ threadId: conversationId, requestId, response })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new CodexIpcError({ operation: "codex:setup-codex-step:respond", cause }),
              ),
            ),
      );

      registerEffectHandle("codex:conversation-unread:set", (_, conversationId, hasUnreadTurn) =>
        options.threadReadState
          .set({ threadId: conversationId, hasUnreadTurn })
          .pipe(
            Effect.mapError(
              (cause) => new CodexIpcError({ operation: "codex:conversation-unread:set", cause }),
            ),
          ),
      );

      yield* Effect.all(registrations, { discard: true });
    }),
  );
