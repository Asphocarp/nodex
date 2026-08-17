import type { BrowserRuntimeManifest } from "./browser-runtime-metadata";

type ParsedCodexVersion = {
  core: readonly [number, number, number];
  prerelease: string | null;
};

const CODEX_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;

function parseCodexVersion(value: string): ParsedCodexVersion | null {
  const match = CODEX_VERSION_PATTERN.exec(value);
  if (!match) return null;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;

  return {
    core: [major, minor, patch],
    prerelease: match[4] ?? null,
  };
}

function compareCoreVersions(
  left: ParsedCodexVersion["core"],
  right: ParsedCodexVersion["core"],
): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Keeps a Browser closure inside its reviewed Codex protocol window.
 *
 * The manifest compatibility version is the certified lower boundary. The
 * closure's embedded Codex CLI is the upper boundary; a prerelease CLI does
 * not certify the stable release on the same version line.
 */
export function isBrowserRuntimeCompatibleWithCodex(
  manifest: Pick<BrowserRuntimeManifest, "codexCompatibilityVersion" | "runtimeVersions">,
  activeCodexVersion: string,
): boolean {
  if (manifest.codexCompatibilityVersion === activeCodexVersion) return true;

  const lower = parseCodexVersion(manifest.codexCompatibilityVersion);
  const active = parseCodexVersion(activeCodexVersion);
  const upper = parseCodexVersion(manifest.runtimeVersions.codexCli);
  if (!lower || !active || !upper || active.prerelease !== null) return false;

  const lowerComparison = compareCoreVersions(active.core, lower.core);
  if (lowerComparison < 0 || (lowerComparison === 0 && lower.prerelease !== null)) {
    return false;
  }

  const upperComparison = compareCoreVersions(active.core, upper.core);
  if (upperComparison > 0) return false;
  return upperComparison < 0 || upper.prerelease === null;
}
