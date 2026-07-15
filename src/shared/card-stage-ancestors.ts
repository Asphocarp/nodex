import type { ProjectSessionCardStageAncestor } from "./types";

export const MAX_CARD_STAGE_ANCESTOR_DEPTH = 32;

function isSameCard(
  left: ProjectSessionCardStageAncestor,
  right: ProjectSessionCardStageAncestor,
): boolean {
  return left.projectId === right.projectId && left.cardId === right.cardId;
}

export function appendCardStageAncestor(
  ancestors: readonly ProjectSessionCardStageAncestor[],
  current: ProjectSessionCardStageAncestor,
): ProjectSessionCardStageAncestor[] {
  let path: ProjectSessionCardStageAncestor[] = [];

  for (const ancestor of [...ancestors, current]) {
    const repeatedIndex = path.findIndex((entry) => isSameCard(entry, ancestor));
    path = repeatedIndex >= 0
      ? [...path.slice(0, repeatedIndex), ancestor]
      : [...path, ancestor];
  }

  return path.slice(-MAX_CARD_STAGE_ANCESTOR_DEPTH);
}
