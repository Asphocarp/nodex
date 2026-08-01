import { readFileSync } from "node:fs";
import path from "node:path";

export interface SparkleReleaseLock {
  readonly archive: {
    readonly name: string;
    readonly sha256: string;
    readonly size: number;
    readonly url: string;
  };
  readonly framework: {
    readonly architectures: readonly ["arm64", "x86_64"];
    readonly bundleVersion: string;
    readonly shortVersion: string;
  };
  readonly license: {
    readonly path: "resources/sparkle/LICENSE";
    readonly sha256: string;
  };
  readonly schemaVersion: 1;
  readonly source: {
    readonly commit: string;
    readonly repository: string;
    readonly tag: string;
  };
  readonly version: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (value: unknown, label: string): string => {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  throw new Error(`Sparkle release lock ${label} must be a non-empty string.`);
};

export function parseSparkleReleaseLock(value: unknown): SparkleReleaseLock {
  if (!isObject(value) || value.schemaVersion !== 1) {
    throw new Error("Unsupported Sparkle release lock schema.");
  }
  if (
    !isObject(value.source)
    || !isObject(value.archive)
    || !isObject(value.framework)
    || !isObject(value.license)
  ) {
    throw new Error("Sparkle release lock is missing required sections.");
  }

  const version = requireString(value.version, "version");
  const tag = requireString(value.source.tag, "source tag");
  const commit = requireString(value.source.commit, "source commit");
  const repository = requireString(value.source.repository, "source repository");
  const archiveName = requireString(value.archive.name, "archive name");
  const archiveUrl = requireString(value.archive.url, "archive URL");
  const archiveSha256 = requireString(value.archive.sha256, "archive SHA-256").toLowerCase();
  const archiveSize = value.archive.size;
  const bundleVersion = requireString(value.framework.bundleVersion, "bundle version");
  const shortVersion = requireString(value.framework.shortVersion, "framework version");
  const architectures = value.framework.architectures;
  const licensePath = requireString(value.license.path, "license path");
  const licenseSha256 = requireString(value.license.sha256, "license SHA-256").toLowerCase();

  if (!/^\d+\.\d+\.\d+$/u.test(version) || tag !== version || shortVersion !== version) {
    throw new Error("Sparkle release lock versions must match one stable semantic version.");
  }
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    throw new Error("Sparkle source commit must be a full Git commit SHA.");
  }
  if (repository !== "https://github.com/sparkle-project/Sparkle") {
    throw new Error("Sparkle source repository must be the official upstream repository.");
  }
  const parsedArchiveUrl = new URL(archiveUrl);
  if (
    parsedArchiveUrl.protocol !== "https:"
    || parsedArchiveUrl.hostname !== "github.com"
    || parsedArchiveUrl.pathname !== `/sparkle-project/Sparkle/releases/download/${version}/${archiveName}`
  ) {
    throw new Error("Sparkle archive URL must target the pinned official GitHub release asset.");
  }
  if (archiveName !== `Sparkle-${version}.tar.xz`) {
    throw new Error("Sparkle archive name does not match the pinned version.");
  }
  if (!Number.isSafeInteger(archiveSize) || (archiveSize as number) <= 0) {
    throw new Error("Sparkle archive size must be a positive safe integer.");
  }
  if (!/^[a-f0-9]{64}$/u.test(archiveSha256)) {
    throw new Error("Sparkle archive SHA-256 must be a lowercase digest.");
  }
  if (!/^\d+$/u.test(bundleVersion)) {
    throw new Error("Sparkle bundle version must be numeric.");
  }
  if (
    !Array.isArray(architectures)
    || architectures.length !== 2
    || architectures[0] !== "arm64"
    || architectures[1] !== "x86_64"
  ) {
    throw new Error("Sparkle framework must retain the official arm64/x86_64 slices.");
  }
  if (licensePath !== "resources/sparkle/LICENSE" || !/^[a-f0-9]{64}$/u.test(licenseSha256)) {
    throw new Error("Sparkle license identity is invalid.");
  }

  return {
    archive: {
      name: archiveName,
      sha256: archiveSha256,
      size: archiveSize as number,
      url: archiveUrl,
    },
    framework: {
      architectures: ["arm64", "x86_64"],
      bundleVersion,
      shortVersion,
    },
    license: { path: "resources/sparkle/LICENSE", sha256: licenseSha256 },
    schemaVersion: 1,
    source: { commit, repository, tag },
    version,
  };
}

export const resolveSparkleReleaseLockPath = (repositoryRoot: string): string =>
  path.join(repositoryRoot, "resources", "sparkle", "sparkle.lock.json");

export function readSparkleReleaseLock(lockPath: string): SparkleReleaseLock {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    throw new Error(`Invalid Sparkle release lock at ${lockPath}.`);
  }
  return parseSparkleReleaseLock(value);
}
