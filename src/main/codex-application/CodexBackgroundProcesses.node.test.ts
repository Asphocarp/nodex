import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import type {
  CodexBackgroundProcessRecord,
  Project,
  TerminalSessionSnapshot,
} from "../../shared/types";
import type { DesktopProjectWorkspaceThread } from "../core-client/project-workspace-adapter";
import { ProjectRuntimeLifecycleRuntime } from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { TerminalSessions } from "../terminal-runtime/TerminalSessions";
import { make, type CodexBackgroundProcessesOptions } from "./CodexBackgroundProcesses";

const project = (id: string): Project => ({ id, lifecycle: "active" }) as unknown as Project;

const thread = (threadId: string, projectId: string | null): DesktopProjectWorkspaceThread =>
  ({ threadId, projectId }) as unknown as DesktopProjectWorkspaceThread;

const terminalSessions = (
  overrides: Partial<TerminalSessions["Service"]> = {},
): TerminalSessions["Service"] =>
  TerminalSessions.of({
    refreshSessionProcessMetrics: () => Effect.void,
    getSessionSnapshot: () => Effect.succeed(null),
    runAction: () => Effect.void,
    ...overrides,
  } as unknown as TerminalSessions["Service"]);

const gateway = (
  requestForThread: CodexGateway["Service"]["requestForThread"],
): CodexGateway["Service"] => {
  const unsupported = () => Effect.die(new Error("Unsupported test operation"));
  return CodexGateway.of({
    localHostId: "local",
    requestRawOnHost: () => Effect.die(new Error("Unsupported raw host request")),
    requestRawForThread: () => Effect.die(new Error("Unsupported raw request")),
    events: Stream.empty,
    requestLocal: unsupported,
    requestOnHost: unsupported,
    requestForThread,
    notifyLocal: unsupported,
    connection: () => unsupported(),
    connectionChanges: () => Stream.empty,
    awaitReady: () => Effect.void,
    reconcileHost: unsupported,
    removeHost: unsupported,
    restartHost: unsupported,
  });
};

const makeService = (
  scope: Scope.Closeable,
  options: CodexBackgroundProcessesOptions,
  services: {
    readonly gateway: CodexGateway["Service"];
    readonly terminals?: TerminalSessions["Service"];
    readonly lifecycle?: ProjectRuntimeLifecycleRuntime["Service"];
  },
) =>
  make(options).pipe(
    Effect.provideService(CodexGateway, services.gateway),
    Effect.provideService(
      ProjectRuntimeLifecycleRuntime,
      services.lifecycle ??
        ProjectRuntimeLifecycleRuntime.of({ runExclusive: (_projectId, operation) => operation }),
    ),
    Effect.provideService(Scope.Scope, scope),
    Effect.provideService(TerminalSessions, services.terminals ?? terminalSessions()),
  );

