import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent, OpenDialogOptions } from "electron";
import type { CoreResult } from "../../../shared/core-result";
import type { IpcApi } from "../../../shared/ipc-api";
import { WorkbenchSceneSnapshotSchema } from "../../../shared/schemas/workbench-scene";
import { ProjectLifecycleInputSchema } from "../../../shared/schemas/projects";
import type { TerminalSessionSnapshot } from "../../../shared/types";
import { MainConfig } from "../../app/MainConfig";
import { ScopedCallbackRuntime } from "../../app/ScopedCallbackRuntime";
import type { BrowserSidebarService } from "../../browser-sidebar-service";
import type { CodexService } from "../../codex/codex-service";
import type { DesktopProjectWorkspacePort } from "../../core-client/project-workspace-adapter";
import { coreResultFrom } from "../../core-result-ipc";
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
import { ProjectRuntimeLifecycleRuntime } from "../../host-runtime/ProjectRuntimeLifecycleRuntime";
import { makeProjectRuntimeLifecyclePromiseAdapter } from "../../host-runtime/ProjectRuntimeLifecycleRuntimePromiseAdapter";
import { deleteProjectSessionWithBrowserCleanupUsing } from "../../project-session-browser-ownership";
import { createProjectLifecycleService } from "../../project-lifecycle-service";
import { renameProjectSessionChat } from "../../project-session-rename-service";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export interface ProjectWorkspaceIpcOptions {
  readonly browserSidebar: BrowserSidebarService;
  readonly codex: CodexService;
  readonly projects: DesktopProjectWorkspacePort;
  readonly terminals?: {
    readonly listLiveSessionsForOwners: (input: {
      readonly conversationIds: ReadonlySet<string>;
      readonly projectSessionIds: ReadonlySet<string>;
    }) => Promise<readonly TerminalSessionSnapshot[]>;
    readonly discardExitedSessionsForOwners: (input: {
      readonly conversationIds: ReadonlySet<string>;
      readonly projectSessionIds: ReadonlySet<string>;
    }) => Promise<readonly string[]>;
  };
}

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

export const live = (
  options: ProjectWorkspaceIpcOptions,
): Layer.Layer<
  never,
  never,
  | ElectronDesktop
  | ElectronIpc
  | MainConfig
  | ProjectRuntimeLifecycleRuntime
  | ScopedCallbackRuntime
  | WindowRuntime
> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const config = yield* MainConfig;
      const desktop = yield* ElectronDesktop;
      const ipc = yield* ElectronIpc;
      const projectRuntimeLifecycle = yield* ProjectRuntimeLifecycleRuntime;
      const callbacks = yield* ScopedCallbackRuntime;
      const windows = yield* WindowRuntime;
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
          catch: (cause) =>
            new ProjectWorkspaceIpcError({ operation: "authorize-renderer", cause }),
        });
      const run = <A>(operation: string, task: () => A | Promise<A>) =>
        Effect.tryPromise({
          try: () => Promise.resolve(task()),
          catch: (cause) => new ProjectWorkspaceIpcError({ operation, cause }),
        });
      const invoke = <Channel extends keyof IpcApi>(
        channel: Channel,
        task: (
          event: IpcMainInvokeEvent,
          ...args: IpcApi[Channel]["args"]
        ) => IpcApi[Channel]["result"] | Promise<IpcApi[Channel]["result"]>,
      ) =>
        handle(channel, (event, ...args) =>
          authorize(event).pipe(Effect.andThen(run(channel, () => task(event, ...args)))),
        );
      const core = <Channel extends keyof IpcApi>(
        channel: Channel,
        read: (
          event: IpcMainInvokeEvent,
          ...args: IpcApi[Channel]["args"]
        ) => Promise<CoreValue<Channel>>,
      ) =>
        handle(channel, (event, ...args) =>
          authorize(event).pipe(
            Effect.andThen(
              run(channel, () =>
                coreResultFrom(async () => await read(event, ...args)),
              ) as Effect.Effect<IpcApi[Channel]["result"], ProjectWorkspaceIpcError>,
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
      const lifecycle = createProjectLifecycleService({
        projectWorkspace: options.projects,
        browserRuntime: options.browserSidebar,
        listCodexBlockers: (threadIds) => options.codex.listProjectArchiveBlockers(threadIds),
        listBackgroundProcessRows: (threadId) =>
          options.codex.listBackgroundProcessRows({ threadId }),
        listLiveTerminalSessions: (input) =>
          options.terminals?.listLiveSessionsForOwners(input) ?? Promise.resolve([]),
        discardExitedTerminalSessions: (input) =>
          options.terminals?.discardExitedSessionsForOwners(input) ?? Promise.resolve([]),
        coordinator: makeProjectRuntimeLifecyclePromiseAdapter(projectRuntimeLifecycle, callbacks),
      });

      yield* invoke("projects:list", (_, input) => options.projects.listProjectWindow(input));
      yield* invoke("projects:get", (_, projectId) => options.projects.getProject(projectId));
      yield* invoke("projects:activity-summaries", (_, projectIds) =>
        options.projects.readProjectActivitySummaries(projectIds),
      );
      yield* core("projects:create", (_, input) =>
        createProjectWithDefaultSource(input, {
          projectsDirectory: resolveNodexProjectsDirectory(config.documentsPath),
          createProject: options.projects.createProject,
        }),
      );
      yield* core("projects:update", (_, projectId, updates) =>
        options.projects.updateProject(projectId, updates),
      );
      yield* invoke("projects:reorder", (_, input) => options.projects.reorderProjects(input));
      yield* invoke("projects:set-pinned", (_, projectId, input) =>
        options.projects.setProjectPinned(projectId, input),
      );
      yield* invoke("projects:set-pinned-order", (_, input) =>
        options.projects.setPinnedProjectOrder(input),
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
      yield* invoke("projects:set-lifecycle", (_, projectId, input) => {
        const parsed = ProjectLifecycleInputSchema.parse(input);
        return lifecycle.setLifecycle(projectId, parsed.lifecycle);
      });
      yield* invoke("workspace:tasks:list", async (_, projectId, input) => {
        const startedAt = getDevRuntimeMetricStart();
        const window = await options.projects.listProjectSessionSummaryWindow(projectId, input);
        logDevRuntimeMetric("ipc.workspace_tasks_list", {
          projectId,
          includeArchived: input?.includeArchived === true,
          requestedFirst: input?.first ?? 50,
          itemCount: window.items.length,
          hasMore: window.hasMore,
          approxPayloadBytes: approximateJsonPayloadBytes(window),
          durationMs: getDevRuntimeMetricDurationMs(startedAt),
        });
        return window;
      });
      yield* invoke("project-sessions:get", async (_, sessionId) => {
        const startedAt = getDevRuntimeMetricStart();
        const session = await options.projects.getProjectSession(sessionId);
        logDevRuntimeMetric("ipc.project_sessions_get", {
          sessionId,
          found: session !== null,
          approxPayloadBytes: approximateJsonPayloadBytes(session),
          durationMs: getDevRuntimeMetricDurationMs(startedAt),
        });
        return session;
      });
      yield* invoke("project-sessions:create", (_, input) =>
        options.projects.createProjectSession(input),
      );
      yield* invoke("project-sessions:ensure-default-draft", (_, projectId) =>
        options.projects.ensureDefaultDraftProjectSession(projectId),
      );
      yield* invoke("project-sessions:update", (_, sessionId, input) =>
        options.projects.updateProjectSession(sessionId, input),
      );
      yield* invoke("project-sessions:rename", (_, sessionId, input) =>
        renameProjectSessionChat(sessionId, input, {
          getProjectSession: options.projects.getProjectSession,
          renameProjectSession: options.projects.renameProjectSession,
          setThreadName: (threadId, title) => options.codex.setThreadName(threadId, title),
        }),
      );
      yield* invoke("project-sessions:delete", (_, sessionId) =>
        deleteProjectSessionWithBrowserCleanupUsing({
          sessionId,
          browserRuntime: options.browserSidebar,
          deleteProjectSession: options.projects.deleteProjectSession,
        }),
      );
      yield* invoke("project-sessions:reorder", (_, projectId, orderedSessionIds) =>
        options.projects.reorderProjectSessions(projectId, orderedSessionIds),
      );
      yield* invoke("project-sessions:set-pinned", (_, sessionId, input) =>
        options.projects.setProjectSessionPinned(sessionId, input),
      );
      yield* invoke("project-sessions:set-pinned-order", (_, projectId, input) =>
        options.projects.setPinnedProjectSessionOrder(projectId, input),
      );
      yield* invoke("project-sessions:archive", async (_, sessionId) => {
        const existing = await options.projects.getProjectSession(sessionId);
        if (!existing) return null;
        if (!existing.thread) return await options.projects.archiveProjectSession(sessionId);
        await options.codex.archiveThread(existing.thread.threadId);
        return await options.projects.getProjectSession(sessionId);
      });
      yield* invoke("project-sessions:unarchive", async (_, sessionId) => {
        const existing = await options.projects.getProjectSession(sessionId);
        if (!existing) return null;
        if (!existing.thread) return await options.projects.unarchiveProjectSession(sessionId);
        await options.codex.unarchiveThread(existing.thread.threadId);
        return await options.projects.getProjectSession(sessionId);
      });
      yield* invoke("project-sessions:mark-unread", (_, sessionId, input) =>
        options.projects.markProjectSessionUnread(sessionId, input),
      );
      yield* invoke("project-sessions:fork", (event, sessionId, input, sourceSceneContext) => {
        if (
          sourceSceneContext &&
          windows.resolveSessionId(event.sender.id) !== sourceSceneContext.browserViewScopeId
        ) {
          throw new Error("Browser view scope does not belong to the requesting window");
        }
        const parsedSceneContext = sourceSceneContext
          ? {
              browserViewScopeId: sourceSceneContext.browserViewScopeId,
              scene: WorkbenchSceneSnapshotSchema.parse(sourceSceneContext.scene),
            }
          : undefined;
        return options.codex.forkProjectSessionThread(sessionId, input, parsedSceneContext);
      });
      yield* invoke("project-session-threads:attach", (_, input) =>
        options.projects.upsertProjectSessionThreadLink(input),
      );
      yield* invoke("project-session-threads:detach", (_, sessionId) =>
        options.projects.detachProjectSessionThread(sessionId),
      );
    }),
  );
