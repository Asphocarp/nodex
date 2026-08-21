import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { make } from "./BrowserSidebarEventHub";

it.effect("owns ordered Browser Sidebar streams and the exact IAB callback seam", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const events = yield* make.pipe(Effect.provideService(Scope.Scope, scope));
    const collected = yield* events.events.pipe(
      Stream.take(2),
      Stream.runCollect,
      Effect.forkIn(scope, { startImmediately: true }),
    );
    let attachedCount = 0;
    events.subscribeWebviewAttached(() => {
      attachedCount += 1;
    });
    const attached = {
      browserConversationId: "conversation-1",
      browserViewScopeId: "scope-1",
      browserTabId: "tab-1",
      mountGeneration: 1,
      webContentsId: 1,
    } as const;

    events.publish({ kind: "state", value: { tabs: [] } });
    events.publish({ kind: "webviewAttached", value: attached });

    assert.deepEqual(
      (yield* Fiber.join(collected)).map((event) => event.kind),
      ["state", "webviewAttached"],
    );
    assert.strictEqual(attachedCount, 1);

    yield* Scope.close(scope, Exit.void);
    events.publish({ kind: "webviewAttached", value: attached });
    assert.strictEqual(attachedCount, 1);
    assert.deepEqual(yield* Stream.runCollect(events.events), []);
  }),
);
