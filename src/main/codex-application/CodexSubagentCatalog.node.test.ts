import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { CodexThreadSummary } from "../../shared/types";
import type { DesktopProjectWorkspaceThread } from "../core-client/project-workspace-adapter";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { codexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import type { CodexSubagentCatalogOptions } from "./CodexSubagentCatalog";
import { make } from "./CodexSubagentCatalog";

type RequestLocal = CodexGateway["Service"]["requestLocal"];

const makeGateway = (requestLocal: RequestLocal): CodexGateway["Service"] => {
  const unsupported = () => Effect.die("unused");
  return CodexGateway.of({
    localHostId: "local",
    requestRawOnHost: () => Effect.die(new Error("Unsupported raw host request")),
    requestRawForThread: () => Effect.die(new Error("Unsupported raw request")),
    events: Stream.empty,
    requestLocal,
    requestOnHost: (_hostId, method, params) => requestLocal(method, params),
    requestForThread: (_threadId, method, params) => requestLocal(method, params),
    notifyLocal: unsupported,
    connection: unsupported,
    connectionChanges: () => Stream.empty,
    awaitReady: () => Effect.void,
    reconcileHost: unsupported,
    removeHost: unsupported,
    restartHost: unsupported,
  });
};

const unusedGateway = makeGateway((() => Effect.die("unexpected request")) as RequestLocal);

const workspaceThread = (
  threadId: string,
  overrides: Partial<DesktopProjectWorkspaceThread> = {},
): DesktopProjectWorkspaceThread =>
  ({
    threadId,
    projectId: "project-1",
    sessionId: null,
    forkedFromId: null,
    parentThreadId: null,
    threadSource: "subagent",
    serviceName: null,
    agentNickname: null,
    agentRole: null,
    agentPath: null,
    threadName: threadId,
    threadPreview: "",
    modelProvider: "openai",
    executionProfile: null,
    executionHostId: "local",
    cwd: "/workspace",
    managedWorktreePath: null,
    projectlessOutputDirectory: null,
    projectlessWorkspaceBrowserRoot: null,
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    pinnedOrder: null,
    hasUnreadTurn: false,
    createdAt: 100_000,
    updatedAt: 100_000,
    recencyAt: 100_000,
    linkedAt: "2026-08-23T00:00:00.000Z",
    ...overrides,
  }) as DesktopProjectWorkspaceThread;

const options = (
  overrides: Partial<CodexSubagentCatalogOptions> = {},
): CodexSubagentCatalogOptions => ({
  materializeRead: () => Effect.void,
  shouldRetryReadWithoutTurns: () => false,
  readWorkspaceThread: () => Effect.succeed(null),
  readCanonicalParent: () => undefined,
  materialize: () => Effect.succeed(null),
  publishSummary: () => undefined,
  ...overrides,
});

it.effect("deduplicates background hydration and returns Workspace-authored summaries", () =>
  Effect.gen(function* () {
    const reads: string[] = [];
    const gateway = makeGateway(((method, params) => {
      assert.strictEqual(method, "thread/read");
      const record = typeof params === "object" && params !== null ? params : {};
      const threadId = "threadId" in record ? String(record.threadId) : "";
      return Effect.succeed({ thread: { id: threadId } });
    }) as RequestLocal);
    const runtime = yield* make(
      options({
        materializeRead: (thread, includeTurns) =>
          Effect.sync(() => reads.push(`${thread.id}:${includeTurns}`)),
        readWorkspaceThread: (threadId) => Effect.succeed(workspaceThread(threadId)),
      }),
    ).pipe(Effect.provideService(CodexGateway, gateway));

    const summaries = yield* runtime.hydrateBackground({
      threadIds: [" child-1 ", "child-1", "", "child-2"],
      includeTurns: true,
    });
    assert.deepEqual(reads, ["child-1:true", "child-2:true"]);
    assert.deepEqual(
      summaries.map((summary) => summary.threadId),
      ["child-1", "child-2"],
    );
  }),
);

it.effect("falls back to metadata-only read for a pre-materialized subagent", () =>
  Effect.gen(function* () {
    const requests: boolean[] = [];
    const materialized: boolean[] = [];
    const gateway = makeGateway(((method, params) => {
      assert.strictEqual(method, "thread/read");
      const record = typeof params === "object" && params !== null ? params : {};
      const includeTurns = "includeTurns" in record && record.includeTurns === true;
      requests.push(includeTurns);
      if (includeTurns) {
        return Effect.fail(
          codexRuntimeError({
            operation: "gateway.request",
            reason: "request",
            retryable: false,
            cause: new Error("includeTurns is unavailable before first user message"),
          }),
        );
      }
      return Effect.succeed({ thread: { id: "child-1" } });
    }) as RequestLocal);
    const runtime = yield* make(
      options({
        materializeRead: (_thread, includeTurns) =>
          Effect.sync(() => materialized.push(includeTurns)),
        shouldRetryReadWithoutTurns: () => true,
        readWorkspaceThread: (threadId) => Effect.succeed(workspaceThread(threadId)),
      }),
    ).pipe(Effect.provideService(CodexGateway, gateway));

    yield* runtime.hydrateBackground({ threadIds: ["child-1"], includeTurns: true });
    assert.deepEqual(requests, [true, false]);
    assert.deepEqual(materialized, [false]);
  }),
);

it.effect("discovers all paginated descendants and publishes each materialized summary", () =>
  Effect.gen(function* () {
    const cursors: Array<string | null | undefined> = [];
    const published: string[] = [];
    const threads = new Map<string, DesktopProjectWorkspaceThread>([
      ["root", workspaceThread("root")],
    ]);
    const gateway = makeGateway(((method, params) => {
      assert.strictEqual(method, "thread/list");
      const cursor =
        typeof params === "object" && params !== null && "cursor" in params ? params.cursor : null;
      cursors.push(cursor);
      return Effect.succeed(
        cursor === null
          ? {
              data: [
                {
                  id: "child-1",
                  cwd: "/workspace",
                  createdAt: 110,
                  parent_thread_id: "root",
                },
              ],
              nextCursor: "page-2",
            }
          : {
              data: [
                {
                  id: "child-2",
                  cwd: "/workspace",
                  createdAt: 105,
                  parent_thread_id: "child-1",
                },
              ],
              nextCursor: null,
            },
      );
    }) as RequestLocal);
    const runtime = yield* make(
      options({
        readWorkspaceThread: (threadId) => Effect.succeed(threads.get(threadId) ?? null),
        materialize: ({ thread, parentThreadId }) => {
          const threadId = String(thread.id);
          const materialized = workspaceThread(threadId, { parentThreadId });
          threads.set(threadId, materialized);
          return Effect.succeed({
            threadId,
            source: { parentThreadId },
          } as CodexThreadSummary);
        },
        publishSummary: (summary) => published.push(summary.threadId),
      }),
    ).pipe(Effect.provideService(CodexGateway, gateway));

    const summaries = yield* runtime.hydratePanel({ rootThreadId: "root" });
    assert.deepEqual(cursors, [null, "page-2"]);
    assert.deepEqual(
      summaries.map((summary) => summary.threadId),
      ["child-1", "child-2"],
    );
    assert.deepEqual(published, ["child-1", "child-2"]);
  }),
);

it.effect("opens full-fidelity delivery and clears both subagent indexes with the Thread", () =>
  Effect.gen(function* () {
    const runtime = yield* make(options()).pipe(Effect.provideService(CodexGateway, unusedGateway));
    runtime.observe("child-1");
    assert.isTrue(runtime.shouldDropDelta("item/agentMessage/delta", "child-1"));
    assert.isFalse(runtime.shouldDropDelta("turn/completed", "child-1"));
    assert.isTrue(yield* runtime.open("child-1"));
    assert.isFalse(runtime.shouldDropDelta("item/agentMessage/delta", "child-1"));
    runtime.clear("child-1");
    assert.isFalse(runtime.shouldDropDelta("item/agentMessage/delta", "child-1"));
  }),
);

it.effect("Main Scope close interrupts an active hydration", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    let interrupted = false;
    const gateway = makeGateway((() =>
      Effect.never.pipe(
        Effect.onInterrupt(() => Effect.sync(() => (interrupted = true))),
      )) as RequestLocal);
    const runtime = yield* make(options()).pipe(
      Effect.provideService(CodexGateway, gateway),
      Effect.provideService(Scope.Scope, ownerScope),
    );
    const hydration = yield* Effect.forkChild(
      runtime.hydrateBackground({ threadIds: ["child-1"] }),
      { startImmediately: true },
    );
    yield* Effect.yieldNow;
    yield* Scope.close(ownerScope, Exit.void);
    assert.strictEqual((yield* Fiber.await(hydration))._tag, "Failure");
    assert.isTrue(interrupted);
  }),
);
