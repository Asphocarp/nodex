import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import type * as Scope from "effect/Scope";

export const DEFAULT_CODEX_SIDEBAR_NOTIFICATION_SYNC_DEBOUNCE = "300 millis";

export interface CodexSidebarNotificationSyncRequest {
  readonly notificationMethod: string;
  readonly threadId: string;
  readonly minimumSyncGeneration: number;
}

export class CodexSidebarNotificationSyncError extends Data.TaggedError(
  "CodexSidebarNotificationSyncError",
)<{ readonly cause: unknown }> {}

export interface CodexSidebarNotificationSyncOptions {
  readonly repair: (
    minimumSyncGeneration: number,
  ) => Effect.Effect<void, CodexSidebarNotificationSyncError>;
  readonly debounce?: Duration.Input;
}

export class CodexSidebarNotificationSync extends Context.Service<
  CodexSidebarNotificationSync,
  { readonly schedule: (request: CodexSidebarNotificationSyncRequest) => Effect.Effect<void> }
>()("nodex/main/codex-application/CodexSidebarNotificationSync") {}

export const make = (
  options: CodexSidebarNotificationSyncOptions,
): Effect.Effect<CodexSidebarNotificationSync["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const pending = yield* FiberMap.make<"sidebar", void, never>();
    return CodexSidebarNotificationSync.of({
      schedule: (request) =>
        FiberMap.run(
          pending,
          "sidebar",
          Effect.sleep(options.debounce ?? DEFAULT_CODEX_SIDEBAR_NOTIFICATION_SYNC_DEBOUNCE).pipe(
            Effect.andThen(options.repair(request.minimumSyncGeneration)),
            Effect.catch((error) =>
              Effect.logDebug("Sidebar notification sync failed").pipe(
                Effect.annotateLogs({
                  cause: String(error.cause),
                  notificationMethod: request.notificationMethod,
                  threadId: request.threadId,
                }),
              ),
            ),
          ),
          { startImmediately: true },
        ).pipe(Effect.asVoid),
    });
  });

export interface CodexSidebarNotificationSyncLegacyPort {
  readonly schedule: (request: CodexSidebarNotificationSyncRequest) => void;
}
