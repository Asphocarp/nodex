import { describe, expect, test, vi } from "vite-plus/test";

import { STATIC_GROUPS } from "./ci-gate-plan";
import {
  parseStaticArguments,
  runStaticChecks,
  selectStaticChecks,
  STATIC_CHECKS,
} from "./verify-static";

describe("static CI groups", () => {
  test("partition every CI-selectable check exactly once", () => {
    const selected = STATIC_GROUPS.flatMap((group) => selectStaticChecks(STATIC_CHECKS, [group]));
    expect(selected.map(({ id }) => id)).toEqual(STATIC_CHECKS.map(({ id }) => id));
    expect(new Set(selected.map(({ id }) => id)).size).toBe(STATIC_CHECKS.length);
  });

  test("routes the integrated developer check through its cacheable task", () => {
    expect(STATIC_CHECKS.find(({ id }) => id === "integrated-check")?.command).toEqual([
      "run",
      "check",
    ]);
  });

  test("parses explicit groups and rejects empty, unknown, or duplicate groups", () => {
    expect(parseStaticArguments([])).toEqual({ groups: null });
    expect(parseStaticArguments(["--group", "types", "--group", "generated"])).toEqual({
      groups: ["types", "generated"],
    });
    expect(() => selectStaticChecks(STATIC_CHECKS, [])).toThrow("At least one");
    expect(() => parseStaticArguments(["--group", "surprise"])).toThrow("Unknown static group");
    expect(() => parseStaticArguments(["--group", "types", "--group", "types"])).toThrow(
      "must not be repeated",
    );
  });

  test("stops after the first failing command", () => {
    const execute = vi.fn((_executable: string, arguments_: readonly string[]) => {
      if (arguments_.includes("lint")) throw new Error("lint failed");
    });
    expect(() =>
      runStaticChecks(
        [
          { command: ["run", "typecheck"], name: "typecheck" },
          { command: ["run", "lint"], name: "lint" },
          { command: ["run", "build:landing"], name: "landing" },
        ],
        execute,
      ),
    ).toThrow("lint failed");
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
