import { describe, expect, test } from "bun:test";
import {
  resolveThreadInProgressFollowUpMode,
  resolveShortcutKeycapTokens,
  resolveThreadComposerAlternateShortcutAccelerator,
  resolveThreadComposerPrimaryShortcutAccelerator,
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

  test("resolves the primary and alternate accelerators like the Codex tooltip", () => {
    expect(resolveThreadComposerPrimaryShortcutAccelerator({
      enterBehavior: "enter",
      hasMultilinePrompt: false,
    })).toBe("Enter");
    expect(resolveThreadComposerPrimaryShortcutAccelerator({
      enterBehavior: "cmdIfMultiline",
      hasMultilinePrompt: true,
    })).toBe("CmdOrCtrl+Enter");
    expect(resolveThreadComposerAlternateShortcutAccelerator("enter")).toBe("CmdOrCtrl+Enter");
    expect(resolveThreadComposerAlternateShortcutAccelerator("cmdIfMultiline")).toBe("CmdOrCtrl+Shift+Enter");
  });

  test("formats mac keycap tokens like the Codex tooltip", () => {
    expect(JSON.stringify(resolveShortcutKeycapTokens({
      accelerator: "Enter",
      isMacPlatform: true,
    }))).toBe(JSON.stringify(["Enter"]));
    expect(JSON.stringify(resolveShortcutKeycapTokens({
      accelerator: "CmdOrCtrl+Enter",
      isMacPlatform: true,
    }))).toBe(JSON.stringify(["⌘", "Enter"]));
    expect(JSON.stringify(resolveShortcutKeycapTokens({
      accelerator: "CmdOrCtrl+Shift+Enter",
      isMacPlatform: true,
    }))).toBe(JSON.stringify(["⌘", "⇧", "Enter"]));
  });
});
