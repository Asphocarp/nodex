import { describe, expect, test } from "vitest";
import { replaceEqualDeep } from "./structural-sharing";

describe("replaceEqualDeep", () => {
  test("returns the previous reference for a semantically equal value", () => {
    const prev = {
      order: ["a", "b"],
      byId: { a: { title: "Alpha", tags: [1, 2] }, b: { title: "Beta", tags: [] } },
      count: 2,
    };
    const next = {
      order: ["a", "b"],
      byId: { a: { title: "Alpha", tags: [1, 2] }, b: { title: "Beta", tags: [] } },
      count: 2,
    };

    expect(replaceEqualDeep(prev, next)).toBe(prev);
  });

  test("shares unchanged subtrees when part of the value changes", () => {
    const prev = {
      unchanged: { deep: ["x", "y"] },
      changed: { value: 1 },
    };
    const next = {
      unchanged: { deep: ["x", "y"] },
      changed: { value: 2 },
    };

    const result = replaceEqualDeep(prev, next);
    expect(result).not.toBe(prev);
    expect(result.unchanged).toBe(prev.unchanged);
    expect(result.changed).toEqual({ value: 2 });
  });

  test("shares equal array members across a length change", () => {
    const prev = [{ id: "a" }, { id: "b" }];
    const next = [{ id: "a" }, { id: "b" }, { id: "c" }];

    const result = replaceEqualDeep(prev, next);
    expect(result).not.toBe(prev);
    expect(result[0]).toBe(prev[0]);
    expect(result[1]).toBe(prev[1]);
    expect(result[2]).toEqual({ id: "c" });
  });

  test("detects key removal as a change", () => {
    const prev = { a: 1, b: 2 };
    const next = { a: 1 };

    const result = replaceEqualDeep<Record<string, number>>(prev, next);
    expect(result).not.toBe(prev);
    expect(result).toEqual({ a: 1 });
  });

  test("keeps the next value for non-plain objects that are not identical", () => {
    const prevDate = new Date("2026-01-01T00:00:00.000Z");
    const nextDate = new Date("2026-01-01T00:00:00.000Z");

    expect(replaceEqualDeep(prevDate, nextDate)).toBe(nextDate);
    expect(replaceEqualDeep(prevDate, prevDate)).toBe(prevDate);
  });

  test("handles primitive and null transitions", () => {
    expect(replaceEqualDeep(null, null)).toBe(null);
    expect(replaceEqualDeep(1, 1)).toBe(1);
    expect(replaceEqualDeep({ a: 1 }, null)).toBe(null);
    expect(replaceEqualDeep(null, { a: 1 })).toEqual({ a: 1 });
  });
});
