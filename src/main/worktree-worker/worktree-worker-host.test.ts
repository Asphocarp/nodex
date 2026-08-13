import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { CodexWorktreeWorkerCreateInput } from "../codex/codex-worktree-worker-port";
import { CodexWorktreeWorkerHost } from "./worktree-worker-host";

let fixtureRoot = "";
let fixturePath = "";

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), "nodex-worktree-worker-host-test-"));
  fixturePath = path.join(fixtureRoot, "fixture.mjs");
  await writeFile(fixturePath, `
import { parentPort, workerData } from "node:worker_threads";
const port = parentPort;
if (!port) throw new Error("missing parent port");
const active = new Set();
port.on("message", (message) => {
  if (message.type === "shutdown") {
    port.close();
    return;
  }
  if (message.type === "cancel") {
    active.delete(message.id);
    port.postMessage({ type: "result", id: message.id, result: { type: "error", message: "Request canceled" } });
    return;
  }
  if (message.type === "remove") {
    port.postMessage({ type: "result", id: message.id, result: { type: "ok", value: null } });
    return;
  }
  if (message.input.threadTitle === "crash") process.exit(23);
  const roots = {
    worktreeGitRoot: "/worktrees/abcd/repo",
    worktreeWorkspaceRoot: "/worktrees/abcd/repo/packages/app",
  };
  port.postMessage({ type: "event", id: message.id, event: { type: "path-allocated", ...roots } });
  if (message.input.threadTitle === "hang") {
    active.add(message.id);
    return;
  }
  port.postMessage({
    type: "result",
    id: message.id,
    result: { type: "ok", value: { ...roots, setupError: null, shellEnvironment: null } },
  });
});
port.postMessage({ type: "ready", epoch: workerData.epoch, protocolVersion: 1 });
`, "utf8");
});

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

function createInput(threadTitle: string): CodexWorktreeWorkerCreateInput {
  return {
    requestId: `request:${threadTitle}`,
    hostId: "local",
    repositoryPath: "/repo",
    nodexHome: "/nodex",
    projectId: "project-1",
    targetId: "pending-1",
    threadTitle,
    startingState: { type: "branch", branchName: "main" },
    localEnvironmentConfigPath: null,
    setUpSyncedBranch: true,
    propagateLocalWorkspaceFiles: true,
  };
}

describe("Codex worktree worker host", () => {
  test("streams events and restarts cleanly after a worker crash", async () => {
    const infrastructureErrors: string[] = [];
    const host = new CodexWorktreeWorkerHost({
      workerPath: fixturePath,
      onInfrastructureError: (error) => infrastructureErrors.push(error.message),
    });
    try {
      await expect(host.create(createInput("crash"), {
        signal: new AbortController().signal,
        onEvent: () => undefined,
      })).rejects.toThrow("temporarily unavailable");
      expect(infrastructureErrors.length).toBe(1);

      const events: string[] = [];
      const result = await host.create(createInput("success"), {
        signal: new AbortController().signal,
        onEvent: (event) => events.push(event.type),
      });
      expect(events).toEqual(["path-allocated"]);
      expect(result.worktreeWorkspaceRoot).toBe("/worktrees/abcd/repo/packages/app");
    } finally {
      await host.shutdown();
    }
  });

  test("cancels an in-flight request without poisoning the worker", async () => {
    const host = new CodexWorktreeWorkerHost({ workerPath: fixturePath });
    const controller = new AbortController();
    let markAllocated!: () => void;
    const allocated = new Promise<void>((resolve) => {
      markAllocated = resolve;
    });
    try {
      const pending = host.create(createInput("hang"), {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "path-allocated") markAllocated();
        },
      });
      await allocated;
      controller.abort();
      await expect(pending).rejects.toThrow("Request canceled");

      await expect(host.create(createInput("success"), {
        signal: new AbortController().signal,
        onEvent: () => undefined,
      })).resolves.toMatchObject({ setupError: null });
    } finally {
      await host.shutdown();
    }
  });

  test("cancels and rejects when an event consumer fails", async () => {
    const host = new CodexWorktreeWorkerHost({ workerPath: fixturePath });
    try {
      await expect(host.create(createInput("hang"), {
        signal: new AbortController().signal,
        onEvent: () => {
          throw new Error("event consumer failed");
        },
      })).rejects.toThrow("event consumer failed");

      await expect(host.create(createInput("success"), {
        signal: new AbortController().signal,
        onEvent: () => undefined,
      })).resolves.toMatchObject({ setupError: null });
    } finally {
      await host.shutdown();
    }
  });
});
