import { describe, expect, test } from "vitest";
import { readCuaRuntimeVersion } from "./vendor-browser-runtime";

describe("readCuaRuntimeVersion", () => {
  test("reads the unified CUA runtime version used by current desktop builds", () => {
    expect(readCuaRuntimeVersion({
      runtime_archive_version: "0.0.6/current",
      node_repl_archive_path: "legacy",
    })).toBe("0.0.6/current");
  });

  test("requires the current runtime manifest field", () => {
    expect(() => readCuaRuntimeVersion({
      node_repl_archive_path: "legacy",
    })).toThrow("CUA runtime version");
  });
});
