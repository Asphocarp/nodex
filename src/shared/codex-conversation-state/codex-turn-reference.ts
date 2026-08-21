export interface CodexTurnReference {
  readonly turnId: string | null;
  readonly status: "completed" | "interrupted" | "failed" | "inProgress";
  readonly hasError: boolean;
  readonly itemCount: number;
}

export interface ResolveCodexTurnReferenceOptions {
  readonly rebindLatestInProgressPlaceholder?: boolean;
}

export type CodexTurnReferenceResolution =
  | { readonly kind: "none" }
  | { readonly kind: "latest"; readonly turnIndex: number }
  | { readonly kind: "existing"; readonly turnIndex: number }
  | {
      readonly kind: "reboundInProgressPlaceholder";
      readonly turnIndex: number;
    }
  | {
      readonly kind: "reboundCompletedEmptyPlaceholder";
      readonly turnIndex: number;
    };

/** Exact `_Q` turn selection shared by non-synthesizing event families. */
export function resolveCodexTurnReference(
  turns: readonly CodexTurnReference[],
  turnId: string | null,
  options: ResolveCodexTurnReferenceOptions = {},
): CodexTurnReferenceResolution {
  const latestTurnIndex = turns.length - 1;
  const latestTurn = turns[latestTurnIndex];
  if (!latestTurn) return { kind: "none" };

  if (!turnId) {
    return { kind: "latest", turnIndex: latestTurnIndex };
  }

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.turnId === turnId) {
      return { kind: "existing", turnIndex: index };
    }
  }

  if (
    options.rebindLatestInProgressPlaceholder === true &&
    latestTurn.turnId === null &&
    latestTurn.status === "inProgress"
  ) {
    return {
      kind: "reboundInProgressPlaceholder",
      turnIndex: latestTurnIndex,
    };
  }

  if (
    turns.length === 1 &&
    latestTurn.turnId === null &&
    latestTurn.status === "completed" &&
    !latestTurn.hasError &&
    latestTurn.itemCount === 0
  ) {
    return {
      kind: "reboundCompletedEmptyPlaceholder",
      turnIndex: latestTurnIndex,
    };
  }

  return { kind: "none" };
}
