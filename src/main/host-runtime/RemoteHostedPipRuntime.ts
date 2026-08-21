import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import { BrowserWindow } from "electron";
import type { CodexDesktopMessageFromView } from "../../shared/remote-hosted-pip";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
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
    ) => Effect.Effect<void>;
    readonly isPrivacySettingsTerminationRequest: () => boolean;
    readonly refresh: Effect.Effect<void>;
    readonly setAlwaysHide: (value: boolean) => Effect.Effect<void>;
  }
>()("nodex/main/host-runtime/RemoteHostedPipRuntime") {}

export interface RemoteHostedPipRuntimeOptions {
  readonly browserSidebarService: BrowserSidebarService;
  readonly preferenceFilePath: string;
}

const fromPort = (
  acquire: Effect.Effect<RemoteHostedPipPort>,
  notifications: Stream.Stream<unknown>,
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
      return RemoteHostedPipRuntime.of({
        getAlwaysHide: () => service.getAlwaysHide(),
        handleDesktopMessageFromView: (sender, message) =>
          Effect.sync(() => service.handleDesktopMessageFromView(sender, message)),
        isPrivacySettingsTerminationRequest: () => service.isPrivacySettingsTerminationRequest(),
        refresh: Effect.promise(() => service.handleBrowserUseStateSnapshot()),
        setAlwaysHide: (value) => Effect.sync(() => service.setAlwaysHide(value)),
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
              isEnabled: () => process.platform === "darwin" && isMacOSVersionAtLeast("13.0"),
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
      );
    }),
  );

export interface RemoteHostedPipRuntimeAdapter {
  readonly getAlwaysHide: () => boolean;
  readonly handleDesktopMessageFromView: (
    sender: Electron.WebContents,
    message: CodexDesktopMessageFromView,
  ) => void;
  readonly isPrivacySettingsTerminationRequest: () => boolean;
  readonly refresh: () => Promise<void>;
  readonly setAlwaysHide: (value: boolean) => Promise<void>;
}

export const makeRemoteHostedPipRuntimeAdapter = (
  runtime: RemoteHostedPipRuntime["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): RemoteHostedPipRuntimeAdapter => ({
  getAlwaysHide: runtime.getAlwaysHide,
  handleDesktopMessageFromView: (sender, message) => {
    callbacks.fork(runtime.handleDesktopMessageFromView(sender, message));
  },
  isPrivacySettingsTerminationRequest: runtime.isPrivacySettingsTerminationRequest,
  refresh: () => callbacks.runPromise(runtime.refresh),
  setAlwaysHide: (value) => callbacks.runPromise(runtime.setAlwaysHide(value)),
});

export const testLayer = (
  service: RemoteHostedPipPort,
  notifications: Stream.Stream<unknown> = Stream.empty,
): Layer.Layer<RemoteHostedPipRuntime> => fromPort(Effect.succeed(service), notifications);
