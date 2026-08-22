import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { EventEmitter } from "node:events";
import { assert, it } from "@effect/vitest";
import type { CodexService } from "../codex/codex-service";
import type { RendererClientRouter } from "../codex/renderer-client-router";
import { live } from "./CodexRendererProjectionRuntime";

it.effect("releases Codex projection and renderer-client subscriptions with the Main Scope", () =>
  Effect.gen(function* () {
    const codex = new EventEmitter() as CodexService;
    const autoResolutionChanges = yield* PubSub.unbounded();
    const projectedChanges: Array<readonly [string, unknown]> = [];
    let clientSubscriptionCount = 0;
    const rendererClients = {
      addClientConnectedListener: () => {
        clientSubscriptionCount += 1;
        return () => {
          clientSubscriptionCount -= 1;
        };
      },
      addClientDisposedListener: () => {
        clientSubscriptionCount += 1;
        return () => {
          clientSubscriptionCount -= 1;
        };
      },
    } as unknown as RendererClientRouter;
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      live({
        codex,
        rendererClients,
        userInputAutoResolution: {
          changes: Stream.fromPubSub(autoResolutionChanges),
        } as never,
        windows: {
          all: () => [
            {
              isDestroyed: () => false,
              webContents: {
                isDestroyed: () => false,
                send: (channel: string, change: unknown) => {
                  projectedChanges.push([channel, change]);
                },
              },
            },
          ],
        } as never,
      }),
      scope,
    );

    assert.strictEqual(codex.eventNames().length, 8);
    assert.strictEqual(clientSubscriptionCount, 2);
    yield* Effect.yieldNow;
    yield* PubSub.publish(autoResolutionChanges, {
      type: "timedOut",
      conversationId: "thread-1",
      requestId: "request-1",
    });
    yield* Effect.yieldNow;
    assert.deepEqual(projectedChanges, [
      [
        "codex:user-input:auto-resolution:changed",
        {
          type: "timedOut",
          conversationId: "thread-1",
          requestId: "request-1",
        },
      ],
    ]);
    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(codex.eventNames().length, 0);
    assert.strictEqual(clientSubscriptionCount, 0);
  }),
);
