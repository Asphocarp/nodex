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

it.layer(NodeServices.layer)("BrowserSidebarRuntime", (it) => {
  it.effect("owns the Browser sidebar service with the Main Scope", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        live("/tmp/nodex-browser-sidebar-runtime").pipe(
          Layer.provide(
            Layer.merge(
              callbackLayer,
              Layer.succeed(
                ElectronNet,
                ElectronNet.of({
                  appVersion: "test",
                  fetch: () => Effect.die("unused"),
                  readBase64: () => Effect.die("unused"),
                }),
              ),
            ),
          ),
        ),
        scope,
      );
      const { browser } = Context.get(context, BrowserSidebarRuntime);
      browser.on("state", () => undefined);
      assert.strictEqual(browser.listenerCount("state"), 1);

      yield* Scope.close(scope, Exit.void);
      assert.strictEqual(browser.listenerCount("state"), 0);
    }),
  );
});
