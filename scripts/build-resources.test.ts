import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  BUILD_RESOURCES_MANIFEST_FILENAME,
  resolveBuildResources,
  verifyBuildResourceTree,
} from "./build-resources";
import {
  LEGACY_PROFILE_MIGRATOR_LEGAL_PATH,
  LEGACY_PROFILE_MIGRATOR_MANIFEST_PATH,
  LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH,
  LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT,
  LEGACY_PROFILE_MIGRATOR_SOURCE_VERSIONS,
  serializeLegacyProfileMigratorManifest,
} from "./legacy-profile-migrator-artifacts";

const temporaryRoots: string[] = [];

const digest = (contents: Buffer): string =>
  createHash("sha256").update(contents).digest("hex");

const createFixture = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "nodex-build-resources-"));
  temporaryRoots.push(root);
  const bundle = Buffer.from("export const migrate = () => 84;\n", "utf8");
  const legal = Buffer.from("license\n", "utf8");
  const notices = Buffer.from("notices\n", "utf8");
  const bundlePath = path.join(root, "legacy-profile-migrator.mjs");
  const legalPath = path.join(root, "legacy-profile-migrator.mjs.LEGAL.txt");
  const manifestPath = path.join(root, "legacy-profile-migrator.json");
  const noticesPath = path.join(root, "THIRD_PARTY_NOTICES.txt");
  writeFileSync(bundlePath, bundle);
  writeFileSync(legalPath, legal);
  writeFileSync(noticesPath, notices);
  writeFileSync(
    manifestPath,
    serializeLegacyProfileMigratorManifest({
      schemaVersion: 1,
      sourceCommit: LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT,
      supportedSourceVersions: LEGACY_PROFILE_MIGRATOR_SOURCE_VERSIONS,
      targetSchemaVersion: 84,
      bundle: {
        path: LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH,
        sha256: digest(bundle),
        size: bundle.byteLength,
      },
      legalNotices: {
        path: LEGACY_PROFILE_MIGRATOR_LEGAL_PATH,
        sha256: digest(legal),
        size: legal.byteLength,
      },
    }),
  );
  const outputFiles = [
    ["THIRD_PARTY_NOTICES.txt", notices],
    ["legacy-profile-migrator.mjs", bundle],
    ["legacy-profile-migrator.mjs.LEGAL.txt", legal],
    ["legacy-profile-migrator.json", readFileSync(manifestPath)],
  ] as const;
  const outputs = Object.fromEntries(outputFiles.map(([filename, contents]) => [
    filename,
    { sha256: digest(contents), size: contents.byteLength },
  ]));
  writeFileSync(
    path.join(root, BUILD_RESOURCES_MANIFEST_FILENAME),
    `${JSON.stringify({
      inputs: {
        dependencyFingerprint: "a".repeat(64),
        esbuildVersion: "0.28.1",
        nodeVersion: "v24.15.0",
        pnpmVersion: "11.11.0",
        repositoryLockfileSha256: "b".repeat(64),
        repositoryPackageJsonSha256: "c".repeat(64),
        sourceCommit: LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT,
        sourceLockfileSha256: "d".repeat(64),
        sourcePackageJsonSha256: "e".repeat(64),
        sourceWorkspaceSha256: "f".repeat(64),
      },
      outputs,
      schemaVersion: 1,
    }, null, 2)}\n`,
  );
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("build resources", () => {
  test("resolves the generated resource directory from a repository root", () => {
    expect(resolveBuildResources("/repo/nodex").root).toBe(
      "/repo/nodex/.generated/build-resources",
    );
  });

  test("verifies a complete resource tree", () => {
    const root = createFixture();
    expect(verifyBuildResourceTree(root).schemaVersion).toBe(1);
  });

  test("reports missing and partial resources at the boundary", () => {
    const root = createFixture();
    rmSync(path.join(root, "legacy-profile-migrator.mjs.LEGAL.txt"));
    expect(() => verifyBuildResourceTree(root)).toThrow("legacy-profile-migrator.mjs.LEGAL.txt is missing");
  });

  test("reports output tampering through the recorded hash", () => {
    const root = createFixture();
    writeFileSync(path.join(root, "legacy-profile-migrator.mjs"), "tampered\n");
    expect(() => verifyBuildResourceTree(root)).toThrow(
      "legacy-profile-migrator.mjs does not match its manifest",
    );
  });
});
