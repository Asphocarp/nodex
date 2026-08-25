import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { createCommandKeymapState } from "../../shared/command-keybindings";
import type { MacDictationHelperEvent } from "./mac-dictation-native-helper-client";
import { GlobalDictationManager } from "./global-dictation-manager";
import { ClipboardSafePasteError } from "./clipboard-safe-paste-service";

const macKeymap = () =>
  createCommandKeymapState(
    { globalDictationHold: ["Fn"], globalDictationToggle: ["Command+Shift+D"] },
    "macOS",
  );

const createFixture = (focusedWindow: BrowserWindow | null = null) => {
  let helperListener: ((event: MacDictationHelperEvent) => void) | null = null;
  let terminalListener: ((webContentsId: number) => void) | null = null;
  const helper = {
    subscribe: vi.fn((listener: (event: MacDictationHelperEvent) => void) => {
      helperListener = listener;
      return () => {
        helperListener = null;
      };
    }),
    register: vi.fn(async () => undefined),
    unregister: vi.fn(async () => undefined),
    captureFn: vi.fn(async () => "Fn" as const),
    queryBuiltInMicrophoneName: vi.fn(async () => null),
    capabilities: vi.fn(async () => ({ inputMonitoring: true, accessibility: true })),
    requestInputMonitoring: vi.fn(async () => true),
    requestAccessibility: vi.fn(async () => true),
    dispose: vi.fn(),
  };
  const commands: unknown[] = [];
  const overlayWindow = { webContents: { id: 99 } } as BrowserWindow;
  const windowController = {
    ensureWindow: vi.fn(() => overlayWindow),
    ownsWebContents: (id: number) => id === 99,
    show: vi.fn(),
    hide: vi.fn(),
    send: vi.fn((command: unknown) => {
      commands.push(command);
      return true;
    }),
    setInteractive: vi.fn(),
    dispose: vi.fn(),
    subscribeTerminal: vi.fn((listener: (webContentsId: number) => void) => {
      terminalListener = listener;
      return () => {
        terminalListener = null;
      };
    }),
  };
  const paste = vi.fn(async () => undefined);
  const readSettings = vi.fn(async () => ({
    microphoneInputDeviceId: null,
    keepGlobalBarVisible: false,
    playStartSound: true,
    playStopSound: true,
    globalShortcutNudgeDismissed: false,
    dictionary: [],
  }));
  const manager = new GlobalDictationManager({
    helper,
    windowController,
    pasteService: { paste },
    readSettings,
    getFocusedAppWindow: () => focusedWindow,
    getAppWindowByWebContentsId: (id) =>
      focusedWindow?.webContents.id === id ? focusedWindow : null,
    platform: "darwin",
  });
  void manager.setEnabled(true);
  return {
    commands,
    emit: (event: MacDictationHelperEvent) => helperListener?.(event),
    emitWindowTerminal: (webContentsId: number) => terminalListener?.(webContentsId),
    helper,
    manager,
    paste,
    readSettings,
    windowController,
  };
};

