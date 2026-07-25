import { describe, expect, test } from "vitest";

import {
  assertLocalInstallDestination,
  parseLocalMacInstallOptions,
  type LocalMacInstallOptions,
} from "./install-local-macos";

const options = (
  overrides: Partial<LocalMacInstallOptions> = {},
): LocalMacInstallOptions => ({
  allowProductionDestination: false,
  appPath: "/tmp/Nodex.app",
  cliTargetPath: "/tmp/bin/nodex",
  destination: "/tmp/Nodex Dev.app",
  installCli: false,
  targetArch: "arm64",
  ...overrides,
});

describe("local macOS app installer", () => {
  test("infers the standard packaged app and defaults away from production", () => {
    const parsed = parseLocalMacInstallOptions(
      ["--install-cli"],
      "arm64",
      "/tmp/repository",
    );

    expect(parsed.appPath).toBe("/tmp/repository/dist/mac-arm64/Nodex.app");
    expect(parsed.destination).toBe("/Applications/Nodex Dev.app");
    expect(parsed.installCli).toBe(true);
    expect(parsed.targetArch).toBe("arm64");
  });

  test("uses the x64 output convention and accepts an explicit source override", () => {
    expect(parseLocalMacInstallOptions(
      ["--target-arch", "x64"],
      "arm64",
      "/tmp/repository",
    ).appPath).toBe("/tmp/repository/dist/mac/Nodex.app");

    expect(parseLocalMacInstallOptions([
      "--app-path",
      "/tmp/build/Nodex.app",
    ], "arm64", "/tmp/repository").appPath).toBe("/tmp/build/Nodex.app");
  });

  test("requires an explicit override for the production Applications path", () => {
    expect(() => assertLocalInstallDestination(options({
      destination: "/Applications/Nodex.app",
    }))).toThrow("--allow-production-destination");

    expect(() => assertLocalInstallDestination(options({
      allowProductionDestination: true,
      destination: "/Applications/Nodex.app",
    }))).not.toThrow();
  });

  test("rejects a source/destination collision and broad paths", () => {
    expect(() => assertLocalInstallDestination(options({
      destination: "/tmp/Nodex.app",
    }))).toThrow("must be different");
    expect(() => assertLocalInstallDestination(options({
      destination: "/Nodex.app",
    }))).toThrow("broad");
  });
});
