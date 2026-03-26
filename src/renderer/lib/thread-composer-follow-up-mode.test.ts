import { describe, expect, test } from "bun:test";
import {
  getThreadComposerAlternateShortcutLabel,
  getThreadComposerPrimaryShortcutLabel,
  resolveThreadInProgressFollowUpMode,
  shouldInvertThreadInProgressFollowUpModeFromKeyDown,
} from "./thread-composer-follow-up-mode";

describe("thread composer follow-up mode", () => {
  test("resolves the primary in-progress mode from the queue preference", () => {
    expect(resolveThreadInProgressFollowUpMode({ isQueueingEnabled: false })).toBe("steer");
    expect(resolveThreadInProgressFollowUpMode({ isQueueingEnabled: true })).toBe("queue");
  });

  test("resolves the inverted in-progress mode from the queue preference", () => {
    expect(resolveThreadInProgressFollowUpMode({
      invertInProgressFollowUpMode: true,
      isQueueingEnabled: false,
    })).toBe("queue");
    expect(resolveThreadInProgressFollowUpMode({
      invertInProgressFollowUpMode: true,
      isQueueingEnabled: true,
    })).toBe("steer");
  });

  test("matches Codex-style inverted shortcuts for both submit shortcut modes", () => {
    expect(shouldInvertThreadInProgressFollowUpModeFromKeyDown({
      enterBehavior: "enter",
      key: "Enter",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    })).toBeTrue();

    expect(shouldInvertThreadInProgressFollowUpModeFromKeyDown({
      enterBehavior: "cmdIfMultiline",
      key: "Enter",
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
      altKey: false,
    })).toBeTrue();

    expect(shouldInvertThreadInProgressFollowUpModeFromKeyDown({
      enterBehavior: "cmdIfMultiline",
      key: "Enter",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    })).toBeFalse();
  });

  test("formats the primary and alternate shortcut labels like the Codex tooltip", () => {
    expect(getThreadComposerPrimaryShortcutLabel({
      enterBehavior: "enter",
      hasMultilinePrompt: false,
    })).toBe("Enter");
    expect(getThreadComposerPrimaryShortcutLabel({
      enterBehavior: "cmdIfMultiline",
      hasMultilinePrompt: true,
    })).toBe("Cmd/Ctrl+Enter");
    expect(getThreadComposerAlternateShortcutLabel("enter")).toBe("Cmd/Ctrl+Enter");
    expect(getThreadComposerAlternateShortcutLabel("cmdIfMultiline")).toBe("Cmd/Ctrl+Shift+Enter");
  });
});
