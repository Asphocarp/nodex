import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

import { createPackagedMacAppUpdater, parseSparkleRuntimeConfig } from "./sparkle-mac-app-updater";
import { parseSparkleNativeEvent } from "./sparkle-native-binding";

const runtimeManifest = (overrides: Record<string, unknown> = {}) => ({
  architecture: "arm64",
  artifacts: {},
  buildChannel: "stable",
  feedUrls: {
    stable: "https://nodex.jyu.app/updates/stable/arm64/appcast.xml",
    nightly: "https://nodex.jyu.app/updates/nightly/arm64/appcast.xml",
  },
  minimumMacOS: "12.0",
  publicKey: "YNySLZ74gjVAOpEdMo9OOEPvuTEMZf8fMnI+oQD7Ifs=",
  schemaVersion: 3,
  sparkleArchiveSha256: "ce89daf967db1e1893ed3ebd67575ed82d3902563e3191ca92aaec9164fbdef9",
  sparkleVersion: "2.9.4",
  ...overrides,
});

describe("packaged Sparkle runtime boundary", () => {
  test("accepts only the pinned architecture-specific stable feed", () => {
    expect(parseSparkleRuntimeConfig(runtimeManifest())).toMatchObject({
      architecture: "arm64",
      buildChannel: "stable",
      sparkleVersion: "2.9.4",
    });
    expect(() =>
      parseSparkleRuntimeConfig(
        runtimeManifest({
          feedUrls: {
            stable: "https://nodex.jyu.app/updates/stable/x64/appcast.xml",
            nightly: "https://nodex.jyu.app/updates/nightly/arm64/appcast.xml",
          },
        }),
      ),
    ).toThrow("does not match");
    expect(() =>
      parseSparkleRuntimeConfig(
        runtimeManifest({
          sparkleVersion: "2.9.5",
        }),
      ),
    ).toThrow("identity is invalid");
  });

  test("allows a disabled local build only when it has no feed", () => {
    expect(
      parseSparkleRuntimeConfig(
        runtimeManifest({
          buildChannel: "disabled",
          feedUrls: null,
        }),
      ),
    ).toMatchObject({ buildChannel: "disabled", feedUrls: null });
    expect(() =>
      parseSparkleRuntimeConfig(
        runtimeManifest({
          buildChannel: "disabled",
        }),
      ),
    ).toThrow("does not match");
  });

  test("returns before native addon loading for a disabled package", () => {
    const resourcesPath = mkdtempSync(join(tmpdir(), "nodex-disabled-sparkle-"));
    try {
      mkdirSync(join(resourcesPath, "native"));
      writeFileSync(
        join(resourcesPath, "native", "sparkle-runtime.json"),
        JSON.stringify(runtimeManifest({ buildChannel: "disabled", feedUrls: null })),
      );

      expect(
        createPackagedMacAppUpdater({
          applicationBundlePath: "/missing/Nodex.app",
          architecture: "arm64",
          resourcesPath,
        }),
      ).toBeNull();
    } finally {
      rmSync(resourcesPath, { force: true, recursive: true });
    }
  });

  test("normalizes native progress and rejects malformed event payloads", () => {
    expect(
      parseSparkleNativeEvent({
        expectedBytes: 1_000,
        receivedBytes: 240,
        type: "download-progress",
      }),
    ).toEqual({
      expectedBytes: 1_000,
      receivedBytes: 240,
      type: "download-progress",
    });
    expect(() =>
      parseSparkleNativeEvent({
        expectedBytes: 1_000,
        receivedBytes: -1,
        type: "download-progress",
      }),
    ).toThrow("non-negative byte count");
    expect(() => parseSparkleNativeEvent({ type: "unexpected" })).toThrow("Unsupported");
  });
});
