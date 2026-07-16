import type { ProjectSessionPageStageAncestor } from "./types";

export const MAX_PAGE_STAGE_ANCESTOR_DEPTH = 32;

function isSamePage(
  left: ProjectSessionPageStageAncestor,
  right: ProjectSessionPageStageAncestor,
): boolean {
  return left.pageId === right.pageId;
}

export function appendPageStageAncestor(
  ancestors: readonly ProjectSessionPageStageAncestor[],
  current: ProjectSessionPageStageAncestor,
): ProjectSessionPageStageAncestor[] {
  let path: ProjectSessionPageStageAncestor[] = [];

  for (const ancestor of [...ancestors, current]) {
    const repeatedIndex = path.findIndex((entry) => isSamePage(entry, ancestor));
    path = repeatedIndex >= 0
      ? [...path.slice(0, repeatedIndex), ancestor]
      : [...path, ancestor];
  }

  return path.slice(-MAX_PAGE_STAGE_ANCESTOR_DEPTH);
}
