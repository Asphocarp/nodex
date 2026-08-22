import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import type { CodexServerNotification } from "../codex-runtime/CodexApplicationProtocol";
import type { CodexEndpointEvent } from "../codex-runtime/CodexEventHub";
import { live } from "./CodexApplicationIngressRuntime";

const notification: CodexEndpointEvent = {
  kind: "notification",
  hostId: "local",
  generation: 1,
  value: {
    method: "thread/name/updated",
    params: { threadId: "thread-a", threadName: "Thread A" },
  },
};

it.effect("subscribes before Layer readiness and stops both projections with its Scope", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const events = yield* PubSub.unbounded<CodexEndpointEvent>();
    const routed = yield* Deferred.make<void>();
    const connections: string[] = [];
    const notifications: string[] = [];

    yield* Layer.buildWithScope(
      live({
        connections: Stream.succeed({ status: "connected", retries: 0 }),
        events: Stream.fromPubSub(events),
        observeConnection: (connection) => connections.push(connection.status),
        offerNotification: (event: CodexServerNotification) =>
          Effect.sync(() => notifications.push(event.method)).pipe(
            Effect.andThen(Deferred.succeed(routed, undefined)),
          ),
      }),
      scope,
    );

    assert.deepEqual(connections, ["connected"]);
    yield* PubSub.publish(events, notification);
    yield* Deferred.await(routed);
    assert.deepEqual(notifications, ["thread/name/updated"]);

    yield* Scope.close(scope, Exit.void);
    yield* PubSub.publish(events, notification);
    yield* Effect.yieldNow;
    assert.deepEqual(notifications, ["thread/name/updated"]);
    yield* PubSub.shutdown(events);
  }),
);
