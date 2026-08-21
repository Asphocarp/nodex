import type { CodexConversationItem } from "../../../lib/types";

export interface GeneratedImageOutputState {
  visibleCompletedItems: CodexConversationItem[];
  pendingImageCount: number;
  shouldRender: boolean;
}
function getPathExtension(path: string): string {
  const withoutQueryOrFragment = path.split(/[?#]/u, 1)[0] ?? path;
  const extension = /\.([^.\\/]+)$/u.exec(withoutQueryOrFragment)?.[1];
  return extension?.toLowerCase() ?? "";
}

function isPendingGeneratedImage(item: CodexConversationItem): boolean {
  if (item.generatedImage?.src !== null) return false;
  return (
    item.generatedImage.status === "in_progress" || item.generatedImage.status === "inProgress"
  );
}

/** Exact `US`: presentation outputs suppress completed images, not pending work. */
export function resolveGeneratedImageOutputState(input: {
  items: readonly CodexConversationItem[];
  endResourcePaths: readonly string[];
  isTurnInProgress: boolean;
}): GeneratedImageOutputState {
  const completedItems = input.items.filter((item) => item.generatedImage?.src != null);
  const visibleCompletedItems = input.endResourcePaths.some(
    (path) => getPathExtension(path) === "pptx",
  )
    ? []
    : completedItems;
  const pendingImageCount = input.isTurnInProgress
    ? input.items.filter(isPendingGeneratedImage).length
    : 0;

  return {
    visibleCompletedItems,
    pendingImageCount,
    shouldRender: visibleCompletedItems.length > 0 || pendingImageCount > 0,
  };
}
