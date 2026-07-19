import { describe, expect, test, vi } from "vitest";

import type { CodexScheduledAutomationCreateInput } from "../../shared/types";
import {
  createDesktopAutomationModuleBridge,
  mapCoreAutomationEvent,
  type DesktopAutomationModulePort,
} from "./desktop-automation-module-bridge";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { FakeCoreClient } from "./testing/fake-core-client";
import type {
  AutomationCommittedValue,
  AutomationReadSnapshot,
} from "./types";

const definition = (overrides: Record<string, unknown> = {}) => ({
  automation_id: "daily-report",
  definition_revision: 1,
  kind: "cron" as const,
  status: "ACTIVE" as const,
  target_thread_id: null,
  name: "Daily Report",
  prompt: "Summarize the workspace.",
  rrule: "FREQ=DAILY;BYHOUR=9",
  model: "gpt-5",
  reasoning_effort: "medium" as const,
  cwds: ["/workspace"],
  execution_environment: "worktree" as const,
  local_environment_config_path: null,
  next_run_at_ms: 200,
  last_run_at_ms: null,
  created_at_ms: 100,
  updated_at_ms: 100,
  ...overrides,
});

const run = (overrides: Record<string, unknown> = {}) => ({
  thread_id: "thread:daily-report",
  automation_id: "daily-report",
  run_revision: 3,
  status: "PENDING_REVIEW" as const,
  read_at_ms: null,
  thread_title: "Daily Report run",
  source_cwd: "/workspace",
  inbox_title: "Report ready",
  inbox_summary: "Review the report.",
  archived_user_message: null,
  archived_assistant_message: null,
  archived_reason: null,
  created_at_ms: 120,
  updated_at_ms: 130,
  ...overrides,
});

const readSnapshot = (
  value: AutomationReadSnapshot["value"],
): AutomationReadSnapshot => ({
  version: 1,
  store_epoch: "epoch:test",
  event_head: 7,
  value,
});

const committed = (
  value: Partial<AutomationCommittedValue["value"]>,
): AutomationCommittedValue => ({
  store_epoch: "epoch:test",
  event_sequence: 8,
  receipt: {
    operation_id: "operation:test",
    duplicate: false,
    affected_automation_ids: ["daily-report"],
    affected_lease_ids: [],
    affected_run_ids: [],
    affected_reminder_lease_ids: [],
    affected_snooze_ids: [],
    affected_page_ids: [],
    affected_document_ids: [],
    affected_database_ids: [],
  },
  value: {
    affected_automation_ids: ["daily-report"],
    definitions: [],
    claimed_leases: [],
    runs: [],
    deleted_run_ids: [],
    reminder_leases: [],
    reminder_snoozes: [],
    ...value,
  },
});

const rustRuntime = (client: FakeCoreClient): RustDataAuthorityRuntime => ({
  backend: "rust",
  rootClient: Object.assign(client, {
    handshake: {
      library_id: "library:test",
      profile_id: "profile:test",
      store_epoch: "epoch:test",
      event_head: 0,
    },
  }),
  clientForProject: () => client,
}) as unknown as RustDataAuthorityRuntime;

const createInput: CodexScheduledAutomationCreateInput = {
  kind: "cron",
  name: "Daily Report",
  prompt: "Summarize the workspace.",
  rrule: "FREQ=DAILY;BYHOUR=9",
  model: "gpt-5",
  reasoningEffort: "medium",
  cwds: ["/workspace"],
  executionEnvironment: "worktree",
};

const neverTypeScript = (): DesktopAutomationModulePort => ({
  listDefinitions: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  getDefinition: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  createDefinition: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  updateDefinition: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  deleteDefinition: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  dispatchDefinitionNow: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  claimDueDefinitions: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  completeLease: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  failLease: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  settleInterruptedRuns: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  getRun: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  beginRun: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  replacePendingRunThread: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  setRunThreadTitle: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  completeRunForReview: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  setRunInboxItem: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  acceptRun: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  archiveRun: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  deleteRun: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  unarchiveRun: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  readInbox: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  setRunReadState: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  markAllRunsRead: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
});

