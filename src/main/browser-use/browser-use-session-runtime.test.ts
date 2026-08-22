import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type { BrowserUseCdpEvent } from "./browser-use-iab-api";
import {
  makeBrowserUseSessionRuntime,
  type BrowserUseRouteCapture,
} from "./browser-use-session-runtime";

class FakeApi {
  activeControl = false;
  disposed = false;
  readonly endedTurns: string[] = [];

  addCdpEventListener(listener: (event: BrowserUseCdpEvent) => void) {
    void listener;
    return () => undefined;
  }

  async dispatch(method: string): Promise<unknown> {
    return method;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }

  hasActiveControl(): boolean {
    return this.activeControl;
  }

  notifyCursorArrived(moveSequence: number): void {
    void moveSequence;
  }

  async turnEnded(params: unknown): Promise<void> {
    this.endedTurns.push((params as { turn_id: string }).turn_id);
  }
}

class FakeServer {
  closed = false;
  started = false;

  constructor(readonly pipePath: string) {}

  broadcast(method: string, params?: unknown): void {
    void method;
    void params;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async start(): Promise<void> {
    this.started = true;
  }
}

const capture = (overrides: Partial<BrowserUseRouteCapture> = {}): BrowserUseRouteCapture => ({
  browserConversationId: "session-1",
  browserViewScopeId: "window-session-1",
  codexSessionId: "thread-1",
  ownerWebContentsId: 101,
  projectId: "project-1",
  ...overrides,
});

const makeTestRuntime = Effect.gen(function* () {
  const apis: FakeApi[] = [];
  const servers: FakeServer[] = [];
  const scope = yield* Scope.make();
  const runtime = yield* makeBrowserUseSessionRuntime(true, {
    createApi: () => {
      const api = new FakeApi();
      apis.push(api);
      return api;
    },
    createServer: () => {
      const server = new FakeServer(`/tmp/fake-${servers.length}.sock`);
      servers.push(server);
      return server;
    },
  }).pipe(Effect.provideService(Scope.Scope, scope));
  return { apis, runtime, scope, servers };
});

it.effect("reuses one scoped backend for an exact route", () =>
  Effect.gen(function* () {
    const { apis, runtime, scope, servers } = yield* makeTestRuntime;
    const first = yield* runtime.captureRoute(capture());
    const second = yield* runtime.captureRoute(capture());

    assert.strictEqual(first.pipePath, "/tmp/fake-0.sock");
    assert.strictEqual(second.pipePath, first.pipePath);
    assert.lengthOf(apis, 1);
    assert.lengthOf(servers, 1);
    assert.isTrue(servers[0]!.started);
    assert.deepEqual(runtime.availableBackends(), ["iab"]);
    yield* Scope.close(scope, Exit.void);
    assert.isTrue(apis[0]!.disposed);
    assert.isTrue(servers[0]!.closed);
  }),
);

it.effect("rejects route theft while controlled pages are live", () =>
  Effect.gen(function* () {
    const { apis, runtime, scope } = yield* makeTestRuntime;
    yield* runtime.captureRoute(capture());
    apis[0]!.activeControl = true;

    const error = yield* Effect.flip(
      runtime.captureRoute(
        capture({ browserViewScopeId: "window-session-2", ownerWebContentsId: 202 }),
      ),
    );
    assert.include(String(error.cause), "live controlled pages");
    assert.strictEqual((yield* runtime.debugSnapshot).sessions[0]?.ownerWebContentsId, 101);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("atomically replaces a provisional route with its Codex session", () =>
  Effect.gen(function* () {
    const { apis, runtime, scope, servers } = yield* makeTestRuntime;
    yield* Effect.all(
      [
        runtime.captureRoute(capture({ codexSessionId: "session-1" })),
        runtime.captureRoute(capture({ codexSessionId: "thread-1" })),
      ],
      { concurrency: "unbounded" },
    );

    const snapshot = yield* runtime.debugSnapshot;
    assert.lengthOf(snapshot.sessions, 1);
    assert.strictEqual(snapshot.sessions[0]?.browserConversationId, "session-1");
    assert.strictEqual(snapshot.sessions[0]?.sessionId, "thread-1");
    assert.lengthOf(apis, 2);
    assert.isTrue(apis[0]!.disposed);
    assert.isTrue(servers[0]!.closed);
    assert.isTrue(servers[1]!.started);
    assert.isTrue(snapshot.events.some((event) => event.kind === "provisional-route-rebound"));
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("serializes turn completion and ignores stale completion", () =>
  Effect.gen(function* () {
    const { apis, runtime, scope } = yield* makeTestRuntime;
    yield* runtime.captureRoute(capture());
    yield* runtime.turnStarted({ sessionId: "thread-1", turnId: "turn-2" });
    yield* runtime.turnEnded({ sessionId: "thread-1", turnId: "turn-1" });
    yield* runtime.turnEnded({ sessionId: "thread-1", turnId: "turn-2" });

    assert.deepEqual(apis[0]?.endedTurns, ["turn-2"]);
    assert.isTrue(
      (yield* runtime.debugSnapshot).events.some(
        (event) => event.kind === "stale-turn-end-ignored",
      ),
    );
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("invalidates every backend owned by a renderer", () =>
  Effect.gen(function* () {
    const { apis, runtime, scope, servers } = yield* makeTestRuntime;
    yield* runtime.captureRoute(capture());
    yield* runtime.releaseOwner(101);

    assert.deepEqual((yield* runtime.debugSnapshot).sessions, []);
    assert.isTrue(apis[0]!.disposed);
    assert.isTrue(servers[0]!.closed);
    yield* Scope.close(scope, Exit.void);
  }),
);
