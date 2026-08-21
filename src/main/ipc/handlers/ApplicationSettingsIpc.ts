import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import {
  COMMAND_KEYBINDINGS_CHANGED_CHANNEL,
  type CommandKeybindingUpdate,
} from "../../../shared/command-keybindings";
import type {
  UpdateBackupSettingsInput,
  UpdateCodexDeveloperInstructionSettingsInput,
  UpdateCodexGitSettingsInput,
  UpdateDiagnosticsSettingsInput,
  UpdateHistorySettingsInput,
  UpdateTelemetrySettingsInput,
  UpdateThreadNotificationSettingsInput,
  UpdateWindowRestoreSettingsInput,
} from "../../../shared/types";
import { MainConfig } from "../../app/MainConfig";
import { ApplicationMenuRuntime } from "../../host-runtime/ApplicationMenuRuntime";
import { StoreAdministrationSchedulerRuntime } from "../../host-runtime/StoreAdministrationSchedulerRuntime";
import { safeBroadcastToWindows } from "../../ipc-safe-send";
import {
  getBackupSettings,
  getCodexDeveloperInstructionSettings,
  getCodexGitSettings,
  getCommandKeymapState,
  getDiagnosticsSettings,
  getHistorySettings,
  getTelemetrySettings,
  getThreadNotificationSettings,
  getWindowRestoreSettings,
  resetCommandKeybindings,
  updateBackupSettings,
  updateCodexDeveloperInstructionSettings,
  updateCodexGitSettings,
  updateCommandKeybinding,
  updateDiagnosticsSettings,
  updateHistorySettings,
  updateTelemetrySettings,
  updateThreadNotificationSettings,
  updateWindowRestoreSettings,
} from "../../local-store/config";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { readThirdPartyNotices } from "../../third-party-notices";
import { isTrustedAppRendererIpcSender } from "../../app-renderer-ipc-authorization";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export class ApplicationSettingsIpcError extends Schema.TaggedError<ApplicationSettingsIpcError>()(
  "ApplicationSettingsIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

const BackupUpdate = z
  .object({
    autoEnabled: z.boolean(),
    intervalHours: z.number().int().min(1),
    retentionCount: z.number().int().nonnegative(),
  })
  .strict() satisfies z.ZodType<UpdateBackupSettingsInput>;
const HistoryUpdate = z
  .object({ retentionCount: z.number().int().nonnegative() })
  .strict() satisfies z.ZodType<UpdateHistorySettingsInput>;
const DiagnosticsUpdate = z
  .object({
    enabled: z.boolean(),
    dsn: z.string(),
    environment: z.string(),
    release: z.string().nullable(),
    tracesSampleRate: z.number().min(0).max(1),
    replayEnabled: z.boolean(),
    replaysSessionSampleRate: z.number().min(0).max(1),
    replaysOnErrorSampleRate: z.number().min(0).max(1),
  })
  .strict() satisfies z.ZodType<UpdateDiagnosticsSettingsInput>;
const TelemetryUpdate = z
  .object({
    enabled: z.boolean(),
    clientKey: z.string(),
    environment: z.string(),
    autoCaptureEnabled: z.boolean(),
  })
  .strict() satisfies z.ZodType<UpdateTelemetrySettingsInput>;
const ThreadNotificationUpdate = z
  .object({
    turnMode: z.enum(["off", "unfocused", "always"]),
    permissionsEnabled: z.boolean(),
    questionsEnabled: z.boolean(),
  })
  .strict() satisfies z.ZodType<UpdateThreadNotificationSettingsInput>;
const DeveloperInstructionUpdate = z
  .object({ detailLevel: z.enum(["STEPS_PROSE", "STEPS_COMMANDS", "STEPS_EXECUTION"]) })
  .strict() satisfies z.ZodType<UpdateCodexDeveloperInstructionSettingsInput>;
const GitUpdate = z
  .object({
    branchPrefix: z.string().optional(),
    commitInstructions: z.string().optional(),
    pullRequestInstructions: z.string().optional(),
  })
  .strict() satisfies z.ZodType<UpdateCodexGitSettingsInput>;
const WindowRestoreUpdate = z
  .object({ policy: z.enum(["all", "last-window", "none"]) })
  .strict() satisfies z.ZodType<UpdateWindowRestoreSettingsInput>;
const Keybinding = z.object({ key: z.string().nullable() }).strict();
const CommandKeybindingMutation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set"), keybinding: Keybinding }).strict(),
  z
    .object({ type: z.literal("replace"), oldKeybinding: Keybinding, newKeybinding: Keybinding })
    .strict(),
  z.object({ type: z.literal("append"), keybinding: Keybinding }).strict(),
  z.object({ type: z.literal("remove"), keybinding: Keybinding }).strict(),
  z.object({ type: z.literal("reset") }).strict(),
]) satisfies z.ZodType<CommandKeybindingUpdate>;

