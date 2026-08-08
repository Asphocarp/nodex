export interface PageCreateDialogLayout {
  readonly width: number;
  readonly topViewportPercent: number;
  readonly minimumWritingHeight: number;
  readonly fillsAvailableHeight: boolean;
}

export function resolvePageCreateDialogLayout(
  expanded: boolean,
): PageCreateDialogLayout {
  if (expanded) {
    return {
      width: 820,
      topViewportPercent: 6,
      minimumWritingHeight: 320,
      fillsAvailableHeight: true,
    };
  }

  return {
    width: 750,
    topViewportPercent: 13,
    minimumWritingHeight: 79,
    fillsAvailableHeight: false,
  };
}
