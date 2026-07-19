import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { describe, expect, test } from "vitest";

import { CoreClient } from "./core-client";
import { readCoreRuntimeConnection } from "./runtime-descriptor";
import type {
  CoreEventEnvelope,
  CoreEventSubscription,
  CoreRuntimeDescriptor,
} from "./types";

const CORE_BINARY = path.resolve("target/debug/nodex-core");

const spawnCore = (nodexHome: string): ChildProcessWithoutNullStreams =>
  spawn(CORE_BINARY, ["--home", nodexHome], {
    stdio: ["pipe", "pipe", "pipe"],
  });

const readDescriptor = (
  child: ChildProcessWithoutNullStreams,
): Promise<CoreRuntimeDescriptor> =>
  new Promise((resolve, reject) => {
    const lines = createInterface({ input: child.stdout });
    const timeout = setTimeout(() => {
      lines.close();
      reject(new Error("Core did not publish a runtime descriptor"));
    }, 5_000);
    lines.once("line", (line) => {
      clearTimeout(timeout);
      lines.close();
      resolve(JSON.parse(line) as CoreRuntimeDescriptor);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      lines.close();
      reject(error);
    });
  });

const waitForExit = (
  child: ChildProcessWithoutNullStreams,
): Promise<number | null> => {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Core process ${child.pid} did not exit`));
    }, 5_000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
};

const withTimeout = async <Value>(
  promise: Promise<Value>,
  message: string,
): Promise<Value> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), 5_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

describe("CoreClient over a Unix socket", () => {
  test("reuses one daemon and completes handshake, read, apply, event, and shutdown", async () => {
    expect(existsSync(CORE_BINARY), "run pnpm run core:test:client").toBe(true);
    const nodexHome = mkdtempSync(path.join(tmpdir(), "nodex-core-client-"));
    const children = [spawnCore(nodexHome), spawnCore(nodexHome)];
    let subscription: CoreEventSubscription | undefined;

    try {
      const descriptors = await Promise.all(children.map(readDescriptor));
      expect(descriptors[0]?.pid).toBe(descriptors[1]?.pid);
      expect(descriptors[0]?.start_nonce).toBe(descriptors[1]?.start_nonce);
      const winnerPid = descriptors[0]?.pid;
      expect(children.some((child) => child.pid === winnerPid)).toBe(true);

      const client = await CoreClient.connect({
        nodexHome,
        clientKind: "test",
        buildId: "node-integration-test",
        projectId: "project:default",
      });
      expect(client.handshake.pid).toBe(winnerPid);

      const descriptorPath = path.join(nodexHome, "run/core/core.json");
      chmodSync(descriptorPath, 0o644);
      try {
        expect(() => readCoreRuntimeConnection(nodexHome)).toThrow(
          "Core runtime descriptor has mode 644; expected 600",
        );
      } finally {
        chmodSync(descriptorPath, 0o600);
      }

      let resolveEvent: ((event: CoreEventEnvelope) => void) | undefined;
      const observedEvent = new Promise<CoreEventEnvelope>((resolve) => {
        resolveEvent = resolve;
      });
      subscription = await client.openEventStream(0, (event) => resolveEvent?.(event));

      const snapshot = await client.libraryRead({ kind: "metadata" });
      expect(snapshot.event_head).toBe(0);
      expect(snapshot.value).toMatchObject({
        kind: "metadata",
        library_id: client.handshake.library_id,
      });

      const applyInput = {
        operationId: "node-operation-1",
        intent: {
          kind: "create_page" as const,
          page_id: "page:node-integration",
          document_id: "document:node-integration",
          title: "Node integration",
          parent: { kind: "library" as const, before: null },
        },
      };
      const committed = await client.libraryApply(applyInput);
      expect(committed.event_sequence).toBeGreaterThanOrEqual(1);
      expect(committed.receipt.duplicate).toBe(false);

      const event = await withTimeout(observedEvent, "Core Module event was not observed");
      expect(event.event.sequence).toBe(committed.event_sequence);
      expect(event.event.payload).toMatchObject({
        module: "library",
        event: {
          kind: "library_changed",
          page_ids: ["page:node-integration"],
        },
      });

      const replay = await client.libraryApply(applyInput);
      expect(replay.event_sequence).toBe(committed.event_sequence);
      expect(replay.receipt.duplicate).toBe(true);

      subscription.close();
      await subscription.done;
      subscription = undefined;
      await expect(client.shutdown()).resolves.toEqual({ status: "draining" });
      const exitCodes = await Promise.all(children.map(waitForExit));
      expect(exitCodes).toEqual([0, 0]);
      expect(existsSync(path.join(nodexHome, "run/core/core.sock"))).toBe(false);
      expect(existsSync(path.join(nodexHome, "run/core/core.json"))).toBe(false);
      expect(existsSync(path.join(nodexHome, "run/core/core.auth"))).toBe(false);
    } finally {
      subscription?.close();
      for (const child of children) {
        if (child.exitCode === null) child.kill();
      }
      await Promise.all(children.map((child) => waitForExit(child).catch(() => null)));
      rmSync(nodexHome, { recursive: true, force: true });
    }
  });
});
