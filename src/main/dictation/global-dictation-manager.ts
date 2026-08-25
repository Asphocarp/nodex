import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import type { CommandKeymapState } from "../../shared/command-keybindings";
import { getPrimaryCommandAccelerator } from "../../shared/command-keybindings";
import type {
  DictationError,
  DictationSettings,
  GlobalDictationPermissionSnapshot,
} from "../../shared/dictation";
import {
  GLOBAL_DICTATION_COMMAND_CHANNEL,
  type GlobalDictationManagerSnapshot,
  type GlobalDictationRendererEvent,
  type GlobalDictationTarget,
} from "../../shared/global-dictation";
import type {
  MacDictationHelperEvent,
  MacDictationNativeHelperClient,
} from "./mac-dictation-native-helper-client";
import type { ClipboardSafePasteService } from "./clipboard-safe-paste-service";
import { ClipboardSafePasteError } from "./clipboard-safe-paste-service";
import type { GlobalDictationWindowController } from "./global-dictation-window-controller";

const IN_APP_ACCEPT_TIMEOUT_MS = 150;
const GLOBAL_BINDINGS = [
  { commandId: "globalDictationHold", bindingId: "global-dictation-hold", mode: "hold" },
  { commandId: "globalDictationToggle", bindingId: "global-dictation-toggle", mode: "toggle" },
] as const;

interface ActiveGlobalSession {
  readonly sessionId: string;
  readonly target: GlobalDictationTarget;
  readonly gesture: "hold" | "toggle";
  owner: "pending-in-app" | "in-app" | "overlay";
  senderWebContentsId: number | null;
  acceptTimer: ReturnType<typeof setTimeout> | null;
  transcript: string | null;
  stopRequested: boolean;
}

type GlobalDictationHelperPort = Pick<
  MacDictationNativeHelperClient,
  | "captureFn"
  | "dispose"
  | "queryBuiltInMicrophoneName"
  | "capabilities"
  | "requestAccessibility"
  | "requestInputMonitoring"
  | "register"
  | "subscribe"
  | "unregister"
>;

type GlobalDictationWindowPort = Pick<
  GlobalDictationWindowController,
  | "dispose"
  | "ensureWindow"
  | "hide"
  | "ownsWebContents"
  | "send"
  | "setInteractive"
  | "show"
  | "subscribeTerminal"
>;

/** Main-owned lease for hotkey routing, overlay lifecycle, and exact-target paste. */
export class GlobalDictationManager {
  readonly #helper: GlobalDictationHelperPort;
  readonly #windowController: GlobalDictationWindowPort;
  readonly #pasteService: Pick<ClipboardSafePasteService, "paste">;
  readonly #readSettings: () => Promise<DictationSettings>;
  readonly #getFocusedAppWindow: () => BrowserWindow | null;
  readonly #getAppWindowByWebContentsId: (webContentsId: number) => BrowserWindow | null;
  readonly #platform: NodeJS.Platform;
  readonly #listeners = new Set<() => void>();
  readonly #registered = new Map<
    string,
    { readonly mode: "hold" | "toggle"; readonly accelerator: string }
  >();
  #snapshot: GlobalDictationManagerSnapshot = { kind: "idle" };
  #active: ActiveGlobalSession | null = null;
  #overlayReady = false;
  #helperAvailable: boolean;
  #enabled = false;
  #desiredCommandKeymap: CommandKeymapState | null = null;
  #disposed = false;
  readonly #unsubscribeHelper: () => void;
  readonly #unsubscribeWindowTerminal: () => void;

  constructor(options: {
    readonly helper: GlobalDictationHelperPort;
    readonly windowController: GlobalDictationWindowPort;
    readonly pasteService: Pick<ClipboardSafePasteService, "paste">;
    readonly readSettings: () => Promise<DictationSettings>;
    readonly getFocusedAppWindow: () => BrowserWindow | null;
    readonly getAppWindowByWebContentsId: (webContentsId: number) => BrowserWindow | null;
    readonly platform?: NodeJS.Platform;
  }) {
    this.#helper = options.helper;
    this.#windowController = options.windowController;
    this.#pasteService = options.pasteService;
    this.#readSettings = options.readSettings;
    this.#getFocusedAppWindow = options.getFocusedAppWindow;
    this.#getAppWindowByWebContentsId = options.getAppWindowByWebContentsId;
    this.#platform = options.platform ?? process.platform;
    this.#helperAvailable = this.#platform === "darwin";
    this.#unsubscribeHelper = this.#helper.subscribe((event) => this.#onHelperEvent(event));
    this.#unsubscribeWindowTerminal = this.#windowController.subscribeTerminal((webContentsId) => {
      this.#overlayReady = false;
      this.handleWebContentsGone(webContentsId);
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): GlobalDictationManagerSnapshot => this.#snapshot;