export const live: Layer.Layer<
  never,
  never,
  | ApplicationMenuRuntime
  | StoreAdministrationSchedulerRuntime
  | ElectronIpc
  | MainConfig
  | WindowRuntime
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    const ipc = yield* ElectronIpc;
    const menus = yield* ApplicationMenuRuntime;
    const schedulers = yield* StoreAdministrationSchedulerRuntime;
    const windows = yield* WindowRuntime;
    const authorize = (event: IpcMainInvokeEvent, capability: string) =>
      Effect.try({
        try: () => {
          if (
            !isTrustedAppRendererIpcSender({
              developmentOrigin: config.rendererUrl,
              hasOwnerWindow: windows.has(event.sender.id),
              senderType: event.sender.getType(),
              senderUrl: event.senderFrame?.url ?? "",
              isMainFrame: event.senderFrame === event.sender.mainFrame,
            })
          ) {
            throw new Error(`${capability} requires an active Nodex window`);
          }
        },
        catch: (cause) =>
          new ApplicationSettingsIpcError({ operation: "authorize-renderer", cause }),
      });
    const run = <A>(operation: string, action: () => A) =>
      Effect.try({
        try: action,
        catch: (cause) => new ApplicationSettingsIpcError({ operation, cause }),
      });
    const handleRead = (channel: string, capability: string, read: () => unknown) =>
      ipc.handle(channel, (event) =>
        authorize(event, capability).pipe(Effect.andThen(run(`read-${channel}`, read))),
      );
    const broadcastKeymap = (state: ReturnType<typeof getCommandKeymapState>): void => {
      menus.refresh(state);
      safeBroadcastToWindows(windows.all(), COMMAND_KEYBINDINGS_CHANGED_CHANNEL, [state]);
    };

    yield* handleRead("settings:backup:get", "Backup settings", getBackupSettings);
    yield* ipc.handle("settings:backup:update", (event, input: unknown) =>
      authorize(event, "Backup settings").pipe(
        Effect.andThen(
          run("update-backup-settings", () => updateBackupSettings(BackupUpdate.parse(input))),
        ),
        Effect.tap((settings) => schedulers.configureBackup(settings)),
      ),
    );
    yield* handleRead("settings:history:get", "History settings", getHistorySettings);
    yield* ipc.handle("settings:history:update", (event, input: unknown) =>
      authorize(event, "History settings").pipe(
        Effect.andThen(
          run("update-history-settings", () => updateHistorySettings(HistoryUpdate.parse(input))),
        ),
      ),
    );
    yield* handleRead("settings:diagnostics:get", "Diagnostics settings", getDiagnosticsSettings);
    yield* ipc.handle("settings:diagnostics:update", (event, input: unknown) =>
      authorize(event, "Diagnostics settings").pipe(
        Effect.andThen(
          run("update-diagnostics-settings", () =>
            updateDiagnosticsSettings(DiagnosticsUpdate.parse(input)),
          ),
        ),
      ),
    );
    yield* handleRead("settings:telemetry:get", "Telemetry settings", getTelemetrySettings);
    yield* ipc.handle("settings:telemetry:update", (event, input: unknown) =>
      authorize(event, "Telemetry settings").pipe(
        Effect.andThen(
          run("update-telemetry-settings", () =>
            updateTelemetrySettings(TelemetryUpdate.parse(input)),
          ),
        ),
      ),
    );
    yield* handleRead(
      "settings:thread-notifications:get",
      "Thread notification settings",
      getThreadNotificationSettings,
    );
    yield* ipc.handle("settings:thread-notifications:update", (event, input: unknown) =>
      authorize(event, "Thread notification settings").pipe(
        Effect.andThen(
          run("update-thread-notification-settings", () =>
            updateThreadNotificationSettings(ThreadNotificationUpdate.parse(input)),
          ),
        ),
      ),
    );
    yield* handleRead(
      "settings:codex-developer:get",
      "Developer instruction settings",
      getCodexDeveloperInstructionSettings,
    );
    yield* ipc.handle("settings:codex-developer:update", (event, input: unknown) =>
      authorize(event, "Developer instruction settings").pipe(
        Effect.andThen(
          run("update-developer-instruction-settings", () =>
            updateCodexDeveloperInstructionSettings(DeveloperInstructionUpdate.parse(input)),
          ),
        ),
      ),
    );
    yield* handleRead("settings:git:get", "Git settings", getCodexGitSettings);
    yield* ipc.handle("settings:git:update", (event, input: unknown) =>
      authorize(event, "Git settings").pipe(
        Effect.andThen(
          run("update-git-settings", () => updateCodexGitSettings(GitUpdate.parse(input))),
        ),
      ),
    );
    yield* handleRead(
      "settings:window-restore:get",
      "Window restore settings",
      getWindowRestoreSettings,
    );
    yield* ipc.handle("settings:window-restore:update", (event, input: unknown) =>
      authorize(event, "Window restore settings").pipe(
        Effect.andThen(
          run("update-window-restore-settings", () =>
            updateWindowRestoreSettings(WindowRestoreUpdate.parse(input)),
          ),
        ),
      ),
    );
    yield* ipc.handle("settings:third-party-notices:get", (event) =>
      authorize(event, "Third-party notices").pipe(
        Effect.andThen(
          Effect.tryPromise({
            try: () =>
              readThirdPartyNotices({
                appPath: config.projectRootPath,
                cwd: config.projectRootPath,
                isPackaged: config.isPackaged,
                resourcesPath: config.resourcesPath,
              }),
            catch: (cause) =>
              new ApplicationSettingsIpcError({ operation: "read-third-party-notices", cause }),
          }),
        ),
      ),
    );
    yield* handleRead("codex-command-keymap-state", "Command keybindings", getCommandKeymapState);
    yield* ipc.handle(
      "set-codex-command-keybinding",
      (event, commandId: unknown, update: unknown) =>
        authorize(event, "Command keybindings").pipe(
          Effect.andThen(
            run("update-command-keybinding", () => {
              if (typeof commandId !== "string") throw new Error("commandId must be a string");
              return updateCommandKeybinding(commandId, CommandKeybindingMutation.parse(update));
            }),
          ),
          Effect.tap((state) => Effect.sync(() => broadcastKeymap(state))),
        ),
    );
    yield* ipc.handle("reset-codex-command-keybindings", (event) =>
      authorize(event, "Command keybindings").pipe(
        Effect.andThen(run("reset-command-keybindings", resetCommandKeybindings)),
        Effect.tap((state) => Effect.sync(() => broadcastKeymap(state))),
      ),
    );
    yield* ipc.handle("global-dictation-capture-fn-hotkey", (event) =>
      authorize(event, "Global dictation shortcut").pipe(Effect.as(null)),
    );
  }),
);
