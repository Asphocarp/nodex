import { describe, expect, mock, test } from "bun:test";
import { createElement, useEffect } from "react";
import { render, settleAsyncRender } from "../test/dom";
import { CODEX_DEFAULT_SERVICE_TIER_STORAGE_KEY } from "./codex-service-tier-settings";

let invokeCalls: unknown[][] = [];

const storageMap = new Map<string, string>();

const mockStorage = {
  getItem(key: string): string | null {
    return storageMap.has(key) ? storageMap.get(key) ?? null : null;
  },
  setItem(key: string, value: string): void {
    storageMap.set(key, value);
  },
  removeItem(key: string): void {
    storageMap.delete(key);
  },
};

if (!(globalThis as { localStorage?: unknown }).localStorage) {
  (globalThis as { localStorage: typeof mockStorage }).localStorage = mockStorage;
}

const localStorageRef = (globalThis as { localStorage: typeof mockStorage }).localStorage;

mock.module("./use-codex-thread-follower-client-deps", () => ({
  invoke: async (...args: unknown[]) => {
    invokeCalls.push(args);
    return null;
  },
}));

function resetStorage(): void {
  invokeCalls = [];
  storageMap.clear();
  localStorageRef.removeItem(CODEX_DEFAULT_SERVICE_TIER_STORAGE_KEY);
}

describe("use-codex-thread-follower-client", () => {
  test("falls back to the persisted fast tier when a request omits serviceTier", async () => {
    resetStorage();
    localStorageRef.setItem(CODEX_DEFAULT_SERVICE_TIER_STORAGE_KEY, "fast");

    const { CodexServiceTierSettingsProvider } = await import("./use-codex-service-tier-settings");
    const { useCodexThreadFollowerClient } = await import("./use-codex-thread-follower-client");

    function Probe() {
      const client = useCodexThreadFollowerClient({
        projectId: "project-1",
        permissionMode: "auto",
        model: "gpt-5.3-codex",
        reasoningEffort: "high",
      });

      useEffect(() => {
        void client.startTurn("thread-1", "Ship the change");
      }, [client.startTurn]);

      return createElement("div");
    }

    render(
      <CodexServiceTierSettingsProvider>
        <Probe />
      </CodexServiceTierSettingsProvider>,
    );
    await settleAsyncRender();

    expect(invokeCalls.length).toBe(1);
    expect(invokeCalls[0]?.[0]).toBe("codex:turn:start");
    expect(JSON.stringify(invokeCalls[0]?.[3])).toBe(JSON.stringify({
      permissionMode: "auto",
      model: "gpt-5.3-codex",
      reasoningEffort: "high",
      collaborationMode: undefined,
      serviceTier: "fast",
    }));
  });

  test("explicit standard clears a persisted fast default", async () => {
    resetStorage();
    localStorageRef.setItem(CODEX_DEFAULT_SERVICE_TIER_STORAGE_KEY, "fast");

    const { CodexServiceTierSettingsProvider } = await import("./use-codex-service-tier-settings");
    const { useCodexThreadFollowerClient } = await import("./use-codex-thread-follower-client");

    function Probe() {
      const client = useCodexThreadFollowerClient({
        projectId: "project-1",
        permissionMode: "auto",
        model: "gpt-5.3-codex",
        reasoningEffort: "high",
      });

      useEffect(() => {
        void client.startTurn("thread-1", "Ship the change", { serviceTier: null });
      }, [client.startTurn]);

      return createElement("div");
    }

    render(
      <CodexServiceTierSettingsProvider>
        <Probe />
      </CodexServiceTierSettingsProvider>,
    );
    await settleAsyncRender();

    expect(invokeCalls.length).toBe(1);
    expect(JSON.stringify(invokeCalls[0]?.[3])).toBe(JSON.stringify({
      permissionMode: "auto",
      model: "gpt-5.3-codex",
      reasoningEffort: "high",
      collaborationMode: undefined,
    }));
  });

  test("preserves an explicit fast tier when provided", async () => {
    resetStorage();

    const { CodexServiceTierSettingsProvider } = await import("./use-codex-service-tier-settings");
    const { useCodexThreadFollowerClient } = await import("./use-codex-thread-follower-client");

    function Probe() {
      const client = useCodexThreadFollowerClient({
        projectId: "project-1",
        permissionMode: "auto",
        model: "gpt-5.3-codex",
        reasoningEffort: "high",
      });

      useEffect(() => {
        void client.enqueueQueuedFollowUp("thread-1", "Queue this", { serviceTier: "fast" });
      }, [client.enqueueQueuedFollowUp]);

      return createElement("div");
    }

    render(
      <CodexServiceTierSettingsProvider>
        <Probe />
      </CodexServiceTierSettingsProvider>,
    );
    await settleAsyncRender();

    expect(invokeCalls.length).toBe(1);
    expect(invokeCalls[0]?.[0]).toBe("codex:thread:follow-up:enqueue");
    expect(JSON.stringify(invokeCalls[0]?.[3])).toBe(JSON.stringify({
      permissionMode: "auto",
      model: "gpt-5.3-codex",
      reasoningEffort: "high",
      collaborationMode: undefined,
      serviceTier: "fast",
    }));
  });
});
