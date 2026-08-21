import path from "node:path";
import { describe, expect, test } from "vitest";

import { resolveBrowserProfileHelperExecutable } from "./browser-profile-helper-client";

describe("resolveBrowserProfileHelperExecutable", () => {
  test("resolves explicit, packaged, and development executables", () => {
    expect(
      resolveBrowserProfileHelperExecutable({
        environment: {
          NODEX_BROWSER_PROFILE_HELPER_EXECUTABLE: "/opt/nodex/bin/profile-helper",
        },
        isPackaged: false,
        resourcesPath: "/electron/resources",
      }),
    ).toBe("/opt/nodex/bin/profile-helper");
    expect(
      resolveBrowserProfileHelperExecutable({
        environment: {},
        isPackaged: true,
        resourcesPath: "/Applications/Nodex.app/Contents/Resources",
      }),
    ).toBe("/Applications/Nodex.app/Contents/Resources/bin/nodex-browser-profile-helper");
    expect(
      resolveBrowserProfileHelperExecutable({
        environment: {},
        isPackaged: false,
        repositoryRoot: "/work/nodex",
        resourcesPath: "/electron/resources",
      }),
    ).toBe(path.join("/work/nodex", "target/debug/nodex-browser-profile-helper"));
  });

  test("rejects a relative executable override", () => {
    expect(() =>
      resolveBrowserProfileHelperExecutable({
        environment: {
          NODEX_BROWSER_PROFILE_HELPER_EXECUTABLE: "target/release/profile-helper",
        },
        isPackaged: false,
        resourcesPath: "/electron/resources",
      }),
    ).toThrow("NODEX_BROWSER_PROFILE_HELPER_EXECUTABLE must be absolute");
  });
});
