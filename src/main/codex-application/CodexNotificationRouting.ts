import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import type { CodexServerNotification } from "../codex-runtime/CodexApplicationProtocol";

export class CodexNotificationRoutingError extends Data.TaggedError(
  "CodexNotificationRoutingError",
)<{ readonly cause: unknown }> {}

export interface CodexNotificationRoutingOptions {
  readonly route: (
    notification: CodexServerNotification,
  ) => Effect.Effect<void, CodexNotificationRoutingError>;
}

export class CodexNotificationRouting extends Context.Service<
  CodexNotificationRouting,
  {
    readonly offer: (notification: CodexServerNotification) => Effect.Effect<boolean>;
  }
>()("nodex/main/codex-application/CodexNotificationRouting") {}

export const make = (
  options: CodexNotificationRoutingOptions,
): Effect.Effect<CodexNotificationRouting["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const notifications = yield* Queue.unbounded<CodexServerNotification>();
    yield* Effect.addFinalizer(() => Queue.shutdown(notifications));
    yield* Effect.forkScoped(
      Effect.forever(
        Queue.take(notifications).pipe(
          Effect.flatMap((notification) =>
            options.route(notification).pipe(
              Effect.catch((error) =>
                Effect.logWarning("Codex notification routing failed").pipe(
                  Effect.annotateLogs({
                    cause: String(error.cause),
                    method: notification.method,
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
    );

    return CodexNotificationRouting.of({
      offer: (notification) => Queue.offer(notifications, notification),
    });
  });
