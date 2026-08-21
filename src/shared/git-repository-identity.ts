export interface GitRepositoryOwnerRepo {
  owner: string;
  repo: string;
}

export interface GitRepositoryIdentity {
  repositoryRoot: string;
  ownerRepo: GitRepositoryOwnerRepo | null;
}

function normalizeRepositoryPath(pathname: string): string[] {
  const pathOnly = pathname.split(/[?#]/, 1)[0] ?? "";
  const trimmed = pathOnly
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "");
  if (!trimmed) return [];

  return trimmed
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function ownerRepoFromSegments(segments: string[]): GitRepositoryOwnerRepo | null {
  if (segments.length < 2) return null;

  const repo = segments.at(-1) ?? "";
  const owner = segments.slice(0, -1).join("/");
  if (!owner || !repo) return null;

  return { owner, repo };
}

/**
 * Extracts a credential-free display identity without constraining remotes to
 * one host. Raw remote URLs remain in main and never cross into renderer data.
 */
export function parseGitRepositoryOwnerRepo(
  remoteUrl: string | null | undefined,
): GitRepositoryOwnerRepo | null {
  const normalizedUrl = remoteUrl?.trim() ?? "";
  if (!normalizedUrl) return null;

  const scpMatch = normalizedUrl.match(/^(?:[^@\s/:]+@)?[^@\s/:]+:(?![\\/])(.+)$/);
  if (scpMatch?.[1]) {
    return ownerRepoFromSegments(normalizeRepositoryPath(scpMatch[1]));
  }

  try {
    const parsed = new URL(normalizedUrl);
    if (!["http:", "https:", "ssh:", "git:"].includes(parsed.protocol)) {
      return null;
    }
    return ownerRepoFromSegments(normalizeRepositoryPath(parsed.pathname));
  } catch {
    return null;
  }
}
