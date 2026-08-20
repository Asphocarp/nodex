import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { analyzeEffectBoundaries, type EffectBoundaryDiagnosticCode } from "./effect-boundaries";

const fixtureRoot = resolve(import.meta.dirname, "../fixtures/effect-boundaries");

function fixture(name: string): string {
  return readFileSync(resolve(fixtureRoot, name), "utf8");
}

function codes(path: string, name: string): EffectBoundaryDiagnosticCode[] {
  return analyzeEffectBoundaries({ path, sourceText: fixture(name) }).map(
    (diagnostic) => diagnostic.code,
  );
}

describe("Effect architecture boundaries", () => {
  test("keeps renderer and wire-contract code Effect-free", () => {
    expect(codes("src/shared/wire-contract.ts", "effect-import.ts")).toEqual([
      "effect-free-import",
    ]);
    expect(codes("src/renderer/runtime.ts", "effect-import.ts")).toEqual(["effect-free-import"]);
    expect(
      codes("packages/codex-app-server-protocol/src/v2/thread.ts", "effect-import.ts"),
    ).toEqual(["effect-free-import"]);
  });

  test("localizes unstable APIs and Effect execution", () => {
    expect(codes("src/main/effect-control-plane/session.ts", "unstable-import.ts")).toEqual([
      "unstable-outside-adapter",
    ]);
    expect(codes("src/main/core-client/supervisor.ts", "run-promise.ts")).toEqual([
      "run-outside-boundary",
    ]);
  });

  test("accepts the app-owned adapter and compatibility runtime seams", () => {
    expect(codes("src/main/effect-adapters/persistence.ts", "unstable-import.ts")).toEqual([]);
    expect(codes("src/main/effect-control-plane/runtime.ts", "run-promise.ts")).toEqual([]);
    expect(codes("src/main/effect-control-plane/runtime.test.ts", "run-promise.ts")).toEqual([]);
  });
});
