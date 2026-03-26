import type { ComposerEnterBehavior } from "./composer-enter-behavior";

export type ThreadInProgressFollowUpMode = "queue" | "steer";

export const THREAD_QUEUE_FOLLOW_UPS_STORAGE_KEY =
  "nodex-thread-composer-queue-follow-ups-v1";

interface ResolveThreadInProgressFollowUpModeInput {
  invertInProgressFollowUpMode?: boolean;
  isQueueingEnabled: boolean;
}

interface ThreadComposerInvertedShortcutInput {
  enterBehavior: ComposerEnterBehavior;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}

interface ThreadComposerPrimaryShortcutLabelInput {
  enterBehavior: ComposerEnterBehavior;
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

  if (input.enterBehavior === "enter") {
    return !input.shiftKey;
  }

  return input.shiftKey;
}

export function getThreadComposerPrimaryShortcutLabel(
  input: ThreadComposerPrimaryShortcutLabelInput,
): string {
  if (
    input.enterBehavior === "cmdIfMultiline"
    && input.hasMultilinePrompt
  ) {
    return "Cmd/Ctrl+Enter";
  }

  return "Enter";
}

export function getThreadComposerAlternateShortcutLabel(
  enterBehavior: ComposerEnterBehavior,
): string {
  return enterBehavior === "cmdIfMultiline"
    ? "Cmd/Ctrl+Shift+Enter"
    : "Cmd/Ctrl+Enter";
}
