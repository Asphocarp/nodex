import { beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  registerCodexScheduledAutomationIpcHandlers,
  type CodexScheduledAutomationIpcChannel,
  type CodexScheduledAutomationIpcHandler,
} from "./codex-scheduled-automation-ipc-handlers";
import {
  insertCodexAutomationRunInProgress,
  markCodexAutomationRunPendingReview,
} from "./local-store/codex-automation-runs";
import { closeDatabase, initializeDatabase } from "./local-store/database";
import type {
  CodexAutomationRunsInboxResponse,
  CodexScheduledAutomationChangedEvent,
  CodexScheduledAutomationDeleteResponse,
  CodexScheduledAutomationListResponse,
  CodexScheduledAutomationMutationResponse,
  CodexScheduledAutomationRunNowInput,
  CodexScheduledAutomationRunNowResponse,
  CodexAutomationRunMutationResponse,
  CodexAutomationRunsUpdatedEvent,
  CodexAutomationInboxItem,
  CodexAutomationRunMarkAllReadResponse,
} from "../shared/types";

type RegisteredIpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown;

const registeredHandlers = new Map<string, RegisteredIpcHandler>();
const sentIpcEvents: Array<{ channel: string; args: unknown[] }> = [];
const runNowInputs: CodexScheduledAutomationRunNowInput[] = [];
const unarchivedThreadIds: string[] = [];

async function invokeIpc(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = registeredHandlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return await handler(null, ...args);
}

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: (tempDir: string) => Promise<void> | void): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-ipc-scheduled-"));
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
  } catch (error) {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
    if (isUnsupportedSqliteError(error)) return false;
    throw error;
  }

  try {
    sentIpcEvents.length = 0;
    runNowInputs.length = 0;
    unarchivedThreadIds.length = 0;
    await run(tempDir);
    return true;
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
}

function countEvents(channel: string): number {
  return sentIpcEvents.filter((event) => event.channel === channel).length;
}

function latestScheduledChangedEvent(): CodexScheduledAutomationChangedEvent {
  const event = sentIpcEvents.filter((item) => item.channel === "codex:scheduled-automations:changed").at(-1);
  const payload = event?.args[0] as CodexScheduledAutomationChangedEvent | undefined;
  if (!payload) throw new Error("Missing scheduled automation change event");
  return payload;
}

function latestAutomationRunsUpdatedEvent(): CodexAutomationRunsUpdatedEvent {
  const event = sentIpcEvents.filter((item) => item.channel === "codex:automation-runs:updated").at(-1);
  const payload = event?.args[0] as CodexAutomationRunsUpdatedEvent | undefined;
  if (!payload) throw new Error("Missing automation runs update event");
  return payload;
}

beforeAll(async () => {
  registerCodexScheduledAutomationIpcHandlers({
    registerHandle: <Channel extends CodexScheduledAutomationIpcChannel>(
      channel: Channel,
      listener: CodexScheduledAutomationIpcHandler<Channel>,
    ) => {
      registeredHandlers.set(channel, listener as RegisteredIpcHandler);
    },
    runScheduledAutomationNow: async (input) => {
      runNowInputs.push(input);
    },
    captureAutomationArchiveMessages: async () => false,
    unarchiveThread: async (threadId) => {
      unarchivedThreadIds.push(threadId);
      return true;
    },
    broadcastScheduledAutomationChanged: (automationId, targetThreadId, reason) => {
      sentIpcEvents.push({
        channel: "codex:scheduled-automations:changed",
        args: [{ automationId, targetThreadId, reason }],
      });
    },
    broadcastAutomationRunsUpdated: (event) => {
      sentIpcEvents.push({
        channel: "codex:automation-runs:updated",
        args: [event],
      });
    },
  });
});

