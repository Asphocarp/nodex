import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import {
  applyMacSigningMode,
  refreshSignedAgentRuntimeMetadata,
} from "./sign-macos-runtime.mjs";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("applyMacSigningMode", () => {
  const releaseOptions = {
    app: "/tmp/Nodex.app",
    platform: "darwin",
    optionsForFile: (filePath: string) => ({
      entitlements: `${filePath}.entitlements`,
      hardenedRuntime: true,
    }),
  };

  test("returns release options untouched when no mode is selected", () => {
    expect(applyMacSigningMode(releaseOptions, undefined)).toBe(releaseOptions);
  });

  test("local mode disables timestamping while keeping per-file release options", () => {
    const local = applyMacSigningMode(releaseOptions, "local");
    expect(local).not.toBe(releaseOptions);
    expect(local.optionsForFile("/tmp/Nodex.app/Contents/MacOS/Nodex")).toEqual({
      entitlements: "/tmp/Nodex.app/Contents/MacOS/Nodex.entitlements",
      hardenedRuntime: true,
      timestamp: "none",
    });
  });

  test("local mode disables timestamping even without base per-file options", () => {
    const local = applyMacSigningMode(
      { app: "/tmp/Nodex.app", platform: "darwin" },
      "local",
    );
    expect(local.optionsForFile?.("/tmp/anything")).toEqual({ timestamp: "none" });
  });

  test("rejects unknown signing modes instead of silently signing differently", () => {
    expect(() => applyMacSigningMode(releaseOptions, "adhoc"))
      .toThrow("Unknown NODEX_MAC_SIGN_MODE: adhoc");
  });
});

describe("refreshSignedAgentRuntimeMetadata", () => {
  test("reseals Agent artifacts after nested executable signing changes their bytes", () => {
    const appPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-agent-signing-"));
    temporaryRoots.push(appPath);
    const resourcesPath = path.join(appPath, "Contents", "Resources");
    const executablePath = path.join(resourcesPath, "bin", "interpreter");
    fs.mkdirSync(path.dirname(executablePath), { recursive: true });
    fs.writeFileSync(executablePath, "developer-id-signed-interpreter", { mode: 0o755 });
    const metadataPath = path.join(resourcesPath, "agent-runtime.json");
    fs.writeFileSync(metadataPath, JSON.stringify({
      layoutVersion: 2,
      artifacts: [{
        executable: true,
        path: "bin/interpreter",
        sha256: "0".repeat(64),
        size: 1,
      }],
    }));

    refreshSignedAgentRuntimeMetadata(appPath);

    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as {
      artifacts: Array<{
        executable: boolean;
        path: string;
        sha256: string;
        size: number;
      }>;
    };
    expect(metadata.artifacts).toEqual([{
      executable: true,
      path: "bin/interpreter",
      sha256: createHash("sha256")
        .update("developer-id-signed-interpreter")
        .digest("hex"),
      size: Buffer.byteLength("developer-id-signed-interpreter"),
    }]);
  });
});
