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
import { parseCodexApprovalResponse } from "../shared/codex-approval-response";
import {
  parseCodexUserInputAutoResolutionActivityInput,
  parseCodexUserInputAutoResolutionTarget,
} from "../shared/codex-user-input-auto-resolution";
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
  UpdateWorktreeEnvironmentConfigInput,
} from "../shared/types";
import type {
  AgentImportApplyInput,
  AgentImportScanInput,
  AgentImportSourceKind,
} from "../shared/agent-import";
import type { ThreadBackgroundTerminal } from "@nodex/codex-app-server-protocol/v2/ThreadBackgroundTerminal";
import type {
  RendererClientRouter,
  RendererClientWebContents,
} from "./codex/renderer-client-router";
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
  ...args: IpcApi[Channel]["args"]
) => IpcApi[Channel]["result"] | Promise<IpcApi[Channel]["result"]>;

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
  rendererClientRouter: RendererClientRouter;
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

function assertValidWorktreeEnvironmentSaveInput(
  input: UpdateWorktreeEnvironmentConfigInput,
): void {
  const revision = input?.expectedRevision;
  if (revision === null || (typeof revision === "string" && /^sha256:[a-f0-9]{64}$/.test(revision)))
    return;

  throw new Error("Invalid local environment revision");
}

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
      const registerHandle = <Channel extends keyof IpcApi>(
        channel: Channel,
        listener: TypedIpcHandler<Channel>,
      ): void => {
        registrations.push(
          ipc.handle(channel, (event, ...args: IpcApi[Channel]["args"]) =>
            authorize(event).pipe(
              Effect.andThen(
                Effect.tryPromise({
                  try: () => Promise.resolve(listener(event, ...args)),
                  catch: (cause) => new CodexIpcError({ operation: channel, cause }),
                }),
              ),
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

      registerHandle("codex:sidebar:snapshot", async (_, input) => {
        const startedAt = getDevRuntimeMetricStart();
        const snapshot = await codexService.syncSidebarThreads(input);
        logDevRuntimeMetric("ipc.codex_sidebar_snapshot", {
          refresh: input?.refresh === true,
          includeArchived: input?.includeArchived === true,
          itemCount: snapshot.items.length,
          pinnedThreadCount: snapshot.pinnedThreadIds.length,
          projectAssignmentCount: Object.keys(snapshot.projectAssignments).length,
          projectlessThreadCount: snapshot.projectlessThreadIds.length,
          approxPayloadBytes: approximateJsonPayloadBytes(snapshot),
          durationMs: getDevRuntimeMetricDurationMs(startedAt),
        });
        return snapshot;
      });

      registerHandle("codex:sidebar:sync", async (_, input) => {
        const startedAt = getDevRuntimeMetricStart();
        const result = await codexService.syncSidebarThreadsDetailed(input);
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
        return result;
      });

      registerHandle("codex:sidebar:thread:move", (_, input) =>
        codexService.moveSidebarThread(input),
      );

      registerHandle(
        "codex:threads:pinned:list",
        async () => await codexService.listPinnedThreads(),
      );

      registerHandle("codex:threads:pinned:set", (_, threadId: string, input) =>
        codexService.setThreadPinned(threadId, input.pinned),
      );

      registerHandle("codex:threads:pinned:reorder", (_, orderedThreadIds) =>
        codexService.setPinnedThreadOrder(
          requireNonBlankStringArray(orderedThreadIds, "Pinned thread order"),
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
      registerHandle("agent-import:scan", (_, input: AgentImportScanInput) => {
        const sourceKind = parseAgentImportSourceKind(input?.sourceKind);
        return codexService.scanAgentImport(sourceKind);
      });
      registerHandle(
        "agent-import:scan-picked-home",
        async (event, input: AgentImportScanInput) => {
          const sourceKind = parseAgentImportSourceKind(input?.sourceKind);
          if (sourceKind === "claude-code") {
            throw new Error("Claude Code imports use its standard home directory");
          }
          const sourceHome = await showDirectoryPicker(event, {
            buttonLabel: "Scan",
            message: "The selected directory is read-only during import.",
            properties: ["openDirectory"],
            title: `Select ${sourceKind === "codex" ? "Codex" : "Open Interpreter"} home`,
          });
          if (!sourceHome) return null;
          return await codexService.scanAgentImport(sourceKind, sourceHome);
        },
      );
      registerHandle("agent-import:apply", (_, input: AgentImportApplyInput) => {
        if (
          typeof input !== "object" ||
          input === null ||
          typeof input.scanId !== "string" ||
          !Array.isArray(input.itemIds) ||
          !input.itemIds.every((itemId) => typeof itemId === "string")
        ) {
          throw new Error("Invalid agent import selection");
        }
        return codexService.applyAgentImport({
          itemIds: input.itemIds,
          scanId: input.scanId,
        });
      });

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
        async (event, input: CodexThreadStartForSessionInput) => {
          const controller = new AbortController();
          const abortWhenRendererCloses = (): void => controller.abort();
          event.sender.once("destroyed", abortWhenRendererCloses);
          try {
            return await codexService.startThreadForSession(input, {
              signal: controller.signal,
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

      registerHandle("worktrees:environments:list", (_, projectId: string) =>
        codexService.listWorktreeEnvironments(projectId),
      );

      registerHandle("worktrees:environments:configs:list", (_, projectId: string) =>
        codexService.listWorktreeEnvironmentConfigs(projectId),
      );

      registerHandle(
        "worktrees:environments:configs:list-for-workspace",
        (_, hostId: string, workspaceRoot: string) =>
          codexService.listWorktreeEnvironmentConfigsForWorkspace(hostId, workspaceRoot),
      );

      registerHandle(
        "worktrees:environments:config:read",
        (_, projectId: string, configPath?: string | null) =>
          codexService.readWorktreeEnvironmentConfig(projectId, configPath),
      );

      registerHandle("worktrees:environments:config:save", (_, input) => {
        assertValidWorktreeEnvironmentSaveInput(input);
        return codexService.saveWorktreeEnvironmentConfig(input);
      });

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

      registerHandle("codex:user-input:auto-resolution:snapshot", () =>
        codexService.getUserInputAutoResolutionSnapshot(),
      );

      registerHandle("codex:user-input:auto-resolution:activity", (event, input: unknown) => {
        const conversationId = parseCodexUserInputAutoResolutionActivityInput(input);
        if (conversationId === null) return false;
        const clientId = resolveRendererClientId(event);
        if (!clientId) return false;
        return codexService.recordUserInputAutoResolutionActivity(conversationId, clientId);
      });

      registerHandle("codex:user-input:auto-resolution:snooze", (event, input: unknown) => {
        const target = parseCodexUserInputAutoResolutionTarget(input);
        if (target === null) return false;
        const clientId = resolveRendererClientId(event);
        if (!clientId) return false;
        return codexService.snoozeUserInputAutoResolution(
          target.conversationId,
          target.requestId,
          clientId,
        );
      });

      registerHandle("codex:thread:turns:load-older", (_, threadId: string) =>
        codexService.loadOlderThreadTurns(threadId),
      );
      registerHandle("codex:thread:turns:load-complete", (_, threadId: string) =>
        codexService.loadCompleteThreadHistory(threadId),
      );

      registerHandle("codex:thread:name:set", (_, threadId: string, name: string) =>
        codexService.setThreadName(threadId, name),
      );

      registerHandle("codex:thread:name:set-generated", (_, threadId: string, name: string) =>
        codexService.setGeneratedThreadName(threadId, name),
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

      registerHandle("codex:thread:archive", (_, threadId: string) =>
        codexService.archiveThread(threadId),
      );

      registerHandle("codex:thread:unarchive", (_, threadId: string) =>
        codexService.unarchiveThread(threadId),
      );

      registerHandle(
        "codex:thread:collaboration-mode:set",
        (_, threadId: string, collaborationMode: CodexCollaborationModeKind) =>
          codexService.setConversationCollaborationMode(threadId, collaborationMode),
      );

      registerHandle(
        "codex:thread:settings:update",
        (_, threadId: string, patch: CodexConversationThreadSettingsPatch) =>
          codexService.updateThreadSettingsForNextTurn(threadId, patch),
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

      registerHandle("codex:review:start", (_, input) => codexService.startReview(input));

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

      registerHandle("codex:thread:compact:start", (_, threadId: string) =>
        codexService.startThreadCompaction(threadId),
      );

      registerHandle("codex:thread:goal:get", (_, threadId: string) =>
        codexService.getThreadGoal(threadId),
      );

      registerHandle("codex:thread:goal:set", (_, params: CodexThreadGoalSetActionInput) =>
        codexService.setThreadGoal(params),
      );

      registerHandle("codex:thread:goal:clear", (_, threadId: string) =>
        codexService.clearThreadGoal(threadId),
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

      registerHandle(
        "codex:conversation-unread:set",
        (_, conversationId: string, hasUnreadTurn: boolean) =>
          codexService.setConversationUnreadState(conversationId, hasUnreadTurn),
      );

      yield* Effect.all(registrations, { discard: true });
    }),
  );
