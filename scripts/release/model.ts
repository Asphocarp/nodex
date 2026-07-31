import { createHash } from "node:crypto";
import { openSync, closeSync, readSync } from "node:fs";

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export interface ReleaseIdentity {
  readonly sourceSha: string;
  readonly sourceTree: string;
  readonly tag: string;
  readonly version: string;
}

export function normalizeStableVersion(value: string, label = "version"): string {
  const normalized = value.trim();
  if (!STABLE_VERSION_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a stable semantic version such as 0.2.0.`);
  }
  return normalized;
}

export function compareStableVersions(leftValue: string, rightValue: string): number {
  const left = normalizeStableVersion(leftValue, "left version")
    .split(".")
    .map((part) => BigInt(part));
  const right = normalizeStableVersion(rightValue, "right version")
    .split(".")
    .map((part) => BigInt(part));

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

export function tagForVersion(version: string): string {
  return `v${normalizeStableVersion(version)}`;
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
  return versions.reduce<string | null>((latest, version) => (
    latest === null || compareStableVersions(version, latest) > 0 ? version : latest
  ), null);
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
