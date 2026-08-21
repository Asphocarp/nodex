import { describe, expect, test } from "vitest";
import { browserPluginNodeModuleDirs, readCuaRuntimeVersion } from "./vendor-browser-runtime";

test("declares the vendored Browser plugin dependency directory", () => {
  expect(browserPluginNodeModuleDirs()).toEqual([
    "runtime/lib/node_modules",
    "marketplace/plugins/browser/node_modules",
  ]);
});

describe("readCuaRuntimeVersion", () => {
  test("reads the unified CUA runtime version used by current desktop builds", () => {
    expect(
      readCuaRuntimeVersion({
        runtime_archive_version: "0.0.6/current",
        node_repl_archive_path: "legacy",
      }),
    ).toBe("0.0.6/current");
  });

  test("requires the current runtime manifest field", () => {
    expect(() =>
      readCuaRuntimeVersion({
        node_repl_archive_path: "legacy",
      }),
    ).toThrow("CUA runtime version");
  });
});
