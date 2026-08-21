import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { CodexConnectionState } from "../../shared/types";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexEndpointConnection } from "../codex-runtime/CodexEventHub";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";

export class CodexConnection extends Context.Service<
  CodexConnection,
  {
    readonly read: Effect.Effect<CodexConnectionState, CodexRuntimeError>;
  }
>()("nodex/main/codex-application/CodexConnection") {}

const disconnected = (): CodexConnectionState => ({ status: "disconnected", retries: 0 });

export const projectCodexConnection = (
  previous: CodexConnectionState,
  connection: CodexEndpointConnection,
  now: number,
): CodexConnectionState => {
  switch (connection.kind) {
    case "connecting":
      return { status: "starting", retries: previous.retries };
    case "ready":
      return {
        status: "connected",
        retries: previous.retries,
        lastConnectedAt: previous.status === "connected" ? (previous.lastConnectedAt ?? now) : now,
      };
    case "backing-off":
      return {
        status: connection.error.reason === "spawn" ? "missingBinary" : "error",
        retries: Math.max(previous.retries, connection.attempt),
        message: connection.error.message,
      };
    case "failed":
      return {
        status: connection.error.reason === "spawn" ? "missingBinary" : "error",
        retries: previous.retries,
        message: connection.error.message,
      };
    case "closing":
    case "stopped":
      return { status: "disconnected", retries: previous.retries };
  }
};

export const live: Layer.Layer<CodexConnection, never, CodexGateway> = Layer.effect(
  CodexConnection,
  Effect.gen(function* () {
    const gateway = yield* CodexGateway;
    const state = yield* Ref.make(disconnected());
    const observe = Effect.fn("CodexConnection.observe")(function* (
      connection: CodexEndpointConnection,
    ) {
      const now = yield* Clock.currentTimeMillis;
      return yield* Ref.updateAndGet(state, (previous) =>
        projectCodexConnection(previous, connection, now),
      );
    });

    yield* gateway.events.pipe(
      Stream.filter(
        (event) => event.kind === "connection" && event.value.hostId === gateway.localHostId,
      ),
      Stream.runForEach((event) =>
        event.kind === "connection" ? observe(event.value).pipe(Effect.asVoid) : Effect.void,
      ),
      Effect.forkScoped,
    );

    return CodexConnection.of({
      read: gateway.connection(gateway.localHostId).pipe(Effect.flatMap(observe)),
    });
  }),
);
