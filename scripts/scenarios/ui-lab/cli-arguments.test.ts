import { describe, expect, test } from "vitest";

import { parseUiLabCliArguments } from "./cli-arguments";

describe("UI Lab CLI arguments", () => {
  test("creates a mutable Lab session from a catalog seed", () => {
    expect(parseUiLabCliArguments([
      "open",
      "--",
      "--seed",
      "board/dense",
      "--dev",
    ])).toEqual({
      command: "open",
      appMode: "dev",
      target: { kind: "seed", scenarioId: "board/dense" },
    });
  });

  test("resumes a retained Lab session by session identity", () => {
    expect(parseUiLabCliArguments([
      "open",
      "--resume",
      "c1636eea-77a5-43ee-aa3b-c847b1c901b7",
      "--dev",
    ])).toEqual({
      command: "open",
      appMode: "dev",
      target: {
        kind: "resume",
        sessionId: "c1636eea-77a5-43ee-aa3b-c847b1c901b7",
      },
    });
  });

  test("keeps deterministic verification on the scenario catalog", () => {
    expect(parseUiLabCliArguments(["verify", "board/dense"])).toEqual({
      command: "verify",
      scenarioId: "board/dense",
    });
    expect(() => parseUiLabCliArguments([
      "verify",
      "board/dense",
      "--dev",
    ])).toThrow(/pnpm ui:verify/u);
  });

  test("requires exactly one seed or retained session", () => {
    expect(() => parseUiLabCliArguments(["open", "board/dense"]))
      .toThrow(/Unknown UI Lab option/u);
    expect(() => parseUiLabCliArguments([
      "open",
      "--seed",
      "board/dense",
      "--resume",
      "session-id",
    ])).toThrow(/exactly one seed or session/u);
    expect(() => parseUiLabCliArguments(["open", "--seed"]))
      .toThrow(/requires a value/u);
  });
});
