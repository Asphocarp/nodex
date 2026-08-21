export interface RewriteExecutionWorkspaceRootsInput {
  readonly sourcePrimary: string;
  readonly targetPrimary: string;
  readonly workspaceRoots: readonly string[];
  /** Paths such as a custom cwd that must remain explicitly authorized. */
  readonly explicitRoots?: readonly string[];
}

function normalizedPathParts(value: string): {
  readonly comparable: string;
  readonly raw: string;
} {
  const slashNormalized = value.trim().replaceAll("\\", "/");
  const collapsed = slashNormalized.startsWith("//")
    ? `//${slashNormalized.slice(2).replace(/\/{2,}/g, "/")}`
    : slashNormalized.replace(/\/{2,}/g, "/");
  const raw = collapsed === "/" ? collapsed : collapsed.replace(/\/+$/, "");
  return {
    raw,
    comparable: /^(?:[a-z]:\/|\/\/)/i.test(raw) ? raw.toLowerCase() : raw,
  };
}

export function executionWorkspacePathKey(value: string): string {
  return normalizedPathParts(value).comparable;
}

export function isExecutionWorkspacePathWithinRoot(
  candidatePath: string,
  rootPath: string,
): boolean {
  const candidate = executionWorkspacePathKey(candidatePath);
  const root = executionWorkspacePathKey(rootPath);
  if (!candidate || !root) return false;
  return candidate === root || candidate.startsWith(`${root}/`);
}

/** Replace a source-primary prefix while retaining a nested relative suffix. */
export function rewriteExecutionWorkspacePath(input: {
  readonly path: string;
  readonly sourcePrimary: string;
  readonly targetPrimary: string;
}): string {
  if (!isExecutionWorkspacePathWithinRoot(input.path, input.sourcePrimary)) {
    return input.path;
  }

  const candidate = normalizedPathParts(input.path);
  const source = normalizedPathParts(input.sourcePrimary);
  if (candidate.comparable === source.comparable) return input.targetPrimary;

  const suffix = candidate.raw.slice(source.raw.length).replace(/^\/+/, "");
  return suffix ? `${input.targetPrimary.replace(/[\\/]+$/, "")}/${suffix}` : input.targetPrimary;
}

function dedupeExecutionWorkspaceRoots(roots: readonly string[]): string[] {
  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = executionWorkspacePathKey(root);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Move only the primary source tree to a worktree. Additional and explicit
 * roots keep their authored order and path identity.
 */
export function rewriteExecutionWorkspaceRoots(
  input: RewriteExecutionWorkspaceRootsInput,
): string[] {
  const rewrittenRoots = input.workspaceRoots.map((root) =>
    rewriteExecutionWorkspacePath({
      path: root,
      sourcePrimary: input.sourcePrimary,
      targetPrimary: input.targetPrimary,
    }),
  );
  const externalExplicitRoots = (input.explicitRoots ?? []).filter(
    (root) =>
      !isExecutionWorkspacePathWithinRoot(root, input.sourcePrimary) &&
      !isExecutionWorkspacePathWithinRoot(root, input.targetPrimary),
  );
  return dedupeExecutionWorkspaceRoots([
    input.targetPrimary,
    ...rewrittenRoots,
    ...externalExplicitRoots,
  ]);
}
