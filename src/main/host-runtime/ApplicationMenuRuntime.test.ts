import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type { BrowserWindow, Menu, MenuItemConstructorOptions } from "electron";
import { createCommandKeymapState } from "../../shared/command-keybindings";
import { layer as scopedCallbackRuntimeLive } from "../app/ScopedCallbackRuntime";
import type { WindowRuntimeService } from "../window-runtime/WindowRuntime";
import {
  ApplicationMenuRuntime,
  type ApplicationMenuNativePort,
  live,
} from "./ApplicationMenuRuntime";

it.effect("owns native menus and refreshes commands without replacing the runtime", () =>
  Effect.gen(function* () {
    const templates: MenuItemConstructorOptions[][] = [];
    const applicationMenus: Array<Menu | null> = [];
    const dockMenus: Array<Menu | null> = [];
    const sent: Array<{ channel: string; args: unknown[] }> = [];
    let newWindowCount = 0;
    let closeCount = 0;
    const window = {
      close: () => {
        closeCount += 1;
      },
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: (channel: string, ...args: unknown[]) => sent.push({ channel, args }),
      },
    } as unknown as BrowserWindow;
    const windows = {
      getLastFocused: () => window,
    } as unknown as WindowRuntimeService;
    const native: ApplicationMenuNativePort = {
      buildFromTemplate: (template) => {
        templates.push(template);
        return { template } as unknown as Menu;
      },
      homePath: "/tmp/nodex-home",
      isInApplicationsFolder: true,
      setApplicationMenu: (menu) => applicationMenus.push(menu),
      setDockMenu: (menu) => dockMenus.push(menu),
    };
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      live({
        checkForUpdates: Effect.void,
        initialCommandKeymap: createCommandKeymapState({}, "macOS"),
        isPackaged: true,
        native,
        requestNewWindow: () => {
          newWindowCount += 1;
        },
        resourcesPath: "/tmp/Nodex.app/Contents/Resources",
        showMessage: () => Effect.succeed({ response: 0, checkboxChecked: false }),
        windows,
      }).pipe(Layer.provide(scopedCallbackRuntimeLive)),
      scope,
    );
    const runtime = Context.get(context, ApplicationMenuRuntime);
    const initialApplicationTemplate = templates.at(-1)!;
    const fileMenu = initialApplicationTemplate.find((item) => item.label === "File");
    const fileItems = fileMenu?.submenu as MenuItemConstructorOptions[];
    const newWindow = fileItems.find((item) => item.id === "file.newWindow");
    const closeWindow = fileItems.find((item) => item.id === "file.closeWindow");
    if (typeof newWindow?.click !== "function" || typeof closeWindow?.click !== "function") {
      throw new Error("Expected native window menu commands");
    }
    newWindow.click({} as never, {} as never, {} as never);
    closeWindow.click({} as never, {} as never, {} as never);
    assert.strictEqual(newWindowCount, 1);
    assert.strictEqual(closeCount, 1);

    const navigateMenu = initialApplicationTemplate.find((item) => item.label === "Navigate");
    const back = (navigateMenu?.submenu as MenuItemConstructorOptions[]).find(
      (item) => item.label === "Back",
    );
    if (typeof back?.click !== "function") throw new Error("Expected Back menu command");
    back.click({} as never, {} as never, {} as never);
    assert.deepEqual(sent, [{ channel: "navigate-back", args: [] }]);

    runtime.refresh(createCommandKeymapState({ newWindow: ["CmdOrCtrl+Alt+N"] }, "macOS"));
    assert.strictEqual(templates.at(-2)?.[0]?.accelerator, "CommandOrControl+Alt+N");
    assert.isNotNull(applicationMenus.at(-1));
    assert.isNotNull(dockMenus.at(-1));

    yield* Scope.close(scope, Exit.void);
    assert.isNull(applicationMenus.at(-1));
    assert.isNull(dockMenus.at(-1));
  }),
);
