const WINDOWS_UNC_LONG_PATH_PATTERN = /^\\\\\?\\UNC\\(.*)$/i;
const WINDOWS_DRIVE_LONG_PATH_PATTERN = /^\\\\\?\\([a-zA-Z]:[\\/].*)$/;

function stripWindowsLongPathPrefix(root: string): string {
  const uncMatch = root.match(WINDOWS_UNC_LONG_PATH_PATTERN);
  if (uncMatch != null) return `\\\\${uncMatch[1]}`;
  const driveMatch = root.match(WINDOWS_DRIVE_LONG_PATH_PATTERN);
  return driveMatch == null ? root : driveMatch[1];
}

function normalizeSourceRootSlashes(root: string): string {
  return stripWindowsLongPathPrefix(root).replaceAll("\\", "/");
}

export function normalizeSourceRootKey(root: string): string {
  return normalizeSourceRootSlashes(root).toLowerCase();
}

export function dedupeSourceRoots(roots: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const root of roots) {
    const trimmed = root.trim();
    if (!trimmed) continue;
    const key = normalizeSourceRootKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(trimmed);
  }
  return deduped;
}

export function sourceRootDisplayName(root: string): string {
  const normalized = normalizeSourceRootSlashes(root).replace(/\/+$/, "");
  const lastSegment = normalized.split("/").at(-1);
  return lastSegment || normalized || root;
}

export function makeSourceRootPrimary(
  roots: readonly string[],
  root: string,
): string[] {
  return [root, ...roots.filter((candidate) => candidate !== root)];
}
