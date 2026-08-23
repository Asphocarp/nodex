import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { layer as callbackLayer } from "../app/ScopedCallbackRuntime";
import { ElectronNet } from "../platform/electron/ElectronNet";
import { BrowserSidebarRuntime, live } from "./BrowserSidebarRuntime";
import { BrowserSiteStatusRuntime } from "./BrowserSiteStatusRuntime";

it.layer(NodeServices.layer)("BrowserSidebarRuntime", (it) => {
  it.effect("owns the Browser sidebar service with the Main Scope", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        live("/tmp/nodex-browser-sidebar-runtime").pipe(
          Layer.provide(
            Layer.mergeAll(
              callbackLayer,
              Layer.succeed(
                ElectronNet,
                ElectronNet.of({
                  appVersion: "test",
                  fetch: () => Effect.die("unused"),
                  readBase64: () => Effect.die("unused"),
                }),
              ),
              Layer.succeed(
                BrowserSiteStatusRuntime,
                BrowserSiteStatusRuntime.of({
                  cachedCommentModeBlocked: () => null,
                  isCommentModeBlocked: () => Effect.die("unused"),
                }),
              ),
            ),
          ),
        ),
        scope,
      );
      const { events } = Context.get(context, BrowserSidebarRuntime);
      let observed = 0;
      events.subscribeWebviewAttached(() => {
        observed += 1;
      });
      const attached = {
        browserConversationId: "conversation-1",
        browserViewScopeId: "scope-1",
        browserTabId: "tab-1",
        mountGeneration: 1,
        webContentsId: 1,
      } as const;
      events.publish({ kind: "webviewAttached", value: attached });
      assert.strictEqual(observed, 1);

      yield* Scope.close(scope, Exit.void);
      events.publish({ kind: "webviewAttached", value: attached });
      assert.strictEqual(observed, 1);
    }),
  );
});
