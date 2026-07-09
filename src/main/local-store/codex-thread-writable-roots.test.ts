import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteCodexThreadWritableRoots,
  getCodexThreadWritableRoots,
  mergeCodexThreadWritableRoots,
  replaceCodexThreadWritableRoots,
  resetCodexThreadWritableRootsCacheForTests,
  setCodexThreadWritableRootsPathOverrideForTests,
} from "./codex-thread-writable-roots";

let temporaryDirectory: string | null = null;

afterEach(() => {
  setCodexThreadWritableRootsPathOverrideForTests(null);
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = null;
  }
});

describe("codex thread writable roots", () => {
  test("persists exact per-thread merge and replace semantics", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "nodex-writable-roots-"));
    const statePath = join(temporaryDirectory, "roots.json");
    setCodexThreadWritableRootsPathOverrideForTests(statePath);

    expect(JSON.stringify(mergeCodexThreadWritableRoots(
      "thread-a",
      ["relative", " /workspace/a ", "/workspace/a", "/workspace/b", "/workspace/a"],
    ))).toBe(JSON.stringify(["/workspace/a", "/workspace/b"]));
    resetCodexThreadWritableRootsCacheForTests();
    expect(JSON.stringify(getCodexThreadWritableRoots("thread-a"))).toBe(
      JSON.stringify(["/workspace/a", "/workspace/b"]),
    );

    expect(JSON.stringify(replaceCodexThreadWritableRoots(
      "thread-a",
      ["/workspace/c"],
    ))).toBe(JSON.stringify(["/workspace/c"]));
    deleteCodexThreadWritableRoots("thread-a");
    resetCodexThreadWritableRootsCacheForTests();
    expect(JSON.stringify(getCodexThreadWritableRoots("thread-a"))).toBe("[]");
  });
});
