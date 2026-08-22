import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type { CodexServerNotification } from "../codex-runtime/CodexApplicationClient";
import { CodexNotificationRoutingError, make } from "./CodexNotificationRouting";

const notification = (method: CodexServerNotification["method"]) =>
  ({ method, params: {} }) as CodexServerNotification;

it.effect("routes admitted notifications in arrival order", () =>
  Effect.gen(function* () {
    const routed: string[] = [];
    const complete = yield* Deferred.make<void>();
    const runtime = yield* make({
      route: (entry) =>
        Effect.sync(() => routed.push(entry.method)).pipe(
          Effect.andThen(
            entry.method === "deprecationNotice"
              ? Deferred.succeed(complete, undefined)
              : Effect.void,
          ),
        ),
    });
    runtime.offer(notification("account/updated"));
    runtime.offer(notification("configWarning"));
    runtime.offer(notification("deprecationNotice"));
    yield* Deferred.await(complete);
    assert.deepEqual(routed, ["account/updated", "configWarning", "deprecationNotice"]);
  }),
);

it.effect("continues routing after one notification fails", () =>
  Effect.gen(function* () {
    const routed: string[] = [];
    const complete = yield* Deferred.make<void>();
    const runtime = yield* make({
      route: (entry) => {
        routed.push(entry.method);
        return entry.method === "configWarning"
          ? Effect.fail(new CodexNotificationRoutingError({ cause: new Error("broken") }))
          : Deferred.succeed(complete, undefined).pipe(Effect.asVoid);
      },
    });
    runtime.offer(notification("configWarning"));
    runtime.offer(notification("account/updated"));
    yield* Deferred.await(complete);
    assert.deepEqual(routed, ["configWarning", "account/updated"]);
  }),
);

it.effect("interrupts active routing and abandons backlog when the Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let interrupted = false;
    const routed: string[] = [];
    const runtime = yield* make({
      route: (entry) => {
        routed.push(entry.method);
        return Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.onInterrupt(() => Effect.sync(() => void (interrupted = true))),
        );
      },
    }).pipe(Effect.provideService(Scope.Scope, scope));
    runtime.offer(notification("configWarning"));
    runtime.offer(notification("account/updated"));
    yield* Deferred.await(started);
    yield* Scope.close(scope, Exit.void);
    assert.isTrue(interrupted);
    assert.deepEqual(routed, ["configWarning"]);
  }),
);
