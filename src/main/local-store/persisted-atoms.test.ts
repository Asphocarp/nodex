import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  commitPersistedAtomMutation,
  readPersistedAtomSnapshot,
  readPersistedAtomState,
  resetPersistedAtomStateForTests,
  setPersistedAtomsPathOverrideForTests,
  updatePersistedAtom,
} from "./persisted-atoms";

function withTempStore<T>(callback: (atomsPath: string) => T): T {
  const storeDir = mkdtempSync(join(tmpdir(), "nodex-persisted-atoms-"));
  const atomsPath = join(storeDir, "persisted-atoms-v1.json");
  setPersistedAtomsPathOverrideForTests(atomsPath);

  try {
    return callback(atomsPath);
  } finally {
    setPersistedAtomsPathOverrideForTests(null);
    rmSync(storeDir, { recursive: true, force: true });
  }
}

describe("persisted atom local store", () => {
  afterEach(() => {
    setPersistedAtomsPathOverrideForTests(null);
    resetPersistedAtomStateForTests();
  });

  test("reads and writes the atom map as local JSON", () => {
    withTempStore((atomsPath) => {
      expect(JSON.stringify(readPersistedAtomState())).toBe("{}");
      const nextState = updatePersistedAtom({
        key: "prompt-history",
        value: ["first prompt"],
      });

      expect(JSON.stringify(nextState)).toBe("{\"prompt-history\":[\"first prompt\"]}");
      expect(existsSync(atomsPath)).toBe(true);
      expect(readFileSync(atomsPath, "utf8")).toBe("{\n  \"prompt-history\": [\n    \"first prompt\"\n  ]\n}");
    });
  });

  test("assigns ordered revisions only after durable mutation succeeds", () => {
    withTempStore((atomsPath) => {
      const first = commitPersistedAtomMutation({
        key: " prompt-history ",
        value: ["first"],
        mutationId: "mutation-1",
      }, "renderer-7");
      const second = commitPersistedAtomMutation({
        key: "prompt-history",
        value: ["second"],
        mutationId: "mutation-2",
      }, "renderer-9");

      expect(first).toEqual({
        key: "prompt-history",
        value: ["first"],
        mutationId: "mutation-1",
        revision: 1,
        originRendererId: "renderer-7",
      });
      expect(second.revision).toBe(2);
      expect(readPersistedAtomSnapshot()).toEqual({
        revision: 2,
        values: { "prompt-history": ["second"] },
      });
      expect(JSON.parse(readFileSync(atomsPath, "utf8"))).toEqual({
        "prompt-history": ["second"],
      });
    });
  });

  test("does not advance the revision when the durable write fails", () => {
    const storeDir = mkdtempSync(join(tmpdir(), "nodex-persisted-atoms-failure-"));
    setPersistedAtomsPathOverrideForTests(storeDir);
    try {
      expect(() => commitPersistedAtomMutation({
        key: "draft",
        value: "not persisted",
        mutationId: "mutation-failed",
      }, "renderer-1")).toThrow();
      expect(readPersistedAtomSnapshot()).toEqual({ revision: 0, values: {} });
    } finally {
      setPersistedAtomsPathOverrideForTests(null);
      rmSync(storeDir, { recursive: true, force: true });
    }
  });

  test("ignores blank keys and falls back to an empty map for invalid JSON", () => {
    withTempStore((atomsPath) => {
      expect(JSON.stringify(updatePersistedAtom({ key: "   ", value: "ignored" }))).toBe("{}");
      writeFileSync(atomsPath, "not json", "utf8");
      resetPersistedAtomStateForTests();

      expect(JSON.stringify(readPersistedAtomState())).toBe("{}");
    });
  });
});
