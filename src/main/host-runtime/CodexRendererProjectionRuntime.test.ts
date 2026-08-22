import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { EventEmitter } from "node:events";
import { assert, it } from "@effect/vitest";
import type { CodexService } from "../codex/codex-service";
import type {
  RendererClientEvent,
  RendererClientRuntimeService,
} from "../codex/renderer-client-runtime-contracts";
import { live } from "./CodexRendererProjectionRuntime";

it.effect("releases Codex projection and renderer-client subscriptions with the Main Scope", () =>
  Effect.gen(function* () {
    const codex = new EventEmitter() as CodexService;
    const autoResolutionChanges = yield* PubSub.unbounded();
    const projectedChanges: Array<readonly [string, unknown]> = [];
    const rendererClientEvents = yield* PubSub.unbounded<RendererClientEvent>();
    const rendererLifecycleEvents: string[] = [];
    Object.assign(codex, {
      handleRendererClientConnected: (clientId: string) => {
        rendererLifecycleEvents.push(`connected:${clientId}`);
      },
      handleRendererClientDisposed: (clientId: string) => {
        rendererLifecycleEvents.push(`disposed:${clientId}`);
      },
    });
    const rendererClients = {
      events: Stream.fromPubSub(rendererClientEvents),
    } as unknown as RendererClientRuntimeService;
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
    yield* Effect.yieldNow;
    yield* PubSub.publish(rendererClientEvents, {
      kind: "connected",
      clientId: "renderer:1",
      webContentsId: 1,
    });
    yield* PubSub.publish(rendererClientEvents, {
      kind: "disposed",
      clientId: "renderer:1",
      webContentsId: 1,
      reason: "closed",
    });
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
    assert.deepEqual(rendererLifecycleEvents, ["connected:renderer:1", "disposed:renderer:1"]);
    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(codex.eventNames().length, 0);
  }),
);
