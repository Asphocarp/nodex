import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import { refreshSignedAgentRuntimeMetadata } from "./sign-macos-runtime.mjs";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
