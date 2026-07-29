import { describe, expect, test } from "vitest";

import { parseNativeRuntimeManifest } from "./native-runtime-manifest";

const manifest = {
  schemaVersion: 2,
  targetPlatform: "darwin",
  targetArch: "arm64",
  rustTarget: "aarch64-apple-darwin",
  minimumMacOS: "12.0",
  binaries: [
    {
      name: "nodex-core",
      bundlePath: "Resources/bin/nodex-core",
      sourceSha256: "a".repeat(64),
      sourceSize: 10,
      file: "Mach-O 64-bit executable arm64",
    },
    {
      name: "nodex",
      bundlePath: "Resources/bin/nodex",
      sourceSha256: "b".repeat(64),
      sourceSize: 11,
      file: "Mach-O 64-bit executable arm64",
    },
    {
      name: "nodex-browser-profile-helper",
      bundlePath: "Resources/bin/nodex-browser-profile-helper",
      sourceSha256: "c".repeat(64),
      sourceSize: 12,
      file: "Mach-O 64-bit executable arm64",
    },
    {
      name: "nodex-appshot-helper",
      bundlePath: "Resources/bin/nodex-appshot-helper",
      sourceSha256: "e".repeat(64),
      sourceSize: 14,
      file: "Mach-O 64-bit executable arm64",
    },
    {
      name: "nodex-service",
      bundlePath: "Helpers/Nodex Service.app/Contents/MacOS/nodex-service",
      sourceSha256: "d".repeat(64),
      sourceSize: 13,
      file: "Mach-O 64-bit executable arm64",
    },
  ],
};

describe("native runtime manifest", () => {
  test("accepts the complete architecture-bound package inventory", () => {
    expect(parseNativeRuntimeManifest(manifest)).toEqual(manifest);
  });

  test("rejects cross-architecture and duplicate package inventories", () => {
    expect(() => parseNativeRuntimeManifest({ ...manifest, rustTarget: "x86_64-apple-darwin" }))
      .toThrow("Rust target");
    expect(() => parseNativeRuntimeManifest({
      ...manifest,
      binaries: [
        manifest.binaries[0],
        manifest.binaries[0],
        manifest.binaries[1],
        manifest.binaries[2],
        manifest.binaries[3],
      ],
    })).toThrow("each required binary exactly once");
  });
});
