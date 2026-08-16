import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  LEGACY_SMART_PREFIX_PARSING_STORAGE_KEY,
  LEGACY_STRIP_SMART_PREFIX_STORAGE_KEY,
  TASK_SHORTHAND_PAGE_PROMOTION_STORAGE_KEY,
  readTaskShorthandPagePromotionEnabled,
  writeTaskShorthandPagePromotionEnabled,
} from "./page-promotion-preference";

describe("task shorthand Page promotion preference", () => {
  beforeAll(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("defaults new Profiles to enabled", () => {
    expect(readTaskShorthandPagePromotionEnabled()).toBe(true);
  });

  it.each([
    [null, null, true],
    ["true", "true", true],
    ["false", "true", false],
    ["true", "false", false],
    ["false", "false", false],
  ])("migrates legacy parse=%s strip=%s to %s", (parse, strip, expected) => {
    if (parse) localStorage.setItem(LEGACY_SMART_PREFIX_PARSING_STORAGE_KEY, parse);
    if (strip) localStorage.setItem(LEGACY_STRIP_SMART_PREFIX_STORAGE_KEY, strip);
    expect(readTaskShorthandPagePromotionEnabled()).toBe(expected);
    expect(localStorage.getItem(TASK_SHORTHAND_PAGE_PROMOTION_STORAGE_KEY)).toBe(String(expected));
    expect(localStorage.getItem(LEGACY_SMART_PREFIX_PARSING_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_STRIP_SMART_PREFIX_STORAGE_KEY)).toBeNull();
  });

  it("persists one coherent mode", () => {
    expect(writeTaskShorthandPagePromotionEnabled(false)).toBe(false);
    expect(readTaskShorthandPagePromotionEnabled()).toBe(false);
  });
});
