import { describe, expect, test } from "vitest";

import {
  createDataAuthoritySelection,
  resolveDataAuthorityBackend,
} from "../data-authority";

describe("data authority selection", () => {
  test("defaults to TypeScript and accepts only explicit supported backends", () => {
    expect(resolveDataAuthorityBackend({})).toBe("typescript");
    expect(resolveDataAuthorityBackend({ NODEX_CORE_BACKEND: " TypeScript " })).toBe(
      "typescript",
    );
    expect(resolveDataAuthorityBackend({ NODEX_CORE_BACKEND: " RUST " })).toBe("rust");
    expect(() =>
      resolveDataAuthorityBackend({ NODEX_CORE_BACKEND: "auto" }),
    ).toThrow('NODEX_CORE_BACKEND must be either "typescript" or "rust"');
  });

  test("freezes the first process-lifetime selection", () => {
    const selection = createDataAuthoritySelection();
    expect(selection.get()).toBeNull();
    expect(selection.select({ NODEX_CORE_BACKEND: "rust" })).toBe("rust");
    expect(selection.select({ NODEX_CORE_BACKEND: "rust" })).toBe("rust");
    expect(selection.get()).toBe("rust");
    expect(() =>
      selection.select({ NODEX_CORE_BACKEND: "typescript" }),
    ).toThrow("cannot switch its data authority from rust to typescript at runtime");
  });
});