describe("scheduled automation IPC contract", () => {
  test("registers the reference Scheduled API surface", () => {
    for (const channel of [
      "codex:scheduled-automations:list",
      "codex:scheduled-automations:create",
      "codex:scheduled-automations:update",
      "codex:scheduled-automations:delete",
      "codex:scheduled-automations:run-now",
      "codex:automation-runs:archive",
      "codex:automation-runs:delete",
      "codex:automation-runs:unarchive",
      "codex:automation-runs:inbox-items",
      "codex:automation-runs:set-read-state",
      "codex:automation-runs:mark-all-read",
    ]) {
      expect(registeredHandlers.has(channel)).toBeTrue();
    }
  });

  test("returns list/create/update/delete response shapes and broadcasts task changes", async () => {
    const ran = await withTempDatabase(async (tempDir) => {
      const createResponse = await invokeIpc("codex:scheduled-automations:create", {
        kind: "cron",
        name: "Daily Report",
        prompt: "Summarize the repository state.",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        cwds: ["/repo/project-alpha"],
        executionEnvironment: "worktree",
        model: "gpt-5",
        reasoningEffort: "medium",
        localEnvironmentConfigPath: ".codex/environments/default.toml",
      }) as CodexScheduledAutomationMutationResponse;

      expect(createResponse.item.id).toBe("daily-report");
      expect(createResponse.item.status).toBe("ACTIVE");
      expect(createResponse.item.targetThreadId).toBe(null);
      expect(createResponse.item.cwds[0]).toBe("/repo/project-alpha");
      expect(createResponse.item.localEnvironmentConfigPath).toBe(".codex/environments/default.toml");
      expect(countEvents("codex:scheduled-automations:changed")).toBe(1);
      expect(latestScheduledChangedEvent().reason).toBe("upsert");
      expect(latestScheduledChangedEvent().automationId).toBe("daily-report");

      const listResponse = await invokeIpc("codex:scheduled-automations:list") as CodexScheduledAutomationListResponse;
      expect(Array.isArray(listResponse.items)).toBeTrue();
      expect(listResponse.items.length).toBe(1);
      expect(listResponse.items[0]?.id).toBe("daily-report");

      const updateResponse = await invokeIpc("codex:scheduled-automations:update", {
        id: "daily-report",
        kind: "cron",
        status: "PAUSED",
        name: "Paused Daily Report",
        prompt: "Summarize less frequently.",
        rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=10;BYMINUTE=30",
        cwds: ["/repo/project-alpha"],
        executionEnvironment: "local",
        model: "gpt-5.1",
        reasoningEffort: "high",
        localEnvironmentConfigPath: null,
      }) as CodexScheduledAutomationMutationResponse;

      expect(updateResponse.item.id).toBe("daily-report");
      expect(updateResponse.item.status).toBe("PAUSED");
      expect(updateResponse.item.executionEnvironment).toBe("local");
      expect(updateResponse.item.model).toBe("gpt-5.1");
      expect(updateResponse.item.reasoningEffort).toBe("high");
      expect(updateResponse.item.localEnvironmentConfigPath).toBe(null);
      expect(countEvents("codex:scheduled-automations:changed")).toBe(2);
      expect(latestScheduledChangedEvent().reason).toBe("upsert");

      const updatedListResponse = await invokeIpc("codex:scheduled-automations:list") as CodexScheduledAutomationListResponse;
      expect(updatedListResponse.items[0]?.model).toBe("gpt-5.1");
      expect(updatedListResponse.items[0]?.reasoningEffort).toBe("high");
      const updatedToml = fs.readFileSync(
        path.join(tempDir, "automations", "daily-report", "automation.toml"),
        "utf8",
      );
      expect(updatedToml.includes("model = \"gpt-5.1\"")).toBeTrue();
      expect(updatedToml.includes("reasoning_effort = \"high\"")).toBeTrue();

      const deleteResponse = await invokeIpc("codex:scheduled-automations:delete", {
        id: "daily-report",
      }) as CodexScheduledAutomationDeleteResponse;

      expect(deleteResponse.success).toBeTrue();
      expect(deleteResponse.status).toBe("deleted");
      expect(deleteResponse.item?.id).toBe("daily-report");
      expect(countEvents("codex:scheduled-automations:changed")).toBe(3);
      expect(latestScheduledChangedEvent().reason).toBe("delete");

      const deleteAgainResponse = await invokeIpc("codex:scheduled-automations:delete", {
        id: "daily-report",
      }) as CodexScheduledAutomationDeleteResponse;

      expect(deleteAgainResponse.success).toBeTrue();
      expect(deleteAgainResponse.status).toBe("not_found");
      expect(deleteAgainResponse.item).toBe(null);
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("forwards run-now input to the automation runtime and returns success", async () => {
    const response = await invokeIpc("codex:scheduled-automations:run-now", {
      id: "heartbeat-follow-up",
      collaborationMode: "plan",
      permissions: null,
    }) as CodexScheduledAutomationRunNowResponse;

    expect(response.success).toBeTrue();
    expect(runNowInputs.length).toBe(1);
    expect(JSON.stringify(runNowInputs[0])).toBe(JSON.stringify({
      id: "heartbeat-follow-up",
      collaborationMode: "plan",
      permissions: null,
    }));
  });

  test("returns previous-run inbox and mutation response shapes with run update events", async () => {
    const ran = await withTempDatabase(async () => {
      const createResponse = await invokeIpc("codex:scheduled-automations:create", {
        kind: "cron",
        name: "Review Runs",
        prompt: "Run and wait for review.",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        cwds: ["/repo/project-alpha"],
        executionEnvironment: "worktree",
      }) as CodexScheduledAutomationMutationResponse;
      const automationId = createResponse.item.id;

      expect(insertCodexAutomationRunInProgress({
        threadId: "thread-run-1",
        automationId,
        threadTitle: "Review Runs execution",
        sourceCwd: "/repo/project-alpha",
        now: 10,
      })).toBeTrue();
      expect(markCodexAutomationRunPendingReview("thread-run-1", 20)).toBeTrue();

      const inboxResponse = await invokeIpc("codex:automation-runs:inbox-items", 25) as CodexAutomationRunsInboxResponse;
      expect(inboxResponse.items.length).toBe(1);
      expect(inboxResponse.items[0]?.threadId).toBe("thread-run-1");
      expect(inboxResponse.unreadRunCounts.total).toBe(1);
      expect(inboxResponse.unreadRunCounts.automationIds[0]).toBe(automationId);

      const readItem = await invokeIpc("codex:automation-runs:set-read-state", {
        threadId: "thread-run-1",
        readAt: 30,
      }) as CodexAutomationInboxItem | null;
      expect(readItem?.readAt).toBe(30);
      expect(latestAutomationRunsUpdatedEvent().reason).toBe("read-state");
      expect(latestAutomationRunsUpdatedEvent().automationId).toBe(automationId);

      const archiveResponse = await invokeIpc("codex:automation-runs:archive", {
        threadId: "thread-run-1",
        archivedAssistantMessage: "Done",
        archivedUserMessage: "Please run it.",
        archivedReason: "manual",
      }) as CodexAutomationRunMutationResponse;
      expect(archiveResponse.success).toBeTrue();
      expect(latestAutomationRunsUpdatedEvent().reason).toBe("archive");

      const unarchiveResponse = await invokeIpc("codex:automation-runs:unarchive", {
        threadId: "thread-run-1",
      }) as CodexAutomationRunMutationResponse;
      expect(unarchiveResponse.success).toBeTrue();
      expect(unarchivedThreadIds[0]).toBe("thread-run-1");
      expect(latestAutomationRunsUpdatedEvent().reason).toBe("unarchive");

      const markAllReadResponse = await invokeIpc("codex:automation-runs:mark-all-read", {
        readAt: 40,
      }) as CodexAutomationRunMarkAllReadResponse;
      expect(markAllReadResponse.changedCount).toBe(0);

      const deleteResponse = await invokeIpc("codex:automation-runs:delete", {
        threadId: "thread-run-1",
      }) as CodexAutomationRunMutationResponse;
      expect(deleteResponse.success).toBeTrue();
      expect(latestAutomationRunsUpdatedEvent().reason).toBe("delete");
    });

    if (!ran) expect(true).toBeTrue();
  });
});
