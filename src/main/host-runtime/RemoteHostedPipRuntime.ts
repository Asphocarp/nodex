import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { BrowserWindow } from "electron";
import type { CodexDesktopMessageFromView } from "../../shared/remote-hosted-pip";
import type { BrowserSidebarService } from "../browser-sidebar-service";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { safeBroadcastToWindows, safeSendToWebContents } from "../ipc-safe-send";
import { RemoteHostedPipPreferenceStore } from "../remote-hosted-pip-preference-store";
import { RemoteHostedPipService } from "../remote-hosted-pip-service";
import { isMacOSVersionAtLeast, loadSkyNativeAddon } from "../sky-native";

interface RemoteHostedPipPort {
  readonly dispose: () => void;
  readonly getAlwaysHide: () => boolean;
  readonly handleBrowserUseStateSnapshot: () => Promise<void>;
  readonly handleCodexNotification: (notification: unknown) => void;
  readonly handleDesktopMessageFromView: (
    sender: Electron.WebContents,
    message: CodexDesktopMessageFromView,
  ) => void;
  readonly isPrivacySettingsTerminationRequest: () => boolean;
  readonly setAlwaysHide: (value: boolean) => void;
}

export class RemoteHostedPipRuntime extends Context.Service<
  RemoteHostedPipRuntime,
  {
    readonly getAlwaysHide: () => boolean;
    readonly handleDesktopMessageFromView: (
      sender: Electron.WebContents,
      message: CodexDesktopMessageFromView,
    ) => Effect.Effect<void, RemoteHostedPipRuntimeError>;
    readonly isPrivacySettingsTerminationRequest: () => boolean;
    readonly refresh: Effect.Effect<void, RemoteHostedPipRuntimeError>;
    readonly setAlwaysHide: (value: boolean) => Effect.Effect<void, RemoteHostedPipRuntimeError>;
  }
>()("nodex/main/host-runtime/RemoteHostedPipRuntime") {}

export class RemoteHostedPipRuntimeError extends Schema.TaggedError<RemoteHostedPipRuntimeError>()(
  "RemoteHostedPipRuntimeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export interface RemoteHostedPipRuntimeOptions {
  readonly browserSidebarService: BrowserSidebarService;
  readonly platform: NodeJS.Platform;
  readonly preferenceFilePath: string;
}

const fromPort = (
  acquire: Effect.Effect<RemoteHostedPipPort>,
  notifications: Stream.Stream<unknown>,
  subscribeBrowserUseState?: (listener: () => void) => () => void,
): Layer.Layer<RemoteHostedPipRuntime> =>
  Layer.effect(
    RemoteHostedPipRuntime,
    Effect.gen(function* () {
      const service = yield* Effect.acquireRelease(acquire, (runtime) =>
        Effect.sync(() => runtime.dispose()),
      );
      yield* notifications.pipe(
        Stream.runForEach((notification) =>
          Effect.sync(() => service.handleCodexNotification(notification)),
        ),
        Effect.forkScoped,
      );
      const refresh = Effect.tryPromise({
        try: () => service.handleBrowserUseStateSnapshot(),
        catch: (cause) => new RemoteHostedPipRuntimeError({ operation: "refresh", cause }),
      });
      if (subscribeBrowserUseState) {
        const runRefresh = yield* FiberSet.makeRuntime<never, void, never>();
        const listener = () => {
          runRefresh(
            refresh.pipe(
              Effect.catch((error) =>
                Effect.logWarning("Could not refresh Remote Hosted PiP state").pipe(
                  Effect.annotateLogs({ error: String(error.cause) }),
                ),
              ),
            ),
          );
        };
        yield* Effect.acquireRelease(
          Effect.sync(() => subscribeBrowserUseState(listener)),
          (unsubscribe) => Effect.sync(unsubscribe),
        );
        listener();
      }
      return RemoteHostedPipRuntime.of({
        getAlwaysHide: () => service.getAlwaysHide(),
        handleDesktopMessageFromView: (sender, message) =>
          Effect.try({
            try: () => service.handleDesktopMessageFromView(sender, message),
            catch: (cause) =>
              new RemoteHostedPipRuntimeError({ operation: "desktop-message", cause }),
          }),
        isPrivacySettingsTerminationRequest: () => service.isPrivacySettingsTerminationRequest(),
        refresh,
        setAlwaysHide: (value) =>
          Effect.try({
            try: () => service.setAlwaysHide(value),
            catch: (cause) =>
              new RemoteHostedPipRuntimeError({ operation: "set-always-hide", cause }),
          }),
      });
    }),
  );

export const live = (
  options: RemoteHostedPipRuntimeOptions,
): Layer.Layer<RemoteHostedPipRuntime, never, CodexGateway> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const gateway = yield* CodexGateway;
      const preferences = new RemoteHostedPipPreferenceStore(options.preferenceFilePath);
      return fromPort(
        Effect.sync(
          () =>
            new RemoteHostedPipService({
              addon: loadSkyNativeAddon(),
              broadcast: (channel, payload) => {
                safeBroadcastToWindows(BrowserWindow.getAllWindows(), channel, [payload]);
              },
              getFocusedWindow: () => BrowserWindow.getFocusedWindow(),
              getWindowForSender: (sender) =>
                BrowserWindow.fromWebContents(sender as Electron.WebContents),
              isEnabled: () => options.platform === "darwin" && isMacOSVersionAtLeast("13.0"),
              isThreadSurfacePresented: (threadId) =>
                options.browserSidebarService.hasPresentedBrowserUseSurfaceForThread(threadId),
              readAlwaysHide: () => preferences.readAlwaysHide(),
              readMaxDisplaySize: () => preferences.readMaxDisplaySize(),
              sendToSender: (sender, channel, payload) => {
                safeSendToWebContents(sender as Electron.WebContents, channel, [payload]);
              },
              writeAlwaysHide: (alwaysHide) => preferences.writeAlwaysHide(alwaysHide),
              writeMaxDisplaySize: (size) => preferences.writeMaxDisplaySize(size),
            }),
        ),
        gateway.events.pipe(
          Stream.filterMap((event) =>
            event.kind === "notification" ? Result.succeed(event.value) : Result.fail(undefined),
          ),
        ),
        (listener) => {
          options.browserSidebarService.on("browserUseState", listener);
          return () => options.browserSidebarService.removeListener("browserUseState", listener);
        },
      );
    }),
  );

export const testLayer = (
  service: RemoteHostedPipPort,
  notifications: Stream.Stream<unknown> = Stream.empty,
  subscribeBrowserUseState?: (listener: () => void) => () => void,
): Layer.Layer<RemoteHostedPipRuntime> =>
  fromPort(Effect.succeed(service), notifications, subscribeBrowserUseState);
