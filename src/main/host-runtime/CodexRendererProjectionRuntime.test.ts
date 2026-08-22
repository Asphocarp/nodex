import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import type { CodexApplicationEvent } from "../codex-application/CodexApplicationEventHub";
import type { CodexService } from "../codex/codex-service";
import type {
  RendererClientEvent,
  RendererClientRuntimeService,
} from "../codex/renderer-client-runtime-contracts";
import { live } from "./CodexRendererProjectionRuntime";

it.effect("releases Codex projection and renderer-client subscriptions with the Main Scope", () =>
  Effect.gen(function* () {
    const rendererLifecycleEvents: string[] = [];
    const codex = {
      handleRendererClientConnected: (clientId: string) => {
        rendererLifecycleEvents.push(`connected:${clientId}`);
      },
      handleRendererClientDisposed: (clientId: string) => {
        rendererLifecycleEvents.push(`disposed:${clientId}`);
      },
    } as unknown as CodexService;
    const autoResolutionChanges = yield* PubSub.unbounded();
    const applicationEvents = yield* PubSub.unbounded<CodexApplicationEvent>();
    const projectedChanges: Array<readonly [string, unknown]> = [];
    const rendererClientEvents = yield* PubSub.unbounded<RendererClientEvent>();
    const rendererClients = {
      events: Stream.fromPubSub(rendererClientEvents),
    } as unknown as RendererClientRuntimeService;
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      live({
        codex,
        events: {
          events: Stream.fromPubSub(applicationEvents),
          publish: (event) => {
            PubSub.publishUnsafe(applicationEvents, event);
          },
        },
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
    yield* PubSub.publish(applicationEvents, {
      kind: "pendingWorktreesChanged",
      value: [],
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
      ["codex:pending-worktrees:changed", []],
    ]);
    assert.deepEqual(rendererLifecycleEvents, ["connected:renderer:1", "disposed:renderer:1"]);
    yield* Scope.close(scope, Exit.void);
    yield* PubSub.publish(applicationEvents, {
      kind: "pendingWorktreesChanged",
      value: [],
    });
    yield* Effect.yieldNow;
    assert.strictEqual(projectedChanges.length, 2);
  }),
);
