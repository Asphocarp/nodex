import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { DEFAULT_BROWSER_USE_POLICY } from "../../shared/browser-use-policy";
import type { BrowserUseRuntimeBindings } from "./DesktopToolRuntime";
import { BrowserUseRuntime, testLayer, type BrowserUseRuntimePorts } from "./BrowserUseRuntime";

it.effect("installs Browser Use bindings once and releases every ingress with its Scope", () =>
  Effect.gen(function* () {
    let routeCapture: ((route: never) => Promise<void>) | null = null;
    const listeners = new Map<string, (...args: never[]) => void>();
    const sidebar = {
      setBrowserUseRouteCaptureHandler: (handler: typeof routeCapture) => {
        routeCapture = handler;
      },
      on: (event: string, listener: (...args: never[]) => void) => {
        listeners.set(event, listener);
        return sidebar;
      },
      off: (event: string, listener: (...args: never[]) => void) => {
        if (listeners.get(event) === listener) listeners.delete(event);
        return sidebar;
      },
      promoteBrowserUseRoute: async () => undefined,
    } as unknown as BrowserUseRuntimePorts["browserSidebar"];
    let resolver: () => readonly ("chrome" | "iab")[] = () => [];
    let bindings: BrowserUseRuntimeBindings | null = null;
    let cleared = 0;
    const desktopTools: BrowserUseRuntimePorts["desktopTools"] = {
      clearBrowserUseBindings: Effect.sync(() => {
        cleared += 1;
        bindings = null;
      }),
      installBrowserUseBindings: (next) =>
        Effect.sync(() => {
          bindings = next;
        }),
      setAvailableBackendsResolver: (next) => {
        resolver = next;
      },
    };
    const events: string[] = [];
    const registry = {
      availableBackends: () => ["iab"] as const,
      captureRoute: () => Effect.sync(() => void events.push("capture")),
      notifyCursorArrived: () => Effect.sync(() => void events.push("cursor")),
      releaseOwner: () => Effect.sync(() => void events.push("release-owner")),
      releaseSession: () => Effect.void,
      turnEnded: () => Effect.void,
      turnStarted: () => Effect.void,
    };
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      testLayer({
        browserSidebar: sidebar,
        desktopTools,
        makeRegistry: () => Effect.succeed(registry),
      }),
      scope,
    );
    const runtime = Context.get(context, BrowserUseRuntime);
    yield* runtime.install({
      grantDownload: () => undefined,
      policyStore: {
        snapshot: () => DEFAULT_BROWSER_USE_POLICY,
        isExplicitlyDenied: () => false,
      },
      releaseCredentialOwner: () => events.push("release-credential-owner"),
    });

    assert.deepEqual(resolver(), ["iab"]);
    assert.isNotNull(bindings);
    const capture = routeCapture as ((route: unknown) => Promise<void>) | null;
    if (capture) {
      yield* Effect.promise(() =>
        capture({
          browserConversationId: "conversation",
          browserViewScopeId: "scope",
          codexSessionId: "session",
          ownerWebContentsId: 1,
          projectId: null,
        }),
      );
    }
    listeners.get("browserUseOwnerReleased")?.({ ownerWebContentsId: 1 } as never);
    listeners.get("browserUseCursorArrived")?.({
      browserConversationId: "conversation",
      browserViewScopeId: "scope",
      browserTabId: "tab",
      moveSequence: 1,
      ownerWebContentsId: 1,
    } as never);
    yield* Effect.yieldNow;
    assert.includeMembers(events, [
      "capture",
      "cursor",
      "release-credential-owner",
      "release-owner",
    ]);

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(routeCapture, null);
    assert.strictEqual(listeners.size, 0);
    assert.deepEqual(resolver(), []);
    assert.strictEqual(cleared, 1);
  }),
);
