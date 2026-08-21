import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { ComputerUseRuntime } from "./ComputerUseRuntime";
import { DesktopToolRuntime, testLayer } from "./DesktopToolRuntime";
import type { BrowserPluginReconcileResult } from "../codex/browser-plugin-reconciler";

it.effect("owns desktop plugin readiness and derives one coherent snapshot", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const computerUse = {
      message: "Computer Use is unavailable in this fixture",
      reason: "runtime-unavailable" as const,
      status: "unavailable" as const,
    };
    let pluginResult: BrowserPluginReconcileResult | null = null;
    let requestedBackends: readonly string[] = [];
    const context = yield* Layer.buildWithScope(
      testLayer({
        browserRuntime: {
          message: "Browser runtime is unavailable in this fixture",
          reason: "backend-unavailable",
          status: "unavailable",
        },
        computerUse: ComputerUseRuntime.of({
          current: () => computerUse,
          ensureReady: Effect.succeed(computerUse),
        }),
        plugins: (availableBackends) =>
          Effect.succeed({
            ensureInstalled: Effect.sync(() => {
              requestedBackends = availableBackends();
              pluginResult = {
                computerUse: {
                  message: "Computer Use runtime capability is unavailable",
                  reason: "capability-unavailable",
                  status: "unavailable",
                },
                enabled: true,
                installedVersion: "1.0.0-test",
                marketplaceRoot: "/tmp/openai-bundled",
                status: "ready",
              };
              return pluginResult;
            }),
            result: Effect.sync(() => pluginResult),
          }),
        runtimeStateHome: "/tmp/nodex-desktop-tools-test",
      }),
      scope,
    );
    const runtime = Context.get(context, DesktopToolRuntime);
    runtime.setAvailableBackendsResolver(() => ["iab"]);
    const ready = yield* runtime.ensureReady;

    assert.deepEqual(requestedBackends, ["iab"]);
    assert.isTrue(ready.browserPluginReady);
    assert.isFalse(ready.computerUsePluginReady);
    assert.strictEqual(ready.computerUse, computerUse);
    assert.isNull(yield* runtime.threadConfig);
    const browserEvents: string[] = [];
    yield* runtime.installBrowserUseBindings({
      lifecycle: {
        releaseSession: (sessionId) => {
          browserEvents.push(`release:${sessionId}`);
        },
        turnEnded: ({ sessionId, turnId }) => {
          browserEvents.push(`ended:${sessionId}:${turnId}`);
        },
        turnStarted: ({ sessionId, turnId }) => {
          browserEvents.push(`started:${sessionId}:${turnId}`);
        },
      },
      routePromoter: {
        promote: async ({ codexSessionId }) => {
          browserEvents.push(`promote:${codexSessionId}`);
        },
      },
    });
    yield* runtime.turnStarted({ sessionId: "thread-1", turnId: "turn-1" });
    yield* runtime.turnEnded({ sessionId: "thread-1", turnId: "turn-1" });
    yield* runtime.promoteBrowserUseRoute({
      browserConversationId: "browser-1",
      browserViewScopeId: "scope-1",
      codexSessionId: "thread-1",
      projectId: "project-1",
    });
    yield* runtime.releaseBrowserUseSession("thread-1");
    assert.deepEqual(browserEvents, [
      "started:thread-1:turn-1",
      "ended:thread-1:turn-1",
      "promote:thread-1",
      "release:thread-1",
    ]);
    yield* runtime.clearBrowserUseBindings;
    yield* runtime.turnStarted({ sessionId: "thread-1", turnId: "turn-2" });
    assert.strictEqual(browserEvents.length, 4);
    yield* Scope.close(scope, Exit.void);
  }),
);
