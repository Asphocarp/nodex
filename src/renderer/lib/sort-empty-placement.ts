export type SortEmptyPlacement = "first" | "last";

export const DEFAULT_SORT_EMPTY_PLACEMENT: SortEmptyPlacement = "last";

export function supportsSortEmptyPlacementField(field: string): field is "priority" | "estimate" {
  return field === "priority" || field === "estimate";
}

export function normalizeSortEmptyPlacement(value: unknown): SortEmptyPlacement {
  return value === "first" ? "first" : DEFAULT_SORT_EMPTY_PLACEMENT;
}

export function buildSortKeyWithEmptyPlacement<
  TField extends string,
  TDirection extends string,
>(args: {
  field: TField;
  direction: TDirection;
  emptyPlacement?: unknown;
}): {
  field: TField;
  direction: TDirection;
  emptyPlacement?: SortEmptyPlacement;
} {
  const key = {
    field: args.field,
    direction: args.direction,
  };
  if (!supportsSortEmptyPlacementField(args.field)) {
    return key;
  }

  const emptyPlacement = normalizeSortEmptyPlacement(args.emptyPlacement);
  if (emptyPlacement === DEFAULT_SORT_EMPTY_PLACEMENT) {
    return key;
  }

  return {
    ...key,
    emptyPlacement,
  };
}

export function resolveSortEmptyPlacement(
  field: string,
  emptyPlacement?: SortEmptyPlacement,
): SortEmptyPlacement {
  if (!supportsSortEmptyPlacementField(field)) {
    return DEFAULT_SORT_EMPTY_PLACEMENT;
  }
  return normalizeSortEmptyPlacement(emptyPlacement);
}

export function compareNullableRanks(args: {
  leftRank: number | null;
  rightRank: number | null;
  direction: "asc" | "desc";
  emptyPlacement?: SortEmptyPlacement;
}): number {
  if (args.leftRank === null && args.rightRank === null) {
    return 0;
  }
  const resolvedEmptyPlacement = normalizeSortEmptyPlacement(args.emptyPlacement);
  if (args.leftRank === null) {
    return resolvedEmptyPlacement === "first" ? -1 : 1;
  }
  if (args.rightRank === null) {
    return resolvedEmptyPlacement === "first" ? 1 : -1;
  }

  const sign = args.direction === "asc" ? 1 : -1;
  return (args.leftRank - args.rightRank) * sign;
}
