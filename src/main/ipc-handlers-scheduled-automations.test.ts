import { beforeAll, describe, expect, test } from "vitest";
import {
  registerCodexScheduledAutomationIpcHandlers,
  type CodexScheduledAutomationIpcChannel,
  type CodexScheduledAutomationIpcHandler,
} from "./codex-scheduled-automation-ipc-handlers";
import type { DesktopAutomationModulePort } from "./core-client/desktop-automation-module-bridge";
import type {
  CodexAutomationRun,
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

const definitions = new Map<string, CodexScheduledAutomationMutationResponse["item"]>();
const runs = new Map<string, CodexAutomationRun>();

const automationModule = {
  listDefinitions: async () => [...definitions.values()],
  createDefinition: async (input: Parameters<DesktopAutomationModulePort["createDefinition"]>[0]) => {
    const id = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const now = Date.now();
    const item = {
      id,
      definitionRevision: 1,
      kind: input.kind ?? "cron",
      status: "ACTIVE" as const,
      targetThreadId: input.targetThreadId ?? null,
      name: input.name,
      prompt: input.prompt ?? "",
      rrule: input.rrule ?? null,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      cwds: input.cwds ?? [],
      executionEnvironment: input.executionEnvironment ?? "worktree",
      localEnvironmentConfigPath: input.localEnvironmentConfigPath ?? null,
      nextRunAt: null,
      lastRunAt: null,
      createdAt: now,
      updatedAt: now,
    };
    definitions.set(id, item);
    return item;
  },
  updateDefinition: async (input: Parameters<DesktopAutomationModulePort["updateDefinition"]>[0]) => {
    const current = definitions.get(input.id);
    if (!current) return null;
    const item = {
      ...current,
      id: input.id,
      definitionRevision: current.definitionRevision + 1,
      kind: input.kind,
      status: input.status,
      targetThreadId: input.targetThreadId ?? current.targetThreadId,
      name: input.name,
      prompt: input.prompt ?? current.prompt,
      rrule: input.rrule ?? current.rrule,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      cwds: input.cwds ?? current.cwds,
      executionEnvironment:
        input.executionEnvironment ?? current.executionEnvironment,
      localEnvironmentConfigPath: input.localEnvironmentConfigPath ?? null,
      updatedAt: Date.now(),
    };
    definitions.set(input.id, item);
    return item;
  },
  deleteDefinition: async (id: string) => {
    const item = definitions.get(id) ?? null;
    definitions.delete(id);
    return {
      item,
      success: true,
      status: item ? "deleted" as const : "not_found" as const,
      deletedRunCount: 0,
    };
  },
  getRun: async (threadId: string) => runs.get(threadId) ?? null,
  archiveRun: async (input: { readonly threadId: string }) => {
    const run = runs.get(input.threadId);
    if (!run) return false;
    runs.set(input.threadId, { ...run, status: "ARCHIVED" });
    return true;
  },
  deleteRun: async (threadId: string) => runs.delete(threadId),
  unarchiveRun: async (threadId: string) => {
    const run = runs.get(threadId);
    if (!run) return false;
    runs.set(threadId, { ...run, status: "ACCEPTED" });
    return true;
  },
  readInbox: async () => ({
    items: [...runs.values()].map((run) => ({
      id: run.threadId,
      automationId: run.automationId,
      automationName: definitions.get(run.automationId)?.name ?? null,
      title: run.threadTitle,
      description: run.inboxSummary,
      archivedAssistantMessage: run.archivedAssistantMessage,
      archivedUserMessage: run.archivedUserMessage,
      archivedReason: run.archivedReason,
      sourceCwd: run.sourceCwd,
      threadId: run.threadId,
      readAt: run.readAt,
      createdAt: run.createdAt,
      status: run.status,
    })),
    unreadRunCounts: {
      total: [...runs.values()].filter((run) => run.readAt === null).length,
      automationIds: [...new Set([...runs.values()].map((run) => run.automationId))],
      unreadRuns: [...runs.values()].filter((run) => run.readAt === null).map((run) => ({
        automationId: run.automationId,
        threadId: run.threadId,
      })),
    },
  }),
  setRunReadState: async (input: { readonly threadId: string; readonly readAt: number | null }) => {
    const run = runs.get(input.threadId);
    if (!run) return null;
    runs.set(input.threadId, { ...run, readAt: input.readAt });
    return (await automationModule.readInbox()).items[0] ?? null;
  },
  markAllRunsRead: async () => 0,
} as unknown as DesktopAutomationModulePort;

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
    automationModule,
    runScheduledAutomationNow: async (input) => {
      runNowInputs.push(input);
    },
    resolveAutomationArchiveMessages: async () => ({
      archivedAssistantMessage: null,
      archivedUserMessage: null,
    }),
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
      expect(registeredHandlers.has(channel)).toBe(true);
    }
  });

  test("returns list/create/update/delete response shapes and broadcasts task changes", async () => {
    definitions.clear();
    sentIpcEvents.length = 0;
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
      expect(Array.isArray(listResponse.items)).toBe(true);
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

      const deleteResponse = await invokeIpc("codex:scheduled-automations:delete", {
        id: "daily-report",
      }) as CodexScheduledAutomationDeleteResponse;

      expect(deleteResponse.success).toBe(true);
      expect(deleteResponse.status).toBe("deleted");
      expect(deleteResponse.item?.id).toBe("daily-report");
      expect(countEvents("codex:scheduled-automations:changed")).toBe(3);
      expect(latestScheduledChangedEvent().reason).toBe("delete");

      const deleteAgainResponse = await invokeIpc("codex:scheduled-automations:delete", {
        id: "daily-report",
      }) as CodexScheduledAutomationDeleteResponse;

      expect(deleteAgainResponse.success).toBe(true);
      expect(deleteAgainResponse.status).toBe("not_found");
      expect(deleteAgainResponse.item).toBe(null);
  });

  test("forwards run-now input to the automation runtime and returns success", async () => {
    const response = await invokeIpc("codex:scheduled-automations:run-now", {
      id: "heartbeat-follow-up",
      collaborationMode: "plan",
      permissions: null,
    }) as CodexScheduledAutomationRunNowResponse;

    expect(response.success).toBe(true);
    expect(runNowInputs.length).toBe(1);
    expect(JSON.stringify(runNowInputs[0])).toBe(JSON.stringify({
      id: "heartbeat-follow-up",
      collaborationMode: "plan",
      permissions: null,
    }));
  });

  test("returns previous-run inbox and mutation response shapes with run update events", async () => {
    definitions.clear();
    runs.clear();
    sentIpcEvents.length = 0;
    unarchivedThreadIds.length = 0;
      const createResponse = await invokeIpc("codex:scheduled-automations:create", {
        kind: "cron",
        name: "Review Runs",
        prompt: "Run and wait for review.",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        cwds: ["/repo/project-alpha"],
        executionEnvironment: "worktree",
      }) as CodexScheduledAutomationMutationResponse;
      const automationId = createResponse.item.id;

      runs.set("thread-run-1", {
        threadId: "thread-run-1",
        automationId,
        status: "PENDING_REVIEW",
        readAt: null,
        threadTitle: "Review Runs execution",
        sourceCwd: "/repo/project-alpha",
        inboxTitle: null,
        inboxSummary: null,
        archivedUserMessage: null,
        archivedAssistantMessage: null,
        archivedReason: null,
        createdAt: 10,
        updatedAt: 20,
      });

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
      expect(archiveResponse.success).toBe(true);
      expect(latestAutomationRunsUpdatedEvent().reason).toBe("archive");

      const unarchiveResponse = await invokeIpc("codex:automation-runs:unarchive", {
        threadId: "thread-run-1",
      }) as CodexAutomationRunMutationResponse;
      expect(unarchiveResponse.success).toBe(true);
      expect(unarchivedThreadIds[0]).toBe("thread-run-1");
      expect(latestAutomationRunsUpdatedEvent().reason).toBe("unarchive");

      const markAllReadResponse = await invokeIpc("codex:automation-runs:mark-all-read", {
        readAt: 40,
      }) as CodexAutomationRunMarkAllReadResponse;
      expect(markAllReadResponse.changedCount).toBe(0);

      const deleteResponse = await invokeIpc("codex:automation-runs:delete", {
        threadId: "thread-run-1",
      }) as CodexAutomationRunMutationResponse;
      expect(deleteResponse.success).toBe(true);
      expect(latestAutomationRunsUpdatedEvent().reason).toBe("delete");
  });
});
