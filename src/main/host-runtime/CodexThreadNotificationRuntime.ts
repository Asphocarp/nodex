import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  CodexThreadNotificationCoordinator,
  type CodexThreadNotificationCoordinatorOptions,
} from "../codex/codex-thread-notification-coordinator";

export class CodexThreadNotificationRuntime extends Context.Service<
  CodexThreadNotificationRuntime,
  { readonly coordinator: CodexThreadNotificationCoordinator }
>()("nodex/main/host-runtime/CodexThreadNotificationRuntime") {}

/** Binds Codex application events to native notifications for exactly one Main Scope. */
export const live = (
  options: CodexThreadNotificationCoordinatorOptions,
): Layer.Layer<CodexThreadNotificationRuntime> =>
  Layer.effect(
    CodexThreadNotificationRuntime,
    Effect.acquireRelease(
      Effect.sync(() =>
        CodexThreadNotificationRuntime.of({
          coordinator: new CodexThreadNotificationCoordinator(options),
        }),
      ),
      ({ coordinator }) => Effect.sync(() => coordinator.dispose()),
    ),
  );
