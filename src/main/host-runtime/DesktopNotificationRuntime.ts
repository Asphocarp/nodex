import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { MainConfig } from "../app/MainConfig";
import { DesktopNotificationManager } from "../desktop-notification-manager";
import { getLogger } from "../logging/logger";

export class DesktopNotificationRuntime extends Context.Service<
  DesktopNotificationRuntime,
  { readonly manager: DesktopNotificationManager }
>()("nodex/main/host-runtime/DesktopNotificationRuntime") {}

export const fromManager = (
  manager: DesktopNotificationManager,
): Layer.Layer<DesktopNotificationRuntime> =>
  Layer.effect(
    DesktopNotificationRuntime,
    Effect.acquireRelease(
      Effect.succeed(DesktopNotificationRuntime.of({ manager })),
      ({ manager: owned }) => Effect.sync(() => owned.dispose()),
    ),
  );

export const live: Layer.Layer<DesktopNotificationRuntime, never, MainConfig> = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    return fromManager(
      new DesktopNotificationManager({
        logger: getLogger({ component: "desktop-notification-runtime" }),
        platform: config.platform as NodeJS.Platform,
      }),
    );
  }),
);
