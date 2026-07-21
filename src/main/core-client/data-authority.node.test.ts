import { describe, expect, test } from "vitest";

import {
  createDataAuthoritySelection,
  resolveDataAuthorityBackend,
} from "../data-authority";

describe("data authority selection", () => {
  test("defaults to Rust and rejects the retired production selector", () => {
    expect(resolveDataAuthorityBackend({})).toBe("rust");
    expect(resolveDataAuthorityBackend({ NODEX_CORE_BACKEND: " RUST " })).toBe("rust");
    expect(() =>
      resolveDataAuthorityBackend({ NODEX_CORE_BACKEND: "typescript" }),
    ).toThrow("Rust Core is the only production data authority");
    expect(() => resolveDataAuthorityBackend({ NODEX_CORE_BACKEND: "auto" }))
      .toThrow("Rust Core is the only production data authority");
  });

  test("freezes the first process-lifetime selection", () => {
    const selection = createDataAuthoritySelection();
    expect(selection.get()).toBeNull();
    expect(selection.select({ NODEX_CORE_BACKEND: "rust" })).toBe("rust");
    expect(selection.select({ NODEX_CORE_BACKEND: "rust" })).toBe("rust");
    expect(selection.get()).toBe("rust");
    expect(() =>
      selection.select({ NODEX_CORE_BACKEND: "typescript" }),
    ).toThrow("Rust Core is the only production data authority");
  });
});
