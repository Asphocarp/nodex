import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { assert, it } from "@effect/vitest";
import { RemoteHostedPipRuntime, testLayer } from "./RemoteHostedPipRuntime";

it.effect("owns notification consumption with its Scope", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const notifications: unknown[] = [];
    let alwaysHide = false;
    let refreshed = 0;
    const context = yield* Layer.buildWithScope(
      testLayer(
        {
          getAlwaysHide: () => alwaysHide,
          handleBrowserUseStateSnapshot: () => {
            refreshed += 1;
          },
          handleCodexNotification: (notification) => {
            notifications.push(notification);
          },
          handleDesktopMessageFromView: () => undefined,
          isPrivacySettingsTerminationRequest: () => false,
          pollNativePresentationState: () => undefined,
          setAlwaysHide: (value) => {
            alwaysHide = value;
          },
        },
        Stream.make({ method: "turn/started", params: { threadId: "thread-1" } }),
      ),
      scope,
    );
    const runtime = Context.get(context, RemoteHostedPipRuntime);
    yield* runtime.setAlwaysHide(true);
    yield* runtime.refresh;
    yield* Effect.yieldNow;

    assert.isTrue(runtime.getAlwaysHide());
    assert.strictEqual(refreshed, 2);
    assert.deepEqual(notifications, [{ method: "turn/started", params: { threadId: "thread-1" } }]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("tracks Browser Use refresh signals only while its Scope is open", () =>
  Effect.gen(function* () {
    let refreshed = 0;
    const signals = yield* PubSub.unbounded<void>();
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      testLayer(
        {
          getAlwaysHide: () => false,
          handleBrowserUseStateSnapshot: () => {
            refreshed += 1;
          },
          handleCodexNotification: () => undefined,
          handleDesktopMessageFromView: () => undefined,
          isPrivacySettingsTerminationRequest: () => false,
          pollNativePresentationState: () => undefined,
          setAlwaysHide: () => undefined,
        },
        Stream.empty,
        Stream.fromPubSub(signals),
      ),
      scope,
    );
    yield* Effect.yieldNow;
    assert.strictEqual(refreshed, 1);

    yield* PubSub.publish(signals, undefined);
    yield* Effect.yieldNow;
    assert.strictEqual(refreshed, 2);

    yield* Scope.close(scope, Exit.void);
    yield* PubSub.publish(signals, undefined);
    yield* Effect.yieldNow;
    assert.strictEqual(refreshed, 2);
  }),
);

it.effect("owns native presentation polling with the Main Scope clock", () =>
  Effect.gen(function* () {
    let polls = 0;
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      testLayer(
        {
          getAlwaysHide: () => false,
          handleBrowserUseStateSnapshot: () => undefined,
          handleCodexNotification: () => undefined,
          handleDesktopMessageFromView: () => undefined,
          isPrivacySettingsTerminationRequest: () => false,
          pollNativePresentationState: () => {
            polls += 1;
          },
          setAlwaysHide: () => undefined,
        },
        Stream.empty,
        Stream.empty,
        500,
      ),
      scope,
    );

    yield* TestClock.adjust(1_500);
    assert.strictEqual(polls, 3);
    yield* Scope.close(scope, Exit.void);
    yield* TestClock.adjust(1_000);
    assert.strictEqual(polls, 3);
  }),
);
