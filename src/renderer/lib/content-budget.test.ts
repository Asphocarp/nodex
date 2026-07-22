import { describe, expect, test } from "vitest";
import {
  classifyContentBudget,
  countLinesUpTo,
  getUtf8ByteLength,
} from "./content-budget";

describe("content budgets", () => {
  test("counts UTF-8 bytes independently from JavaScript characters", () => {
    expect(getUtf8ByteLength("a🧪")).toBe(5);
  });

  test("stops line counting one line past the limit", () => {
    expect(countLinesUpTo("a\nb\nc\nd", 2)).toEqual({
      lineCount: 3,
      didExceedLimit: true,
    });
  });

  test("treats an empty value and a trailing newline using text-document line semantics", () => {
    expect(countLinesUpTo("", 1)).toEqual({ lineCount: 1, didExceedLimit: false });
    expect(countLinesUpTo("a\n", 2)).toEqual({ lineCount: 2, didExceedLimit: false });
  });

  test("accepts exact byte and line boundaries", () => {
    expect(classifyContentBudget({ value: "a\nb", maxBytes: 3, maxLines: 2 })).toEqual({
      kind: "withinBudget",
      utf8Bytes: 3,
      lineCount: 2,
    });
  });

  test("reports the first structural budget exceeded before byte measurement", () => {
    expect(classifyContentBudget({ value: "a\nb\nc", maxBytes: 1, maxLines: 2 })).toEqual({
      kind: "tooLarge",
      reason: "lines",
      lineCount: 3,
    });
  });

  test("reports byte and character overages explicitly", () => {
    expect(classifyContentBudget({ value: "🧪", maxBytes: 3 })).toEqual({
      kind: "tooLarge",
      reason: "bytes",
      utf8Bytes: 4,
    });
    expect(classifyContentBudget({ value: "ab", maxChars: 1 })).toEqual({
      kind: "tooLarge",
      reason: "characters",
    });
  });

  test("rejects an obviously oversized ASCII string before UTF-8 allocation", () => {
    expect(classifyContentBudget({ value: "abcd", maxBytes: 3 })).toEqual({
      kind: "tooLarge",
      reason: "bytes",
    });
  });
});
