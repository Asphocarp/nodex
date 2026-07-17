import { useEffect } from "react";
import type { StageId } from "./use-workbench-state";
import {
  TOGGLE_BOTTOM_PANEL_COMMAND_ID,
  type WorkbenchCommandId,
} from "../../shared/workbench-commands";
import type {
  WorkbenchNavigationCommandSource,
  WorkbenchSidebarToggleCommandSource,
  WorkbenchThreadRenameCommandSource,
} from "../../shared/window-navigation";
import type { ContentSearchDomain } from "@/features/content-search/content-search-context";
import {
  createCommandKeymapState,
  matchesKeyboardEventToCommand,
  matchesMouseEventToCommand,
  type CommandKeymapState,
  type KeyboardShortcutEventLike,
} from "../../shared/command-keybindings";
import type { CommandMenuOpenRequest } from "./command-palette";

export interface WorkbenchShortcutActions {
  projectRefs: { projectId: string }[];
  dbProjectId: string;
  focusedStage: StageId;
  focusAdjacentStage: (projectId: string, direction: -1 | 1) => void;
  shiftSlidingWindow: (projectId: string, direction: -1 | 1) => void;
  switchToStageIndex: (projectId: string, index: number) => void;
  switchToProjectIndex: (index: number) => void;
  onRequestNewWindow?: () => void;
  onRequestCommandPalette?: (request?: CommandMenuOpenRequest) => void;
  onRequestProjectPicker?: () => void;
  onRequestTaskSearch?: (projectId: string) => void;
  onRequestContentSearch?: (projectId: string, preferredDomain?: ContentSearchDomain) => void;
  onRequestSettingsToggle?: () => void;
  onRequestKeyboardShortcuts?: () => void;
  onRequestProcessManager?: () => void;
  onRequestWorkbenchCommand?: (commandId: WorkbenchCommandId) => void;
  navigateBack?: (source: WorkbenchNavigationCommandSource) => void;
  navigateForward?: (source: WorkbenchNavigationCommandSource) => void;
  onToggleSidebar?: (source: WorkbenchSidebarToggleCommandSource) => void;
  onRequestRenameThread?: (source: WorkbenchThreadRenameCommandSource) => void;
  commandKeymapState?: CommandKeymapState | null;
}

export function shouldUseRendererWorkbenchCommandFallback(
  hasNativeWorkbenchCommandIngress: boolean,
): boolean {
  return !hasNativeWorkbenchCommandIngress;
}

const EDITOR_SURFACE_SELECTOR = ".nfm-editor, .bn-editor, .bn-container";
const COMPOSER_SURFACE_SELECTOR = "[data-composer-prompt-frame]";
const TERMINAL_SURFACE_SELECTOR = "[data-codex-terminal]";

interface ShortcutTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => Element | null;
}

type WorkbenchKeyboardEventLike = KeyboardShortcutEventLike & {
  target: EventTarget | null;
};

function isTextInputTarget(target: EventTarget | null): boolean {
  const element = target as ShortcutTargetLike | null;
  if (!element?.tagName) return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA";
}

function isEditorSurfaceTarget(target: EventTarget | null): boolean {
  const element = target as ShortcutTargetLike | null;
  if (!element?.closest) return false;
  return Boolean(element.closest(EDITOR_SURFACE_SELECTOR));
}

function isComposerSurfaceTarget(target: EventTarget | null): boolean {
  const element = target as ShortcutTargetLike | null;
  if (!element?.closest) return false;
  return Boolean(element.closest(COMPOSER_SURFACE_SELECTOR));
}

function isTerminalSurfaceTarget(target: EventTarget | null): boolean {
  const element = target as ShortcutTargetLike | null;
  if (!element?.closest) return false;
  return Boolean(element.closest(TERMINAL_SURFACE_SELECTOR));
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as ShortcutTargetLike | null;
  if (!element) return false;
  return Boolean(element.isContentEditable) || isTextInputTarget(target) || isEditorSurfaceTarget(target);
}

function fallbackCommandKeymapState(isMac: boolean): CommandKeymapState {
  return createCommandKeymapState({}, isMac ? "macOS" : "windows");
}

function matchesCommandShortcut(
  e: KeyboardShortcutEventLike,
  actions: WorkbenchShortcutActions,
  commandId: string,
  isMac: boolean,
): boolean {
  return matchesKeyboardEventToCommand(e, actions.commandKeymapState ?? fallbackCommandKeymapState(isMac), commandId);
}

