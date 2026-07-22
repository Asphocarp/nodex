import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { sha256File } from "./native-runtime-manifest";

export const LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT =
  "db1e660c907cc41db38d9cc126d385f0826aee78";
export const LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH =
  "resources/legacy-profile-migrator.mjs";
export const LEGACY_PROFILE_MIGRATOR_LEGAL_PATH =
  `${LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH}.LEGAL.txt`;
export const LEGACY_PROFILE_MIGRATOR_MANIFEST_PATH =
  "resources/legacy-profile-migrator.json";
export const LEGACY_PROFILE_MIGRATOR_SOURCE_VERSIONS = [26, 57, 68, 82, 83] as const;

interface LegacyProfileMigratorArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface LegacyProfileMigratorManifest {
  readonly schemaVersion: 1;
  readonly sourceCommit: typeof LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT;
  readonly supportedSourceVersions: typeof LEGACY_PROFILE_MIGRATOR_SOURCE_VERSIONS;
  readonly targetSchemaVersion: 84;
  readonly bundle: LegacyProfileMigratorArtifact;
  readonly legalNotices: LegacyProfileMigratorArtifact;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseArtifact = (
  value: unknown,
  label: string,
  expectedPath: string,
): LegacyProfileMigratorArtifact => {
  if (!isObject(value)) {
    throw new Error(`Invalid legacy profile migrator ${label}`);
  }
  if (value.path !== expectedPath) {
    throw new Error(`Invalid legacy profile migrator ${label} path`);
  }
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error(`Invalid legacy profile migrator ${label} SHA-256`);
  }
  if (!Number.isSafeInteger(value.size) || (value.size as number) <= 0) {
    throw new Error(`Invalid legacy profile migrator ${label} size`);
  }
  return {
    path: expectedPath,
    sha256: value.sha256,
    size: value.size as number,
  };
};

export const parseLegacyProfileMigratorManifest = (
  value: unknown,
): LegacyProfileMigratorManifest => {
  if (!isObject(value)) throw new Error("Invalid legacy profile migrator manifest");
  if (value.schemaVersion !== 1) {
    throw new Error("Unsupported legacy profile migrator manifest schema");
  }
  if (value.sourceCommit !== LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT) {
    throw new Error("Unexpected legacy profile migrator source commit");
  }
  if (value.targetSchemaVersion !== 84) {
    throw new Error("Unexpected legacy profile migrator target schema");
  }
  if (
    !Array.isArray(value.supportedSourceVersions)
    || value.supportedSourceVersions.length !== LEGACY_PROFILE_MIGRATOR_SOURCE_VERSIONS.length
    || value.supportedSourceVersions.some(
      (version, index) => version !== LEGACY_PROFILE_MIGRATOR_SOURCE_VERSIONS[index],
    )
  ) {
    throw new Error("Unexpected legacy profile migrator source schemas");
  }
  return {
    schemaVersion: 1,
    sourceCommit: LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT,
    supportedSourceVersions: LEGACY_PROFILE_MIGRATOR_SOURCE_VERSIONS,
    targetSchemaVersion: 84,
    bundle: parseArtifact(
      value.bundle,
      "bundle",
      LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH,
    ),
    legalNotices: parseArtifact(
      value.legalNotices,
      "legal notices",
      LEGACY_PROFILE_MIGRATOR_LEGAL_PATH,
    ),
  };
};

export const serializeLegacyProfileMigratorManifest = (
  manifest: LegacyProfileMigratorManifest,
): string => `${JSON.stringify(manifest, null, 2)}\n`;

const readManifest = (repositoryRoot: string): LegacyProfileMigratorManifest => {
  const manifestPath = path.join(repositoryRoot, LEGACY_PROFILE_MIGRATOR_MANIFEST_PATH);
  let source: string;
  let value: unknown;
  try {
    const stat = lstatSync(manifestPath);
    if (!stat.isFile()) throw new Error("not a regular file");
    source = readFileSync(manifestPath, "utf8");
    value = JSON.parse(source);
  } catch {
    throw new Error(`Invalid legacy profile migrator manifest at ${manifestPath}`);
  }
  const manifest = parseLegacyProfileMigratorManifest(value);
  if (source !== serializeLegacyProfileMigratorManifest(manifest)) {
    throw new Error("Legacy profile migrator manifest is not canonical");
  }
  return manifest;
};

const verifyArtifact = (
  repositoryRoot: string,
  artifact: LegacyProfileMigratorArtifact,
  label: string,
): void => {
  const artifactPath = path.join(repositoryRoot, artifact.path);
  let size: number;
  try {
    const stat = lstatSync(artifactPath);
    if (!stat.isFile()) throw new Error("not a regular file");
    size = stat.size;
  } catch {
    throw new Error(`Legacy profile migrator ${label} is missing at ${artifactPath}`);
  }
  if (size !== artifact.size) {
    throw new Error(`Legacy profile migrator ${label} size does not match its manifest`);
  }
  if (sha256File(artifactPath) !== artifact.sha256) {
    throw new Error(`Legacy profile migrator ${label} digest does not match its manifest`);
  }
};

export const verifyLegacyProfileMigratorArtifacts = (
  repositoryRoot: string,
): LegacyProfileMigratorManifest => {
  const manifest = readManifest(repositoryRoot);
  verifyArtifact(repositoryRoot, manifest.bundle, "bundle");
  verifyArtifact(repositoryRoot, manifest.legalNotices, "legal notices");
  return manifest;
};
