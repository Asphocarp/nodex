import { createHash } from "node:crypto";
import { openSync, closeSync, readSync } from "node:fs";

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const NIGHTLY_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-nightly\.(\d{8})\.([1-9]\d*)$/;
const APPLE_BUILD_VERSION_PATTERN = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d?)\.(0|[1-9]\d?)$/;
const GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/;
const RELEASE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RELEASE_IDENTITY_KEYS = [
  "buildVersion",
  "channel",
  "mainlineOrdinal",
  "schemaVersion",
  "sourceDate",
  "sourceSha",
  "sourceTree",
  "sourceVersion",
  "tag",
  "version",
] as const;

export type ReleaseChannel = "stable" | "nightly";

export interface ReleaseIdentity {
  readonly schemaVersion: 1;
  readonly channel: ReleaseChannel;
  readonly sourceSha: string;
  readonly sourceTree: string;
  readonly sourceVersion: string;
  readonly version: string;
  readonly buildVersion: string;
  readonly tag: string;
  readonly mainlineOrdinal: number;
  readonly sourceDate: string;
}

interface StableVersionParts {
  readonly major: bigint;
  readonly minor: bigint;
  readonly patch: bigint;
}

interface NightlyVersionParts extends StableVersionParts {
  readonly compactDate: string;
  readonly mainlineOrdinal: number;
}

function stableVersionParts(value: string, label: string): StableVersionParts {
  const normalized = normalizeStableVersion(value, label);
  const [major, minor, patch] = normalized.split(".").map((part) => BigInt(part));
  return { major, minor, patch };
}

function normalizeNightlyVersion(value: string, label = "version"): string {
  const normalized = value.trim();
  if (!NIGHTLY_VERSION_PATTERN.test(normalized)) {
    throw new Error(
      `${label} must be a nightly semantic version such as 0.2.2-nightly.20260813.842.`,
    );
  }
  return normalized;
}

function nightlyVersionParts(value: string, label: string): NightlyVersionParts {
  const normalized = normalizeNightlyVersion(value, label);
  const match = NIGHTLY_VERSION_PATTERN.exec(normalized);
  if (!match) throw new Error(`${label} is not a nightly version.`);
  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    compactDate: match[4],
    mainlineOrdinal: normalizeMainlineOrdinal(Number(match[5]), `${label} ordinal`),
  };
}

function normalizeMainlineOrdinal(value: number, label = "mainlineOrdinal"): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function assertGitObject(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !GIT_OBJECT_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase 40-character Git object id.`);
  }
}

function normalizeReleaseDate(value: unknown, label = "sourceDate"): string {
  if (typeof value !== "string" || !RELEASE_DATE_PATTERN.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a real calendar date.`);
  }
  return value;
}

function assertExactIdentityKeys(value: Record<string, unknown>): void {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...RELEASE_IDENTITY_KEYS].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`Release Identity must contain exactly: ${expectedKeys.join(", ")}.`);
  }
}

