import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import type { BrowserSidebarEvent } from "../browser/BrowserSidebarEventHub";
import { DEFAULT_BROWSER_USE_POLICY } from "../../shared/browser-use-policy";
import type { BrowserUseRuntimeBindings } from "./DesktopToolRuntime";
import { BrowserUseRuntime, testLayer, type BrowserUseRuntimePorts } from "./BrowserUseRuntime";

it.effect("installs Browser Use bindings once and releases every ingress with its Scope", () =>
  Effect.gen(function* () {
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
    const browserEvents = yield* PubSub.unbounded<BrowserSidebarEvent>();
    const registry = {
      availableBackends: () => ["iab"] as const,
      captureRoute: (route: { codexSessionId: string }) =>
        Effect.sync(() => void events.push(`capture:${route.codexSessionId}`)),
      notifyCursorArrived: () => Effect.sync(() => void events.push("cursor")),
      releaseOwner: () => Effect.sync(() => void events.push("release-owner")),
      releaseSession: () => Effect.void,
      turnEnded: () => Effect.void,
      turnStarted: () => Effect.void,
    };
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      testLayer({
        browserEvents: Stream.fromPubSub(browserEvents),
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
      releaseCredentialOwner: () => Effect.sync(() => void events.push("release-credential-owner")),
    });

    assert.deepEqual(resolver(), ["iab"]);
    assert.isNotNull(bindings);
    yield* runtime.captureRoute({
      browserConversationId: "conversation",
      browserViewScopeId: "scope",
      codexSessionId: "session",
      ownerWebContentsId: 1,
      projectId: null,
    });
    yield* runtime.promoteRoute({
      browserConversationId: "conversation",
      browserViewScopeId: "scope",
      codexSessionId: "promoted-session",
      projectId: "project",
    });
    yield* PubSub.publish(browserEvents, {
      kind: "browserUseOwnerReleased",
      value: { ownerWebContentsId: 1 },
    });
    yield* PubSub.publish(browserEvents, {
      kind: "browserUseCursorArrived",
      value: {
        browserConversationId: "conversation",
        browserViewScopeId: "scope",
        browserTabId: "tab",
        moveSequence: 1,
        ownerWebContentsId: 1,
      },
    });
    yield* Effect.yieldNow;
    assert.includeMembers(events, [
      "capture:session",
      "capture:promoted-session",
      "cursor",
      "release-credential-owner",
      "release-owner",
    ]);
    assert.isTrue(
      Exit.isFailure(
        yield* Effect.exit(
          runtime.promoteRoute({
            browserConversationId: "conversation",
            browserViewScopeId: "scope",
            codexSessionId: "released-session",
            projectId: "project",
          }),
        ),
      ),
    );

    yield* Scope.close(scope, Exit.void);
    assert.deepEqual(resolver(), []);
    assert.strictEqual(cleared, 1);
  }),
);
