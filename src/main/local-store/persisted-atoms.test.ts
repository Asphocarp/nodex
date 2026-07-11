import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
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

  test("ignores blank keys and falls back to an empty map for invalid JSON", () => {
    withTempStore((atomsPath) => {
      expect(JSON.stringify(updatePersistedAtom({ key: "   ", value: "ignored" }))).toBe("{}");
      writeFileSync(atomsPath, "not json", "utf8");
      resetPersistedAtomStateForTests();

      expect(JSON.stringify(readPersistedAtomState())).toBe("{}");
    });
  });
});
