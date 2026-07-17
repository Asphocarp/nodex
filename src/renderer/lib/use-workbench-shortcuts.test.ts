import { describe, expect, test } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { render } from "../test/dom";
import {
  handleWorkbenchMouseNavigationShortcut,
  handleWorkbenchShortcut,
  resolveWorkbenchMouseNavigationShortcut,
  shouldUseRendererWorkbenchCommandFallback,
  useWorkbenchShortcuts,
  type WorkbenchShortcutActions,
} from "./use-workbench-shortcuts";
import { createCommandKeymapState } from "../../shared/command-keybindings";

test("uses the renderer workbench-command fallback only without native command ingress", () => {
  expect(shouldUseRendererWorkbenchCommandFallback(false)).toBe(true);
  expect(shouldUseRendererWorkbenchCommandFallback(true)).toBe(false);
});

function makeInputTarget(): EventTarget {
  return { tagName: "INPUT", isContentEditable: false, closest: () => null } as unknown as EventTarget;
}

function makeNfmEditorTarget(): EventTarget {
  return {
    tagName: "DIV",
    isContentEditable: true,
    closest: (selector: string) =>
      selector.includes(".nfm-editor") ? ({} as Element) : null,
  } as unknown as EventTarget;
}

function makeComposerTarget(): EventTarget {
  return {
    tagName: "TEXTAREA",
    isContentEditable: false,
    closest: (selector: string) =>
      selector.includes("[data-composer-prompt-frame]") ? ({} as Element) : null,
  } as unknown as EventTarget;
}

function makeTerminalTarget(): EventTarget {
  return {
    tagName: "DIV",
    isContentEditable: false,
    closest: (selector: string) =>
      selector.includes("[data-codex-terminal]") ? ({} as Element) : null,
  } as unknown as EventTarget;
}

function makeActions(overrides: Partial<WorkbenchShortcutActions> = {}): WorkbenchShortcutActions {
  return {
    projectRefs: [{ projectId: "a" }, { projectId: "b" }, { projectId: "c" }],
    dbProjectId: "a",
    focusedStage: "db",
    focusAdjacentStage: () => {},
    shiftSlidingWindow: () => {},
    switchToStageIndex: () => {},
    switchToProjectIndex: () => {},
    onRequestCommandPalette: () => {},
    onRequestProjectPicker: () => {},
    onRequestTaskSearch: () => {},
    onRequestContentSearch: () => {},
    onRequestSettingsToggle: () => {},
    onRequestKeyboardShortcuts: () => {},
    onRequestProcessManager: () => {},
    ...overrides,
  };
}

function ShortcutHarness({ actions }: { actions: WorkbenchShortcutActions }) {
  useWorkbenchShortcuts(actions);
  return createElement("div");
}

