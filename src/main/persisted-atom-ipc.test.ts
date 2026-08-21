import { afterEach, describe, expect, test } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PersistedAtomEvent,
  PersistedAtomMutation,
  PersistedAtomSnapshot,
} from "../shared/ipc-api";
import {
  resetPersistedAtomStateForTests,
  setPersistedAtomsPathOverrideForTests,
} from "./local-store/persisted-atoms";
import { registerPersistedAtomIpc } from "./persisted-atom-ipc";

describe("persisted atom IPC ordering", () => {
  const directories: string[] = [];

  afterEach(() => {
    setPersistedAtomsPathOverrideForTests(null);
    resetPersistedAtomStateForTests();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("returns and broadcasts the same main-revisioned event", () => {
    const directory = mkdtempSync(join(tmpdir(), "nodex-persisted-ipc-"));
    directories.push(directory);
    setPersistedAtomsPathOverrideForTests(join(directory, "persisted-atoms-v1.json"));
    const syncRef: { current: (() => PersistedAtomSnapshot) | null } = { current: null };
    const mutateRef: {
      current: ((origin: string, mutation: PersistedAtomMutation) => PersistedAtomEvent) | null;
    } = { current: null };
    const broadcasts: PersistedAtomEvent[] = [];
    registerPersistedAtomIpc({
      registerSync: (listener) => {
        syncRef.current = listener;
      },
      registerMutation: (listener) => {
        mutateRef.current = listener;
      },
      broadcast: (event) => broadcasts.push(event),
    });

    const event = mutateRef.current?.("renderer-42", {
      key: "draft",
      value: "hello",
      mutationId: "mutation-1",
    });
    expect(event).toEqual({
      key: "draft",
      value: "hello",
      mutationId: "mutation-1",
      revision: 1,
      originRendererId: "renderer-42",
    });
    expect(broadcasts).toEqual([event]);
    expect(syncRef.current?.()).toEqual({ revision: 1, values: { draft: "hello" } });
  });
});
