import { describe, expect, test } from "vitest";
import { createMutationAuditSessionResolver } from "./mutation-audit-session";

interface MemoryStorage {
  values: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const createMemoryStorage = (): MemoryStorage => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

describe("mutation audit session", () => {
  test("reuses the durable renderer-window identity without querying history", () => {
    const storage = createMemoryStorage();
    let created = 0;
    const createId = () => {
      created += 1;
      return `renderer-window-${created}`;
    };

    const resolveSessionId = createMutationAuditSessionResolver(storage, createId);
    const first = resolveSessionId();
    const second = resolveSessionId();

    expect(first).toBe("renderer-window-1");
    expect(second).toBe(first);
    expect(created).toBe(1);
  });

  test("recovers from an invalid persisted value", () => {
    const storage = createMemoryStorage();
    storage.values.set("nodex-mutation-audit-session-id", "  invalid  ");

    const resolveSessionId = createMutationAuditSessionResolver(
      storage,
      () => "renderer-window-valid",
    );
    const sessionId = resolveSessionId();

    expect(sessionId).toBe("renderer-window-valid");
  });
});
