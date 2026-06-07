import { describe, expect, test } from "bun:test";
import {
  handleWorkbenchShortcut,
  type WorkbenchShortcutActions,
} from "./use-workbench-shortcuts";

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

function makeActions(overrides: Partial<WorkbenchShortcutActions> = {}): WorkbenchShortcutActions {
  return {
    spaces: [{ projectId: "a" }, { projectId: "b" }, { projectId: "c" }],
    dbProjectId: "a",
    focusedStage: "db",
    focusAdjacentStage: () => {},
    shiftSlidingWindow: () => {},
    switchToStageIndex: () => {},
    switchToProjectIndex: () => {},
    toggleTerminalPanel: () => {},
    onRequestCommandPalette: () => {},
    onRequestProjectPicker: () => {},
    onRequestTaskSearch: () => {},
    onRequestThreadSearch: () => {},
    onRequestSettingsToggle: () => {},
    ...overrides,
  };
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

    expect(handled).toBeTrue();
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

    expect(handled).toBeTrue();
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

    expect(handled).toBeTrue();
    expect(selectedIndex).toBe(2);
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

    expect(handled).toBeFalse();
    expect(selectedIndex).toBe(-1);
  });

  test("Cmd+J toggles terminal panel globally", () => {
    let calledWithProjectId: string | null = null;
    const actions = makeActions({
      dbProjectId: "b",
      toggleTerminalPanel: (projectId) => {
        calledWithProjectId = projectId;
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "j",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target: null,
      },
      actions,
      true,
    );

    expect(handled).toBeTrue();
    expect(calledWithProjectId).toBe("b");
  });

  test("Cmd+J still works inside editable targets", () => {
    let called = false;
    const target = makeInputTarget();
    const actions = makeActions({
      toggleTerminalPanel: () => {
        called = true;
      },
    });

    const handled = handleWorkbenchShortcut(
      {
        key: "j",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        target,
      },
      actions,
      true,
    );

    expect(handled).toBeTrue();
    expect(called).toBeTrue();
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

    expect(handled).toBeFalse();
    expect(called).toBeFalse();
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

    expect(handled).toBeTrue();
    expect(called).toBeTrue();
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

    expect(handled).toBeTrue();
    expect(called).toBeTrue();
  });

  test("Cmd+P also opens the command palette", () => {
    let called = false;
    const actions = makeActions({
      onRequestCommandPalette: () => {
        called = true;
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

    expect(handled).toBeTrue();
    expect(called).toBeTrue();
  });

  test("Cmd+F opens thread search when the Threads stage is focused", () => {
    let threadSearchProjectId: string | null = null;
    let taskSearchCalled = false;
    const actions = makeActions({
      focusedStage: "threads",
      onRequestThreadSearch: (projectId) => {
        threadSearchProjectId = projectId;
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

    expect(handled).toBeTrue();
    expect(threadSearchProjectId).toBe("a");
    expect(taskSearchCalled).toBeFalse();
  });

  test("Cmd+F opens diff search when the Diffs stage is focused", () => {
    let diffSearchProjectId: string | null = null;
    let taskSearchCalled = false;
    const actions = makeActions({
      focusedStage: "files",
      onRequestDiffSearch: (projectId) => {
        diffSearchProjectId = projectId;
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

    expect(handled).toBeTrue();
    expect(diffSearchProjectId).toBe("a");
    expect(taskSearchCalled).toBeFalse();
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

    expect(handled).toBeFalse();
    expect(taskSearchCalled).toBeFalse();
  });

  test("Cmd+[ navigates back even inside inputs", () => {
    let called = false;
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
        navigateBack: () => {
          called = true;
        },
      }),
      true,
    );

    expect(handled).toBeTrue();
    expect(called).toBeTrue();
  });

  test("Ctrl+] navigates forward on non-mac platforms", () => {
    let called = false;
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
        navigateForward: () => {
          called = true;
        },
      }),
      false,
    );

    expect(handled).toBeTrue();
    expect(called).toBeTrue();
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

    expect(handled).toBeTrue();
    expect(called).toBeTrue();
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

    expect(handled).toBeTrue();
    expect(direction).toBe(-1);
  });

  test("Cmd+L shifts the sliding window right", () => {
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

    expect(handled).toBeTrue();
    expect(direction).toBe(1);
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

    expect(handled).toBeTrue();
    expect(selectedProjectIndex).toBe(1);
  });

  test("Cmd+Shift+P opens command search with a > seed", () => {
    let query: string | undefined;
    const actions = makeActions({ onRequestCommandPalette: (initialQuery) => (query = initialQuery) });

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

    expect(handled).toBeTrue();
    expect(query).toBe(">");
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

    expect(handled).toBeTrue();
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

    expect(handled).toBeFalse();
    expect(called).toBeFalse();
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

    expect(handled).toBeTrue();
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

    expect(handled).toBeTrue();
    expect(direction).toBe(1);
  });

  test("Cmd+Shift+P opens command search inside NFM editor target", () => {
    let query: string | undefined;
    const target = makeNfmEditorTarget();
    const actions = makeActions({ onRequestCommandPalette: (initialQuery) => (query = initialQuery) });

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

    expect(handled).toBeTrue();
    expect(query).toBe(">");
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

    expect(handled).toBeFalse();
    expect(called).toBeFalse();
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

    expect(handled).toBeFalse();
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

    expect(handled).toBeFalse();
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

    expect(handled).toBeFalse();
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

    expect(handled).toBeFalse();
    expect(direction).toBe(null);
  });
});
