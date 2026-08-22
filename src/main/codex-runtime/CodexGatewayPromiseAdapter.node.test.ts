import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import {
  ScopedCallbackRuntime,
  layer as scopedCallbackRuntimeLive,
} from "../app/ScopedCallbackRuntime";
import { CodexGateway } from "./CodexGateway";
import { makeCodexGatewayPromiseClient } from "./CodexGatewayPromiseAdapter";

it.effect("routes thread requests through Gateway authority and global requests locally", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const callbackContext = yield* Layer.buildWithScope(scopedCallbackRuntimeLive, scope);
    const calls: string[] = [];
    const unsupported = () => Effect.die(new Error("Unsupported test operation"));
    const gateway = CodexGateway.of({
      localHostId: "local",
      events: Stream.empty,
      requestLocal: unsupported,
      requestOnHost: (hostId, method) => {
        calls.push(`host:${hostId}:${method}`);
        return Effect.succeed({ source: hostId }) as never;
      },
      requestForThread: (threadId, method) => {
        calls.push(`thread:${threadId}:${method}`);
        return Effect.succeed({ source: threadId }) as never;
      },
      notifyLocal: unsupported,
      connection: unsupported,
      connectionChanges: () => Stream.empty,
      awaitReady: () => Effect.void,
      reconcileHost: unsupported,
      removeHost: unsupported,
      restartHost: unsupported,
    });
    const client = makeCodexGatewayPromiseClient(
      gateway,
      Context.get(callbackContext, ScopedCallbackRuntime),
    );

    const threadResult = yield* Effect.promise(() =>
      client.request<{ source: string }>("thread/read", { threadId: "thread-a" }),
    );
    const localResult = yield* Effect.promise(() =>
      client.request<{ source: string }>("config/read", { includeLayers: false }),
    );

    assert.deepEqual(threadResult, { source: "thread-a" });
    assert.deepEqual(localResult, { source: "local" });
    assert.deepEqual(calls, ["thread:thread-a:thread/read", "host:local:config/read"]);
    yield* Scope.close(scope, Exit.void);
  }),
);
