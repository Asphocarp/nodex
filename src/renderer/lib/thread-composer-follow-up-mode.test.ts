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
      shortcut: "enter",
      key: "Enter",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    })).toBeTrue();

    expect(shouldInvertThreadInProgressFollowUpModeFromKeyDown({
      shortcut: "mod-enter",
      key: "Enter",
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
      altKey: false,
    })).toBeTrue();

    expect(shouldInvertThreadInProgressFollowUpModeFromKeyDown({
      shortcut: "mod-enter",
      key: "Enter",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    })).toBeFalse();
  });

  test("formats the primary and alternate shortcut labels like the Codex tooltip", () => {
    expect(getThreadComposerPrimaryShortcutLabel({
      shortcut: "enter",
      hasMultilinePrompt: false,
    })).toBe("Enter");
    expect(getThreadComposerPrimaryShortcutLabel({
      shortcut: "mod-enter",
      hasMultilinePrompt: true,
    })).toBe("Cmd/Ctrl+Enter");
    expect(getThreadComposerAlternateShortcutLabel("enter")).toBe("Cmd/Ctrl+Enter");
    expect(getThreadComposerAlternateShortcutLabel("mod-enter")).toBe("Cmd/Ctrl+Shift+Enter");
  });
});
