import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent, OpenDialogOptions } from "electron";
import type { CoreResult } from "../../../shared/core-result";
import type { IpcApi } from "../../../shared/ipc-api";
import { WorkbenchSceneSnapshotSchema } from "../../../shared/schemas/workbench-scene";
import { ProjectLifecycleInputSchema } from "../../../shared/schemas/projects";
import { MainConfig } from "../../app/MainConfig";
import { CodexProjectSessionFork } from "../../codex-application/CodexProjectSessionFork";
import { CodexThreadTitlePersistence } from "../../codex-application/CodexThreadTitlePersistence";
import { ConversationCommands } from "../../codex-application/ConversationCommands";
import { CoreModuleResponseError } from "../../core-client/core-client";
import type { CoreRuntimeError } from "../../core-runtime/CoreRuntimeError";
import { createProjectWithDefaultSource } from "../../default-project-source";
import {
  approximateJsonPayloadBytes,
  getDevRuntimeMetricDurationMs,
  getDevRuntimeMetricStart,
  logDevRuntimeMetric,
} from "../../dev-runtime-metrics";
import { resolveNodexProjectsDirectory } from "../../nodex-projects-directory";
import { ElectronDesktop } from "../../platform/electron/ElectronDesktop";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { BrowserSidebarRuntime } from "../../host-runtime/BrowserSidebarRuntime";
import { deleteProjectSessionWithBrowserCleanupUsing } from "../../project-session-browser-ownership";
import { ProjectLifecycleCommands } from "../../project-application/ProjectLifecycleCommands";
import {
  ProjectWorkspace,
  ProjectWorkspaceError,
} from "../../project-application/ProjectWorkspace";
import { renameProjectSessionChat } from "../../project-session-rename-service";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export class ProjectWorkspaceIpcError extends Schema.TaggedError<ProjectWorkspaceIpcError>()(
  "ProjectWorkspaceIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

type Handler<Channel extends keyof IpcApi> = (
  event: IpcMainInvokeEvent,
  ...args: IpcApi[Channel]["args"]
) => Effect.Effect<IpcApi[Channel]["result"], unknown>;

type CoreValue<Channel extends keyof IpcApi> =
  IpcApi[Channel]["result"] extends CoreResult<infer Value> ? Value : never;

export const live: Layer.Layer<
  never,
  never,
  | BrowserSidebarRuntime
  | CodexProjectSessionFork
  | CodexThreadTitlePersistence
  | ConversationCommands
  | ElectronDesktop
  | ElectronIpc
  | MainConfig
  | ProjectLifecycleCommands
  | ProjectWorkspace
  | WindowRuntime
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    const conversationCommands = yield* ConversationCommands;
    const projectSessionFork = yield* CodexProjectSessionFork;
    const desktop = yield* ElectronDesktop;
    const ipc = yield* ElectronIpc;
    const projectLifecycle = yield* ProjectLifecycleCommands;
    const projects = yield* ProjectWorkspace;
    const threadTitles = yield* CodexThreadTitlePersistence;
    const windows = yield* WindowRuntime;
    const browserSidebar = yield* BrowserSidebarRuntime;
    const projectSessionBrowserRuntime = {
      closeBrowserConversation: (browserConversationId: string) =>
        Effect.sync(() => browserSidebar.browser.closeBrowserConversation(browserConversationId)),
    };
    const handle = <Channel extends keyof IpcApi>(channel: Channel, handler: Handler<Channel>) =>
      ipc.handle(channel, handler);
    const authorize = (event: IpcMainInvokeEvent) =>
      Effect.try({
        try: () => {
          requireTrustedAppRendererSender(event, "Project workspace", config.rendererUrl);
          if (!windows.has(event.sender.id)) {
            throw new Error("Project workspace access requires an active Nodex window");
          }
        },
        catch: (cause) => new ProjectWorkspaceIpcError({ operation: "authorize-renderer", cause }),
      });
    const run = <A>(operation: string, task: () => A | Promise<A>) =>
      Effect.tryPromise({
        try: () => Promise.resolve(task()),
        catch: (cause) => new ProjectWorkspaceIpcError({ operation, cause }),
      });
    const invokeEffect = <Channel extends keyof IpcApi>(
      channel: Channel,
      task: (
        event: IpcMainInvokeEvent,
        ...args: IpcApi[Channel]["args"]
      ) => Effect.Effect<IpcApi[Channel]["result"], unknown>,
    ) =>
      handle(channel, (event, ...args) =>
        authorize(event).pipe(
          Effect.andThen(
            task(event, ...args).pipe(
              Effect.mapError(
                (cause) => new ProjectWorkspaceIpcError({ operation: channel, cause }),
              ),
            ),
          ),
        ),
      );
    const unwrapCoreError = (cause: unknown): CoreModuleResponseError | null => {
      if (cause instanceof CoreModuleResponseError) return cause;
      if (cause instanceof ProjectWorkspaceError) return unwrapCoreError(cause.cause);
      if (
        typeof cause === "object" &&
        cause !== null &&
        "_tag" in cause &&
        cause._tag === "CoreRuntimeError"
      ) {
        return unwrapCoreError((cause as CoreRuntimeError).cause);
      }
      return null;
    };
    const core = <Channel extends keyof IpcApi>(
      channel: Channel,
      read: (
        event: IpcMainInvokeEvent,
        ...args: IpcApi[Channel]["args"]
      ) => Effect.Effect<CoreValue<Channel>, unknown>,
    ) =>
      handle(channel, (event, ...args) =>
        authorize(event).pipe(
          Effect.andThen(
            read(event, ...args).pipe(
              Effect.map((value) => ({ ok: true, value }) as IpcApi[Channel]["result"]),
              Effect.catch((cause) => {
                const coreError = unwrapCoreError(cause);
                if (!coreError) {
                  return Effect.fail(new ProjectWorkspaceIpcError({ operation: channel, cause }));
                }
                return Effect.succeed({
                  ok: false,
                  error: coreError.coreError,
                } as IpcApi[Channel]["result"]);
              }),
            ),
          ),
        ),
      );
    const pickDirectories = (event: IpcMainInvokeEvent, dialogOptions: OpenDialogOptions) =>
      run("pick-directories", async () => {
        const owner = windows.get(event.sender.id);
        const result = owner
          ? await desktop.dialog.showOpenDialog(owner, dialogOptions)
          : await desktop.dialog.showOpenDialog(dialogOptions);
        return result.canceled ? [] : result.filePaths;
      });
    const pickDirectory = (event: IpcMainInvokeEvent, dialogOptions: OpenDialogOptions) =>
      run("pick-directory", async () => {
        const owner = windows.get(event.sender.id);
        const result = owner
          ? await desktop.dialog.showOpenDialog(owner, dialogOptions)
          : await desktop.dialog.showOpenDialog(dialogOptions);
        return result.canceled ? null : (result.filePaths[0] ?? null);
      });
    yield* invokeEffect("projects:list", (_, input) => projects.listProjectWindow(input));
    yield* invokeEffect("projects:get", (_, projectId) => projects.getProject(projectId));
    yield* invokeEffect("projects:activity-summaries", (_, projectIds) =>
      projects.readProjectActivitySummaries(projectIds),
    );
    yield* core("projects:create", (_, input) =>
      createProjectWithDefaultSource(input, {
        projectsDirectory: resolveNodexProjectsDirectory(config.documentsPath),
        createProject: projects.createProject,
      }),
    );
    yield* core("projects:update", (_, projectId, updates) =>
      projects.updateProject(projectId, updates),
    );
    yield* invokeEffect("projects:reorder", (_, input) => projects.reorderProjects(input));
    yield* invokeEffect("projects:set-pinned", (_, projectId, input) =>
      projects.setProjectPinned(projectId, input),
    );
    yield* invokeEffect("projects:set-pinned-order", (_, input) =>
      projects.setPinnedProjectOrder(input),
    );
    yield* handle("projects:pick-source-roots", (event) =>
      authorize(event).pipe(
        Effect.andThen(
          pickDirectories(event, {
            title: "Select Project Root",
            properties: ["openDirectory", "createDirectory", "multiSelections"],
          }),
        ),
      ),
    );
    yield* handle("workspace:pick-directory", (event, input) =>
      authorize(event).pipe(
        Effect.andThen(
          pickDirectory(event, {
            title: typeof input?.title === "string" ? input.title : "Choose folder",
            properties:
              input?.createDirectory === true
                ? ["openDirectory", "createDirectory"]
                : ["openDirectory"],
          }),
        ),
      ),
    );
    yield* handle("projects:set-lifecycle", (event, projectId, input) =>
      authorize(event).pipe(
        Effect.andThen(
          Effect.try({
            try: () => ProjectLifecycleInputSchema.parse(input),
            catch: (cause) =>
              new ProjectWorkspaceIpcError({ operation: "projects:set-lifecycle", cause }),
          }),
        ),
        Effect.flatMap((parsed) => projectLifecycle.setLifecycle(projectId, parsed.lifecycle)),
      ),
    );
    yield* invokeEffect("workspace:tasks:list", (_, projectId, input) =>
      Effect.gen(function* () {
        const startedAt = getDevRuntimeMetricStart();
        const window = yield* projects.listProjectSessionSummaryWindow(projectId, input);
        yield* Effect.sync(() =>
          logDevRuntimeMetric("ipc.workspace_tasks_list", {
            projectId,
            includeArchived: input?.includeArchived === true,
            requestedFirst: input?.first ?? 50,
            itemCount: window.items.length,
            hasMore: window.hasMore,
            approxPayloadBytes: approximateJsonPayloadBytes(window),
            durationMs: getDevRuntimeMetricDurationMs(startedAt),
          }),
        );
        return window;
      }),
    );
    yield* invokeEffect("project-sessions:get", (_, sessionId) =>
      Effect.gen(function* () {
        const startedAt = getDevRuntimeMetricStart();
        const session = yield* projects.getProjectSession(sessionId);
        yield* Effect.sync(() =>
          logDevRuntimeMetric("ipc.project_sessions_get", {
            sessionId,
            found: session !== null,
            approxPayloadBytes: approximateJsonPayloadBytes(session),
            durationMs: getDevRuntimeMetricDurationMs(startedAt),
          }),
        );
        return session;
      }),
    );
    yield* invokeEffect("project-sessions:create", (_, input) =>
      projects.createProjectSession(input),
    );
    yield* invokeEffect("project-sessions:ensure-default-draft", (_, projectId) =>
      projects.ensureDefaultDraftProjectSession(projectId),
    );
    yield* invokeEffect("project-sessions:update", (_, sessionId, input) =>
      projects.updateProjectSession(sessionId, input),
    );
    yield* invokeEffect("project-sessions:rename", (_, sessionId, input) =>
      renameProjectSessionChat(sessionId, input, {
        getProjectSession: projects.getProjectSession,
        renameProjectSession: projects.renameProjectSession,
        setThreadName: (threadId, title) =>
          threadTitles.set({ threadId, name: title, normalization: "manual" }),
      }),
    );
    yield* invokeEffect("project-sessions:delete", (_, sessionId) =>
      deleteProjectSessionWithBrowserCleanupUsing({
        sessionId,
        browserRuntime: projectSessionBrowserRuntime,
        deleteProjectSession: projects.deleteProjectSession,
      }),
    );
    yield* invokeEffect("project-sessions:reorder", (_, projectId, orderedSessionIds) =>
      projects.reorderProjectSessions(projectId, orderedSessionIds),
    );
    yield* invokeEffect("project-sessions:set-pinned", (_, sessionId, input) =>
      projects.setProjectSessionPinned(sessionId, input),
    );
    yield* invokeEffect("project-sessions:set-pinned-order", (_, projectId, input) =>
      projects.setPinnedProjectSessionOrder(projectId, input),
    );
    yield* invokeEffect("project-sessions:archive", (_, sessionId) =>
      Effect.gen(function* () {
        const existing = yield* projects.getProjectSession(sessionId);
        if (!existing) return null;
        if (!existing.thread) return yield* projects.archiveProjectSession(sessionId);
        yield* conversationCommands.archive(existing.thread.threadId);
        return yield* projects.getProjectSession(sessionId);
      }),
    );
    yield* invokeEffect("project-sessions:unarchive", (_, sessionId) =>
      Effect.gen(function* () {
        const existing = yield* projects.getProjectSession(sessionId);
        if (!existing) return null;
        if (!existing.thread) return yield* projects.unarchiveProjectSession(sessionId);
        yield* conversationCommands.unarchive(existing.thread.threadId);
        return yield* projects.getProjectSession(sessionId);
      }),
    );
    yield* invokeEffect("project-sessions:mark-unread", (_, sessionId, input) =>
      projects.markProjectSessionUnread(sessionId, input),
    );
    yield* handle("project-sessions:fork", (event, sessionId, input, sourceSceneContext) =>
      authorize(event).pipe(
        Effect.andThen(
          Effect.try({
            try: () => {
              if (
                sourceSceneContext &&
                windows.resolveSessionId(event.sender.id) !== sourceSceneContext.browserViewScopeId
              ) {
                throw new Error("Browser view scope does not belong to the requesting window");
              }
              return sourceSceneContext
                ? {
                    browserViewScopeId: sourceSceneContext.browserViewScopeId,
                    scene: WorkbenchSceneSnapshotSchema.parse(sourceSceneContext.scene),
                  }
                : undefined;
            },
            catch: (cause) =>
              new ProjectWorkspaceIpcError({ operation: "project-sessions:fork", cause }),
          }),
        ),
        Effect.flatMap((parsedSceneContext) =>
          projectSessionFork.fork({
            sessionId,
            input,
            ...(parsedSceneContext ? { sourceSceneContext: parsedSceneContext } : {}),
          }),
        ),
      ),
    );
    yield* invokeEffect("project-session-threads:attach", (_, input) =>
      projects.upsertProjectSessionThreadLink(input),
    );
    yield* invokeEffect("project-session-threads:detach", (_, sessionId) =>
      projects.detachProjectSessionThread(sessionId),
    );
  }),
);
