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
import { ScopedCallbackRuntime } from "./app/ScopedCallbackRuntime";
import type { CodexService } from "./codex/codex-service";
import type { CodexManualCompactionRuntime } from "./codex-application/CodexManualCompactionRuntime";
import type { CodexThreadGoalRuntime } from "./codex-application/CodexThreadGoalRuntime";
import type { CodexThreadSettingsRuntime } from "./codex-application/CodexThreadSettingsRuntime";
import type { CodexThreadCatalog } from "./codex-application/CodexThreadCatalog";
import type { CodexThreadTitlePersistence } from "./codex-application/CodexThreadTitlePersistence";
import type { ConversationCommands } from "./codex-application/ConversationCommands";
import type { CodexSidebarSyncRuntime } from "./codex-application/CodexSidebarSyncRuntime";
import type { CodexThreadReadState } from "./codex-application/CodexThreadReadState";
import type { AgentImportRuntime } from "./codex-application/AgentImportRuntime";
import type { CodexConversationHistoryRuntime } from "./codex-application/CodexConversationHistoryRuntime";
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
  TerminalRunActionRequest,
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
import { runWithTerminalProjectAdmission } from "./project-lifecycle-service";
import { ProjectRuntimeLifecycleRuntime } from "./host-runtime/ProjectRuntimeLifecycleRuntime";
import { makeProjectRuntimeLifecyclePromiseAdapter } from "./host-runtime/ProjectRuntimeLifecycleRuntimePromiseAdapter";
import type { DesktopProjectWorkspacePort } from "./core-client/project-workspace-adapter";
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
  rendererClientRouter: RendererClientRuntimeService;
  projectWorkspace: DesktopProjectWorkspacePort;
  terminalRuntime: {
    readonly runAction: (input: {
      readonly webContentsId: number;
      readonly windowSessionId: string;
      readonly request: TerminalRunActionRequest;
    }) => Promise<void>;
  };
}

export class CodexIpcError extends Schema.TaggedError<CodexIpcError>()("CodexIpcError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export const codexIpcLive = (
  options: CodexIpcOptions,
): Layer.Layer<
  never,
  never,
  ElectronIpc | MainConfig | ProjectRuntimeLifecycleRuntime | ScopedCallbackRuntime | WindowRuntime
> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const { codexService } = options;
      const config = yield* MainConfig;
      const ipc = yield* ElectronIpc;
      const projectRuntimeLifecycle = yield* ProjectRuntimeLifecycleRuntime;
      const callbacks = yield* ScopedCallbackRuntime;
      const windows = yield* WindowRuntime;
      const projectRuntimeLifecycleAdapter = makeProjectRuntimeLifecyclePromiseAdapter(
        projectRuntimeLifecycle,
        callbacks,
      );
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
      const projectWorkspace = options.projectWorkspace;
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
      registerHandle(
        "codex:threads:list",
        (_, projectId: string, opts?: { includeArchived?: boolean }) =>
          codexService.listProjectThreads(projectId, opts),
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

      registerHandle("codex:thread:ensure-session", (_, threadId: string) =>
        codexService.ensureSidebarThreadSession(threadId),
      );

      registerHandle("codex:threads:palette:list", (_, input) =>
        codexService.listCommandPaletteThreads(input),
      );

      registerHandle("codex:threads:palette:search", (_, input) =>
        codexService.searchCommandPaletteThreads(input),
      );

      registerHandle("codex:thread:summary:get", (_, threadId: string) =>
        codexService.resolveThreadSummary(threadId),
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

      registerHandle("worktrees:list", () => codexService.listManagedWorktrees());
      registerHandle("worktrees:settings:get", () => codexService.getManagedWorktreeSettings());
      registerHandle("worktrees:settings:update", (_, input) =>
        codexService.updateManagedWorktreeSettings(input),
      );
      registerHandle("worktrees:thread:availability", (_, threadId: string) =>
        codexService.inspectThreadManagedWorktree(threadId),
      );
      registerHandle("worktrees:thread:restore", (_, threadId: string) =>
        codexService.restoreThreadManagedWorktree(threadId),
      );

      registerHandle("worktrees:delete", (_, hostId: string, worktreePath: string) =>
        codexService.deleteManagedWorktree(hostId, worktreePath),
      );

      registerHandle("codex:thread:snapshot:request", (_, threadId: string) =>
        codexService.requestConversationSnapshot(threadId),
      );

      registerHandle("codex:thread:resume:request", (event, threadId: string) => {
        const ownerClientId = resolveRendererClientId(event);
        if (!ownerClientId) {
          throw new Error("Renderer client is not registered");
        }
        return codexService.requestRendererConversationResume(threadId, ownerClientId);
      });

      registerHandle(
        "codex:thread:fresh-owner:adopt",
        (event, threadId: string, launchId: string) => {
          const ownerClientId = resolveRendererClientId(event);
          if (!ownerClientId) {
            throw new Error("Renderer client is not registered");
          }
          return codexService.requestRendererFreshConversationAdoption(
            threadId,
            launchId,
            ownerClientId,
          );
        },
      );

      registerHandle(
        "codex:thread:background-subagents:hydrate",
        (_, input: CodexBackgroundSubagentThreadsHydrateInput) =>
          codexService.hydrateBackgroundSubagentThreads(input),
      );

      registerHandle(
        "codex:thread:subagents-panel:hydrate",
        (_, input: CodexSubagentPanelHydrateInput) => codexService.hydrateSubagentPanel(input),
      );

      registerHandle("codex:subagent-thread:opened", (_, threadId: string) =>
        codexService.markSubagentThreadOpened(threadId),
      );

      registerHandle("codex:thread:resume-buffer:release", (_, threadId: string) =>
        codexService.releaseConversationResumeBuffer(threadId),
      );

      registerHandle("codex:thread:view-active:set", (event, input: unknown) => {
        if (typeof input !== "object" || input === null) return false;
        const threadId =
          "threadId" in input && typeof input.threadId === "string" ? input.threadId.trim() : "";
        if (!threadId) return false;
        const clientId = resolveRendererClientId(event);
        if (!clientId) return false;
        codexService.setRendererConversationViewActive(
          threadId,
          clientId,
          "active" in input && input.active === true,
        );
        return true;
      });

      registerHandle("codex:thread:stream-following:set", (event, input: unknown) => {
        if (typeof input !== "object" || input === null) return false;
        const threadId =
          "threadId" in input && typeof input.threadId === "string" ? input.threadId.trim() : "";
        if (!threadId) return false;
        const clientId = resolveRendererClientId(event);
        if (!clientId) return false;
        return codexService.setRendererConversationFollowing(
          threadId,
          clientId,
          "following" in input && input.following === true,
          {
            forceSnapshot: "reannounce" in input && input.reannounce === true,
          },
        );
      });

      registerHandle("codex:thread:presentation:set", (event, input: unknown) => {
        if (typeof input !== "object" || input === null) return false;
        const threadId =
          "threadId" in input && typeof input.threadId === "string" ? input.threadId.trim() : "";
        const surfaceId =
          "surfaceId" in input && typeof input.surfaceId === "string" ? input.surfaceId.trim() : "";
        if (!threadId || !surfaceId) return false;
        const clientId = resolveRendererClientId(event);
        if (!clientId) return false;
        codexService.setRendererConversationPresented(
          threadId,
          clientId,
          surfaceId,
          "presented" in input && input.presented === true,
        );
        return true;
      });

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

      registerHandle(
        "codex:thread:title:generate",
        (_, input: { hostId: string; prompt: string; cwd: string | null }) => {
          void input.hostId;
          return codexService.generateThreadTitle({
            prompt: input.prompt,
            cwd: input.cwd,
          });
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

      registerHandle(
        "codex:thread:plan-implementation:remove",
        (_, threadId: string, turnId: string) =>
          codexService.removePlanImplementationRequest(threadId, turnId),
      );

      registerHandle(
        "codex:turn:start",
        (_, threadId: string, prompt: string, opts?: CodexTurnStartOptions) => {
          return codexService.startTurn(threadId, prompt, opts);
        },
      );

      registerHandle(
        "codex:thread:follow-up:enqueue",
        (_, threadId: string, prompt: string, opts?: CodexTurnStartOptions) =>
          codexService.enqueueQueuedFollowUpPrompt(threadId, prompt, opts),
      );

      registerHandle("codex:thread:follow-up:remove", (_, threadId: string, followUpId: string) =>
        codexService.removeQueuedFollowUp(threadId, followUpId),
      );

      registerHandle(
        "codex:thread:follow-up:reorder",
        (_, threadId: string, orderedFollowUpIds: string[]) =>
          codexService.reorderQueuedFollowUps(threadId, orderedFollowUpIds),
      );

      registerHandle("codex:thread:follow-up:send-now", (_, threadId: string, followUpId: string) =>
        codexService.sendQueuedFollowUpNow(threadId, followUpId),
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

      registerHandle("codex:turn:interrupt", (_, threadId: string, turnId?: string) =>
        codexService.interruptTurn(threadId, turnId),
      );

      registerHandle("codex:thread:background-terminals:clean", (_, threadId: string) =>
        codexService.cleanBackgroundTerminals(threadId),
      );

      registerHandle("codex:thread:background-terminals:clean-silent", (_, threadId: string) =>
        codexService.cleanBackgroundTerminalsSilently(threadId),
      );

      registerHandle(
        "codex:thread:background-processes:list",
        (
          _,
          input: {
            threadId: string;
            observedTerminals?: ThreadBackgroundTerminal[];
          },
        ) => codexService.listBackgroundProcessRows(input),
      );

      registerHandle(
        "codex:thread:background-processes:run-action",
        async (event, input: CodexBackgroundProcessRunActionInput) => {
          const sender = event.sender;
          const terminalInput = {
            sessionId: input.terminalSessionId,
            conversationId: input.threadId,
            cwd: input.cwd,
            command: input.command,
            title: input.command,
          };
          await runWithTerminalProjectAdmission(
            projectWorkspace,
            terminalInput,
            async () => {
              await codexService.registerBackgroundProcessRunAction(input);
              if (!options.terminalRuntime) throw new Error("Terminal runtime is unavailable");
              await options.terminalRuntime.runAction({
                webContentsId: sender.id,
                windowSessionId: requireAssignedWindowSessionId(sender.id),
                request: terminalInput,
              });
            },
            projectRuntimeLifecycleAdapter,
          );
          return codexService.listBackgroundProcessRows({
            threadId: input.threadId,
            observedTerminals: [],
          });
        },
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

      registerHandle(
        "codex:approval:respond",
        (
          _,
          conversationId: string,
          requestId: CodexProtocolRequestId,
          response: CodexApprovalResponse,
        ) => {
          const parsedResponse = parseCodexApprovalResponse(response);
          if (!parsedResponse) {
            throw new Error("Invalid Codex approval response for approval kind.");
          }
          return codexService.respondToApproval(requestId, parsedResponse, conversationId);
        },
      );

      registerHandle(
        "codex:user-input:respond",
        (_, conversationId: string, requestId: CodexProtocolRequestId, answers) =>
          codexService.respondToUserInput(requestId, answers, conversationId),
      );

      registerHandle(
        "codex:mcp-elicitation:respond",
        (_, conversationId: string, requestId: CodexProtocolRequestId, response) =>
          codexService.respondToMcpServerElicitation(requestId, response, conversationId),
      );

      registerHandle(
        "codex:permission-request:respond",
        (_, conversationId: string, requestId: CodexProtocolRequestId, response) =>
          codexService.respondToPermissionRequest(requestId, response, conversationId),
      );

      registerHandle(
        "codex:option-picker:respond",
        (_, conversationId: string, requestId: CodexProtocolRequestId, response) =>
          codexService.respondToOptionPicker(conversationId, requestId, response),
      );

      registerHandle(
        "codex:setup-context-picker:respond",
        (_, conversationId: string, requestId: CodexProtocolRequestId, response) =>
          codexService.respondToSetupContextPicker(conversationId, requestId, response),
      );

      registerHandle(
        "codex:setup-codex-step:respond",
        (_, conversationId: string, requestId: CodexProtocolRequestId, response) =>
          codexService.respondToSetupCodexStep(conversationId, requestId, response),
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
