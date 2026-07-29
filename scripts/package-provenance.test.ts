import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  verifyPackagedBuildProvenance,
  writePackagedBuildProvenance,
} from "./package-provenance.mjs";

const temporaryRoots: string[] = [];
const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const makePreparedManifest = (inputDigest = "1".repeat(64)): object => {
  const body = {
    buildContext: { arch: "arm64", platform: "darwin" },
    inputDigest,
    outputs: [{
      executable: false,
      path: "out/main/bootstrap.js",
      sha256: "2".repeat(64),
      size: 10,
    }],
    product: { name: "nodex", version: "0.1.10" },
    schemaVersion: 2,
    source: {
      baseCommit: "3".repeat(40),
      baseTree: "4".repeat(40),
      snapshotDigest: inputDigest,
      state: "clean",
    },
  };
  return {
    ...body,
    generationId: sha256(JSON.stringify(body)),
  };
};

const writeJson = (filePath: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const makeApp = (): {
  appPath: string;
  currentPreparedPath: string;
} => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-package-provenance-"));
  temporaryRoots.push(root);
  const appPath = path.join(root, "Nodex.app");
  const resources = path.join(appPath, "Contents/Resources");
  fs.mkdirSync(path.join(resources, "bin"), { recursive: true });
  fs.writeFileSync(path.join(resources, "app.asar"), "current app payload\n");
  fs.writeFileSync(
    path.join(resources, "app-update.yml"),
    "provider: github\nowner: junyudev\nrepo: nodex\n",
  );
  const prepared = makePreparedManifest();
  writeJson(path.join(resources, "prepared-electron-build.json"), prepared);
  writeJson(path.join(resources, "bin/rust-core-runtime.json"), {
    schemaVersion: 2,
    targetPlatform: "darwin",
    targetArch: "arm64",
  });
  writeJson(path.join(resources, "agent-runtime.json"), {
    layoutVersion: 2,
    targetPlatform: "darwin",
    targetArch: "arm64",
  });
  const currentPreparedPath = path.join(root, "current-prepared.json");
  writeJson(currentPreparedPath, prepared);
  return { appPath, currentPreparedPath };
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("packaged build provenance", () => {
  test("binds app.asar and both runtime manifests to the prepared source generation", () => {
    const fixture = makeApp();
    const written = writePackagedBuildProvenance(fixture.appPath);

    const verified = verifyPackagedBuildProvenance(fixture.appPath, {
      expectedArch: "arm64",
      expectedPreparedManifestPath: fixture.currentPreparedPath,
    });

    expect(verified.provenanceId).toBe(written.provenanceId);
  });

  test("binds the optional Browser runtime manifest when one is packaged", () => {
    const fixture = makeApp();
    const browserManifestPath = path.join(
      fixture.appPath,
      "Contents/Resources/browser-runtime/browser-runtime-manifest.json",
    );
    const agentManifestPath = path.join(
      fixture.appPath,
      "Contents/Resources/agent-runtime.json",
    );
    writeJson(agentManifestPath, {
      codexCompatibilityVersion: "0.144.6",
      layoutVersion: 2,
      targetArch: "arm64",
      targetPlatform: "darwin",
    });
    writeJson(browserManifestPath, {
      codexCompatibilityVersion: "0.144.6",
      contractVersion: 1,
      schemaVersion: 1,
      targetArch: "arm64",
      targetPlatform: "darwin",
    });
    writePackagedBuildProvenance(fixture.appPath);
    fs.appendFileSync(browserManifestPath, "tampered\n");

    expect(() => verifyPackagedBuildProvenance(fixture.appPath)).toThrow(
      "does not match the packaged provenance",
    );
  });

  test("rejects a stale prepared source generation", () => {
    const fixture = makeApp();
    writePackagedBuildProvenance(fixture.appPath);
    writeJson(fixture.currentPreparedPath, makePreparedManifest("5".repeat(64)));

    expect(() => verifyPackagedBuildProvenance(fixture.appPath, {
      expectedPreparedManifestPath: fixture.currentPreparedPath,
    })).toThrow("stale for the current prepared Electron source");
  });

  test.each([
    "app.asar",
    "app-update.yml",
    "bin/rust-core-runtime.json",
    "agent-runtime.json",
  ])("rejects a packaged payload mutation in %s", (relativePath) => {
    const fixture = makeApp();
    writePackagedBuildProvenance(fixture.appPath);
    fs.appendFileSync(
      path.join(fixture.appPath, "Contents/Resources", relativePath),
      "tampered\n",
    );

    expect(() => verifyPackagedBuildProvenance(fixture.appPath)).toThrow(
      "does not match the packaged provenance",
    );
  });
});
