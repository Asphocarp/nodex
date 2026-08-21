import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { codexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import { CodexConnection, live, projectCodexConnection } from "./CodexConnection";

it.effect("projects the authoritative endpoint state without losing retry history", () =>
  Effect.gen(function* () {
    const retrying = projectCodexConnection(
      { status: "connected", retries: 1, lastConnectedAt: 10 },
      {
        kind: "backing-off",
        hostId: "local",
        generation: 2,
        attempt: 3,
        error: codexRuntimeError({
          operation: "session.spawn",
          reason: "spawn",
          retryable: true,
        }),
      },
      20,
    );
    assert.deepEqual(retrying, {
      status: "missingBinary",
      retries: 3,
      message: "Codex session.spawn failed",
    });

    const unsupported = () => Effect.die(new Error("Unsupported test operation"));
    const gateway = CodexGateway.of({
      localHostId: "local",
      requestRawOnHost: () => Effect.die(new Error("Unsupported raw host request")),
      requestRawForThread: () => Effect.die(new Error("Unsupported raw request")),
      events: Stream.empty,
      requestLocal: unsupported,
      requestOnHost: unsupported,
      requestForThread: unsupported,
      notifyLocal: unsupported,
      connection: () => Effect.succeed({ kind: "ready", hostId: "local", generation: 1 }),
      connectionChanges: () => Stream.succeed({ kind: "ready", hostId: "local", generation: 1 }),
      awaitReady: () => Effect.void,
      reconcileHost: unsupported,
      removeHost: unsupported,
      restartHost: unsupported,
    });
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      live.pipe(Layer.provide(Layer.succeed(CodexGateway, gateway))),
      scope,
    );
    const connection = Context.get(context, CodexConnection);
    const snapshot = yield* connection.read;
    assert.strictEqual(snapshot.status, "connected");
    assert.strictEqual(snapshot.retries, 0);
    assert.isNumber(snapshot.lastConnectedAt);
    yield* Scope.close(scope, Exit.void);
  }),
);