it.effect("merges all live terminal pages with the durable background-process catalog", () =>
  Effect.gen(function* () {
    const records: CodexBackgroundProcessRecord[] = [];
    const cursors: Array<string | null> = [];
    const scope = yield* Scope.make();
    const service = yield* makeService(
      scope,
      {
        projectWorkspace: {
          getProject: async () => null,
          getThread: async () => null,
          listBackgroundProcesses: async () => records,
          upsertBackgroundProcess: async (record) => {
            records.push(record);
            return record;
          },
        },
        conversationProjection: () => ({
          threadTitle: "Build release",
          terminalItems: [
            {
              itemId: "item-b",
              processId: "process-b",
              turnId: "turn-b",
              createdAt: 42,
            },
          ],
        }),
      },
      {
        gateway: gateway(((_threadId: string, method: string, params: unknown) => {
          assert.strictEqual(method, "thread/backgroundTerminals/list");
          const cursor = (params as { readonly cursor?: string | null }).cursor ?? null;
          cursors.push(cursor);
          return Effect.succeed({
            data: [
              {
                itemId: cursor === null ? "item-a" : "item-b",
                processId: cursor === null ? "process-a" : "process-b",
                command: cursor === null ? "vp run dev" : "vp run test",
                cwd: "/repo",
                osPid: cursor === null ? 101 : 202,
                cpuPercent: null,
                rssKb: cursor === null ? 1024 : 2048,
              },
            ],
            nextCursor: cursor === null ? "page-2" : null,
          });
        }) as CodexGateway["Service"]["requestForThread"]),
      },
    );

    const rows = yield* service.list({ threadId: " thread-a " });

    assert.deepEqual(cursors, [null, "page-2"]);
    assert.deepEqual(
      rows.map(({ itemId, status }) => ({ itemId, status })),
      [
        { itemId: "item-a", status: "running" },
        { itemId: "item-b", status: "running" },
      ],
    );
    assert.strictEqual(rows[1]?.threadTitle, "Build release");
    assert.strictEqual(rows[1]?.turnId, "turn-b");
    assert.strictEqual(rows[1]?.startedAtMs, 42);
    assert.strictEqual(rows[1]?.terminal?.rssKb, 2048n);

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect(
  "admits a local terminal action, commits its catalog record, then returns live state",
  () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const records: CodexBackgroundProcessRecord[] = [];
      const scope = yield* Scope.make();
      const service = yield* makeService(
        scope,
        {
          projectWorkspace: {
            getProject: async (projectId) => {
              events.push(`project:${projectId}`);
              return project(projectId);
            },
            getThread: async (threadId) => {
              events.push(`thread:${threadId}`);
              return thread(threadId, "project-a");
            },
            listBackgroundProcesses: async () => records,
            upsertBackgroundProcess: async (record) => {
              events.push(`record:${record.itemId}`);
              records.push(record);
              return record;
            },
          },
          conversationProjection: () => ({
            threadTitle: "Projected title",
            terminalItems: [],
          }),
        },
        {
          gateway: gateway((() =>
            Effect.die("unused")) as CodexGateway["Service"]["requestForThread"]),
          lifecycle: ProjectRuntimeLifecycleRuntime.of({
            runExclusive: (projectId, operation) =>
              Effect.sync(() => events.push(`gate:${projectId}:open`)).pipe(
                Effect.andThen(operation),
                Effect.ensuring(Effect.sync(() => events.push(`gate:${projectId}:close`))),
              ),
          }),
          terminals: terminalSessions({
            runAction: (_owner, request) =>
              Effect.sync(() => events.push(`terminal:${request.sessionId}`)),
            getSessionSnapshot: (sessionId) =>
              Effect.succeed({
                sessionId,
                exited: false,
                osPid: 303,
                processMetricsSampledAtMs: null,
                childProcessCount: null,
              } as unknown as TerminalSessionSnapshot),
          }),
        },
      );

      const rows = yield* service.runAction({
        owner: { webContentsId: 7, windowSessionId: "window-a" },
        action: {
          threadId: "thread-a",
          itemId: "item-a",
          command: "vp run test",
          cwd: "/repo",
          terminalSessionId: "terminal-a",
        },
      });

      assert.deepEqual(events, [
        "thread:thread-a",
        "project:project-a",
        "gate:project-a:open",
        "thread:thread-a",
        "project:project-a",
        "record:item-a",
        "terminal:terminal-a",
        "gate:project-a:close",
      ]);
      assert.strictEqual(rows[0]?.threadTitle, "Projected title");
      assert.strictEqual(rows[0]?.status, "running");
      assert.strictEqual(rows[0]?.osPid, 303);

      yield* Scope.close(scope, Exit.void);
    }),
);

it.effect("interrupts an admitted terminal action when the owning Main Scope closes", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const scope = yield* Scope.make();
    const records: CodexBackgroundProcessRecord[] = [];
    const service = yield* makeService(
      scope,
      {
        projectWorkspace: {
          getProject: async (projectId) => project(projectId),
          getThread: async (threadId) => thread(threadId, "project-a"),
          listBackgroundProcesses: async () => records,
          upsertBackgroundProcess: async (record) => {
            records.push(record);
            return record;
          },
        },
        conversationProjection: () => ({ threadTitle: null, terminalItems: [] }),
      },
      {
        gateway: gateway((() =>
          Effect.die("unused")) as CodexGateway["Service"]["requestForThread"]),
        terminals: terminalSessions({
          runAction: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
            ),
        }),
      },
    );
    const caller = yield* Effect.forkChild(
      service.runAction({
        owner: { webContentsId: 7, windowSessionId: "window-a" },
        action: {
          threadId: "thread-a",
          itemId: "item-a",
          command: "vp run test",
          cwd: "/repo",
          terminalSessionId: "terminal-a",
        },
      }),
    );

    yield* Deferred.await(started);
    yield* Scope.close(scope, Exit.void);
    yield* Deferred.await(interrupted);
    const exit = yield* Fiber.await(caller);
    assert.isTrue(Exit.isFailure(exit));
    if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
  }),
);
