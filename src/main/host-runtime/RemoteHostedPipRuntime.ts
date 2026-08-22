import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { BrowserWindow } from "electron";
import type { CodexDesktopMessageFromView } from "../../shared/remote-hosted-pip";
import type { BrowserSidebarService } from "../browser-sidebar-service";
import type { BrowserSidebarEventHubService } from "../browser/BrowserSidebarEventHub";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { safeBroadcastToWindows, safeSendToWebContents } from "../ipc-safe-send";
import {
  makeRemoteHostedPipController,
  type RemoteHostedPipWindowLike,
} from "../remote-hosted-pip-controller";
import { makeRemoteHostedPipPreferences } from "../remote-hosted-pip-preference-store";
import { isMacOSVersionAtLeast, loadSkyNativeAddon } from "../sky-native";

interface RemoteHostedPipPort {
  readonly getAlwaysHide: () => boolean;
  readonly handleBrowserUseStateSnapshot: () => void;
  readonly handleCodexNotification: (notification: unknown) => void;
  readonly handleDesktopMessageFromView: (
    sender: Electron.WebContents,
    message: CodexDesktopMessageFromView,
  ) => void;
  readonly isPrivacySettingsTerminationRequest: () => boolean;
  readonly pollNativePresentationState: () => void;
  readonly setAlwaysHide: (value: boolean) => void;
}

const REMOTE_HOSTED_PIP_POLL_INTERVAL_MS = 500;

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
  readonly browserSidebarEvents: BrowserSidebarEventHubService;
  readonly browserSidebarService: BrowserSidebarService;
  readonly platform: NodeJS.Platform;
  readonly preferenceFilePath: string;
}

const fromPort = (
  acquire: Effect.Effect<RemoteHostedPipPort, never, Scope.Scope>,
  notifications: Stream.Stream<unknown>,
  browserUseStateSignals: Stream.Stream<unknown> = Stream.empty,
  pollIntervalMs = REMOTE_HOSTED_PIP_POLL_INTERVAL_MS,
): Layer.Layer<RemoteHostedPipRuntime> =>
  Layer.effect(
    RemoteHostedPipRuntime,
    Effect.gen(function* () {
      const service = yield* acquire;
      yield* notifications.pipe(
        Stream.runForEach((notification) =>
          Effect.sync(() => service.handleCodexNotification(notification)),
        ),
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* Effect.forever(
        Effect.sleep(Math.max(1, pollIntervalMs)).pipe(
          Effect.andThen(Effect.sync(() => service.pollNativePresentationState())),
        ),
      ).pipe(Effect.forkScoped);
      const refresh = Effect.try({
        try: service.handleBrowserUseStateSnapshot,
        catch: (cause) => new RemoteHostedPipRuntimeError({ operation: "refresh", cause }),
      });
      yield* Stream.concat(Stream.make(undefined), browserUseStateSignals).pipe(
        Stream.runForEach(() =>
          refresh.pipe(
            Effect.catch((error) =>
              Effect.logWarning("Could not refresh Remote Hosted PiP state").pipe(
                Effect.annotateLogs({ error: String(error.cause) }),
              ),
            ),
          ),
        ),
        Effect.forkScoped({ startImmediately: true }),
      );
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
      const preferences = makeRemoteHostedPipPreferences(options.preferenceFilePath);
      return fromPort(
        makeRemoteHostedPipController({
          addon: loadSkyNativeAddon(),
          broadcast: (channel, payload) => {
            safeBroadcastToWindows(BrowserWindow.getAllWindows(), channel, [payload]);
          },
          getFocusedWindow: () =>
            BrowserWindow.getFocusedWindow() as unknown as RemoteHostedPipWindowLike | null,
          getWindowForSender: (sender) =>
            BrowserWindow.fromWebContents(
              sender as Electron.WebContents,
            ) as unknown as RemoteHostedPipWindowLike | null,
          isEnabled: () => options.platform === "darwin" && isMacOSVersionAtLeast("13.0"),
          isThreadSurfacePresented: (threadId) =>
            options.browserSidebarService.hasPresentedBrowserUseSurfaceForThread(threadId),
          readAlwaysHide: preferences.readAlwaysHide,
          readMaxDisplaySize: preferences.readMaxDisplaySize,
          sendToSender: (sender, channel, payload) => {
            safeSendToWebContents(sender as Electron.WebContents, channel, [payload]);
          },
          writeAlwaysHide: preferences.writeAlwaysHide,
          writeMaxDisplaySize: preferences.writeMaxDisplaySize,
        }),
        gateway.events.pipe(
          Stream.filterMap((event) =>
            event.kind === "notification" ? Result.succeed(event.value) : Result.fail(undefined),
          ),
        ),
        options.browserSidebarEvents.events.pipe(
          Stream.filter((event) => event.kind === "browserUseState"),
        ),
      );
    }),
  );

export const testLayer = (
  service: RemoteHostedPipPort,
  notifications: Stream.Stream<unknown> = Stream.empty,
  browserUseStateSignals: Stream.Stream<unknown> = Stream.empty,
  pollIntervalMs?: number,
): Layer.Layer<RemoteHostedPipRuntime> =>
  fromPort(Effect.succeed(service), notifications, browserUseStateSignals, pollIntervalMs);
