import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { CommandKeymapState } from "../../shared/command-keybindings";
import type {
  DictationSettings,
  DictationSettingsPatch,
  DictationSurface,
  GlobalDictationPermissionSnapshot,
  MicrophoneAccessResult,
  MicrophoneAccessStatus,
} from "../../shared/dictation";
import type {
  DictationRecordingAppendInput,
  DictationRecordingAudio,
  DictationRecordingCreateInput,
  DictationRecordingFinalizeInput,
  DictationRecordingMetadata,
  DictationRecordingSetTranscriptInput,
} from "../../shared/dictation-history";
import type { GlobalDictationRendererEvent } from "../../shared/global-dictation";
import { APP_RENDERER_URL } from "../../shared/app-renderer-policy";
import { MainConfig } from "../app/MainConfig";
import { ClipboardSafePasteService } from "../dictation/clipboard-safe-paste-service";
import { DictationMicrophoneLease } from "../dictation/dictation-microphone-lease";
import { FileDictationRecordingStore } from "../dictation/dictation-recording-store";
import { DictationSettingsStore } from "../dictation/dictation-settings-store";
import { GlobalDictationManager } from "../dictation/global-dictation-manager";
import { GlobalDictationWindowController } from "../dictation/global-dictation-window-controller";
import {
  MacDictationNativeHelperClient,
  resolveMacDictationHelperExecutable,
} from "../dictation/mac-dictation-native-helper-client";
import { createSystemMicrophonePermissionService } from "../dictation/system-microphone-permission-service";
import { getCommandKeymapState } from "../local-store/config";
import { ElectronPrivacy } from "../platform/electron/ElectronPrivacy";
import { RendererClientRuntime } from "./RendererClientRuntime";
import { WindowRuntime } from "../window-runtime/WindowRuntime";

export class DictationRuntimeError extends Schema.TaggedError<DictationRuntimeError>()(
  "DictationRuntimeError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class DictationRuntime extends Context.Service<
  DictationRuntime,
  {
    readonly changes: Stream.Stream<void>;
    readonly globalAvailable: () => boolean;
    readonly microphoneOwner: () => "none" | "dictation" | "realtime-voice";
    readonly setEnabled: (enabled: boolean) => Effect.Effect<void, DictationRuntimeError>;
    readonly syncCommandKeymap: (
      state: CommandKeymapState,
    ) => Effect.Effect<void, DictationRuntimeError>;
    readonly captureHotkey: Effect.Effect<string | null, DictationRuntimeError>;
    readonly handleRendererEvent: (
      webContentsId: number,
      event: GlobalDictationRendererEvent,
    ) => Effect.Effect<boolean>;
    readonly releaseOwner: (webContentsId: number) => Effect.Effect<void>;
    readonly readMicrophoneAccess: Effect.Effect<MicrophoneAccessStatus>;
    readonly requestMicrophoneAccess: Effect.Effect<MicrophoneAccessResult, DictationRuntimeError>;
    readonly acquireMicrophone: (input: {
      readonly webContentsId: number;
      readonly sessionId: string;
      readonly surface: DictationSurface;
    }) => Effect.Effect<boolean>;
    readonly releaseMicrophone: (
      webContentsId: number,
      sessionId: string,
    ) => Effect.Effect<boolean>;
    readonly readMicrophoneRouteHint: Effect.Effect<string | null, DictationRuntimeError>;
    readonly readGlobalPermissions: Effect.Effect<
      GlobalDictationPermissionSnapshot,
      DictationRuntimeError
    >;
    readonly requestInputMonitoring: Effect.Effect<
      GlobalDictationPermissionSnapshot,
      DictationRuntimeError
    >;
    readonly requestAccessibility: Effect.Effect<
      GlobalDictationPermissionSnapshot,
      DictationRuntimeError
    >;
    readonly readSettings: Effect.Effect<DictationSettings, DictationRuntimeError>;
    readonly updateSettings: (
      patch: DictationSettingsPatch,
    ) => Effect.Effect<DictationSettings, DictationRuntimeError>;
    readonly consumeGlobalShortcutNudge: Effect.Effect<boolean, DictationRuntimeError>;
    readonly createRecording: (
      input: DictationRecordingCreateInput,
    ) => Effect.Effect<DictationRecordingMetadata, DictationRuntimeError>;
    readonly appendRecording: (
      input: DictationRecordingAppendInput,
    ) => Effect.Effect<DictationRecordingMetadata, DictationRuntimeError>;
    readonly finalizeRecording: (
      input: DictationRecordingFinalizeInput,
    ) => Effect.Effect<DictationRecordingMetadata, DictationRuntimeError>;
    readonly setRecordingTranscript: (
      input: DictationRecordingSetTranscriptInput,
    ) => Effect.Effect<DictationRecordingMetadata, DictationRuntimeError>;
    readonly listRecordings: Effect.Effect<
      readonly DictationRecordingMetadata[],
      DictationRuntimeError
    >;
    readonly readRecordingAudio: (
      id: string,
    ) => Effect.Effect<DictationRecordingAudio, DictationRuntimeError>;
    readonly deleteRecording: (id: string) => Effect.Effect<void, DictationRuntimeError>;
  }
>()("nodex/main/host-runtime/DictationRuntime") {}

const unavailablePermissions: GlobalDictationPermissionSnapshot = {
  available: false,
  inputMonitoring: false,
  accessibility: false,
};

const attemptPromise = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new DictationRuntimeError({ operation, cause }),
  });

