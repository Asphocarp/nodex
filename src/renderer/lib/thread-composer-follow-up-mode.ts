import type { ComposerEnterBehavior } from "./composer-enter-behavior";

export type ThreadInProgressFollowUpMode = "queue" | "steer";
export type ThreadComposerShortcutAccelerator =
  | "Enter"
  | "CmdOrCtrl+Enter"
  | "CmdOrCtrl+Shift+Enter";

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

interface ResolveShortcutKeycapTokensInput {
  accelerator: ThreadComposerShortcutAccelerator;
  isMacPlatform: boolean;
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

export function resolveThreadComposerPrimaryShortcutAccelerator(
  input: ThreadComposerPrimaryShortcutLabelInput,
): ThreadComposerShortcutAccelerator {
  if (
    input.enterBehavior === "cmdIfMultiline"
    && input.hasMultilinePrompt
  ) {
    return "CmdOrCtrl+Enter";
  }

  return "Enter";
}

export function resolveThreadComposerAlternateShortcutAccelerator(
  enterBehavior: ComposerEnterBehavior,
): ThreadComposerShortcutAccelerator {
  return enterBehavior === "cmdIfMultiline"
    ? "CmdOrCtrl+Shift+Enter"
    : "CmdOrCtrl+Enter";
}

export function resolveShortcutKeycapTokens(
  input: ResolveShortcutKeycapTokensInput,
): string[] {
  if (input.accelerator === "Enter") return ["Enter"];

  if (input.accelerator === "CmdOrCtrl+Enter") {
    return input.isMacPlatform ? ["⌘", "Enter"] : ["Ctrl", "Enter"];
  }

  return input.isMacPlatform ? ["⌘", "⇧", "Enter"] : ["Ctrl", "Shift", "Enter"];
}