export function normalizeStableVersion(value: string, label = "version"): string {
  const normalized = value.trim();
  if (!STABLE_VERSION_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a stable semantic version such as 0.2.0.`);
  }
  return normalized;
}

export function normalizeReleaseVersion(value: string, label = "version"): string {
  try {
    return normalizeStableVersion(value, label);
  } catch {
    return normalizeNightlyVersion(value, label);
  }
}

export function compareStableVersions(leftValue: string, rightValue: string): number {
  const left = stableVersionParts(leftValue, "left version");
  const right = stableVersionParts(rightValue, "right version");
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] < right[key]) return -1;
    if (left[key] > right[key]) return 1;
  }
  return 0;
}

export function nextPatchVersion(value: string): string {
  const { major, minor, patch } = stableVersionParts(value, "source version");
  return `${major}.${minor}.${patch + 1n}`;
}

export function nightlyVersionFor(
  sourceVersion: string,
  sourceDate: string,
  mainlineOrdinal: number,
): string {
  const date = normalizeReleaseDate(sourceDate).replaceAll("-", "");
  const ordinal = normalizeMainlineOrdinal(mainlineOrdinal);
  return `${nextPatchVersion(sourceVersion)}-nightly.${date}.${ordinal}`;
}

export function buildVersionForMainlineOrdinal(mainlineOrdinal: number): string {
  const ordinal = normalizeMainlineOrdinal(mainlineOrdinal);
  const major = 1 + Math.floor(ordinal / 10_000);
  const minor = Math.floor(ordinal / 100) % 100;
  const patch = ordinal % 100;
  if (major > 9_999) {
    throw new Error("mainlineOrdinal exceeds Apple's four-digit major build-version limit.");
  }
  return `${major}.${minor}.${patch}`;
}

export function normalizeAppleBuildVersion(value: string, label = "buildVersion"): string {
  const normalized = value.trim();
  if (!APPLE_BUILD_VERSION_PATTERN.test(normalized)) {
    throw new Error(`${label} must be an Apple build version such as 1.8.42.`);
  }
  return normalized;
}

export function compareBuildVersions(leftValue: string, rightValue: string): number {
  const left = normalizeAppleBuildVersion(leftValue, "left build version").split(".").map(Number);
  const right = normalizeAppleBuildVersion(rightValue, "right build version")
    .split(".")
    .map(Number);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

export function tagForVersion(version: string): string {
  return `v${normalizeStableVersion(version)}`;
}

export function tagForReleaseVersion(version: string): string {
  return `v${normalizeReleaseVersion(version)}`;
}

export function stableVersionFromAppTag(tag: string): string | null {
  if (!tag.startsWith("v")) return null;
  try {
    return normalizeStableVersion(tag.slice(1), "app tag");
  } catch {
    return null;
  }
}

export function latestStableAppVersion(tags: readonly string[]): string | null {
  const versions = tags
    .map(stableVersionFromAppTag)
    .filter((version): version is string => version !== null);
  return versions.reduce<string | null>(
    (latest, version) =>
      latest === null || compareStableVersions(version, latest) > 0 ? version : latest,
    null,
  );
}

export function parseReleaseIdentity(input: unknown): ReleaseIdentity {
  const value = typeof input === "string" ? (JSON.parse(input) as unknown) : input;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Release Identity must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  assertExactIdentityKeys(record);
  if (record.schemaVersion !== 1) throw new Error("Release Identity schemaVersion must be 1.");
  if (record.channel !== "stable" && record.channel !== "nightly") {
    throw new Error("Release Identity channel must be stable or nightly.");
  }
  assertGitObject(record.sourceSha, "sourceSha");
  assertGitObject(record.sourceTree, "sourceTree");
  if (typeof record.sourceVersion !== "string") throw new Error("sourceVersion must be a string.");
  if (typeof record.version !== "string") throw new Error("version must be a string.");
  if (typeof record.buildVersion !== "string") throw new Error("buildVersion must be a string.");
  if (typeof record.tag !== "string") throw new Error("tag must be a string.");
  if (typeof record.mainlineOrdinal !== "number") {
    throw new Error("mainlineOrdinal must be a number.");
  }

  const sourceVersion = normalizeStableVersion(record.sourceVersion, "sourceVersion");
  const sourceDate = normalizeReleaseDate(record.sourceDate);
  const mainlineOrdinal = normalizeMainlineOrdinal(record.mainlineOrdinal);
  const expectedVersion =
    record.channel === "stable"
      ? sourceVersion
      : nightlyVersionFor(sourceVersion, sourceDate, mainlineOrdinal);
  const expectedBuildVersion = buildVersionForMainlineOrdinal(mainlineOrdinal);

  if (record.version !== expectedVersion) {
    throw new Error(
      `Release Identity version must be ${expectedVersion} for its source and channel.`,
    );
  }
  if (record.buildVersion !== expectedBuildVersion) {
    throw new Error(`Release Identity buildVersion must be ${expectedBuildVersion}.`);
  }
  if (record.tag !== tagForReleaseVersion(expectedVersion)) {
    throw new Error(`Release Identity tag must be ${tagForReleaseVersion(expectedVersion)}.`);
  }
  if (record.channel === "nightly") {
    const parts = nightlyVersionParts(record.version, "version");
    if (
      parts.compactDate !== sourceDate.replaceAll("-", "") ||
      parts.mainlineOrdinal !== mainlineOrdinal
    ) {
      throw new Error("Nightly version does not match sourceDate and mainlineOrdinal.");
    }
  }

  return {
    schemaVersion: 1,
    channel: record.channel,
    sourceSha: record.sourceSha,
    sourceTree: record.sourceTree,
    sourceVersion,
    version: expectedVersion,
    buildVersion: expectedBuildVersion,
    tag: record.tag,
    mainlineOrdinal,
    sourceDate,
  };
}

export function sha256File(filePath: string): string {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = openSync(filePath, "r");
  try {
    for (;;) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) return hash.digest("hex");
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