describe("Desktop Automation Module bridge", () => {
  test("maps Automation events into authority-neutral invalidations", () => {
    expect(mapCoreAutomationEvent({
      protocol_version: 1,
      event: {
        version: 1,
        sequence: 8,
        store_epoch: "epoch:test",
        operation_id: "operation:automation",
        committed_at: "2026-07-19T15:02:00.000Z",
        payload: {
          module: "automation",
          event: {
            kind: "automation_changed",
            automation_ids: ["daily-report"],
            lease_ids: ["lease:daily-report"],
            run_ids: ["thread:daily-report"],
            reminder_lease_ids: [],
            snooze_ids: [],
            page_ids: [],
            document_ids: [],
            database_ids: [],
          },
        },
      },
    })).toEqual({
      automationIds: ["daily-report"],
      runIds: ["thread:daily-report"],
    });
  });

  test("maps Definition CRUD and preserves slug identities through Core", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopAutomationModuleBridge({
      authority: Promise.resolve(rustRuntime(client)),
      typescript: neverTypeScript(),
    });
    client.enqueueAutomationRead(readSnapshot({
      kind: "definitions",
      items: [definition({ automation_id: "daily-report-2" })],
    }));
    client.enqueueAutomationApply(committed({ definitions: [definition()] }));

    await expect(bridge.createDefinition(createInput)).resolves.toMatchObject({
      id: "daily-report",
      status: "ACTIVE",
      reasoningEffort: "medium",
      executionEnvironment: "worktree",
    });
    expect(client.automationReads).toEqual([{
      kind: "definitions",
      include_deleted: true,
    }]);
    expect(client.automationApplies[0]?.intent).toEqual({
      kind: "create_definition",
      automation_id: "daily-report",
      definition: {
        kind: "cron",
        target_thread_id: null,
        name: "Daily Report",
        prompt: "Summarize the workspace.",
        rrule: "FREQ=DAILY;BYHOUR=9",
        model: "gpt-5",
        reasoning_effort: "medium",
        cwds: ["/workspace"],
        execution_environment: "worktree",
        local_environment_config_path: null,
      },
    });

    client.enqueueAutomationRead(readSnapshot({
      kind: "definition",
      item: definition(),
    }));
    client.enqueueAutomationApply(committed({
      definitions: [definition({ definition_revision: 2, status: "PAUSED" })],
    }));
    await expect(bridge.updateDefinition({
      ...createInput,
      id: "daily-report",
      status: "PAUSED",
    })).resolves.toMatchObject({ id: "daily-report", status: "PAUSED" });
    expect(client.automationApplies[1]?.intent).toMatchObject({
      kind: "update_definition",
      automation_id: "daily-report",
      expected_revision: 1,
      status: "PAUSED",
    });

    client.enqueueAutomationRead(readSnapshot({
      kind: "definition",
      item: definition({ definition_revision: 2, status: "PAUSED" }),
    }));
    client.enqueueAutomationApply(committed({
      definitions: [definition({ definition_revision: 3, status: "DELETED" })],
      deleted_run_ids: ["thread:daily-report"],
    }));
    await expect(bridge.deleteDefinition("daily-report")).resolves.toMatchObject({
      item: { id: "daily-report", status: "PAUSED" },
      success: true,
      status: "deleted",
      deletedRunCount: 1,
    });
    expect(client.automationApplies[2]?.intent).toEqual({
      kind: "delete_definition",
      automation_id: "daily-report",
      expected_revision: 2,
    });
  });

  test("commits archive messages with the revision-fenced Run transition", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopAutomationModuleBridge({
      authority: Promise.resolve(rustRuntime(client)),
      typescript: neverTypeScript(),
    });
    client.enqueueAutomationRead(readSnapshot({ kind: "run", item: run() }));
    client.enqueueAutomationApply(committed({
      runs: [run({ run_revision: 4, status: "ARCHIVED" })],
    }));

    await expect(bridge.archiveRun(
      { threadId: "thread:daily-report", archivedReason: "manual" },
      {
        archivedUserMessage: "Generate the report.",
        archivedAssistantMessage: "Report complete.",
      },
    )).resolves.toBe(true);
    expect(client.automationApplies[0]?.intent).toEqual({
      kind: "archive_run",
      thread_id: "thread:daily-report",
      expected_revision: 3,
      archived_user_message: "Generate the report.",
      archived_assistant_message: "Report complete.",
      archived_reason: "manual",
    });
  });

  test("dispatches and claims definitions before revision-fenced Run lifecycle commits", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopAutomationModuleBridge({
      authority: Promise.resolve(rustRuntime(client)),
      typescript: neverTypeScript(),
    });

    client.enqueueAutomationRead(readSnapshot({
      kind: "definition",
      item: definition(),
    }));
    client.enqueueAutomationApply(committed({
      definitions: [definition({ last_run_at_ms: 150, next_run_at_ms: 250 })],
    }));
    await expect(bridge.dispatchDefinitionNow("daily-report")).resolves.toMatchObject({
      id: "daily-report",
      lastRunAt: 150,
      nextRunAt: 250,
    });
    expect(client.automationApplies[0]?.intent).toEqual({
      kind: "dispatch_now",
      automation_id: "daily-report",
    });

    client.enqueueAutomationApply(committed({
      definitions: [definition({ last_run_at_ms: 200, next_run_at_ms: 300 })],
      claimed_leases: [{
        lease_id: "lease:daily-report",
        automation_id: "daily-report",
        scheduled_for_ms: 200,
        claimed_at_ms: 200,
        expires_at_ms: 60_200,
        attempt: 1,
        status: "claimed",
        settled_at_ms: null,
        retry_at_ms: null,
        reason_code: null,
      }],
    }));
    await expect(bridge.claimDueDefinitions(3, 60_000)).resolves.toEqual([{
      leaseId: "lease:daily-report",
      scheduledFor: 200,
      attempt: 1,
      expiresAt: 60_200,
      definition: expect.objectContaining({ id: "daily-report" }),
    }]);
    expect(client.automationApplies[1]?.intent).toEqual({
      kind: "claim_due",
      limit: 3,
      lease_duration_ms: 60_000,
    });

    client.enqueueAutomationApply(committed({
      runs: [run({ status: "IN_PROGRESS", run_revision: 1 })],
    }));
    await expect(bridge.beginRun({
      threadId: "thread:daily-report",
      automationId: "daily-report",
      threadTitle: "Daily Report run",
      sourceCwd: "/workspace",
    })).resolves.toBe(true);
    expect(client.automationApplies[2]?.intent).toEqual({
      kind: "begin_run",
      thread_id: "thread:daily-report",
      automation_id: "daily-report",
      thread_title: "Daily Report run",
      source_cwd: "/workspace",
    });

    client.enqueueAutomationRead(readSnapshot({ kind: "run", item: run() }));
    client.enqueueAutomationApply(committed({
      runs: [run({ run_revision: 4 })],
    }));
    await expect(bridge.completeRunForReview({
      threadId: "thread:daily-report",
      inboxTitle: "Report ready",
      inboxSummary: "Review the report.",
    })).resolves.toBe(true);
    expect(client.automationApplies[3]?.intent).toEqual({
      kind: "complete_run_for_review",
      thread_id: "thread:daily-report",
      expected_revision: 3,
      inbox_title: "Report ready",
      inbox_summary: "Review the report.",
    });
  });

  test("maps inbox/read state and selects the explicit TypeScript fallback", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopAutomationModuleBridge({
      authority: Promise.resolve(rustRuntime(client)),
      typescript: neverTypeScript(),
    });
    const inboxValue = {
      kind: "inbox" as const,
      items: [{
        automation_id: "daily-report",
        automation_name: "Daily Report",
        title: "Daily Report",
        description: "Review the report.",
        archived_assistant_message: null,
        archived_user_message: null,
        archived_reason: null,
        source_cwd: "/workspace",
        thread_id: "thread:daily-report",
        read_at_ms: 140,
        created_at_ms: 120,
        status: "PENDING_REVIEW" as const,
      }],
      unread_counts: {
        total: 0,
        automation_ids: [],
        unread_runs: [],
      },
    };
    client.enqueueAutomationRead(readSnapshot(inboxValue));
    await expect(bridge.readInbox(25)).resolves.toMatchObject({
      items: [{ threadId: "thread:daily-report", readAt: 140 }],
      unreadRunCounts: { total: 0 },
    });

    const fallback = neverTypeScript();
    vi.mocked(fallback.listDefinitions).mockResolvedValue([]);
    const fallbackBridge = createDesktopAutomationModuleBridge({
      authority: Promise.resolve({ backend: "typescript" } as never),
      typescript: fallback,
    });
    await expect(fallbackBridge.listDefinitions()).resolves.toEqual([]);
    expect(fallback.listDefinitions).toHaveBeenCalledOnce();
  });
});