describe("handleWorkbenchShortcut", () => {
  test("Ctrl+Tab cycles stages forward", () => {
    let direction: -1 | 1 | null = null;
    const actions = makeActions({ focusAdjacentStage: (_, next) => (direction = next) });

    const handled = handleWorkbenchShortcut(
      {
        key: "Tab",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(direction).toBe(1);
  });

  test("Ctrl+Shift+Tab cycles stages backward", () => {
    let direction: -1 | 1 | null = null;
    const actions = makeActions({ focusAdjacentStage: (_, next) => (direction = next) });

    const handled = handleWorkbenchShortcut(
      {
        key: "Tab",
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(direction).toBe(-1);
  });

  test("Cmd+number switches to stage index", () => {
    let selectedIndex = -1;
    const actions = makeActions({ switchToStageIndex: (_, index) => (selectedIndex = index) });

    const handled = handleWorkbenchShortcut(
      {
        key: "3",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(selectedIndex).toBe(2);
  });

  test("Cmd+Alt+R requests chat rename", () => {
    let source = "";
    const actions = makeActions({
      onRequestRenameThread: (nextSource) => {
        source = nextSource;
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "R",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: true,
        target: makeInputTarget(),
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(source).toBe("keyboard_shortcut");
  });

  test("terminal focus leaves app-level shortcuts unhandled", () => {
    let opened = false;
    const actions = makeActions({
      onRequestCommandPalette: () => {
        opened = true;
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "k",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: makeTerminalTarget(),
      },
      actions,
      true,
    );

    expect(handled).toBe(false);
    expect(opened).toBe(false);
  });

  test("Cmd+5 does not map to a stage index", () => {
    let selectedIndex = -1;
    const actions = makeActions({ switchToStageIndex: (_, index) => (selectedIndex = index) });

    const handled = handleWorkbenchShortcut(
      {
        key: "5",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBe(false);
    expect(selectedIndex).toBe(-1);
  });

  test("Cmd+J requests the bottom-panel command from editable targets", () => {
    const commands: string[] = [];
    const handled = handleWorkbenchShortcut(
      {
        key: "j",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: makeInputTarget(),
      },
      makeActions({
        dbProjectId: "b",
        onRequestWorkbenchCommand: (commandId) => commands.push(commandId),
      }),
      true,
    );

    expect(handled).toBe(true);
    expect(commands).toEqual(["toggleBottomPanel"]);
  });

  test("Ctrl+J requests the bottom-panel command on Windows and Linux", () => {
    const commands: string[] = [];
    const handled = handleWorkbenchShortcut(
      {
        key: "j",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target: null,
      },
      makeActions({
        onRequestWorkbenchCommand: (commandId) => commands.push(commandId),
      }),
      false,
    );

    expect(handled).toBe(true);
    expect(commands).toEqual(["toggleBottomPanel"]);
  });

  test("an explicitly unassigned bottom-panel command does not handle Cmd+J", () => {
    const handled = handleWorkbenchShortcut(
      {
        key: "j",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: null,
      },
      makeActions({
        commandKeymapState: createCommandKeymapState({ toggleBottomPanel: [] }, "macOS"),
        onRequestWorkbenchCommand: () => {
          throw new Error("Explicitly unassigned commands must not execute");
        },
      }),
      true,
    );

    expect(handled).toBe(false);
  });

  test("a custom bottom-panel binding replaces the default binding", () => {
    const commands: string[] = [];
    const actions = makeActions({
      commandKeymapState: createCommandKeymapState({
        toggleBottomPanel: ["CmdOrCtrl+Alt+J"],
      }, "macOS"),
      onRequestWorkbenchCommand: (commandId) => commands.push(commandId),
    });

    const defaultHandled = handleWorkbenchShortcut({
      key: "j",
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
      altKey: false,
      target: null,
    }, actions, true);
    const customHandled = handleWorkbenchShortcut({
      key: "j",
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
      altKey: true,
      target: null,
    }, actions, true);

    expect(defaultHandled).toBe(false);
    expect(customHandled).toBe(true);
    expect(commands).toEqual(["toggleBottomPanel"]);
  });

  test("Cmd+N is reserved for the workbench shell new chat action", () => {
    let called = false;
    const actions = makeActions({
      onRequestNewWindow: () => {
        called = true;
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "n",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBe(false);
    expect(called).toBe(false);
  });

  test("Cmd+Shift+N requests a new window", () => {
    let called = false;
    const actions = makeActions({
      onRequestNewWindow: () => {
        called = true;
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "N",
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
        altKey: false,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(called).toBe(true);
  });

  test("Cmd+K opens the command palette even inside inputs", () => {
    let called = false;
    const actions = makeActions({
      onRequestCommandPalette: () => {
        called = true;
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "k",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: makeInputTarget(),
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(called).toBe(true);
  });

  test("Cmd+P opens Page search", () => {
    let mode = "";
    const actions = makeActions({
      onRequestCommandPalette: (request) => {
        mode = request?.mode ?? "";
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "P",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(mode).toBe("pages");
  });

  test("Cmd+P opens Page search inside editable targets", () => {
    let calls = 0;
    let mode = "";
    const actions = makeActions({
      onRequestCommandPalette: (request) => {
        calls += 1;
        mode = request?.mode ?? "";
      },
    });

    for (const target of [makeInputTarget(), makeComposerTarget(), makeNfmEditorTarget()]) {
      const handled = handleWorkbenchShortcut(
        {
          key: "p",
          ctrlKey: false,
          metaKey: true,
          shiftKey: false,
          altKey: false,
          target,
        },
        actions,
        true,
      );

      expect(handled).toBe(true);
      expect(mode).toBe("pages");
    }

    expect(calls).toBe(3);
  });

  test("Cmd+G opens chats search", () => {
    let mode = "";
    const actions = makeActions({
      onRequestCommandPalette: (request) => {
        mode = request?.mode ?? "";
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "g",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(mode).toBe("chats");
  });

  test("Cmd+B toggles the sidebar from non-editable shell focus", () => {
    let source = "";
    const handled = handleWorkbenchShortcut(
      {
        key: "b",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: null,
      },
      makeActions({
        onToggleSidebar: (nextSource) => {
          source = nextSource;
        },
      }),
      true,
    );

    expect(handled).toBe(true);
    expect(source).toBe("keyboard_shortcut");
  });

  test("Cmd+B toggles the sidebar from the composer with the Codex composer source", () => {
    let source = "";
    const handled = handleWorkbenchShortcut(
      {
        key: "B",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: makeComposerTarget(),
      },
      makeActions({
        onToggleSidebar: (nextSource) => {
          source = nextSource;
        },
      }),
      true,
    );

    expect(handled).toBe(true);
    expect(source).toBe("composer_sidebar_shortcut");
  });

  test("Cmd+B is left to editable non-composer surfaces", () => {
    let called = false;
    const handled = handleWorkbenchShortcut(
      {
        key: "b",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: makeNfmEditorTarget(),
      },
      makeActions({
        onToggleSidebar: () => {
          called = true;
        },
      }),
      true,
    );

    expect(handled).toBe(false);
    expect(called).toBe(false);
  });

  test("Cmd+F opens content search in conversation mode when the Threads stage is focused", () => {
    let contentSearchProjectId: string | null = null;
    let contentSearchDomain: string | undefined;
    let taskSearchCalled = false;
    const actions = makeActions({
      focusedStage: "threads",
      onRequestContentSearch: (projectId, preferredDomain) => {
        contentSearchProjectId = projectId;
        contentSearchDomain = preferredDomain;
      },
      onRequestTaskSearch: () => {
        taskSearchCalled = true;
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "f",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: makeInputTarget(),
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(contentSearchProjectId).toBe("a");
    expect(contentSearchDomain).toBe("conversation");
    expect(taskSearchCalled).toBe(false);
  });

  test("Cmd+F opens content search in diff mode when the Diffs stage is focused", () => {
    let contentSearchProjectId: string | null = null;
    let contentSearchDomain: string | undefined;
    let taskSearchCalled = false;
    const actions = makeActions({
      focusedStage: "files",
      onRequestContentSearch: (projectId, preferredDomain) => {
        contentSearchProjectId = projectId;
        contentSearchDomain = preferredDomain;
      },
      onRequestTaskSearch: () => {
        taskSearchCalled = true;
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "f",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: makeInputTarget(),
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(contentSearchProjectId).toBe("a");
    expect(contentSearchDomain).toBe("diff");
    expect(taskSearchCalled).toBe(false);
  });

  test("Cmd+F keeps task search blocked inside editable inputs outside the Threads stage", () => {
    let taskSearchCalled = false;
    const actions = makeActions({
      focusedStage: "db",
      onRequestTaskSearch: () => {
        taskSearchCalled = true;
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "f",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: makeInputTarget(),
      },
      actions,
      true,
    );

    expect(handled).toBe(false);
    expect(taskSearchCalled).toBe(false);
  });

  test("Cmd+[ navigates back even inside inputs", () => {
    let called = false;
    let source = "";
    const handled = handleWorkbenchShortcut(
      {
        key: "[",
        code: "BracketLeft",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: makeInputTarget(),
      },
      makeActions({
        navigateBack: (nextSource) => {
          called = true;
          source = nextSource;
        },
      }),
      true,
    );

    expect(handled).toBe(true);
    expect(called).toBe(true);
    expect(source).toBe("keyboard_shortcut");
  });

  test("Ctrl+] navigates forward on non-mac platforms", () => {
    let called = false;
    let source = "";
    const handled = handleWorkbenchShortcut(
      {
        key: "]",
        code: "BracketRight",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target: null,
      },
      makeActions({
        navigateForward: (nextSource) => {
          called = true;
          source = nextSource;
        },
      }),
      false,
    );

    expect(handled).toBe(true);
    expect(called).toBe(true);
    expect(source).toBe("keyboard_shortcut");
  });

  test("Cmd+comma toggles settings globally", () => {
    let called = false;
    const actions = makeActions({
      onRequestSettingsToggle: () => {
        called = true;
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: ",",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: makeInputTarget(),
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(called).toBe(true);
  });

  test("custom command keymap shortcut drives settings toggle", () => {
    let opened = false;
    const actions = makeActions({
      onRequestSettingsToggle: () => {
        opened = true;
      },
      commandKeymapState: createCommandKeymapState({ settings: ["CmdOrCtrl+Alt+,"] }, "macOS"),
    });

    const handled = handleWorkbenchShortcut(
      {
        key: ",",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: true,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(opened).toBe(true);
  });

  test("Cmd+Shift+slash opens keyboard shortcuts settings globally", () => {
    let called = false;
    const actions = makeActions({
      onRequestKeyboardShortcuts: () => {
        called = true;
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "/",
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
        altKey: false,
        target: makeInputTarget(),
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(called).toBe(true);
  });

  test("custom command keymap shortcut opens keyboard shortcuts settings", () => {
    let opened = false;
    const actions = makeActions({
      onRequestKeyboardShortcuts: () => {
        opened = true;
      },
      commandKeymapState: createCommandKeymapState({ showKeyboardShortcuts: ["CmdOrCtrl+Alt+/"] }, "macOS"),
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "/",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: true,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(opened).toBe(true);
  });

  test("Ctrl+Alt+M opens the process manager", () => {
    let opened = false;
    const actions = makeActions({
      onRequestProcessManager: () => {
        opened = true;
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "m",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: true,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(opened).toBe(true);
  });

  test("Cmd+H shifts the sliding window left", () => {
    let direction: -1 | 1 | null = null;
    const actions = makeActions({ shiftSlidingWindow: (_, next) => (direction = next) });

    const handled = handleWorkbenchShortcut(
      {
        key: "h",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(direction).toBe(-1);
  });

  test("Cmd+L is reserved for browser address focus", () => {
    let direction: -1 | 1 | null = null;
    const actions = makeActions({ shiftSlidingWindow: (_, next) => (direction = next) });

    const handled = handleWorkbenchShortcut(
      {
        key: "l",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBe(false);
    expect(direction).toBe(null);
  });

  test("Cmd+Alt+number switches to project index", () => {
    let selectedProjectIndex = -1;
    const actions = makeActions({ switchToProjectIndex: (index) => (selectedProjectIndex = index) });

    const handled = handleWorkbenchShortcut(
      {
        key: "2",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: true,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(selectedProjectIndex).toBe(1);
  });

  test("Cmd+Shift+P opens root command search", () => {
    let mode = "";
    const actions = makeActions({ onRequestCommandPalette: (request) => (mode = request?.mode ?? "") });

    const handled = handleWorkbenchShortcut(
      {
        key: "P",
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
        altKey: false,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(mode).toBe("root");
  });

  test("Cmd+F opens task search for active project", () => {
    let calledWithProjectId: string | null = null;
    const actions = makeActions({
      dbProjectId: "c",
      onRequestTaskSearch: (projectId) => {
        calledWithProjectId = projectId;
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "f",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(calledWithProjectId).toBe("c");
  });

  test("Cmd+F ignores editable targets", () => {
    let called = false;
    const target = makeInputTarget();
    const actions = makeActions({
      onRequestTaskSearch: () => {
        called = true;
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "f",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target,
      },
      actions,
      true,
    );

    expect(handled).toBe(false);
    expect(called).toBe(false);
  });

  test("Cmd+number switches stage inside NFM editor target", () => {
    let selectedIndex = -1;
    const target = makeNfmEditorTarget();
    const actions = makeActions({ switchToStageIndex: (_, index) => (selectedIndex = index) });

    const handled = handleWorkbenchShortcut(
      {
        key: "3",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target,
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(selectedIndex).toBe(2);
  });

  test("Ctrl+Tab cycles stages inside NFM editor target", () => {
    let direction: -1 | 1 | null = null;
    const target = makeNfmEditorTarget();
    const actions = makeActions({ focusAdjacentStage: (_, next) => (direction = next) });

    const handled = handleWorkbenchShortcut(
      {
        key: "Tab",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target,
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(direction).toBe(1);
  });

  test("Cmd+Shift+P opens root command search inside NFM editor target", () => {
    let mode = "";
    const target = makeNfmEditorTarget();
    const actions = makeActions({ onRequestCommandPalette: (request) => (mode = request?.mode ?? "") });

    const handled = handleWorkbenchShortcut(
      {
        key: "P",
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
        altKey: false,
        target,
      },
      actions,
      true,
    );

    expect(handled).toBe(true);
    expect(mode).toBe("root");
  });

  test("Cmd+Shift+P opens root command search inside plain inputs and composer targets", () => {
    let calls = 0;
    let lastMode = "";
    const actions = makeActions({
      onRequestCommandPalette: (request) => {
        calls += 1;
        lastMode = request?.mode ?? "";
      },
    });

    for (const target of [makeInputTarget(), makeComposerTarget()]) {
      const handled = handleWorkbenchShortcut(
        {
          key: "p",
          ctrlKey: false,
          metaKey: true,
          shiftKey: true,
          altKey: false,
          target,
        },
        actions,
        true,
      );

      expect(handled).toBe(true);
      expect(lastMode).toBe("root");
    }

    expect(calls).toBe(2);
  });

  test("Cmd+F remains unhandled inside NFM editor target", () => {
    let called = false;
    const target = makeNfmEditorTarget();
    const actions = makeActions({ onRequestTaskSearch: () => (called = true) });

    const handled = handleWorkbenchShortcut(
      {
        key: "f",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target,
      },
      actions,
      true,
    );

    expect(handled).toBe(false);
    expect(called).toBe(false);
  });

  test("Cmd+Alt+number remains unhandled inside NFM editor target", () => {
    let selectedProjectIndex = -1;
    const target = makeNfmEditorTarget();
    const actions = makeActions({ switchToProjectIndex: (index) => (selectedProjectIndex = index) });

    const handled = handleWorkbenchShortcut(
      {
        key: "1",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: true,
        target,
      },
      actions,
      true,
    );

    expect(handled).toBe(false);
    expect(selectedProjectIndex).toBe(-1);
  });

  test("Cmd+number remains blocked for plain input targets", () => {
    let selectedIndex = -1;
    const target = makeInputTarget();
    const actions = makeActions({ switchToStageIndex: (_, index) => (selectedIndex = index) });

    const handled = handleWorkbenchShortcut(
      {
        key: "1",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target,
      },
      actions,
      true,
    );

    expect(handled).toBe(false);
    expect(selectedIndex).toBe(-1);
  });

  test("ignores editable targets", () => {
    const target = makeInputTarget();
    const actions = makeActions();

    const handled = handleWorkbenchShortcut(
      {
        key: "Tab",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target,
      },
      actions,
      true,
    );

    expect(handled).toBe(false);
  });

  test("Cmd+H remains blocked for plain input targets", () => {
    let direction: -1 | 1 | null = null;
    const target = makeInputTarget();
    const actions = makeActions({ shiftSlidingWindow: (_, next) => (direction = next) });

    const handled = handleWorkbenchShortcut(
      {
        key: "h",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target,
      },
      actions,
      true,
    );

    expect(handled).toBe(false);
    expect(direction).toBe(null);
  });
});

describe("handleWorkbenchMouseNavigationShortcut", () => {
  test("classifies browser back and forward mouse buttons", () => {
    expect(resolveWorkbenchMouseNavigationShortcut({ button: 3 })).toBe("back");
    expect(resolveWorkbenchMouseNavigationShortcut({ button: 4 })).toBe("forward");
    expect(resolveWorkbenchMouseNavigationShortcut({ button: 1 })).toBe(null);
  });

  test("MouseBack runs the back navigation command source", () => {
    let source = "";
    const handled = handleWorkbenchMouseNavigationShortcut(
      { button: 3 },
      makeActions({
        navigateBack: (nextSource) => {
          source = nextSource;
        },
      }),
    );

    expect(handled).toBe(true);
    expect(source).toBe("mouse_back");
  });

  test("MouseForward runs the forward navigation command source", () => {
    let source = "";
    const handled = handleWorkbenchMouseNavigationShortcut(
      { button: 4 },
      makeActions({
        navigateForward: (nextSource) => {
          source = nextSource;
        },
      }),
    );

    expect(handled).toBe(true);
    expect(source).toBe("mouse_forward");
  });

  test("unhandled mouse buttons do not claim the event", () => {
    const handled = handleWorkbenchMouseNavigationShortcut(
      { button: 0 },
      makeActions(),
    );

    expect(handled).toBe(false);
  });
});

describe("useWorkbenchShortcuts", () => {
  test("handles the command palette shortcut before a focused target stops propagation", () => {
    let called = false;
    let targetSawDefaultPrevented = false;
    const actions = makeActions({
      onRequestCommandPalette: () => {
        called = true;
      },
    });
    const view = render(createElement(ShortcutHarness, { actions }));
    const input = document.createElement("input");
    input.addEventListener("keydown", (event) => {
      targetSawDefaultPrevented = event.defaultPrevented;
      event.stopPropagation();
    });
    document.body.appendChild(input);
    const isMac = navigator.platform.toUpperCase().includes("MAC");

    act(() => {
      fireEvent.keyDown(input, { key: "p", ctrlKey: !isMac, metaKey: isMac });
    });

    input.remove();
    view.unmount();
    expect(called).toBe(true);
    expect(targetSawDefaultPrevented).toBe(true);
  });
});
