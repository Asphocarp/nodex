import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { APP_RENDERER_URL } from "../../shared/app-renderer-policy";
import {
  GLOBAL_DICTATION_COMMAND_CHANNEL,
  type GlobalDictationRendererCommand,
} from "../../shared/global-dictation";

const WIDTH = 720;
const HEIGHT = 84;
const BOTTOM_MARGIN = 16;

export const withGlobalDictationRoute = (rendererUrl: string): string => {
  const url = new URL(rendererUrl);
  url.searchParams.set("initialRoute", "/global-dictation");
  return url.toString();
};

export const resolveGlobalDictationBounds = (workArea: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}) => ({
  x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
  y: workArea.y + workArea.height - HEIGHT - BOTTOM_MARGIN,
  width: WIDTH,
  height: HEIGHT,
});

/** Owns the auxiliary window without registering it as a restorable WindowSession. */
export class GlobalDictationWindowController {
  readonly #preloadPath: string;
  readonly #rendererUrl: string;
  #window: BrowserWindow | null = null;
  #generation = 0;
  readonly #terminalListeners = new Set<(webContentsId: number) => void>();

  constructor(options?: { readonly preloadPath?: string; readonly rendererUrl?: string }) {
    this.#preloadPath = options?.preloadPath ?? join(__dirname, "../preload/global-dictation.js");
    this.#rendererUrl =
      options?.rendererUrl ?? process.env.ELECTRON_RENDERER_URL ?? APP_RENDERER_URL;
  }

  subscribeTerminal(listener: (webContentsId: number) => void): () => void {
    this.#terminalListeners.add(listener);
    return () => this.#terminalListeners.delete(listener);
  }

  ensureWindow(): BrowserWindow {
    if (this.#window && !this.#window.isDestroyed()) return this.#window;
    const window = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      show: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: this.#preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    window.setAlwaysOnTop(true, "floating");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setIgnoreMouseEvents(true, { forward: true });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const generation = ++this.#generation;
    const webContentsId = window.webContents.id;
    let terminalReported = false;
    const reportTerminal = (): void => {
      if (terminalReported) return;
      terminalReported = true;
      if (this.#window === window && this.#generation === generation) this.#window = null;
      for (const listener of this.#terminalListeners) listener(webContentsId);
      if (!window.isDestroyed()) window.destroy();
    };
    window.on("closed", reportTerminal);
    window.webContents.on("render-process-gone", reportTerminal);
    window.webContents.on("did-fail-load", reportTerminal);
    window.on("unresponsive", reportTerminal);
    this.#window = window;
    this.reposition();
    void window.loadURL(withGlobalDictationRoute(this.#rendererUrl));
    return window;
  }

  ownsWebContents(webContentsId: number): boolean {
    return this.#window?.isDestroyed() === false && this.#window.webContents.id === webContentsId;
  }

  show(): void {
    const window = this.ensureWindow();
    this.reposition();
    window.showInactive();
  }

  hide(): void {
    if (!this.#window || this.#window.isDestroyed()) return;
    this.#window.hide();
    this.#window.setIgnoreMouseEvents(true, { forward: true });
  }

  send(command: GlobalDictationRendererCommand): boolean {
    const window = this.ensureWindow();
    if (
      window.isDestroyed() ||
      window.webContents.isLoading() ||
      window.webContents.isDestroyed()
    ) {
      return false;
    }
    try {
      window.webContents.send(GLOBAL_DICTATION_COMMAND_CHANNEL, command);
    } catch {
      return false;
    }
    return true;
  }

  setInteractive(enabled: boolean): void {
    if (!this.#window || this.#window.isDestroyed()) return;
    this.#window.setIgnoreMouseEvents(!enabled, { forward: true });
  }

  reposition(): void {
    if (!this.#window || this.#window.isDestroyed()) return;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    this.#window.setBounds(resolveGlobalDictationBounds(display.workArea), false);
  }

  dispose(): void {
    const window = this.#window;
    this.#window = null;
    window?.destroy();
    this.#terminalListeners.clear();
  }
}
