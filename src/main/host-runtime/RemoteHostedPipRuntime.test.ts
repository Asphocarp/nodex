import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import { RemoteHostedPipRuntime, testLayer } from "./RemoteHostedPipRuntime";

it.effect("owns notification consumption and releases the native host with its Scope", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const notifications: unknown[] = [];
    let alwaysHide = false;
    let disposed = 0;
    let refreshed = 0;
    const context = yield* Layer.buildWithScope(
      testLayer(
        {
          dispose: () => {
            disposed += 1;
          },
          getAlwaysHide: () => alwaysHide,
          handleBrowserUseStateSnapshot: async () => {
            refreshed += 1;
          },
          handleCodexNotification: (notification) => {
            notifications.push(notification);
          },
          handleDesktopMessageFromView: () => undefined,
          isPrivacySettingsTerminationRequest: () => false,
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
    assert.strictEqual(refreshed, 1);
    assert.deepEqual(notifications, [{ method: "turn/started", params: { threadId: "thread-1" } }]);
    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(disposed, 1);
  }),
);

it.effect("tracks Browser Use refresh signals only while its Scope is open", () =>
  Effect.gen(function* () {
    let listener: (() => void) | null = null;
    let refreshed = 0;
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      testLayer(
        {
          dispose: () => undefined,
          getAlwaysHide: () => false,
          handleBrowserUseStateSnapshot: async () => {
            refreshed += 1;
          },
          handleCodexNotification: () => undefined,
          handleDesktopMessageFromView: () => undefined,
          isPrivacySettingsTerminationRequest: () => false,
          setAlwaysHide: () => undefined,
        },
        Stream.empty,
        (next) => {
          listener = next;
          return () => {
            listener = null;
          };
        },
      ),
      scope,
    );
    yield* Effect.yieldNow;
    assert.strictEqual(refreshed, 1);

    const refresh = listener as (() => void) | null;
    refresh?.();
    yield* Effect.yieldNow;
    assert.strictEqual(refreshed, 2);

    yield* Scope.close(scope, Exit.void);
    assert.isNull(listener);
  }),
);
