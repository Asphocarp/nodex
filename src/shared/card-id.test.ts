import { describe, expect, test } from "vitest";
import { createUuidV7, createUuidV7FromTimestamp, isUuidV7 } from "./card-id";

describe("card-id", () => {
  test("creates canonical lowercase UUID-v7 values", () => {
    const value = createUuidV7();
    expect(isUuidV7(value)).toBe(true);
    expect(value).toBe(value.toLowerCase());
    expect(isUuidV7(value.toUpperCase())).toBe(false);
  });

  test("creates monotonic timestamp-derived UUID-v7 values", () => {
    const first = createUuidV7FromTimestamp(1_762_400_000_000, 0);
    const second = createUuidV7FromTimestamp(1_762_400_000_000, 1);
    const third = createUuidV7FromTimestamp(1_762_400_000_001, 0);

    expect(isUuidV7(first)).toBe(true);
    expect(isUuidV7(second)).toBe(true);
    expect(isUuidV7(third)).toBe(true);
    expect(first < second).toBe(true);
    expect(second < third).toBe(true);
  });

  test("rejects non-v7 values", () => {
    expect(isUuidV7("not-a-uuid")).toBe(false);
    expect(isUuidV7("550e8400-e29b-41d4-a716-446655440000")).toBe(false);
  });
});
