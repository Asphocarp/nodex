import type { ThreadPromptSubmitShortcut } from "./thread-panel-prompt-submit-shortcut";

export type ThreadInProgressFollowUpMode = "queue" | "steer";

export const THREAD_QUEUE_FOLLOW_UPS_STORAGE_KEY =
  "nodex-thread-composer-queue-follow-ups-v1";

interface ResolveThreadInProgressFollowUpModeInput {
  invertInProgressFollowUpMode?: boolean;
  isQueueingEnabled: boolean;
}

interface ThreadComposerInvertedShortcutInput {
  shortcut: ThreadPromptSubmitShortcut;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}

interface ThreadComposerPrimaryShortcutLabelInput {
  shortcut: ThreadPromptSubmitShortcut;
  hasMultilinePrompt: boolean;
}

export function readThreadQueueFollowUpsEnabled(): boolean {
  try {
    return localStorage.getItem(THREAD_QUEUE_FOLLOW_UPS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeThreadQueueFollowUpsEnabled(value: boolean): boolean {
  try {
    localStorage.setItem(THREAD_QUEUE_FOLLOW_UPS_STORAGE_KEY, String(value));
  } catch {
    // localStorage may be unavailable.
  }

  return value;
}

export function resolveThreadInProgressFollowUpMode(
  input: ResolveThreadInProgressFollowUpModeInput,
): ThreadInProgressFollowUpMode {
  if (input.invertInProgressFollowUpMode) {
    return input.isQueueingEnabled ? "steer" : "queue";
  }

  return input.isQueueingEnabled ? "queue" : "steer";
}

export function shouldInvertThreadInProgressFollowUpModeFromKeyDown(
  input: ThreadComposerInvertedShortcutInput,
): boolean {
  if (input.isComposing || input.key !== "Enter") return false;

  const hasModifier = input.ctrlKey || input.metaKey;
  if (!hasModifier || input.altKey) return false;

  if (input.shortcut === "enter") {
    return !input.shiftKey;
  }

  return input.shiftKey;
}

export function getThreadComposerPrimaryShortcutLabel(
  input: ThreadComposerPrimaryShortcutLabelInput,
): string {
  if (input.shortcut === "mod-enter" && input.hasMultilinePrompt) {
    return "Cmd/Ctrl+Enter";
  }

  return "Enter";
}

export function getThreadComposerAlternateShortcutLabel(
  shortcut: ThreadPromptSubmitShortcut,
): string {
  return shortcut === "mod-enter"
    ? "Cmd/Ctrl+Shift+Enter"
    : "Cmd/Ctrl+Enter";
}
