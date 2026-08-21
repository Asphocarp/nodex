import { describe, expect, test } from "vite-plus/test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { PersistedAtomStore } from "./persisted-atoms";

function withTempStore<T>(callback: (store: PersistedAtomStore, atomsPath: string) => T): T {
  const storeDir = mkdtempSync(join(tmpdir(), "nodex-persisted-atoms-"));
  const atomsPath = join(storeDir, "persisted-atoms-v1.json");

  try {
    return callback(new PersistedAtomStore(atomsPath), atomsPath);
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
}

describe("persisted atom local store", () => {
  test("reads and writes the atom map as local JSON", () => {
    withTempStore((store, atomsPath) => {
      expect(JSON.stringify(store.readState())).toBe("{}");
      const nextState = store.update({
        key: "prompt-history",
        value: ["first prompt"],
      });

      expect(JSON.stringify(nextState)).toBe('{"prompt-history":["first prompt"]}');
      expect(existsSync(atomsPath)).toBe(true);
      expect(readFileSync(atomsPath, "utf8")).toBe(
        '{\n  "prompt-history": [\n    "first prompt"\n  ]\n}',
      );
    });
  });

  test("assigns ordered revisions only after durable mutation succeeds", () => {
    withTempStore((store, atomsPath) => {
      const first = store.commitMutation(
        {
          key: " prompt-history ",
          value: ["first"],
          mutationId: "mutation-1",
        },
        "renderer-7",
      );
      const second = store.commitMutation(
        {
          key: "prompt-history",
          value: ["second"],
          mutationId: "mutation-2",
        },
        "renderer-9",
      );

      expect(first).toEqual({
        key: "prompt-history",
        value: ["first"],
        mutationId: "mutation-1",
        revision: 1,
        originRendererId: "renderer-7",
      });
      expect(second.revision).toBe(2);
      expect(store.readSnapshot()).toEqual({
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
    const store = new PersistedAtomStore(storeDir);
    try {
      expect(() =>
        store.commitMutation(
          {
            key: "draft",
            value: "not persisted",
            mutationId: "mutation-failed",
          },
          "renderer-1",
        ),
      ).toThrow();
      expect(store.readSnapshot()).toEqual({ revision: 0, values: {} });
    } finally {
      rmSync(storeDir, { recursive: true, force: true });
    }
  });

  test("ignores blank keys and falls back to an empty map for invalid JSON", () => {
    withTempStore((store, atomsPath) => {
      expect(JSON.stringify(store.update({ key: "   ", value: "ignored" }))).toBe("{}");
      writeFileSync(atomsPath, "not json", "utf8");

      expect(JSON.stringify(new PersistedAtomStore(atomsPath).readState())).toBe("{}");
    });
  });

  test("isolates cache and revision state between Main owners", () => {
    withTempStore((first, atomsPath) => {
      first.update({ key: "draft", value: "persisted" });
      expect(first.readSnapshot().revision).toBe(1);

      const replacement = new PersistedAtomStore(atomsPath);
      expect(replacement.readSnapshot()).toEqual({
        revision: 0,
        values: { draft: "persisted" },
      });
    });
  });
});
