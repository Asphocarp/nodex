import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { CodexConnectionState } from "../../shared/types";
import { CodexApplicationEventHub, type CodexApplicationEvent } from "./CodexApplicationEventHub";
import { CodexConnection } from "./CodexConnection";
import { make } from "./CodexConnectionLifecycle";
import { CodexPendingServerRequestRuntime } from "./CodexPendingServerRequestRuntime";
import { CodexProtocolNotificationEffects } from "./CodexProtocolNotificationEffects";
import { CodexSidebarSyncRuntime } from "./CodexSidebarSyncRuntime";
import { CodexUserInputAutoResolution } from "./CodexUserInputAutoResolution";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

it.effect("settles a lost generation and marks loaded conversations before reconnect sync", () =>
  Effect.gen(function* () {
    const trace: string[] = [];
    const published: CodexApplicationEvent[] = [];
    const runtime = yield* make.pipe(
      Effect.provideService(
        CodexConnection,
        CodexConnection.of({ read: Effect.die("unused"), changes: Stream.empty }),
      ),
      Effect.provideService(
        CodexApplicationEventHub,
        CodexApplicationEventHub.of({
          events: Stream.empty,
          publish: (event) => published.push(event),
        }),
      ),
      Effect.provideService(
        CodexPendingServerRequestRuntime,
        CodexPendingServerRequestRuntime.of({
          disconnectIdentities: () => [{ threadId: "thread-1", requestId: 7 }],
        } as unknown as CodexPendingServerRequestRuntime["Service"]),
      ),
      Effect.provideService(
        CodexProtocolNotificationEffects,
        CodexProtocolNotificationEffects.of({
          apply: ({ notification }) =>
            Effect.sync(() => {
              assert.strictEqual(notification.method, "serverRequest/resolved");
              if (notification.method !== "serverRequest/resolved") return;
              trace.push(`${notification.method}:${notification.params.requestId}`);
            }),
        }),
      ),
      Effect.provideService(
        CodexSidebarSyncRuntime,
        CodexSidebarSyncRuntime.of({
          sync: () => Effect.sync(() => trace.push("sidebar")).pipe(Effect.as({} as never)),
        } as unknown as CodexSidebarSyncRuntime["Service"]),
      ),
      Effect.provideService(
        CodexUserInputAutoResolution,
        CodexUserInputAutoResolution.of({
          handleDisconnect: Effect.sync(() => trace.push("auto-resolution")),
        } as unknown as CodexUserInputAutoResolution["Service"]),
      ),
      Effect.provideService(
        ConversationRuntimeMap,
        ConversationRuntimeMap.of({
          runExclusive: (<A, E, R>(
            _threadId: string,
            operation: Effect.Effect<A, E, R>,
          ): Effect.Effect<A, E, R> =>
            operation) as ConversationRuntimeMap["Service"]["runExclusive"],
          markAllNeedsResume: () => trace.push("mark-needs-resume"),
        } as unknown as ConversationRuntimeMap["Service"]),
      ),
    );

    const connected = (retries: number): CodexConnectionState => ({
      status: "connected",
      retries,
      lastConnectedAt: 1,
    });
    yield* runtime.observe(connected(0));
    yield* runtime.observe({ status: "error", retries: 1, message: "lost" });
    yield* runtime.observe(connected(1));

    assert.deepEqual(trace, [
      "auto-resolution",
      "serverRequest/resolved:7",
      "mark-needs-resume",
      "sidebar",
    ]);
    assert.strictEqual(
      published.filter((event) => event.kind === "codex" && event.value.type === "connection")
        .length,
      3,
    );
    assert.strictEqual(
      published.filter(
        (event) =>
          event.kind === "hostMessage" &&
          event.value.type === "sharedObjectUpdated" &&
          event.value.object.objectType === "connection",
      ).length,
      3,
    );
  }),
);