export const live = (options: {
  readonly preloadPath: string;
}): Layer.Layer<
  DictationRuntime,
  never,
  MainConfig | ElectronPrivacy | RendererClientRuntime | WindowRuntime
> =>
  Layer.effect(
    DictationRuntime,
    Effect.gen(function* () {
      const config = yield* MainConfig;
      const privacy = yield* ElectronPrivacy;
      const rendererClients = yield* RendererClientRuntime;
      const windows = yield* WindowRuntime;
      const events = yield* PubSub.unbounded<void>();
      const settings = new DictationSettingsStore(config.nodexHome);
      const recordings = new FileDictationRecordingStore({ profileRoot: config.nodexHome });
      const microphone = new DictationMicrophoneLease();
      const permission = createSystemMicrophonePermissionService({
        platform: config.platform as NodeJS.Platform,
        systemPreferences: privacy.systemPreferences,
      });
      let accepting = true;
      const publish = (): void => {
        if (accepting) PubSub.publishUnsafe(events, undefined);
      };
      const releaseMicrophoneSubscription = microphone.subscribe(publish);
      let globalManager: GlobalDictationManager | null = null;
      let releaseGlobalSubscription = (): void => undefined;
      let releaseGlobalWindowSubscription = (): void => undefined;

      if (config.platform === "darwin") {
        const helper = new MacDictationNativeHelperClient(
          resolveMacDictationHelperExecutable({
            isPackaged: config.isPackaged,
            repositoryRoot: config.projectRootPath,
            resourcesPath: config.resourcesPath,
          }),
        );
        const windowController = new GlobalDictationWindowController({
          preloadPath: options.preloadPath,
          rendererUrl: config.rendererUrl ?? APP_RENDERER_URL,
        });
        globalManager = new GlobalDictationManager({
          helper,
          windowController,
          pasteService: new ClipboardSafePasteService({ helper }),
          readSettings: () => settings.read(),
          getFocusedAppWindow: () => windows.getLastFocused(),
          getAppWindowByWebContentsId: (webContentsId) => windows.get(webContentsId),
          platform: "darwin",
        });
        releaseGlobalSubscription = globalManager.subscribe(publish);
        releaseGlobalWindowSubscription = windowController.subscribeTerminal((webContentsId) => {
          microphone.releaseOwner(webContentsId);
        });
        yield* attemptPromise("initialize-global-dictation", () =>
          globalManager!.initialize(getCommandKeymapState()),
        ).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Global dictation shortcuts are unavailable").pipe(
              Effect.annotateLogs({ operation: error.operation }),
            ),
          ),
        );
      }

      yield* rendererClients.events.pipe(
        Stream.runForEach((event) =>
          event.kind === "disposed"
            ? Effect.sync(() => {
                microphone.releaseOwner(event.webContentsId);
                globalManager?.handleWebContentsGone(event.webContentsId);
              })
            : Effect.void,
        ),
        Effect.forkScoped({ startImmediately: true }),
      );

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          accepting = false;
          releaseMicrophoneSubscription();
          releaseGlobalSubscription();
          releaseGlobalWindowSubscription();
        }).pipe(
          Effect.andThen(globalManager ? Effect.sync(() => globalManager?.dispose()) : Effect.void),
          Effect.andThen(PubSub.shutdown(events)),
          Effect.asVoid,
        ),
      );

      const globalPermissions = (
        operation: string,
        read: (manager: GlobalDictationManager) => Promise<GlobalDictationPermissionSnapshot>,
      ) =>
        globalManager
          ? attemptPromise(operation, () => read(globalManager!))
          : Effect.succeed(unavailablePermissions);

      return DictationRuntime.of({
        changes: Stream.fromPubSub(events),
        globalAvailable: () => globalManager?.isAvailable() ?? false,
        microphoneOwner: () => (microphone.getOwner() ? "dictation" : "none"),
        setEnabled: (enabled) =>
          globalManager
            ? attemptPromise("set-global-dictation-enabled", () =>
                globalManager!.setEnabled(enabled),
              )
            : Effect.void,
        syncCommandKeymap: (state) =>
          globalManager
            ? attemptPromise("sync-global-dictation-keymap", () =>
                globalManager!.syncCommandKeymap(state),
              )
            : Effect.void,
        captureHotkey: globalManager
          ? attemptPromise("capture-global-dictation-hotkey", () => globalManager!.captureHotkey())
          : Effect.succeed(null),
        handleRendererEvent: (webContentsId, event) =>
          Effect.sync(() => globalManager?.handleRendererEvent(webContentsId, event) ?? false),
        releaseOwner: (webContentsId) =>
          Effect.sync(() => {
            microphone.releaseOwner(webContentsId);
            globalManager?.handleWebContentsGone(webContentsId);
          }),
        readMicrophoneAccess: Effect.sync(permission.readStatus),
        requestMicrophoneAccess: attemptPromise("request-microphone-access", () =>
          permission.requestAccess(),
        ),
        acquireMicrophone: (input) => Effect.sync(() => microphone.acquire(input)),
        releaseMicrophone: (webContentsId, sessionId) =>
          Effect.sync(() => microphone.release(webContentsId, sessionId)),
        readMicrophoneRouteHint: globalManager
          ? attemptPromise("read-built-in-microphone", () =>
              globalManager!.queryBuiltInMicrophoneName(),
            )
          : Effect.succeed(null),
        readGlobalPermissions: globalPermissions("read-global-dictation-permissions", (manager) =>
          manager.readPermissions(),
        ),
        requestInputMonitoring: globalPermissions("request-input-monitoring", (manager) =>
          manager.requestInputMonitoring(),
        ),
        requestAccessibility: globalPermissions("request-accessibility", (manager) =>
          manager.requestAccessibility(),
        ),
        readSettings: attemptPromise("read-dictation-settings", () => settings.read()),
        updateSettings: (patch) =>
          attemptPromise("update-dictation-settings", () => settings.update(patch)),
        consumeGlobalShortcutNudge: attemptPromise("consume-global-shortcut-nudge", () =>
          settings.consumeGlobalShortcutNudge(),
        ),
        createRecording: (input) =>
          attemptPromise("create-dictation-recording", () => recordings.create(input)),
        appendRecording: (input) =>
          attemptPromise("append-dictation-recording", () => recordings.append(input)),
        finalizeRecording: (input) =>
          attemptPromise("finalize-dictation-recording", () => recordings.finalize(input)),
        setRecordingTranscript: (input) =>
          attemptPromise("set-dictation-transcript", () => recordings.setTranscript(input)),
        listRecordings: attemptPromise("list-dictation-recordings", () => recordings.list()),
        readRecordingAudio: (id) =>
          attemptPromise("read-dictation-recording", () => recordings.readAudio(id)),
        deleteRecording: (id) =>
          attemptPromise("delete-dictation-recording", () => recordings.delete(id)),
      });
    }),
  );
