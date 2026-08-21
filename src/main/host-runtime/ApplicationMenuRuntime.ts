import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  app,
  Menu,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
} from "electron";
import { join } from "node:path";
import type { CommandKeymapState } from "../../shared/command-keybindings";
import {
  getPrimaryCommandAccelerator,
  NEXT_PANEL_TAB_COMMAND_ID,
  PREVIOUS_PANEL_TAB_COMMAND_ID,
  toElectronAccelerator,
} from "../../shared/command-keybindings";
import {
  CLOSE_PANEL_TAB_HOST_CHANNEL,
  CYCLE_PANEL_TAB_NEXT_HOST_CHANNEL,
  CYCLE_PANEL_TAB_PREVIOUS_HOST_CHANNEL,
  NAVIGATE_BACK_HOST_CHANNEL,
  NAVIGATE_FORWARD_HOST_CHANNEL,
  WORKBENCH_CONTENT_SEARCH_COMMAND,
  WORKBENCH_THREAD_RENAME_COMMAND,
  WORKBENCH_SIDEBAR_TOGGLE_COMMAND,
  type WorkbenchContentSearchHostChannel,
  type WorkbenchNavigationHostChannel,
  type WorkbenchPanelTabCloseHostChannel,
  type WorkbenchPanelTabCycleHostChannel,
  type WorkbenchSidebarToggleHostChannel,
  type WorkbenchThreadRenameHostChannel,
} from "../../shared/window-navigation";
import {
  EXECUTE_WORKBENCH_COMMAND_HOST_CHANNEL,
  type WorkbenchCommandInvocation,
} from "../../shared/workbench-commands";
import {
  buildNodexSetupMenuItems,
  buildWindowFileMenu,
  buildWorkbenchViewMenu,
} from "../application-menu";
import { runAgentSkillSetup } from "../agent-skill-setup";
import { installCliCommand } from "../cli-command-installer";
import { safeSendToWindow } from "../ipc-safe-send";
import { getLogger } from "../logging/logger";
import { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { AppUpdateRuntimeError } from "./AppUpdateRuntime";
import type { WindowRuntimeService } from "../window-runtime/WindowRuntime";

export interface ApplicationMenuNativePort {
  readonly buildFromTemplate: (template: MenuItemConstructorOptions[]) => Menu;
  readonly homePath: string;
  readonly isInApplicationsFolder: boolean;
  readonly setApplicationMenu: (menu: Menu | null) => void;
  readonly setDockMenu: (menu: Menu | null) => void;
}

export interface ApplicationMenuRuntimeOptions {
  readonly checkForUpdates: Effect.Effect<unknown, AppUpdateRuntimeError>;
  readonly environmentPath?: string;
  readonly initialCommandKeymap: CommandKeymapState;
  readonly isPackaged: boolean;
  readonly native?: ApplicationMenuNativePort;
  readonly requestNewWindow: () => void;
  readonly resourcesPath: string;
  readonly showMessage: (options: MessageBoxOptions) => Effect.Effect<MessageBoxReturnValue>;
  readonly windows: WindowRuntimeService;
}

export class ApplicationMenuRuntime extends Context.Service<
  ApplicationMenuRuntime,
  { readonly refresh: (commandKeymap: CommandKeymapState) => void }
>()("nodex/main/host-runtime/ApplicationMenuRuntime") {}

const electronNative = (): ApplicationMenuNativePort => ({
  buildFromTemplate: (template) => Menu.buildFromTemplate(template),
  homePath: app.getPath("home"),
  isInApplicationsFolder:
    typeof app.isInApplicationsFolder !== "function" || app.isInApplicationsFolder(),
  setApplicationMenu: (menu) => Menu.setApplicationMenu(menu),
  setDockMenu: (menu) => app.dock?.setMenu(menu ?? Menu.buildFromTemplate([])),
});

export const live = (
  options: ApplicationMenuRuntimeOptions,
): Layer.Layer<ApplicationMenuRuntime, never, ScopedCallbackRuntime> =>
  Layer.effect(
    ApplicationMenuRuntime,
    Effect.gen(function* () {
      const callbacks = yield* ScopedCallbackRuntime;
      const logger = getLogger({ component: "application-menu-runtime" });
      const native = options.native ?? electronNative();
      const reportFailure = (operation: string) =>
        Effect.catchCause((cause) =>
          Effect.sync(() => logger.warn("Application menu action failed", { operation, cause })),
        );
      const fork = <A, E>(operation: string, effect: Effect.Effect<A, E>): void => {
        callbacks.fork(effect.pipe(reportFailure(operation), Effect.asVoid));
      };
      const targetWindow = () => options.windows.getLastFocused();
      const installCommandLineTool = Effect.gen(function* () {
        const result = yield* Effect.sync(() =>
          installCliCommand({
            environmentPath: options.environmentPath,
            sourcePath: join(options.resourcesPath, "bin/nodex"),
            targetPath: join(native.homePath, ".local/bin/nodex"),
          }),
        );
        const statusMessage =
          result.status === "already-installed"
            ? "The Nodex command line tool is already installed."
            : result.status === "updated"
              ? "The Nodex command line tool was updated."
              : "The Nodex command line tool was installed.";
        const pathMessage = result.pathConfigured
          ? `Run it as:\n\nnodex --help\n\nInstalled link: ${result.targetPath}`
          : `Installed link: ${result.targetPath}\n\nAdd this line to your shell profile, then open a new terminal:\n\nexport PATH="$HOME/.local/bin:$PATH"`;
        yield* options.showMessage({
          type: "info",
          buttons: ["OK"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
          message: statusMessage,
          detail: pathMessage,
        });
        yield* Effect.promise(() =>
          runAgentSkillSetup({
            cliPath: result.sourcePath,
            onlyWhenMissing: true,
            pathConfigured: result.pathConfigured,
            showMessageBox: (message) => callbacks.runPromise(options.showMessage(message)),
          }),
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() =>
            logger.error("Could not install the Nodex command line tool", { cause }),
          ).pipe(
            Effect.andThen(
              options.showMessage({
                type: "error",
                buttons: ["OK"],
                defaultId: 0,
                cancelId: 0,
                noLink: true,
                message: "Could not install the Nodex command line tool.",
                detail: Cause.pretty(cause),
              }),
            ),
          ),
        ),
      );
      const setupAgentSkills = Effect.promise(() =>
        runAgentSkillSetup({
          cliPath: join(options.resourcesPath, "bin/nodex"),
          showMessageBox: (message) => callbacks.runPromise(options.showMessage(message)),
        }),
      );

      const refresh = (commandKeymap: CommandKeymapState): void => {
        const accelerator = (commandId: string): string | undefined =>
          toElectronAccelerator(getPrimaryCommandAccelerator(commandKeymap, commandId));
        const sendWorkbenchCommand = (invocation: WorkbenchCommandInvocation): void => {
          safeSendToWindow(targetWindow(), EXECUTE_WORKBENCH_COMMAND_HOST_CHANNEL, [invocation]);
        };
        const sendNavigationMessage = (
          channel:
            | WorkbenchNavigationHostChannel
            | WorkbenchSidebarToggleHostChannel
            | WorkbenchThreadRenameHostChannel
            | WorkbenchContentSearchHostChannel
            | WorkbenchPanelTabCycleHostChannel
            | WorkbenchPanelTabCloseHostChannel,
        ): void => {
          safeSendToWindow(targetWindow(), channel);
        };
        const dockTemplate: MenuItemConstructorOptions[] = [
          {
            label: "New Window",
            accelerator: accelerator("newWindow"),
            click: options.requestNewWindow,
          },
        ];
        native.setDockMenu(native.buildFromTemplate(dockTemplate));

        const appTemplate: MenuItemConstructorOptions[] = [
          ...(process.platform === "darwin"
            ? [
                {
                  role: "appMenu",
                  submenu: [
                    {
                      label: "Check for Updates…",
                      click: () => fork("check-for-updates", options.checkForUpdates),
                    },
                    ...buildNodexSetupMenuItems({
                      enabled: options.isPackaged && native.isInApplicationsFolder,
                      onInstallCli: () => fork("install-cli", installCommandLineTool),
                      onSetupAgentSkills: () => fork("setup-agent-skills", setupAgentSkills),
                    }),
                  ],
                } satisfies MenuItemConstructorOptions,
              ]
            : []),
          buildWindowFileMenu({
            commandKeymapState: commandKeymap,
            onNewWindow: options.requestNewWindow,
            onCloseWindow: () => {
              const window = targetWindow();
              if (!window || window.isDestroyed()) return;
              window.close();
            },
          }),
          { role: "editMenu" },
          {
            label: "Navigate",
            submenu: [
              {
                label: "Back",
                accelerator: accelerator("navigateBack"),
                click: () => sendNavigationMessage(NAVIGATE_BACK_HOST_CHANNEL),
              },
              {
                label: "Forward",
                accelerator: accelerator("navigateForward"),
                click: () => sendNavigationMessage(NAVIGATE_FORWARD_HOST_CHANNEL),
              },
              { type: "separator" },
              {
                label: WORKBENCH_CONTENT_SEARCH_COMMAND.label,
                accelerator: accelerator(WORKBENCH_CONTENT_SEARCH_COMMAND.id),
                click: () => sendNavigationMessage(WORKBENCH_CONTENT_SEARCH_COMMAND.hostChannel),
              },
              { type: "separator" },
              {
                label: "Previous Panel Tab",
                accelerator: accelerator(PREVIOUS_PANEL_TAB_COMMAND_ID),
                click: () => sendNavigationMessage(CYCLE_PANEL_TAB_PREVIOUS_HOST_CHANNEL),
              },
              {
                label: "Next Panel Tab",
                accelerator: accelerator(NEXT_PANEL_TAB_COMMAND_ID),
                click: () => sendNavigationMessage(CYCLE_PANEL_TAB_NEXT_HOST_CHANNEL),
              },
              {
                label: "Close Panel Tab",
                accelerator: accelerator("closeTab"),
                click: () => sendNavigationMessage(CLOSE_PANEL_TAB_HOST_CHANNEL),
              },
              { type: "separator" },
              {
                label: WORKBENCH_SIDEBAR_TOGGLE_COMMAND.label,
                accelerator: accelerator("toggleSidebar"),
                click: () => sendNavigationMessage(WORKBENCH_SIDEBAR_TOGGLE_COMMAND.hostChannel),
              },
              {
                label: WORKBENCH_THREAD_RENAME_COMMAND.label,
                accelerator: accelerator("renameThread"),
                click: () => sendNavigationMessage(WORKBENCH_THREAD_RENAME_COMMAND.hostChannel),
              },
            ],
          },
          buildWorkbenchViewMenu(commandKeymap, sendWorkbenchCommand),
          { role: "windowMenu" },
        ];
        native.setApplicationMenu(native.buildFromTemplate(appTemplate));
      };

      return yield* Effect.acquireRelease(
        Effect.sync(() => {
          refresh(options.initialCommandKeymap);
          return ApplicationMenuRuntime.of({ refresh });
        }),
        () =>
          Effect.sync(() => {
            native.setDockMenu(null);
            native.setApplicationMenu(null);
          }),
      );
    }),
  );
