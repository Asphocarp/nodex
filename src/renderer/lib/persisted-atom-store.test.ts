import { beforeEach, describe, expect, test } from "bun:test";
import { installWindowApi } from "@/test/browser-globals";
import {
  clearPersistedAtomStoreForTests,
  readAtom,
  subscribeAtom,
  writeAtom,
} from "./persisted-atom-store";

type BridgeListener = (...args: unknown[]) => void;

function clearWindowApi(): void {
  Object.defineProperty(window, "api", {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

describe("persisted atom renderer store", () => {
  beforeEach(() => {
    clearPersistedAtomStoreForTests();
    clearWindowApi();
  });

  test("uses an in-memory fallback when the Electron bridge is unavailable", async () => {
    const seen: string[] = [];
    const unsubscribe = subscribeAtom("prompt-history", (value) => {
      seen.push(String(value));
    });

    expect(await readAtom("prompt-history", "fallback")).toBe("fallback");
    await writeAtom("prompt-history", "stored");

    expect(await readAtom("prompt-history", "fallback")).toBe("stored");
    expect(seen.join("|")).toBe("stored");
    unsubscribe();
  });

  test("uses the Electron IPC bridge and subscribes to atom update events", async () => {
    let bridgeState: Record<string, unknown> = { alpha: "one" };
    const persistedAtomListenerRef: { current: BridgeListener | null } = { current: null };
    const invokedChannels: string[] = [];
    const seen: string[] = [];

    installWindowApi({
      invoke: async (channel: string, ...args: unknown[]) => {
        invokedChannels.push(channel);
        if (channel === "persisted-atom:sync-request") {
          return bridgeState;
        }
        if (channel === "persisted-atom:update") {
          const update = args[0] as { key: string; value: unknown };
          bridgeState = {
            ...bridgeState,
            [update.key]: update.value,
          };
          return bridgeState;
        }
        return null;
      },
      on: (channel: string, listener: BridgeListener) => {
        if (channel !== "persisted-atom:updated") return () => {};
        persistedAtomListenerRef.current = listener;
        return () => {
          if (persistedAtomListenerRef.current === listener) {
            persistedAtomListenerRef.current = null;
          }
        };
      },
    });
    clearPersistedAtomStoreForTests();

    expect(await readAtom("alpha", "fallback")).toBe("one");

    const unsubscribe = subscribeAtom("gamma", (value) => {
      seen.push(String(value));
    });
    persistedAtomListenerRef.current?.({ key: "gamma", value: "three" });

    expect(seen.join("|")).toBe("three");
    await writeAtom("beta", "two");
    expect(await readAtom("beta", "fallback")).toBe("two");
    expect(invokedChannels.join("|")).toBe("persisted-atom:sync-request|persisted-atom:update");
    unsubscribe();
  });
});
