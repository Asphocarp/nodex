import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LEGACY_PROFILE_MIGRATOR_LEGAL_PATH,
  LEGACY_PROFILE_MIGRATOR_MANIFEST_PATH,
  LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH,
  LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT,
  LEGACY_PROFILE_MIGRATOR_SOURCE_VERSIONS,
  type LegacyProfileMigratorManifest,
  serializeLegacyProfileMigratorManifest,
  verifyLegacyProfileMigratorArtifacts,
} from "./legacy-profile-migrator-artifacts";
import { sha256File } from "./native-runtime-manifest";

const temporaryRoots: string[] = [];

const createRepositoryFixture = (repositoryRoot: string): LegacyProfileMigratorManifest => {
  const bundlePath = path.join(repositoryRoot, LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH);
  const legalPath = path.join(repositoryRoot, LEGACY_PROFILE_MIGRATOR_LEGAL_PATH);
  mkdirSync(path.dirname(bundlePath), { recursive: true });
  writeFileSync(bundlePath, "export const migrate = () => 84;\n");
  writeFileSync(legalPath, "frozen dependency notices\n");
  const manifest: LegacyProfileMigratorManifest = {
    schemaVersion: 1,
    sourceCommit: LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT,
    supportedSourceVersions: LEGACY_PROFILE_MIGRATOR_SOURCE_VERSIONS,
    targetSchemaVersion: 84,
    bundle: {
      path: LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH,
      sha256: sha256File(bundlePath),
      size: readFileSync(bundlePath).byteLength,
    },
    legalNotices: {
      path: LEGACY_PROFILE_MIGRATOR_LEGAL_PATH,
      sha256: sha256File(legalPath),
      size: readFileSync(legalPath).byteLength,
    },
  };
  writeFileSync(
    path.join(repositoryRoot, LEGACY_PROFILE_MIGRATOR_MANIFEST_PATH),
    serializeLegacyProfileMigratorManifest(manifest),
  );
  return manifest;
};

const createTemporaryRoot = (prefix: string): string => {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("legacy profile migrator artifact verification", () => {
  it("verifies the same artifact contract from unrelated repository roots", () => {
    const shallowRoot = createTemporaryRoot("nodex-migrator-shallow-");
    const deepBase = createTemporaryRoot("nodex-migrator-deep-");
    const deepRoot = path.join(deepBase, "one", "two", "three", "checkout");
    const expected = createRepositoryFixture(shallowRoot);
    createRepositoryFixture(deepRoot);

    expect(verifyLegacyProfileMigratorArtifacts(shallowRoot)).toEqual(expected);
    expect(verifyLegacyProfileMigratorArtifacts(deepRoot)).toEqual(expected);
  });

  it("rejects a bundle changed after its manifest was written", () => {
    const repositoryRoot = createTemporaryRoot("nodex-migrator-tampered-");
    createRepositoryFixture(repositoryRoot);
    const bundlePath = path.join(repositoryRoot, LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH);
    const bundle = readFileSync(bundlePath);
    bundle[0] ^= 1;
    writeFileSync(bundlePath, bundle);

    expect(() => verifyLegacyProfileMigratorArtifacts(repositoryRoot)).toThrow(
      "bundle digest does not match its manifest",
    );
  });

  it("rejects a manifest that redirects an artifact outside the frozen contract", () => {
    const repositoryRoot = createTemporaryRoot("nodex-migrator-invalid-path-");
    const manifest = createRepositoryFixture(repositoryRoot);
    writeFileSync(
      path.join(repositoryRoot, LEGACY_PROFILE_MIGRATOR_MANIFEST_PATH),
      `${JSON.stringify({
        ...manifest,
        bundle: { ...manifest.bundle, path: "../legacy-profile-migrator.mjs" },
      }, null, 2)}\n`,
    );

    expect(() => verifyLegacyProfileMigratorArtifacts(repositoryRoot)).toThrow(
      "bundle path",
    );
  });
});
