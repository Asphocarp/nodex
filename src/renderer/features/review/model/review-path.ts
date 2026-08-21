import { normalizePathSegments, stripPatchPrefix } from "@/lib/file-path";
import type { CanonicalReviewPath } from "./review-view-state";

export interface ReviewPathCandidate {
  readonly displayPath: string;
  readonly previousPath?: string | null;
  readonly gitPath?: string | null;
}

export function canonicalizeReviewPath(
  path: string,
  roots: readonly (string | null | undefined)[] = [],
): CanonicalReviewPath {
  const normalizedPath = normalizePathSegments(stripPatchPrefix(path.trim()));
  if (!normalizedPath) return "" as CanonicalReviewPath;

  for (const root of roots) {
    const relativePath = relativePathWithinRoot(normalizedPath, root);
    if (relativePath !== null) return relativePath as CanonicalReviewPath;
  }

  return normalizedPath as CanonicalReviewPath;
}

export function getReviewPathAliases(
  candidate: ReviewPathCandidate,
  roots: readonly (string | null | undefined)[] = [],
): readonly CanonicalReviewPath[] {
  const aliases = new Set<CanonicalReviewPath>();
  for (const path of [candidate.displayPath, candidate.previousPath, candidate.gitPath]) {
    if (!path) continue;
    const canonicalPath = canonicalizeReviewPath(path, roots);
    if (canonicalPath) aliases.add(canonicalPath);
  }
  return [...aliases];
}

export function resolveReviewPathCandidate<T extends ReviewPathCandidate>(
  candidates: readonly T[],
  targetPath: CanonicalReviewPath,
  roots: readonly (string | null | undefined)[] = [],
): T | null {
  const exactMatches = candidates.filter((candidate) =>
    [candidate.displayPath, candidate.gitPath].some((path) =>
      path ? canonicalizeReviewPath(path, roots) === targetPath : false,
    ),
  );
  if (exactMatches.length > 0) {
    return exactMatches.length === 1 ? (exactMatches[0] ?? null) : null;
  }

  const aliasMatches = candidates.filter((candidate) =>
    candidate.previousPath
      ? canonicalizeReviewPath(candidate.previousPath, roots) === targetPath
      : false,
  );
  return aliasMatches.length === 1 ? (aliasMatches[0] ?? null) : null;
}

function relativePathWithinRoot(
  normalizedPath: string,
  root: string | null | undefined,
): string | null {
  const normalizedRoot = root ? normalizePathSegments(stripPatchPrefix(root.trim())) : "";
  if (!normalizedRoot || !isAbsolutePath(normalizedPath) || !isAbsolutePath(normalizedRoot)) {
    return null;
  }

  const caseInsensitive =
    /^[a-zA-Z]:\//.test(normalizedPath) || /^[a-zA-Z]:\//.test(normalizedRoot);
  const comparablePath = caseInsensitive ? normalizedPath.toLowerCase() : normalizedPath;
  const comparableRoot = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
  if (comparablePath === comparableRoot) return "";
  if (!comparablePath.startsWith(`${comparableRoot}/`)) return null;
  return normalizedPath.slice(normalizedRoot.length + 1);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[a-zA-Z]:\//.test(path);
}
