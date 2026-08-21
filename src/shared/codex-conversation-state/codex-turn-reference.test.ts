import { describe, expect, test } from "vite-plus/test";
import { resolveCodexTurnReference, type CodexTurnReference } from "./codex-turn-reference";

function turn(
  turnId: string | null,
  overrides: Partial<CodexTurnReference> = {},
): CodexTurnReference {
  return {
    turnId,
    status: "inProgress",
    hasError: false,
    itemCount: 0,
    ...overrides,
  };
}

describe("Codex non-synthesizing turn reference resolution", () => {
  test("returns none without turns and uses the latest turn for a nullable ID", () => {
    const noTurns = resolveCodexTurnReference([], "missing");
    const turns = [turn("older"), turn("latest")];
    const latest = resolveCodexTurnReference(turns, null);

    expect(noTurns.kind).toBe("none");
    expect(latest.kind).toBe("latest");
    expect(latest.kind === "latest" ? latest.turnIndex : -1).toBe(1);
  });

  test("finds the newest duplicate exact turn ID", () => {
    const result = resolveCodexTurnReference(
      [turn("duplicate"), turn("between"), turn("duplicate")],
      "duplicate",
    );

    expect(result.kind).toBe("existing");
    expect(result.kind === "existing" ? result.turnIndex : -1).toBe(2);
  });

  test("rebinds an in-progress null placeholder only when the event opts in", () => {
    const turns = [turn("older"), turn(null)];
    const disabled = resolveCodexTurnReference(turns, "bound-turn");
    const enabled = resolveCodexTurnReference(turns, "bound-turn", {
      rebindLatestInProgressPlaceholder: true,
    });
    const namedLatest = resolveCodexTurnReference(
      [turn("older"), turn("different-live-turn")],
      "bound-turn",
      { rebindLatestInProgressPlaceholder: true },
    );

    expect(disabled.kind).toBe("none");
    expect(enabled.kind).toBe("reboundInProgressPlaceholder");
    expect(enabled.kind === "reboundInProgressPlaceholder" ? enabled.turnIndex : -1).toBe(1);
    expect(namedLatest.kind).toBe("none");
  });

  test("rebinds only the sole completed error-free empty null placeholder", () => {
    const eligible = turn(null, { status: "completed" });
    const rebound = resolveCodexTurnReference([eligible], "bound-turn");
    const withError = resolveCodexTurnReference(
      [turn(null, { status: "completed", hasError: true })],
      "bound-turn",
    );
    const withItems = resolveCodexTurnReference(
      [turn(null, { status: "completed", itemCount: 1 })],
      "bound-turn",
    );
    const notSole = resolveCodexTurnReference(
      [turn("older", { status: "completed" }), eligible],
      "bound-turn",
    );

    expect(rebound.kind).toBe("reboundCompletedEmptyPlaceholder");
    expect(rebound.kind === "reboundCompletedEmptyPlaceholder" ? rebound.turnIndex : -1).toBe(0);
    expect(withError.kind).toBe("none");
    expect(withItems.kind).toBe("none");
    expect(notSole.kind).toBe("none");
  });
});
