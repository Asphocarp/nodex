import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { DesktopNotificationManager } from "../desktop-notification-manager";
import { DesktopNotificationRuntime, fromManager } from "./DesktopNotificationRuntime";

it.effect("closes active native notifications with the Main Scope", () =>
  Effect.gen(function* () {
    let closeCount = 0;
    const manager = new DesktopNotificationManager({
      isSupported: () => true,
      platform: "linux",
      createNotification: () => ({
        close: () => {
          closeCount += 1;
        },
        on: () => undefined,
        show: () => undefined,
      }),
    });
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(fromManager(manager), scope);
    Context.get(context, DesktopNotificationRuntime).manager.showNotification(
      { id: "notification-a", kind: "turn-complete", title: "Title", body: "Body" },
      { id: 42, isDestroyed: () => false } as never,
      () => undefined,
    );

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(closeCount, 1);
  }),
);
