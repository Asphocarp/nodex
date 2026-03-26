import { describe, expect, test } from "bun:test";
import {
  COMPOSER_ENTER_BEHAVIOR_STORAGE_KEY,
  DEFAULT_COMPOSER_ENTER_BEHAVIOR,
  normalizeComposerEnterBehavior,
  readComposerEnterBehavior,
  shouldSubmitComposerPromptFromKeyDown,
  writeComposerEnterBehavior,
} from "./composer-enter-behavior";

const storageMap = new Map<string, string>();

const mockStorage = {
  getItem(key: string): string | null {
    return storageMap.has(key) ? storageMap.get(key) ?? null : null;
  },
  setItem(key: string, value: string): void {
    storageMap.set(key, value);
  },
  removeItem(key: string): void {
    storageMap.delete(key);
  },
  clear(): void {
    storageMap.clear();
  },
};

function withMockLocalStorage(run: () => void): void {
  const storageGlobal = globalThis as { localStorage?: typeof mockStorage };
  const previousLocalStorage = storageGlobal.localStorage;
  storageGlobal.localStorage = mockStorage;
  try {
    run();
  } finally {
    if (previousLocalStorage) {
      storageGlobal.localStorage = previousLocalStorage;
      return;
    }
    delete storageGlobal.localStorage;
  }
}

describe("composer enter behavior", () => {
  test("defaults to enter and normalizes known values", () => {
    withMockLocalStorage(() => {
      mockStorage.clear();
      expect(normalizeComposerEnterBehavior(undefined)).toBe(
        DEFAULT_COMPOSER_ENTER_BEHAVIOR,
      );
      expect(normalizeComposerEnterBehavior("enter")).toBe("enter");
      expect(normalizeComposerEnterBehavior("cmdIfMultiline")).toBe(
        "cmdIfMultiline",
      );
      expect(normalizeComposerEnterBehavior("cmd-if-multiline")).toBe(
        "cmdIfMultiline",
      );
      expect(normalizeComposerEnterBehavior("unexpected")).toBe(
        DEFAULT_COMPOSER_ENTER_BEHAVIOR,
      );
    });
  });

  test("reads and writes persisted values", () => {
    withMockLocalStorage(() => {
      mockStorage.clear();
      expect(readComposerEnterBehavior()).toBe(
        DEFAULT_COMPOSER_ENTER_BEHAVIOR,
      );

      const persisted = writeComposerEnterBehavior("cmdIfMultiline");
      expect(persisted).toBe("cmdIfMultiline");
      expect(
        mockStorage.getItem(COMPOSER_ENTER_BEHAVIOR_STORAGE_KEY),
      ).toBe("cmdIfMultiline");
      expect(readComposerEnterBehavior()).toBe("cmdIfMultiline");
    });
  });

  test("submits on plain enter in enter mode", () => {
    expect(
      shouldSubmitComposerPromptFromKeyDown({
        enterBehavior: "enter",
        hasMultilinePrompt: false,
        key: "Enter",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeTrue();
    expect(
      shouldSubmitComposerPromptFromKeyDown({
        enterBehavior: "enter",
        hasMultilinePrompt: false,
        key: "Enter",
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      }),
    ).toBeFalse();
  });

  test("uses cmd-enter as the primary submit for multiline cmdIfMultiline drafts", () => {
    expect(
      shouldSubmitComposerPromptFromKeyDown({
        enterBehavior: "cmdIfMultiline",
        hasMultilinePrompt: true,
        key: "Enter",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeFalse();
    expect(
      shouldSubmitComposerPromptFromKeyDown({
        enterBehavior: "cmdIfMultiline",
        hasMultilinePrompt: true,
        key: "Enter",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeTrue();
  });

  test("keeps enter as the primary submit for single-line cmdIfMultiline drafts", () => {
    expect(
      shouldSubmitComposerPromptFromKeyDown({
        enterBehavior: "cmdIfMultiline",
        hasMultilinePrompt: false,
        key: "Enter",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeTrue();
  });

  test("never submits while composing", () => {
    expect(
      shouldSubmitComposerPromptFromKeyDown({
        enterBehavior: "enter",
        hasMultilinePrompt: false,
        key: "Enter",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        isComposing: true,
      }),
    ).toBeFalse();
  });
});
