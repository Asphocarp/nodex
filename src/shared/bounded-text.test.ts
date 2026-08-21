import { describe, expect, test } from "vitest";
import { appendTextTail } from "./bounded-text";

describe("appendTextTail", () => {
  test("keeps input at the exact limit without reporting truncation", () => {
    expect(appendTextTail({ current: "ab", delta: "cde", maxChars: 5 })).toEqual({
      text: "abcde",
      didTruncate: false,
    });
  });

  test("keeps the newest JavaScript characters when the combined value is over the limit", () => {
    expect(appendTextTail({ current: "abcd", delta: "ef", maxChars: 5 })).toEqual({
      text: "bcdef",
      didTruncate: true,
    });
  });

  test("slices an oversized delta without first joining it to the current tail", () => {
    const current = {
      toString: () => {
        throw new Error("current should not be coerced when delta owns the complete tail");
      },
    } as unknown as string;

    expect(appendTextTail({ current, delta: "0123456789", maxChars: 4 })).toEqual({
      text: "6789",
      didTruncate: true,
    });
  });

  test("preserves prior truncation after later short deltas", () => {
    expect(
      appendTextTail({
        current: "345",
        delta: "6",
        maxChars: 5,
        didTruncate: true,
      }),
    ).toEqual({
      text: "3456",
      didTruncate: true,
    });
  });

  test("treats zero as a valid limit", () => {
    expect(appendTextTail({ current: "", delta: "x", maxChars: 0 })).toEqual({
      text: "",
      didTruncate: true,
    });
  });

  test("uses JavaScript UTF-16 offset semantics", () => {
    expect(appendTextTail({ current: "a", delta: "🧪", maxChars: 2 })).toEqual({
      text: "🧪",
      didTruncate: true,
    });
  });

  test.each([-1, 1.5, Number.NaN])("rejects invalid limit %s", (maxChars) => {
    expect(() => appendTextTail({ current: "", delta: "", maxChars })).toThrow(RangeError);
  });
});
