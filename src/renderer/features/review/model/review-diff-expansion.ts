export interface ReviewDiffExpansionOverride {
  readonly key: string;
  readonly expanded: boolean;
}

export interface ReviewDiffExpansionState {
  readonly allDiffsExpanded: boolean;
  readonly diffExpansionOverrides: readonly ReviewDiffExpansionOverride[];
  readonly diffExpansionSourceKey: string | null;
}

export function isReviewDiffExpanded(
  state: ReviewDiffExpansionState,
  key: string,
  inheritedExpanded = state.allDiffsExpanded,
): boolean {
  return (
    state.diffExpansionOverrides.find((override) => override.key === key)?.expanded ??
    inheritedExpanded
  );
}

export function setReviewDiffExpanded<State extends ReviewDiffExpansionState>(
  state: State,
  key: string,
  expanded: boolean,
  inheritedExpanded = state.allDiffsExpanded,
): State {
  if (isReviewDiffExpanded(state, key, inheritedExpanded) === expanded) {
    return state;
  }

  const nextOverrides = state.diffExpansionOverrides.filter((override) => override.key !== key);
  if (expanded !== inheritedExpanded) {
    nextOverrides.push({ key, expanded });
  }

  return {
    ...state,
    diffExpansionOverrides: nextOverrides,
  };
}

export function toggleReviewDiffExpanded<State extends ReviewDiffExpansionState>(
  state: State,
  key: string,
  inheritedExpanded = state.allDiffsExpanded,
): State {
  return setReviewDiffExpanded(
    state,
    key,
    !isReviewDiffExpanded(state, key, inheritedExpanded),
    inheritedExpanded,
  );
}

export function setAllReviewDiffsExpanded<State extends ReviewDiffExpansionState>(
  state: State,
  expanded: boolean,
): State {
  if (state.allDiffsExpanded === expanded && state.diffExpansionOverrides.length === 0) {
    return state;
  }

  return {
    ...state,
    allDiffsExpanded: expanded,
    diffExpansionOverrides: [],
  };
}

export function reconcileReviewDiffExpansionSource<State extends ReviewDiffExpansionState>(
  state: State,
  sourceKey: string,
  fileKeys: ReadonlySet<string>,
): State {
  if (state.diffExpansionSourceKey !== sourceKey) {
    return {
      ...state,
      allDiffsExpanded: true,
      diffExpansionOverrides: [],
      diffExpansionSourceKey: sourceKey,
    };
  }

  const nextOverrides = state.diffExpansionOverrides.filter((override) =>
    fileKeys.has(override.key),
  );
  if (nextOverrides.length === state.diffExpansionOverrides.length) return state;

  return {
    ...state,
    diffExpansionOverrides: nextOverrides,
  };
}