export function handleWorkbenchShortcut(
  e: WorkbenchKeyboardEventLike,
  actions: WorkbenchShortcutActions,
  isMac: boolean,
): boolean {
  const modifier = isMac ? e.metaKey : e.ctrlKey;
  const targetIsEditable = isEditableTarget(e.target);
  const targetIsEditorSurface = isEditorSurfaceTarget(e.target);
  const targetIsComposerSurface = isComposerSurfaceTarget(e.target);
  if (isTerminalSurfaceTarget(e.target)) return false;

  if (matchesCommandShortcut(e, actions, "newWindow", isMac)) {
    actions.onRequestNewWindow?.();
    return true;
  }

  if (matchesCommandShortcut(e, actions, "openCommandMenu", isMac)) {
    actions.onRequestCommandPalette?.({ mode: "root" });
    return true;
  }

  if (matchesCommandShortcut(e, actions, "searchChats", isMac)) {
    actions.onRequestCommandPalette?.({ mode: "chats" });
    return true;
  }

  if (matchesCommandShortcut(e, actions, "searchPages", isMac)) {
    actions.onRequestCommandPalette?.({ mode: "pages" });
    return true;
  }

  if (matchesCommandShortcut(e, actions, "navigateBack", isMac)) {
    actions.navigateBack?.("keyboard_shortcut");
    return true;
  }

  if (matchesCommandShortcut(e, actions, "navigateForward", isMac)) {
    actions.navigateForward?.("keyboard_shortcut");
    return true;
  }

  if (matchesCommandShortcut(e, actions, "toggleSidebar", isMac)) {
    if (targetIsEditable && !targetIsComposerSurface) return false;
    actions.onToggleSidebar?.(targetIsComposerSurface ? "composer_sidebar_shortcut" : "keyboard_shortcut");
    return true;
  }

  if (matchesCommandShortcut(e, actions, "renameThread", isMac)) {
    if (!actions.onRequestRenameThread) return false;
    actions.onRequestRenameThread("keyboard_shortcut");
    return true;
  }

  if (matchesCommandShortcut(e, actions, "settings", isMac) && actions.onRequestSettingsToggle) {
    actions.onRequestSettingsToggle();
    return true;
  }

  if (matchesCommandShortcut(e, actions, "showKeyboardShortcuts", isMac) && actions.onRequestKeyboardShortcuts) {
    actions.onRequestKeyboardShortcuts();
    return true;
  }

  if (matchesCommandShortcut(e, actions, "openProcessManager", isMac) && actions.onRequestProcessManager) {
    actions.onRequestProcessManager();
    return true;
  }

  if (matchesCommandShortcut(e, actions, TOGGLE_BOTTOM_PANEL_COMMAND_ID, isMac)) {
    if (!actions.onRequestWorkbenchCommand) return false;
    actions.onRequestWorkbenchCommand(TOGGLE_BOTTOM_PANEL_COMMAND_ID);
    return true;
  }

  if (matchesCommandShortcut(e, actions, "focusBrowserAddressBar", isMac)) {
    return false;
  }

  if (modifier && !e.altKey && !e.shiftKey && (e.key === "h" || e.key === "H" || e.key === "l" || e.key === "L")) {
    if (targetIsEditable && !targetIsEditorSurface) return false;
    actions.shiftSlidingWindow(actions.dbProjectId, e.key === "h" || e.key === "H" ? -1 : 1);
    return true;
  }

  if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Tab") {
    if (targetIsEditable && !targetIsEditorSurface) return false;
    actions.focusAdjacentStage(actions.dbProjectId, e.shiftKey ? -1 : 1);
    return true;
  }

  if (!modifier) return false;

  if (e.altKey && e.key >= "1" && e.key <= "9") {
    if (targetIsEditable) return false;
    const index = Number.parseInt(e.key, 10) - 1;
    if (index < actions.projectRefs.length) {
      actions.switchToProjectIndex(index);
    }
    return true;
  }

  if (!e.altKey && e.key >= "1" && e.key <= "4") {
    if (targetIsEditable && !targetIsEditorSurface) return false;
    const index = Number.parseInt(e.key, 10) - 1;
    actions.switchToStageIndex(actions.dbProjectId, index);
    return true;
  }

  if (matchesCommandShortcut(e, actions, "findInThread", isMac)) {
    if (actions.focusedStage === "threads" && actions.onRequestContentSearch) {
      actions.onRequestContentSearch(actions.dbProjectId, "conversation");
      return true;
    }

    if (actions.focusedStage === "files" && actions.onRequestContentSearch) {
      actions.onRequestContentSearch(actions.dbProjectId, "diff");
      return true;
    }

    if (actions.focusedStage === "pages" && actions.onRequestContentSearch) {
      actions.onRequestContentSearch(actions.dbProjectId);
      return true;
    }

    if (!actions.onRequestTaskSearch || targetIsEditable) return false;
    actions.onRequestTaskSearch(actions.dbProjectId);
    return true;
  }

  return false;
}

export function resolveWorkbenchMouseNavigationShortcut(
  e: Pick<MouseEvent, "button">,
  commandKeymapState?: CommandKeymapState | null,
): "back" | "forward" | null {
  const state = commandKeymapState ?? createCommandKeymapState();
  if (matchesMouseEventToCommand(e, state, "navigateBack")) return "back";
  if (matchesMouseEventToCommand(e, state, "navigateForward")) return "forward";
  return null;
}

export function handleWorkbenchMouseNavigationShortcut(
  e: Pick<MouseEvent, "button">,
  actions: Pick<WorkbenchShortcutActions, "navigateBack" | "navigateForward" | "commandKeymapState">,
): boolean {
  const direction = resolveWorkbenchMouseNavigationShortcut(e, actions.commandKeymapState);
  if (direction === "back") {
    if (!actions.navigateBack) return false;
    actions.navigateBack("mouse_back");
    return true;
  }

  if (direction === "forward") {
    if (!actions.navigateForward) return false;
    actions.navigateForward("mouse_forward");
    return true;
  }

  return false;
}

export function useWorkbenchShortcuts(actions: WorkbenchShortcutActions): void {
  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");

    const onKeyDown = (e: KeyboardEvent) => {
      if (!handleWorkbenchShortcut(e, actions, isMac)) return;
      e.preventDefault();
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!handleWorkbenchMouseNavigationShortcut(e, actions)) return;
      e.preventDefault();
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [actions]);
}
