import { describe, expect, test } from "vitest";

import {
  assertRustDataAuthorityEnvironment,
} from "../data-authority";

describe("data authority environment", () => {
  test("defaults to Rust and rejects the retired production selector", () => {
    expect(() => assertRustDataAuthorityEnvironment({})).not.toThrow();
    expect(() =>
      assertRustDataAuthorityEnvironment({ NODEX_CORE_BACKEND: " RUST " })
    ).not.toThrow();
    expect(() =>
      assertRustDataAuthorityEnvironment({ NODEX_CORE_BACKEND: "typescript" }),
    ).toThrow("Rust Core is the only production data authority");
    expect(() => assertRustDataAuthorityEnvironment({ NODEX_CORE_BACKEND: "auto" }))
      .toThrow("Rust Core is the only production data authority");
  });
});
