import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import type {
  CodexSidebarNotificationSync,
  CodexSidebarNotificationSyncLegacyPort,
  CodexSidebarNotificationSyncRequest,
} from "./CodexSidebarNotificationSync";

/** FIFO projection for synchronous app-server notification callbacks. */
export const makeCodexSidebarNotificationSyncCallbackAdapter = (
  runtime: CodexSidebarNotificationSync["Service"],
): Effect.Effect<CodexSidebarNotificationSyncLegacyPort, never, Scope.Scope> =>
  Effect.gen(function* () {
    const requests = yield* Queue.unbounded<CodexSidebarNotificationSyncRequest>();
    yield* Effect.addFinalizer(() => Queue.shutdown(requests));
    yield* Effect.forkScoped(
      Effect.forever(Queue.take(requests).pipe(Effect.flatMap(runtime.schedule))),
    );
    return {
      schedule: (request) => {
        Queue.offerUnsafe(requests, request);
      },
    };
  });
