import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseArguments, resolveDisposableProfile } from "./core-failure-matrix";

describe("Core failure-matrix boundaries", () => {
  test("accepts one explicit disposable Profile", () => {
    expect(parseArguments([
      "--",
      "--profile",
      ".generated/rust-core-migration/failure-profile",
    ])).toEqual({
      profile: ".generated/rust-core-migration/failure-profile",
    });
    expect(() => parseArguments([])).toThrow("usage: core:failure-matrix");
  });

  test("rejects Profiles outside the generated migration root", () => {
    const root = path.resolve("/workspace/nodex");
    expect(() => resolveDisposableProfile(root, "../real-profile"))
      .toThrow("must stay beneath");
  });
});
