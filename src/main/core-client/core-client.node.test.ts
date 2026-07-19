import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { describe, expect, test } from "vitest";

import { CoreClient, CoreModuleResponseError } from "./core-client";
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

      const startup = await client.workspaceRead({ kind: "startup" });
      expect(startup.value).toMatchObject({
        kind: "startup",
        projects: [{ id: "project:default", database_id: expect.any(String) }],
        sessions: [{ project_id: "project:default" }],
      });
      const threadInput = {
        operationId: "node-workspace-thread-1",
        intent: {
          kind: "upsert_thread" as const,
          thread_id: "thread:node-integration",
          patch: {
            project_id: "project:default",
            thread_name: "Node integration thread",
            thread_source: "appServer",
            thread_preview: "Persisted by native Workspace",
            model_provider: "openai",
            cwd: path.join(nodexHome, "workspace"),
            status: {
              status_type: "active" as const,
              active_flags: ["waitingOnApproval" as const],
            },
            created_at: 100,
            updated_at: 200,
            linked_at: "2026-07-19T06:00:00.000Z",
          },
        },
      };
      const threadCommitted = await client.workspaceApply(threadInput);
      const threadReplay = await client.workspaceApply(threadInput);
      expect(threadReplay.event_sequence).toBe(threadCommitted.event_sequence);
      expect(threadReplay.receipt.duplicate).toBe(true);
      await client.workspaceApply({
        operationId: "node-workspace-thread-catalogs-1",
        intent: {
          kind: "replace_thread_dynamic_tool_catalogs",
          thread_id: "thread:node-integration",
          catalogs: [{ namespace: "nodex_app", toolset_revision: 5 }],
        },
      });
      await client.workspaceApply({
        operationId: "node-workspace-thread-permission-1",
        intent: {
          kind: "set_project_permission_mode",
          project_id: "project:default",
          mode: "guardian-approvals",
        },
      });
      const executionContext = await client.workspaceRead({
        kind: "execution_context",
        thread_id: "thread:node-integration",
      });
      expect(executionContext.value).toMatchObject({
        kind: "execution_context",
        context: {
          permission_mode: "guardian-approvals",
          project: { id: "project:default" },
          thread: {
            thread_id: "thread:node-integration",
            project_id: "project:default",
            thread_name: "Node integration thread",
            status: {
              status_type: "active",
              active_flags: ["waitingOnApproval"],
            },
            dynamic_tool_catalogs: [{ namespace: "nodex_app", toolset_revision: 5 }],
          },
        },
      });
      const automationInput = {
        operationId: "node-automation-create-1",
        intent: {
          kind: "create_definition" as const,
          automation_id: "node-daily-report",
          definition: {
            kind: "cron" as const,
            name: "Node daily report",
            prompt: "Prepare the report",
            rrule: "FREQ=MINUTELY;INTERVAL=5",
            cwds: [path.join(nodexHome, "workspace")],
            execution_environment: "worktree" as const,
          },
        },
      };
      const automationCommitted = await client.automationApply(automationInput);
      expect(automationCommitted.value.definitions).toMatchObject([
        {
          automation_id: "node-daily-report",
          definition_revision: 1,
          status: "ACTIVE",
          next_run_at_ms: expect.any(Number),
        },
      ]);
      const automationReplay = await client.automationApply(automationInput);
      expect(automationReplay.event_sequence).toBe(automationCommitted.event_sequence);
      expect(automationReplay.receipt.duplicate).toBe(true);
      const automations = await client.automationRead({
        kind: "definitions",
        include_deleted: false,
      });
      expect(automations.value).toMatchObject({
        kind: "definitions",
        items: [{ automation_id: "node-daily-report" }],
      });
      const noDueWork = await client.automationApply({
        operationId: "node-automation-claim-1",
        intent: {
          kind: "claim_due",
          limit: 3,
          lease_duration_ms: 60_000,
        },
      });
      expect(noDueWork.value.claimed_leases).toEqual([]);
      const nativeCli = await CoreClient.connect({
        nodexHome,
        clientKind: "native_cli",
        buildId: "node-native-cli-test",
        projectId: "project:default",
      });
      const unauthorizedClaim = nativeCli.automationApply({
        operationId: "node-native-cli-automation-claim-1",
        intent: {
          kind: "claim_due",
          limit: 1,
          lease_duration_ms: 60_000,
        },
      });
      await expect(unauthorizedClaim).rejects.toBeInstanceOf(
        CoreModuleResponseError,
      );
      await expect(unauthorizedClaim).rejects.toMatchObject({
        coreError: { code: "unauthorized" },
      });
      const workspaceInput = {
        operationId: "node-workspace-create-1",
        intent: {
          kind: "create_project" as const,
          project_id: "project:node-integration",
          name: "Node workspace",
          description: "Created through the generated client",
          icon: "🧭",
          source_roots: [path.join(nodexHome, "workspace")],
        },
      };
      const workspaceCommitted = await client.workspaceApply(workspaceInput);
      expect(workspaceCommitted.event_sequence).toBeGreaterThan(
        committed.event_sequence,
      );
      expect(workspaceCommitted.receipt.duplicate).toBe(false);
      expect(workspaceCommitted.value.affected_project_ids).toEqual([
        "project:node-integration",
      ]);
      const workspaceReplay = await client.workspaceApply(workspaceInput);
      expect(workspaceReplay.event_sequence).toBe(
        workspaceCommitted.event_sequence,
      );
      expect(workspaceReplay.receipt.duplicate).toBe(true);
      const createdProject = await client.workspaceRead({
        kind: "project",
        project_id: "project:node-integration",
      });
      expect(createdProject.value).toMatchObject({
        kind: "project",
        project: {
          id: "project:node-integration",
          name: "Node workspace",
          primary_workspace_root: path.join(nodexHome, "workspace"),
        },
      });

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
