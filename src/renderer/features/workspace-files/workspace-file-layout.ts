export const WORKSPACE_TREE_DEFAULT_WIDTH = 250;
export const WORKSPACE_TREE_MIN_WIDTH = 200;
export const WORKSPACE_TREE_MAX_RATIO = 0.6;

export function clampWorkspaceTreeWidth(width: number, containerWidth: number): number {
  const finiteWidth = Number.isFinite(width) ? width : WORKSPACE_TREE_DEFAULT_WIDTH;
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return Math.max(WORKSPACE_TREE_MIN_WIDTH, finiteWidth);
  }
  const maxWidth = Math.max(WORKSPACE_TREE_MIN_WIDTH, containerWidth * WORKSPACE_TREE_MAX_RATIO);
  return Math.min(maxWidth, Math.max(WORKSPACE_TREE_MIN_WIDTH, finiteWidth));
}
