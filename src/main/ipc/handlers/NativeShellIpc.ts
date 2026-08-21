import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { nativeImage, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from "electron";
import { homedir } from "node:os";
import { isAbsolute, sep } from "node:path";
import type { IpcApi } from "../../../shared/ipc-api";
import type { NativeContextMenuItem } from "../../../shared/native-context-menu";
import { buildSessionContextMenuIconSvg } from "../../../shared/session-context-menu-icons";
import { MainConfig } from "../../app/MainConfig";
import { parseExternalNavigationUrl } from "../../external-navigation";
import { openFileLinkTarget } from "../../file-link-opener";
import { ElectronDesktop } from "../../platform/electron/ElectronDesktop";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export class NativeShellIpcError extends Schema.TaggedError<NativeShellIpcError>()(
  "NativeShellIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

type Handler<Channel extends keyof IpcApi> = (
  event: IpcMainInvokeEvent,
  ...args: IpcApi[Channel]["args"]
) => Effect.Effect<IpcApi[Channel]["result"], unknown>;

const menuTemplate = (
  items: readonly NativeContextMenuItem[],
  onSelect: (id: string) => void,
): MenuItemConstructorOptions[] =>
  items.map((item) => {
    if (item.type === "separator") return { type: "separator" };
    const enabled = item.enabled !== false;
    const icon = item.iconKey
      ? nativeImage.createFromDataURL(
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildSessionContextMenuIconSvg(item.iconKey))}`,
        )
      : undefined;
    icon?.setTemplateImage(true);
    const base = {
      id: item.id,
      label: item.label,
      enabled,
      accelerator: item.accelerator,
      toolTip: item.tooltip,
      icon,
    } satisfies MenuItemConstructorOptions;
    if (item.type === "submenu") {
      return { ...base, submenu: menuTemplate(item.submenu, onSelect) };
    }
    if (item.type === "checkbox") {
      return {
        ...base,
        type: "checkbox",
        checked: item.checked === true,
        click: () => {
          if (enabled) onSelect(item.id);
        },
      };
    }
    return {
      ...base,
      click: () => {
        if (enabled) onSelect(item.id);
      },
    };
  });

export const live: Layer.Layer<
  never,
  never,
  ElectronDesktop | ElectronIpc | MainConfig | WindowRuntime
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    const desktop = yield* ElectronDesktop;
    const ipc = yield* ElectronIpc;
    const windows = yield* WindowRuntime;
    const handle = <Channel extends keyof IpcApi>(channel: Channel, handler: Handler<Channel>) =>
      ipc.handle(channel, handler);
    const authorize = (event: IpcMainInvokeEvent) =>
      Effect.try({
        try: () => {
          requireTrustedAppRendererSender(event, "Native desktop", config.rendererUrl);
          if (!windows.has(event.sender.id)) {
            throw new Error("Native desktop access requires an active Nodex window");
          }
        },
        catch: (cause) => new NativeShellIpcError({ operation: "authorize-renderer", cause }),
      });
    const run = <A>(operation: string, task: () => Promise<A>) =>
      Effect.tryPromise({
        try: task,
        catch: (cause) => new NativeShellIpcError({ operation, cause }),
      });

    yield* handle("native-context-menu:show", (event, items, options) =>
      authorize(event).pipe(
        Effect.andThen(
          Effect.callback<string | null>((resume) => {
            let selectedId: string | null = null;
            const owner = windows.get(event.sender.id);
            const menu = desktop.menu.buildFromTemplate(
              menuTemplate(items, (id) => {
                selectedId = id;
              }),
            );
            menu.popup({
              window: owner ?? undefined,
              x: typeof options?.x === "number" ? Math.round(options.x) : undefined,
              y: typeof options?.y === "number" ? Math.round(options.y) : undefined,
              positioningItem: options?.positioningItem,
              callback: () => resume(Effect.succeed(selectedId)),
            });
            return Effect.sync(() => menu.closePopup(owner ?? undefined));
          }),
        ),
      ),
    );
    yield* handle("shell:open-file-link", (event, target, openerId) =>
      authorize(event).pipe(
        Effect.andThen(run("open-file-link", () => openFileLinkTarget(target, openerId))),
      ),
    );
    yield* handle("open-file", (event, target, openerId) =>
      authorize(event).pipe(
        Effect.andThen(run("open-file", () => openFileLinkTarget(target, openerId))),
      ),
    );
    yield* handle("shell:open-external-url", (event, value) =>
      authorize(event).pipe(
        Effect.andThen(
          run("open-external-url", async () => {
            await desktop.shell.openExternal(parseExternalNavigationUrl(value).toString());
            return true;
          }),
        ),
      ),
    );
    yield* handle("shell:open-path-default", (event, inputPath) =>
      authorize(event).pipe(
        Effect.andThen(
          run("open-path", async () => {
            const path = inputPath.trim();
            if (!isAbsolute(path)) return false;
            return (await desktop.shell.openPath(path)) === "";
          }),
        ),
      ),
    );
    yield* handle("shell:path-context:get", (event) =>
      authorize(event).pipe(
        Effect.as({
          homeDirectory: homedir(),
          separator: sep === "\\" ? ("\\" as const) : ("/" as const),
        }),
      ),
    );
  }),
);