describe("GlobalDictationManager", () => {
  it("registers hold/toggle before routing a hold session through the overlay", async () => {
    const fixture = createFixture();
    await fixture.manager.initialize(macKeymap());
    expect(fixture.helper.register).toHaveBeenCalledTimes(2);

    fixture.emit({
      type: "pressed",
      bindingId: "global-dictation-hold",
      mode: "hold",
      generation: 1,
      target: { pid: 7, bundleIdentifier: "example.app" },
    });
    const snapshot = fixture.manager.getSnapshot();
    expect(snapshot.kind).toBe("overlay-starting");
    if (snapshot.kind !== "overlay-starting") throw new Error("Expected overlay session");
    const sessionId = snapshot.sessionId;
    fixture.manager.handleRendererEvent(99, { type: "ready" });
    expect(fixture.commands).toContainEqual({ type: "start", sessionId, gesture: "hold" });

    fixture.manager.handleRendererEvent(99, { type: "accepted", sessionId });
    fixture.emit({
      type: "released",
      bindingId: "global-dictation-hold",
      mode: "hold",
      generation: 2,
      target: { pid: 7, bundleIdentifier: "example.app" },
    });
    expect(fixture.commands).toContainEqual({ type: "stop", sessionId });

    fixture.manager.handleRendererEvent(99, {
      type: "completed",
      sessionId,
      transcript: "hello",
    });
    await vi.waitFor(() => expect(fixture.manager.getSnapshot().kind).toBe("idle"));
    expect(fixture.paste).toHaveBeenCalledWith("hello", {
      pid: 7,
      bundleIdentifier: "example.app",
    });
    expect(fixture.windowController.hide).toHaveBeenCalled();
  });

  it("uses the focused composer when it acknowledges within the handoff window", async () => {
    const sent: unknown[] = [];
    const focusedWindow = {
      isDestroyed: () => false,
      webContents: {
        id: 41,
        isDestroyed: () => false,
        send: (_channel: string, command: unknown) => sent.push(command),
      },
    } as unknown as BrowserWindow;
    const fixture = createFixture(focusedWindow);
    await fixture.manager.initialize(macKeymap());
    fixture.emit({
      type: "pressed",
      bindingId: "global-dictation-toggle",
      mode: "toggle",
      generation: 1,
      target: { pid: process.pid, bundleIdentifier: "app.jyu.nodex" },
    });
    const snapshot = fixture.manager.getSnapshot();
    expect(snapshot.kind).toBe("routing-in-app");
    if (snapshot.kind !== "routing-in-app") throw new Error("Expected in-app route");
    fixture.manager.handleRendererEvent(41, { type: "accepted", sessionId: snapshot.sessionId });
    fixture.manager.handleRendererEvent(41, {
      type: "completed",
      sessionId: snapshot.sessionId,
      transcript: "inserted by composer",
    });

    expect(fixture.manager.getSnapshot().kind).toBe("idle");
    expect(fixture.paste).not.toHaveBeenCalled();
    expect(fixture.windowController.show).not.toHaveBeenCalled();
    expect(sent).toContainEqual({
      type: "start",
      sessionId: snapshot.sessionId,
      gesture: "toggle",
    });
  });

  it("rolls a failed binding registration back to the previous native state", async () => {
    const fixture = createFixture();
    await fixture.manager.initialize(
      createCommandKeymapState({ globalDictationHold: ["Fn"] }, "macOS"),
    );
    fixture.helper.register.mockRejectedValueOnce(new Error("hotkey-conflict"));

    await expect(fixture.manager.syncCommandKeymap(macKeymap())).rejects.toThrow("hotkey-conflict");
    expect(fixture.helper.register).toHaveBeenLastCalledWith({
      bindingId: "global-dictation-hold",
      mode: "hold",
      accelerator: "Fn",
    });
  });

  it("falls back to the overlay when the focused composer misses the acknowledgement window", async () => {
    vi.useFakeTimers();
    try {
      const focusedWindow = {
        isDestroyed: () => false,
        webContents: { id: 41, isDestroyed: () => false, send: vi.fn() },
      } as unknown as BrowserWindow;
      const fixture = createFixture(focusedWindow);
      await fixture.manager.initialize(macKeymap());
      fixture.emit({
        type: "pressed",
        bindingId: "global-dictation-hold",
        mode: "hold",
        generation: 1,
        target: { pid: process.pid, bundleIdentifier: "app.jyu.nodex" },
      });
      expect(fixture.manager.getSnapshot().kind).toBe("routing-in-app");

      await vi.advanceTimersByTimeAsync(150);
      const snapshot = fixture.manager.getSnapshot();
      expect(snapshot.kind).toBe("overlay-starting");
      if (snapshot.kind !== "overlay-starting") throw new Error("Expected overlay fallback");
      fixture.manager.handleRendererEvent(99, { type: "ready" });
      expect(focusedWindow.webContents.send).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ type: "cancel", sessionId: snapshot.sessionId }),
      );
      expect(fixture.commands).toContainEqual({
        type: "start",
        sessionId: snapshot.sessionId,
        gesture: "hold",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-registers the desired shortcuts after Input Monitoring becomes available", async () => {
    const fixture = createFixture();
    fixture.helper.register.mockRejectedValueOnce(new Error("input-monitoring-denied"));
    await expect(fixture.manager.initialize(macKeymap())).rejects.toThrow(
      "input-monitoring-denied",
    );
    fixture.helper.register.mockClear();

    await fixture.manager.requestInputMonitoring();

    expect(fixture.helper.register).toHaveBeenCalledTimes(2);
    expect(fixture.manager.isAvailable()).toBe(true);
  });

  it("drops an active overlay route when its renderer terminates", async () => {
    const fixture = createFixture();
    await fixture.manager.initialize(macKeymap());
    fixture.emit({
      type: "pressed",
      bindingId: "global-dictation-toggle",
      mode: "toggle",
      generation: 1,
      target: { pid: 7, bundleIdentifier: "example.app" },
    });
    expect(fixture.manager.getSnapshot().kind).toBe("overlay-starting");

    fixture.emitWindowTerminal(99);

    expect(fixture.manager.getSnapshot().kind).toBe("idle");
    expect(fixture.windowController.hide).toHaveBeenCalled();
  });

  it("unregisters and ignores global hotkeys when dictation auth is unavailable", async () => {
    const fixture = createFixture();
    await fixture.manager.initialize(macKeymap());
    await fixture.manager.setEnabled(false);
    fixture.emit({
      type: "pressed",
      bindingId: "global-dictation-toggle",
      mode: "toggle",
      generation: 1,
      target: { pid: 7, bundleIdentifier: "example.app" },
    });

    expect(fixture.manager.getSnapshot().kind).toBe("idle");
    expect(fixture.helper.unregister).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed Accessibility paste retryable without losing the transcript", async () => {
    const fixture = createFixture();
    fixture.paste.mockRejectedValueOnce(new ClipboardSafePasteError("accessibility-denied"));
    await fixture.manager.initialize(macKeymap());
    fixture.emit({
      type: "pressed",
      bindingId: "global-dictation-toggle",
      mode: "toggle",
      generation: 1,
      target: { pid: 7, bundleIdentifier: "example.app" },
    });
    const snapshot = fixture.manager.getSnapshot();
    if (snapshot.kind !== "overlay-starting") throw new Error("Expected overlay session");
    fixture.manager.handleRendererEvent(99, { type: "ready" });
    fixture.manager.handleRendererEvent(99, { type: "accepted", sessionId: snapshot.sessionId });
    fixture.manager.handleRendererEvent(99, {
      type: "completed",
      sessionId: snapshot.sessionId,
      transcript: "retained text",
    });
    await vi.waitFor(() =>
      expect(fixture.manager.getSnapshot()).toMatchObject({
        kind: "retryable-error",
        error: { kind: "accessibility-denied" },
      }),
    );

    fixture.manager.handleRendererEvent(99, {
      type: "retry-paste",
      sessionId: snapshot.sessionId,
    });
    await vi.waitFor(() => expect(fixture.manager.getSnapshot().kind).toBe("idle"));
    expect(fixture.paste).toHaveBeenCalledTimes(2);
    expect(fixture.paste).toHaveBeenLastCalledWith("retained text", {
      pid: 7,
      bundleIdentifier: "example.app",
    });
  });

  it("invalidates global capability and closes an active lease after a helper crash", async () => {
    const fixture = createFixture();
    await fixture.manager.initialize(macKeymap());
    fixture.emit({
      type: "pressed",
      bindingId: "global-dictation-hold",
      mode: "hold",
      generation: 1,
      target: { pid: 7, bundleIdentifier: "example.app" },
    });
    fixture.manager.handleRendererEvent(99, { type: "ready" });

    fixture.emit({ type: "crashed" });

    expect(fixture.manager.isAvailable()).toBe(false);
    expect(fixture.manager.getSnapshot().kind).toBe("idle");
    expect(fixture.windowController.hide).toHaveBeenCalled();
  });
});
