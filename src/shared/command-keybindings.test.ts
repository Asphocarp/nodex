import { describe, expect, test } from "bun:test";
import {
  applyCommandKeybindingUpdate,
  CODEX_COMMAND_REGISTRY,
  createCommandKeymapState,
  findCommandKeybindingConflict,
  formatAcceleratorLabel,
  getPrimaryCommandAccelerator,
  keyboardEventToAccelerator,
  matchesKeyboardEventToCommand,
  matchesMouseEventToCommand,
  normalizeAccelerator,
  toElectronAccelerator,
  type KeyboardShortcutEventLike,
} from "./command-keybindings";

function keyboardEvent(key: string, overrides: Partial<KeyboardShortcutEventLike> = {}): KeyboardShortcutEventLike {
  return {
    key,
    code: overrides.code ?? "",
    metaKey: overrides.metaKey ?? false,
    ctrlKey: overrides.ctrlKey ?? false,
    altKey: overrides.altKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
  };
}

describe("command keybindings", () => {
  test("formats platform labels and normalizes CmdOrCtrl accelerators", () => {
    expect(normalizeAccelerator("CommandOrControl+Alt+r")).toBe("CmdOrCtrl+Alt+R");
    expect(formatAcceleratorLabel("CmdOrCtrl+Alt+R", "macOS")).toBe("⌘⌥R");
    expect(formatAcceleratorLabel("CmdOrCtrl+Alt+R", "windows")).toBe("Ctrl+Alt+R");
  });

  test("matches CmdOrCtrl keyboard events by platform", () => {
    const macState = createCommandKeymapState({}, "macOS");
    const windowsState = createCommandKeymapState({}, "windows");

    expect(matchesKeyboardEventToCommand(keyboardEvent("b", { metaKey: true }), macState, "toggleSidebar")).toBeTrue();
    expect(matchesKeyboardEventToCommand(keyboardEvent("b", { ctrlKey: true }), windowsState, "toggleSidebar")).toBeTrue();
    expect(matchesKeyboardEventToCommand(keyboardEvent("b", { ctrlKey: true }), macState, "toggleSidebar")).toBeFalse();
  });

  test("keeps close-tab and close-window defaults distinct", () => {
    const macState = createCommandKeymapState({}, "macOS");

    expect(getPrimaryCommandAccelerator(macState, "closeTab")).toBe("CmdOrCtrl+W");
    expect(getPrimaryCommandAccelerator(macState, "closeWindow")).toBe("CmdOrCtrl+Shift+W");
    expect(toElectronAccelerator(getPrimaryCommandAccelerator(macState, "closeWindow"))).toBe("CommandOrControl+Shift+W");
    expect(formatAcceleratorLabel("CmdOrCtrl+Shift+W", "macOS")).toBe("⌘⇧W");
    expect(matchesKeyboardEventToCommand(keyboardEvent("w", { metaKey: true }), macState, "closeWindow")).toBeFalse();
    expect(matchesKeyboardEventToCommand(keyboardEvent("w", { metaKey: true, shiftKey: true }), macState, "closeWindow")).toBeTrue();
  });

  test("captures keyboard events and mouse navigation bindings", () => {
    expect(keyboardEventToAccelerator(keyboardEvent("A", { metaKey: true, shiftKey: true }), "macOS")).toBe("CmdOrCtrl+Shift+A");

    const state = createCommandKeymapState({}, "macOS");
    expect(matchesMouseEventToCommand({ button: 3 }, state, "navigateBack")).toBeTrue();
    expect(matchesMouseEventToCommand({ button: 4 }, state, "navigateForward")).toBeTrue();
  });

  test("applies set append remove and reset update shapes", () => {
    const setOverrides = applyCommandKeybindingUpdate({}, "openThreadInNewWindow", {
      type: "set",
      keybinding: { key: "CmdOrCtrl+Alt+W" },
    }, "macOS");
    expect(JSON.stringify(setOverrides)).toBe(JSON.stringify({ openThreadInNewWindow: ["CmdOrCtrl+Alt+W"] }));

    const appendOverrides = applyCommandKeybindingUpdate({}, "newThread", {
      type: "append",
      keybinding: { key: "CmdOrCtrl+Alt+Shift+N" },
    }, "macOS");
    expect(JSON.stringify(appendOverrides.newThread)).toBe(JSON.stringify(["CmdOrCtrl+N", "CmdOrCtrl+Shift+O", "CmdOrCtrl+Alt+Shift+N"]));

    const removeOverrides = applyCommandKeybindingUpdate(appendOverrides, "newThread", {
      type: "remove",
      keybinding: { key: "CmdOrCtrl+N" },
    }, "macOS");
    expect(JSON.stringify(removeOverrides.newThread)).toBe(JSON.stringify(["CmdOrCtrl+Shift+O", "CmdOrCtrl+Alt+Shift+N"]));

    const resetOverrides = applyCommandKeybindingUpdate(removeOverrides, "newThread", { type: "reset" }, "macOS");
    expect(Object.prototype.hasOwnProperty.call(resetOverrides, "newThread")).toBeFalse();
  });

  test("detects conflicts and rejects invalid accelerators", () => {
    const state = createCommandKeymapState({}, "macOS");
    const conflict = findCommandKeybindingConflict(state, "renameThread", "CmdOrCtrl+B");
    expect(conflict?.commandId).toBe("toggleSidebar");

    let threw = false;
    try {
      applyCommandKeybindingUpdate({}, "renameThread", {
        type: "set",
        keybinding: { key: "CmdOrCtrl+B" },
      }, "macOS");
    } catch {
      threw = true;
    }
    expect(threw).toBeTrue();
  });

  test("uses current command palette labels and hides unavailable shell commands", () => {
    const byId = new Map(CODEX_COMMAND_REGISTRY.map((entry) => [entry.id, entry]));

    expect(byId.get("searchCards")?.title).toBe("Search cards");
    expect(byId.get("searchFiles")?.title).toBe("Search files");
    expect(byId.get("openCommandMenu")?.title).toBe("Open command palette");
    expect(byId.get("toggleTerminal")?.title).toBe("Open terminal tab");
    expect(byId.get("searchChats")?.available).toBeTrue();
    expect(byId.get("searchFiles")?.available).toBeFalse();
    expect(byId.get("toggleBrowserPanel")?.available).toBeFalse();
  });
});
