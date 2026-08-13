import type { CodexSidebarRunLocation } from "./types";

const MANAGED_WORKTREE_SEGMENT_PATTERN = /^\.(?:codex|nodex)$/i;
const SHORT_ALLOCATION_TOKEN_PATTERN = /^[0-9a-f]{4,}$/i;
const UUID_ALLOCATION_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizePathSegments(value: string): string[] {
  return value
    .trim()
    .replace(/[\\/]+$/g, "")
    .split(/[\\/]+/)
    .filter(Boolean);
}

function isAllocationToken(segment: string): boolean {
  return SHORT_ALLOCATION_TOKEN_PATTERN.test(segment)
    || UUID_ALLOCATION_TOKEN_PATTERN.test(segment);
}

/**
 * Derives the stable repository-facing label used by the task hover card.
 * Managed roots contain an opaque allocation token; that token is never
 * useful to a user and must not become the visible worktree name.
 */
export function resolveCodexSidebarWorktreeLabel(path: string | null): string | null {
  if (!path?.trim()) return null;
  const segments = normalizePathSegments(path);
  if (segments.length === 0) return null;

  const markerIndex = segments.findIndex((segment, index) => (
    MANAGED_WORKTREE_SEGMENT_PATTERN.test(segment)
    && segments[index + 1]?.toLowerCase() === "worktrees"
  ));
  if (markerIndex < 0) return segments.at(-1) ?? null;

  const managedSegments = segments.slice(markerIndex + 2);
  if (managedSegments.length === 0) return null;
  const labelIndex = isAllocationToken(managedSegments[0] ?? "") ? 1 : 0;
  return managedSegments[labelIndex] ?? managedSegments.at(-1) ?? null;
}

export function isCodexSidebarWorktreeLocation(
  location: CodexSidebarRunLocation,
): location is Extract<CodexSidebarRunLocation, { kind: "local-worktree" | "remote-worktree" }> {
  return location.kind === "local-worktree" || location.kind === "remote-worktree";
}

export function isCodexSidebarRemoteLocation(
  location: CodexSidebarRunLocation,
): location is Extract<CodexSidebarRunLocation, { kind: "remote-checkout" | "remote-worktree" }> {
  return location.kind === "remote-checkout" || location.kind === "remote-worktree";
}
