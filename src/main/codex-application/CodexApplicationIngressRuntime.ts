import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { CodexConnectionState } from "../../shared/types";
import type { CodexServerNotification } from "../codex-runtime/CodexApplicationProtocol";
import type { CodexEndpointEvent } from "../codex-runtime/CodexEventHub";

export interface CodexApplicationIngressRuntimeOptions {
  readonly connections: Stream.Stream<CodexConnectionState>;
  readonly events: Stream.Stream<CodexEndpointEvent>;
  readonly observeConnection: (connection: CodexConnectionState) => void;
  readonly offerNotification: (notification: CodexServerNotification) => Effect.Effect<boolean>;
}

/** Owns the two transport observation subscriptions that feed the application projection. */
export const live = (options: CodexApplicationIngressRuntimeOptions): Layer.Layer<never> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      yield* options.connections.pipe(
        Stream.runForEach((connection) => Effect.sync(() => options.observeConnection(connection))),
        Effect.forkScoped({ startImmediately: true }),
        Effect.asVoid,
      );
      yield* options.events.pipe(
        Stream.filter(
          (event): event is Extract<CodexEndpointEvent, { readonly kind: "notification" }> =>
            event.kind === "notification",
        ),
        Stream.runForEach((event) =>
          options.offerNotification(event.value as CodexServerNotification),
        ),
        Effect.forkScoped({ startImmediately: true }),
        Effect.asVoid,
      );
    }),
  );