  readonly isAvailable = (): boolean => this.#platform === "darwin" && this.#helperAvailable;

  async initialize(state: CommandKeymapState): Promise<void> {
    if (this.#platform !== "darwin" || this.#disposed) return;
    await this.syncCommandKeymap(state);
    if (this.#registered.size > 0) this.#windowController.ensureWindow();
  }

  async syncCommandKeymap(state: CommandKeymapState): Promise<void> {
    if (this.#platform !== "darwin" || this.#disposed) return;
    this.#desiredCommandKeymap = state;
    const previous = new Map(this.#registered);
    const next = new Map<
      string,
      { readonly mode: "hold" | "toggle"; readonly accelerator: string }
    >();
    for (const binding of GLOBAL_BINDINGS) {
      const accelerator = getPrimaryCommandAccelerator(state, binding.commandId);
      if (accelerator) next.set(binding.bindingId, { mode: binding.mode, accelerator });
    }
    if (!this.#enabled) {
      for (const bindingId of previous.keys()) await this.#helper.unregister(bindingId);
      this.#registered.clear();
      return;
    }
    try {
      for (const [bindingId, value] of next) {
        const current = previous.get(bindingId);
        if (current?.accelerator === value.accelerator && current.mode === value.mode) continue;
        await this.#helper.register({ bindingId, ...value });
      }
      for (const bindingId of previous.keys()) {
        if (next.has(bindingId)) continue;
        await this.#helper.unregister(bindingId);
      }
      this.#registered.clear();
      for (const [bindingId, value] of next) this.#registered.set(bindingId, value);
      this.#setHelperAvailable(true);
      if (next.size > 0) this.#windowController.ensureWindow();
    } catch (error) {
      this.#setHelperAvailable(false);
      await this.#restoreRegistrations(previous, next);
      throw error;
    }
  }

  captureFnHotkey(): Promise<"Fn"> {
    if (this.#platform !== "darwin")
      return Promise.reject(new Error("Global dictation is macOS-only"));
    return this.#helper.captureFn();
  }

  queryBuiltInMicrophoneName(): Promise<string | null> {
    if (this.#platform !== "darwin") return Promise.resolve(null);
    return this.#helper.queryBuiltInMicrophoneName();
  }

  async readPermissions(): Promise<GlobalDictationPermissionSnapshot> {
    if (this.#platform !== "darwin") {
      return { available: false, inputMonitoring: false, accessibility: false };
    }
    const capabilities = await this.#helper.capabilities(false);
    return { available: true, ...capabilities };
  }

  async requestInputMonitoring(): Promise<GlobalDictationPermissionSnapshot> {
    if (this.#platform !== "darwin") return await this.readPermissions();
    const granted = await this.#helper.requestInputMonitoring();
    if (granted && this.#desiredCommandKeymap) {
      await this.syncCommandKeymap(this.#desiredCommandKeymap);
    }
    return await this.readPermissions();
  }

  async requestAccessibility(): Promise<GlobalDictationPermissionSnapshot> {
    if (this.#platform !== "darwin") return await this.readPermissions();
    await this.#helper.requestAccessibility();
    return await this.readPermissions();
  }

  handleRendererEvent(senderWebContentsId: number, event: GlobalDictationRendererEvent): boolean {
    if (this.#disposed) return false;
    if (event.type === "ready") {
      if (!this.#windowController.ownsWebContents(senderWebContentsId)) return false;
      this.#overlayReady = true;
      const active = this.#active;
      if (active?.owner === "overlay") this.#startOverlay(active);
      return true;
    }
    if (event.type === "interactive") {
      if (this.#windowController.ownsWebContents(senderWebContentsId)) {
        this.#windowController.setInteractive(event.enabled);
      }
      return this.#windowController.ownsWebContents(senderWebContentsId);
    }
    const active = this.#active;
    if (!active || ("sessionId" in event && event.sessionId !== active.sessionId)) return false;
    if (event.type === "accepted") {
      if (active.owner === "pending-in-app" && senderWebContentsId === active.senderWebContentsId) {
        if (active.acceptTimer) clearTimeout(active.acceptTimer);
        active.acceptTimer = null;
        active.owner = "in-app";
        this.#publish({ kind: "recording", sessionId: active.sessionId, owner: "in-app" });
        return true;
      }
      if (
        active.owner === "overlay" &&
        this.#windowController.ownsWebContents(senderWebContentsId)
      ) {
        this.#publish({ kind: "recording", sessionId: active.sessionId, owner: "overlay" });
        return true;
      }
      return false;
    }
    if (senderWebContentsId !== active.senderWebContentsId) return false;
    if (event.type === "state") {
      this.#publish({
        kind: event.state === "listening" ? "recording" : "transcribing",
        sessionId: active.sessionId,
        owner: active.owner === "in-app" ? "in-app" : "overlay",
      });
      return true;
    }
    if (event.type === "completed") {
      if (active.owner === "in-app") {
        this.#finishActive(false);
        return true;
      }
      active.transcript = event.transcript;
      void this.#pasteActive(active);
      return true;
    }
    if (event.type === "failed") {
      this.#publish({ kind: "retryable-error", sessionId: active.sessionId, error: event.error });
      return true;
    }
    if (event.type === "retry-paste" && active.transcript) {
      void this.#pasteActive(active);
      return true;
    }
    if (event.type === "cancelled" || event.type === "dismiss") {
      this.#finishActive(true);
      return true;
    }
    return false;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.#disposed || this.#enabled === enabled) return;
    this.#enabled = enabled;
    if (!enabled) {
      if (this.#active) {
        this.#sendToOwner(this.#active, { type: "cancel", sessionId: this.#active.sessionId });
        this.#finishActive(true);
      }
      await Promise.all(
        [...this.#registered.keys()].map((bindingId) =>
          this.#helper.unregister(bindingId).catch(() => undefined),
        ),
      );
      this.#registered.clear();
      return;
    }
    if (this.#desiredCommandKeymap) {
      await this.syncCommandKeymap(this.#desiredCommandKeymap);
    }
  }

  handleWebContentsGone(webContentsId: number): void {
    if (this.#windowController.ownsWebContents(webContentsId)) this.#overlayReady = false;
    const active = this.#active;
    if (active?.senderWebContentsId !== webContentsId) return;
    if (active.acceptTimer) clearTimeout(active.acceptTimer);
    this.#active = null;
    this.#publish({ kind: "idle" });
    this.#windowController.hide();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribeHelper();
    this.#unsubscribeWindowTerminal();
    const active = this.#active;
    if (active?.acceptTimer) clearTimeout(active.acceptTimer);
    if (active) this.#sendToOwner(active, { type: "cancel", sessionId: active.sessionId });
    this.#active = null;
    for (const bindingId of this.#registered.keys()) void this.#helper.unregister(bindingId);
    this.#registered.clear();
    this.#windowController.dispose();
    this.#helper.dispose();
    this.#publish({ kind: "idle" });
    this.#listeners.clear();
  }

  #onHelperEvent(event: MacDictationHelperEvent): void {
    if (this.#disposed) return;
    if (event.type === "crashed") {
      this.#setHelperAvailable(false);
      if (this.#active) this.#finishActive(true);
      this.#registered.clear();
      if (!this.#active) this.#publish(this.#snapshot);
      return;
    }
    const binding = this.#registered.get(event.bindingId);
    if (!binding) return;
    if (event.type === "pressed") {
      if (binding.mode === "toggle" && this.#active) {
        this.#stopActive();
        return;
      }
      if (!this.#enabled || this.#active || !event.target) return;
      this.#begin({
        target: event.target,
        gesture: binding.mode,
      });
      return;
    }
    if (binding.mode === "hold") this.#stopActive();
  }

  #begin(input: {
    readonly target: GlobalDictationTarget;
    readonly gesture: "hold" | "toggle";
  }): void {
    const session: ActiveGlobalSession = {
      sessionId: randomUUID(),
      target: input.target,
      gesture: input.gesture,
      owner: "overlay",
      senderWebContentsId: null,
      acceptTimer: null,
      transcript: null,
      stopRequested: false,
    };
    this.#active = session;
    const focused = input.target.pid === process.pid ? this.#getFocusedAppWindow() : null;
    if (focused && !focused.isDestroyed()) {
      session.owner = "pending-in-app";
      session.senderWebContentsId = focused.webContents.id;
      this.#publish({ kind: "routing-in-app", sessionId: session.sessionId });
      focused.webContents.send(GLOBAL_DICTATION_COMMAND_CHANNEL, {
        type: "start",
        sessionId: session.sessionId,
        gesture: session.gesture,
      });
      session.acceptTimer = setTimeout(() => {
        if (this.#active !== session || session.owner !== "pending-in-app") return;
        this.#routeToOverlay(session);
      }, IN_APP_ACCEPT_TIMEOUT_MS);
      return;
    }
    this.#routeToOverlay(session);
  }

  #routeToOverlay(session: ActiveGlobalSession): void {
    if (session.owner === "pending-in-app" && session.senderWebContentsId !== null) {
      this.#sendToOwner(session, { type: "cancel", sessionId: session.sessionId });
      if (this.#active !== session) return;
    }
    if (session.acceptTimer) clearTimeout(session.acceptTimer);
    session.acceptTimer = null;
    session.owner = "overlay";
    const window = this.#windowController.ensureWindow();
    session.senderWebContentsId = window.webContents.id;
    this.#windowController.show();
    this.#publish({ kind: "overlay-starting", sessionId: session.sessionId });
    if (this.#overlayReady) this.#startOverlay(session);
  }

  #startOverlay(session: ActiveGlobalSession): void {
    if (this.#active !== session || session.owner !== "overlay") return;
    this.#windowController.send({
      type: "start",
      sessionId: session.sessionId,
      gesture: session.gesture,
    });
    if (session.stopRequested) {
      this.#windowController.send({ type: "stop", sessionId: session.sessionId });
    }
  }

  #stopActive(): void {
    const active = this.#active;
    if (!active) return;
    active.stopRequested = true;
    if (active.owner === "pending-in-app") {
      this.#routeToOverlay(active);
      return;
    }
    if (active.owner !== "overlay" || this.#overlayReady) {
      this.#sendToOwner(active, { type: "stop", sessionId: active.sessionId });
    }
  }

  #sendToOwner(
    active: ActiveGlobalSession,
    command: { readonly type: "stop" | "cancel"; readonly sessionId: string },
  ): void {
    if (active.owner === "overlay") {
      this.#windowController.send(command);
      return;
    }
    if (active.senderWebContentsId === null) return;
    const window = this.#getAppWindowByWebContentsId(active.senderWebContentsId);
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
    try {
      window.webContents.send(GLOBAL_DICTATION_COMMAND_CHANNEL, command);
    } catch {
      // Window lifecycle observers release the route; a racing send failure is already terminal.
    }
  }

  async #pasteActive(active: ActiveGlobalSession): Promise<void> {
    if (this.#active !== active || !active.transcript) return;
    this.#publish({ kind: "pasting", sessionId: active.sessionId });
    try {
      await this.#pasteService.paste(active.transcript, active.target);
      this.#finishActive(false);
    } catch (error) {
      if (this.#active !== active) return;
      const dictationError: DictationError =
        error instanceof ClipboardSafePasteError
          ? error.dictationError
          : { kind: "paste-failed", operation: "paste", retryable: true };
      this.#publish({
        kind: "retryable-error",
        sessionId: active.sessionId,
        error: dictationError,
      });
      this.#windowController.send({
        type: "paste-failed",
        sessionId: active.sessionId,
        error: dictationError,
      });
    }
  }

  #finishActive(forceHide: boolean): void {
    const active = this.#active;
    if (!active) return;
    if (active.acceptTimer) clearTimeout(active.acceptTimer);
    this.#active = null;
    this.#publish({ kind: "idle" });
    if (active.owner === "overlay") {
      this.#windowController.send({ type: "finish", sessionId: active.sessionId });
    }
    if (forceHide) {
      this.#windowController.hide();
      return;
    }
    void this.#readSettings()
      .then((settings) => {
        if (!settings.keepGlobalBarVisible) this.#windowController.hide();
      })
      .catch(() => this.#windowController.hide());
  }

  async #restoreRegistrations(
    previous: ReadonlyMap<
      string,
      { readonly mode: "hold" | "toggle"; readonly accelerator: string }
    >,
    attempted: ReadonlyMap<
      string,
      { readonly mode: "hold" | "toggle"; readonly accelerator: string }
    >,
  ): Promise<void> {
    for (const bindingId of attempted.keys()) {
      if (!previous.has(bindingId)) await this.#helper.unregister(bindingId).catch(() => undefined);
    }
    for (const [bindingId, value] of previous) {
      await this.#helper.register({ bindingId, ...value }).catch(() => undefined);
    }
  }

  #publish(snapshot: GlobalDictationManagerSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }

  #setHelperAvailable(available: boolean): void {
    if (this.#helperAvailable === available) return;
    this.#helperAvailable = available;
    this.#publish(this.#snapshot);
  }
}
