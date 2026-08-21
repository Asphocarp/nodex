import { describe, expect, test } from "vitest";
import {
  applyCommandKeybindingUpdate,
  CODEX_COMMAND_REGISTRY,
  createCommandKeymapState,
  findCommandKeybindingConflict,
  formatAcceleratorAriaKeyShortcut,
  formatAcceleratorLabel,
  formatCommandShortcutLabel,
  getPrimaryCommandAccelerator,
  keyboardEventToAccelerator,
  matchKeyboardShortcutSequence,
  matchesKeyboardEventToCommand,
  matchesMouseEventToCommand,
  normalizeAccelerator,
  NEXT_PANEL_TAB_COMMAND_ID,
  PREVIOUS_PANEL_TAB_COMMAND_ID,
  resolveRuntimePlatform,
  resolveCommandShortcutPresentation,
  toElectronAccelerator,
  type KeyboardShortcutEventLike,
} from "./command-keybindings";

function keyboardEvent(
  key: string,
  overrides: Partial<KeyboardShortcutEventLike> = {},
): KeyboardShortcutEventLike {
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
    expect(formatAcceleratorAriaKeyShortcut("CmdOrCtrl+Alt+R", "macOS")).toBe("Meta+Alt+R");
    expect(formatAcceleratorAriaKeyShortcut("Ctrl+Shift+M", "macOS")).toBe("Control+Shift+M");
  });

  test("projects command shortcuts for visible and assistive labels", () => {
    const defaultState = createCommandKeymapState({}, "macOS");
    const customState = createCommandKeymapState(
      {
        openModelPicker: ["CmdOrCtrl+Alt+M"],
      },
      "macOS",
    );
    const unassignedState = createCommandKeymapState(
      {
        openModelPicker: [],
      },
      "macOS",
    );

    expect(resolveCommandShortcutPresentation(defaultState, "openModelPicker")).toEqual({
      label: "⌃⇧M",
      ariaKeyShortcuts: "Control+Shift+M",
    });
    expect(resolveCommandShortcutPresentation(customState, "openModelPicker")).toEqual({
      label: "⌘⌥M",
      ariaKeyShortcuts: "Meta+Alt+M",
    });
    expect(resolveCommandShortcutPresentation(unassignedState, "openModelPicker")).toBeNull();
  });

  test("matches CmdOrCtrl keyboard events by platform", () => {
    const macState = createCommandKeymapState({}, "macOS");
    const windowsState = createCommandKeymapState({}, "windows");

    expect(
      matchesKeyboardEventToCommand(
        keyboardEvent("b", { metaKey: true }),
        macState,
        "toggleSidebar",
      ),
    ).toBe(true);
    expect(
      matchesKeyboardEventToCommand(
        keyboardEvent("b", { ctrlKey: true }),
        windowsState,
        "toggleSidebar",
      ),
    ).toBe(true);
    expect(
      matchesKeyboardEventToCommand(
        keyboardEvent("b", { ctrlKey: true }),
        macState,
        "toggleSidebar",
      ),
    ).toBe(false);
  });

  test("does not restore fallback labels for explicitly unassigned commands", () => {
    const state = createCommandKeymapState({ toggleBottomPanel: [] }, "macOS");
    const runtimeFallback = resolveRuntimePlatform() === "macOS" ? "⌘J" : "Ctrl+J";

    expect(formatCommandShortcutLabel(state, "toggleBottomPanel", "CmdOrCtrl+J")).toBeUndefined();
    expect(formatCommandShortcutLabel(undefined, "toggleBottomPanel", "CmdOrCtrl+J")).toBe(
      runtimeFallback,
    );
  });

  test("keeps close-tab and close-window defaults distinct", () => {
    const macState = createCommandKeymapState({}, "macOS");

    expect(getPrimaryCommandAccelerator(macState, PREVIOUS_PANEL_TAB_COMMAND_ID)).toBe(
      "CmdOrCtrl+Shift+[",
    );
    expect(getPrimaryCommandAccelerator(macState, NEXT_PANEL_TAB_COMMAND_ID)).toBe(
      "CmdOrCtrl+Shift+]",
    );
    expect(
      toElectronAccelerator(getPrimaryCommandAccelerator(macState, NEXT_PANEL_TAB_COMMAND_ID)),
    ).toBe("CommandOrControl+Shift+]");
    expect(getPrimaryCommandAccelerator(macState, "closeTab")).toBe("CmdOrCtrl+W");
    expect(getPrimaryCommandAccelerator(macState, "closeWindow")).toBe("CmdOrCtrl+Shift+W");
    expect(toElectronAccelerator(getPrimaryCommandAccelerator(macState, "closeWindow"))).toBe(
      "CommandOrControl+Shift+W",
    );
    expect(formatAcceleratorLabel("CmdOrCtrl+Shift+W", "macOS")).toBe("⌘⇧W");
    expect(
      matchesKeyboardEventToCommand(keyboardEvent("w", { metaKey: true }), macState, "closeWindow"),
    ).toBe(false);
    expect(
      matchesKeyboardEventToCommand(
        keyboardEvent("w", { metaKey: true, shiftKey: true }),
        macState,
        "closeWindow",
      ),
    ).toBe(true);
  });

  test("captures keyboard events and mouse navigation bindings", () => {
    expect(
      keyboardEventToAccelerator(keyboardEvent("A", { metaKey: true, shiftKey: true }), "macOS"),
    ).toBe("CmdOrCtrl+Shift+A");

    const state = createCommandKeymapState({}, "macOS");
    expect(matchesMouseEventToCommand({ button: 3 }, state, "navigateBack")).toBe(true);
    expect(matchesMouseEventToCommand({ button: 4 }, state, "navigateForward")).toBe(true);
  });

  test("applies set append remove and reset update shapes", () => {
    const setOverrides = applyCommandKeybindingUpdate(
      {},
      "openThreadInNewWindow",
      {
        type: "set",
        keybinding: { key: "CmdOrCtrl+Alt+W" },
      },
      "macOS",
    );
    expect(JSON.stringify(setOverrides)).toBe(
      JSON.stringify({ openThreadInNewWindow: ["CmdOrCtrl+Alt+W"] }),
    );

    const appendOverrides = applyCommandKeybindingUpdate(
      {},
      "newThread",
      {
        type: "append",
        keybinding: { key: "CmdOrCtrl+Alt+Shift+N" },
      },
      "macOS",
    );
    expect(JSON.stringify(appendOverrides.newThread)).toBe(
      JSON.stringify(["CmdOrCtrl+N", "CmdOrCtrl+Shift+O", "CmdOrCtrl+Alt+Shift+N"]),
    );

    const removeOverrides = applyCommandKeybindingUpdate(
      appendOverrides,
      "newThread",
      {
        type: "remove",
        keybinding: { key: "CmdOrCtrl+N" },
      },
      "macOS",
    );
    expect(JSON.stringify(removeOverrides.newThread)).toBe(
      JSON.stringify(["CmdOrCtrl+Shift+O", "CmdOrCtrl+Alt+Shift+N"]),
    );

    const resetOverrides = applyCommandKeybindingUpdate(
      removeOverrides,
      "newThread",
      { type: "reset" },
      "macOS",
    );
    expect(Object.prototype.hasOwnProperty.call(resetOverrides, "newThread")).toBe(false);
  });

  test("detects conflicts and rejects invalid accelerators", () => {
    const state = createCommandKeymapState({}, "macOS");
    const conflict = findCommandKeybindingConflict(state, "renameThread", "CmdOrCtrl+B");
    expect(conflict?.commandId).toBe("toggleSidebar");

    let threw = false;
    try {
      applyCommandKeybindingUpdate(
        {},
        "renameThread",
        {
          type: "set",
          keybinding: { key: "CmdOrCtrl+B" },
        },
        "macOS",
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("uses current command palette labels and hides unavailable shell commands", () => {
    const byId = new Map(CODEX_COMMAND_REGISTRY.map((entry) => [entry.id, entry]));

    expect(byId.get("searchPages")?.title).toBe("Search Pages");
    expect(byId.get("searchFiles")?.title).toBe("Search files");
    expect(byId.get("openCommandMenu")?.title).toBe("Open command palette");
    expect(byId.get("toggleTerminal")?.title).toBe("Open terminal tab");
    expect(byId.get("searchChats")?.available).toBe(true);
    expect(byId.get("searchFiles")?.available).toBe(false);
    expect(byId.get("toggleBrowserPanel")?.available).toBe(false);
  });

  test("offers bare C as the primary Create Page shortcut with a modifier fallback", () => {
    const state = createCommandKeymapState({}, "macOS");
    const entry = state.entries.find((candidate) => candidate.id === "createPage");

    expect(entry?.keybindings).toEqual([{ key: "C" }, { key: "CmdOrCtrl+Shift+C" }]);
    expect(entry?.allowsMultiple).toBe(true);
    expect(getPrimaryCommandAccelerator(state, "createPage")).toBe("C");
    expect(formatCommandShortcutLabel(state, "createPage")).toBe("C");
  });

  test("matches configurable two-chord sequences without treating their prefix as a command", () => {
    const state = createCommandKeymapState({}, "macOS");
    const first = matchKeyboardShortcutSequence(
      keyboardEvent("g"),
      state,
      { prefix: [], expiresAt: 0 },
      { now: 100 },
    );
    expect(first.kind).toBe("pending");
    if (first.kind !== "pending") return;

    const second = matchKeyboardShortcutSequence(keyboardEvent("p"), state, first.state, {
      now: 200,
    });
    expect(second.kind).toBe("matched");
    expect(second.kind === "matched" ? second.commandId : null).toBe("goToPages");
  });

  test("expires sequences and displays question mark as one keycap", () => {
    const state = createCommandKeymapState({}, "macOS");
    const stale = matchKeyboardShortcutSequence(
      keyboardEvent("p"),
      state,
      { prefix: ["G"], expiresAt: 100 },
      { now: 101 },
    );
    expect(stale.kind).toBe("none");
    expect(formatAcceleratorLabel("Shift+/", "macOS")).toBe("?");
  });
});
