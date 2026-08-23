import { describe, expect, test, vi } from "vite-plus/test";

import type { CodexScheduledAutomationCreateInput } from "../../shared/types";
import {
  createDesktopAutomationModuleBridge,
  mapCoreAutomationEvent,
} from "./desktop-automation-module-bridge";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { createFakeCoreHandshake, FakeCoreClient } from "./testing/fake-core-client";
import { createCoreLocalCommitFixture } from "./testing/local-commit-fixture";
import type {
  AutomationApplyResult,
  AutomationRead,
  AutomationReadSnapshot,
  CoreRequestOptions,
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

const inboxItem = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

const occurrence = (overrides: Record<string, unknown> = {}) => ({
  occurrence_id: "page:planning:2026-07-20T01:00:00.000Z",
  page_id: "page:planning",
  page_key: "LAB-13",
  status: "plan",
  status_name: "Plan",
  archived: false,
  title: "Planning session",
  rich_title: [
    {
      type: "text",
      text: "Planning session",
      styles: {},
    },
  ],
  description: "Plan the next milestone.",
  priority: "p1-high",
  estimate: "m",
  tags: ["planning"],
  due_date: "2026-07-20T03:00:00.000Z",
  occurrence_start_ms: Date.parse("2026-07-20T01:00:00.000Z"),
  occurrence_end_ms: Date.parse("2026-07-20T02:00:00.000Z"),
  is_all_day: false,
  recurrence: {
    frequency: "weekly" as const,
    interval: 1,
    byWeekdays: [1],
    endCondition: { type: "never" as const },
  },
  reminders: [{ offsetMinutes: 30 }],
  schedule_timezone: "Asia/Shanghai",
  assignee: "asc",
  run_in_target: "localProject",
  run_in_local_path: "/workspace",
  run_in_base_branch: null,
  run_in_worktree_path: null,
  run_in_environment_path: null,
  metadata_revision: 3,
  created_at: "2026-07-19T00:00:00.000Z",
  updated_at: "2026-07-19T01:00:00.000Z",
  order: 100,
  is_recurring: true,
  this_and_future_equivalent_to_all: false,
  ...overrides,
});

const readSnapshot = (value: AutomationReadSnapshot["value"]): AutomationReadSnapshot => ({
  contract_version: 3,
  store_epoch: "epoch:test",
  commit_head: 7,
  value,
});

const collectionWindow = <T>(items: readonly T[], nextCursor: string | null = null) => ({
  items,
  next_cursor: nextCursor,
  authority: { projection_revision: 7 },
});

const committed = (value: Partial<AutomationApplyResult["outcome"]>): AutomationApplyResult => ({
  status: "committed",
  commit: {
    store_epoch: "epoch:test",
    commit_seq: 8,
    manifest_hash: "f".repeat(64),
  },
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
  outcome: {
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

const noOp = (value: Partial<AutomationApplyResult["outcome"]>): AutomationApplyResult => {
  const committedResult = committed(value);
  if (committedResult.status !== "committed") {
    throw new Error("Committed fixture did not return a commit");
  }
  const { commit, ...common } = committedResult;
  void commit;
  return {
    ...common,
    status: "no_op",
    observed: { store_epoch: "epoch:observed", commit_head: 13 },
  };
};

const rustRuntime = (client: FakeCoreClient): RustDataAuthorityRuntime =>
  ({
    backend: "rust",
    rootClient: Object.assign(client, {
      handshake: createFakeCoreHandshake({
        libraryId: "library:test",
        profileId: "profile:test",
        storeEpoch: "epoch:test",
      }),
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

describe("Desktop Automation Module bridge", () => {
  test("maps Automation events into authority-neutral invalidations", () => {
    const packet = createCoreLocalCommitFixture({
      commitSeq: 8,
      storeEpoch: "epoch:test",
      operationId: "operation:automation",
      committedAt: "2026-07-19T15:02:00.000Z",
      payload: {
        module: "automation",
        library_id: "library-1",
        project_id: "project-1",
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
      canonicalHash: "0".repeat(64),
    });
    expect(mapCoreAutomationEvent(packet.atoms[0]!)).toEqual({
      automationIds: ["daily-report"],
      runIds: ["thread:daily-report"],
    });
  });

  test("classifies runtime synchronization reads without downgrading user reads", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopAutomationModuleBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const definitions = readSnapshot({
      kind: "definitions",
      window: collectionWindow([definition()]),
    });
    client.enqueueAutomationRead(definitions);
    client.enqueueAutomationRead(definitions);

    await bridge.listDefinitions();
    await bridge.listDefinitions("background");

    expect(client.automationReadOptions).toEqual([undefined, { class: "background" }]);
  });

  test("owns the synchronous Codex routing projection across rebuilds and mutations", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopAutomationModuleBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    client.enqueueAutomationRead(
      readSnapshot({
        kind: "definitions",
        window: collectionWindow([
          definition({
            automation_id: "heartbeat-one",
            kind: "heartbeat",
            target_thread_id: "thread:heartbeat-one",
          }),
        ]),
      }),
    );
    client.enqueueAutomationRead(
      readSnapshot({
        kind: "inbox",
        window: collectionWindow([inboxItem()]),
        unread_counts: { total: 0 },
      }),
    );

    await bridge.synchronizeIndex();

    expect(bridge.peekActiveHeartbeatAutomationId("thread:heartbeat-one")).toBe("heartbeat-one");
    expect(bridge.peekRunAutomationId("thread:daily-report")).toBe("daily-report");
    expect(client.automationReadOptions).toEqual([
      { class: "background" },
      { class: "background" },
    ]);

    client.enqueueAutomationRead(
      readSnapshot({
        kind: "definition",
        item: definition({
          automation_id: "heartbeat-one",
          kind: "heartbeat",
          target_thread_id: "thread:heartbeat-two",
        }),
      }),
    );
    await bridge.getDefinition("heartbeat-one");
    expect(bridge.peekActiveHeartbeatAutomationId("thread:heartbeat-one")).toBeNull();
    expect(bridge.peekActiveHeartbeatAutomationId("thread:heartbeat-two")).toBe("heartbeat-one");

    client.enqueueAutomationApply(
      committed({
        runs: [
          run({
            thread_id: "thread:new-run",
            automation_id: "heartbeat-one",
            status: "IN_PROGRESS",
          }),
        ],
      }),
    );
    await bridge.beginRun({
      threadId: "thread:new-run",
      automationId: "heartbeat-one",
    });
    expect(bridge.peekRunAutomationId("thread:new-run")).toBe("heartbeat-one");

    client.enqueueAutomationRead(
      readSnapshot({
        kind: "run",
        item: run({
          thread_id: "thread:new-run",
          automation_id: "heartbeat-one",
        }),
      }),
    );
    client.enqueueAutomationApply(committed({ deleted_run_ids: ["thread:new-run"] }));
    await bridge.deleteRun("thread:new-run");
    expect(bridge.peekRunAutomationId("thread:new-run")).toBeNull();

    client.enqueueAutomationRead(
      readSnapshot({
        kind: "definition",
        item: definition({
          automation_id: "heartbeat-one",
          kind: "heartbeat",
          target_thread_id: "thread:heartbeat-two",
        }),
      }),
    );
    client.enqueueAutomationApply(committed({ deleted_run_ids: [] }));
    await bridge.deleteDefinition("heartbeat-one");
    expect(bridge.peekActiveHeartbeatAutomationId("thread:heartbeat-two")).toBeNull();
  });

  test("fences stale full rebuilds behind newer committed routing mutations", async () => {
    const client = new FakeCoreClient();
    const originalRead = client.automationRead.bind(client);
    let resolveDefinitions!: (snapshot: AutomationReadSnapshot) => void;
    let resolveInbox!: (snapshot: AutomationReadSnapshot) => void;
    const definitionsRead = new Promise<AutomationReadSnapshot>((resolve) => {
      resolveDefinitions = resolve;
    });
    const inboxRead = new Promise<AutomationReadSnapshot>((resolve) => {
      resolveInbox = resolve;
    });
    client.automationRead = async (
      read: AutomationRead,
      options?: CoreRequestOptions,
    ): Promise<AutomationReadSnapshot> => {
      if (read.kind !== "definitions" && read.kind !== "inbox") {
        return await originalRead(read, options);
      }
      client.automationReads.push(read);
      client.automationReadOptions.push(options);
      return await (read.kind === "definitions" ? definitionsRead : inboxRead);
    };
    const bridge = createDesktopAutomationModuleBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const synchronization = bridge.synchronizeIndex();
    await vi.waitFor(() => expect(client.automationReads).toHaveLength(2));

    client.enqueueAutomationRead(readSnapshot({ kind: "definition", item: null }));
    client.enqueueAutomationApply(
      committed({
        definitions: [
          definition({
            automation_id: "heartbeat-one",
            kind: "heartbeat",
            target_thread_id: "thread:heartbeat-one",
          }),
        ],
      }),
    );
    await bridge.createDefinition({
      kind: "heartbeat",
      targetThreadId: "thread:heartbeat-one",
      name: "Heartbeat One",
      prompt: "Check for updates.",
    });
    client.enqueueAutomationApply(
      committed({
        runs: [
          run({
            thread_id: "thread:heartbeat-run",
            automation_id: "heartbeat-one",
            status: "IN_PROGRESS",
          }),
        ],
      }),
    );
    await bridge.beginRun({
      threadId: "thread:heartbeat-run",
      automationId: "heartbeat-one",
    });

    resolveDefinitions(readSnapshot({ kind: "definitions", window: collectionWindow([]) }));
    resolveInbox(
      readSnapshot({
        kind: "inbox",
        window: collectionWindow([]),
        unread_counts: { total: 0 },
      }),
    );
    await synchronization;

    expect(bridge.peekActiveHeartbeatAutomationId("thread:heartbeat-one")).toBe("heartbeat-one");
    expect(bridge.peekRunAutomationId("thread:heartbeat-run")).toBe("heartbeat-one");
  });

  test("maps Definition CRUD and preserves slug identities through Core", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopAutomationModuleBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    client.enqueueAutomationRead(
      readSnapshot({
        kind: "definition",
        item: null,
      }),
    );
    client.enqueueAutomationApply(committed({ definitions: [definition()] }));

    await expect(bridge.createDefinition(createInput)).resolves.toMatchObject({
      id: "daily-report",
      status: "ACTIVE",
      reasoningEffort: "medium",
      executionEnvironment: "worktree",
    });
    expect(client.automationReads).toEqual([
      {
        kind: "definition",
        automation_id: "daily-report",
      },
    ]);
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
        model_provider: null,
        harness_id: null,
        reasoning_effort: "medium",
        service_tier: null,
        cwds: ["/workspace"],
        execution_environment: "worktree",
        local_environment_config_path: null,
      },
    });

    client.enqueueAutomationRead(
      readSnapshot({
        kind: "definition",
        item: definition(),
      }),
    );
    client.enqueueAutomationApply(
      committed({
        definitions: [definition({ definition_revision: 2, status: "PAUSED" })],
      }),
    );
    await expect(
      bridge.updateDefinition({
        ...createInput,
        id: "daily-report",
        status: "PAUSED",
      }),
    ).resolves.toMatchObject({ id: "daily-report", status: "PAUSED" });
    expect(client.automationApplies[1]?.intent).toMatchObject({
      kind: "update_definition",
      automation_id: "daily-report",
      expected_revision: 1,
      status: "PAUSED",
    });

    client.enqueueAutomationRead(
      readSnapshot({
        kind: "definition",
        item: definition({ definition_revision: 2, status: "PAUSED" }),
      }),
    );
    client.enqueueAutomationApply(
      committed({
        definitions: [definition({ definition_revision: 3, status: "DELETED" })],
        deleted_run_ids: ["thread:daily-report"],
      }),
    );
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
    });
    client.enqueueAutomationRead(readSnapshot({ kind: "run", item: run() }));
    client.enqueueAutomationApply(
      committed({
        runs: [run({ run_revision: 4, status: "ARCHIVED" })],
      }),
    );

    await expect(
      bridge.archiveRun(
        { threadId: "thread:daily-report", archivedReason: "manual" },
        {
          archivedUserMessage: "Generate the report.",
          archivedAssistantMessage: "Report complete.",
        },
      ),
    ).resolves.toBe(true);
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
    });

    client.enqueueAutomationRead(
      readSnapshot({
        kind: "definition",
        item: definition(),
      }),
    );
    client.enqueueAutomationApply(
      committed({
        definitions: [definition({ last_run_at_ms: 150, next_run_at_ms: 250 })],
      }),
    );
    await expect(bridge.dispatchDefinitionNow("daily-report")).resolves.toMatchObject({
      id: "daily-report",
      lastRunAt: 150,
      nextRunAt: 250,
    });
    expect(client.automationApplies[0]?.intent).toEqual({
      kind: "dispatch_now",
      automation_id: "daily-report",
    });
    expect(client.automationApplyOptions[0]).toBeUndefined();

    client.enqueueAutomationApply(
      committed({
        definitions: [definition({ definition_revision: 2, next_run_at_ms: 275 })],
      }),
    );
    await expect(
      bridge.rescheduleDefinition("daily-report", 1, { notBefore: 275 }),
    ).resolves.toMatchObject({
      id: "daily-report",
      nextRunAt: 275,
    });
    expect(client.automationApplies[1]?.intent).toEqual({
      kind: "reschedule_definition",
      automation_id: "daily-report",
      expected_revision: 1,
      not_before_ms: 275,
      retry_within_ms: null,
    });
    expect(client.automationApplyOptions[1]).toEqual({ class: "background" });

    client.enqueueAutomationApply(
      committed({
        definitions: [definition({ last_run_at_ms: 200, next_run_at_ms: 300 })],
        claimed_leases: [
          {
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
          },
        ],
      }),
    );
    await expect(bridge.claimDueDefinitions(3, 60_000)).resolves.toEqual([
      {
        leaseId: "lease:daily-report",
        scheduledFor: 200,
        attempt: 1,
        expiresAt: 60_200,
        definition: expect.objectContaining({ id: "daily-report" }),
      },
    ]);
    expect(client.automationApplies[2]?.intent).toEqual({
      kind: "claim_due",
      limit: 3,
      lease_duration_ms: 60_000,
    });
    expect(client.automationApplyOptions[2]).toEqual({ class: "background" });

    client.enqueueAutomationApply(
      committed({
        runs: [run({ status: "IN_PROGRESS", run_revision: 1 })],
      }),
    );
    await expect(
      bridge.beginRun({
        threadId: "thread:daily-report",
        automationId: "daily-report",
        threadTitle: "Daily Report run",
        sourceCwd: "/workspace",
      }),
    ).resolves.toBe(true);
    expect(client.automationApplies[3]?.intent).toEqual({
      kind: "begin_run",
      thread_id: "thread:daily-report",
      automation_id: "daily-report",
      thread_title: "Daily Report run",
      source_cwd: "/workspace",
    });
    expect(client.automationApplyOptions[3]).toEqual({ class: "background" });

    client.enqueueAutomationRead(readSnapshot({ kind: "run", item: run() }));
    client.enqueueAutomationApply(
      committed({
        runs: [run({ run_revision: 4 })],
      }),
    );
    await expect(
      bridge.completeRunForReview({
        threadId: "thread:daily-report",
        inboxTitle: "Report ready",
        inboxSummary: "Review the report.",
      }),
    ).resolves.toBe(true);
    expect(client.automationApplies[4]?.intent).toEqual({
      kind: "complete_run_for_review",
      thread_id: "thread:daily-report",
      expected_revision: 3,
      inbox_title: "Report ready",
      inbox_summary: "Review the report.",
    });
    expect(client.automationReadOptions.at(-1)).toEqual({ class: "background" });
    expect(client.automationApplyOptions[4]).toEqual({ class: "background" });
  });

  test("routes Calendar occurrences through the project client and preserves operation identities", async () => {
    const rootClient = new FakeCoreClient();
    const projectClient = new FakeCoreClient();
    const resolveProjectClient = vi.fn(() => projectClient);
    const runtime = {
      ...rustRuntime(rootClient),
      clientForProject: resolveProjectClient,
    } as unknown as RustDataAuthorityRuntime;
    const bridge = createDesktopAutomationModuleBridge({
      authority: Promise.resolve(runtime),
    });
    const windowStart = new Date("2026-07-20T00:00:00.000Z");
    const windowEnd = new Date("2026-07-21T00:00:00.000Z");
    projectClient.enqueueAutomationRead(
      readSnapshot({
        kind: "occurrences",
        window: collectionWindow([occurrence()], "nxc1.occurrences.next"),
      }),
    );

    await expect(
      bridge.listPageOccurrences("project:one", windowStart, windowEnd, " planning "),
    ).resolves.toMatchObject({
      items: [
        {
          id: "page:planning:2026-07-20T01:00:00.000Z",
          pageId: "page:planning",
          pageKey: "LAB-13",
          status: "plan",
          priority: "p1-high",
          scheduledStart: new Date("2026-07-20T01:00:00.000Z"),
          occurrenceStart: new Date("2026-07-20T01:00:00.000Z"),
          recurrence: { frequency: "weekly", byWeekdays: [1] },
          runInTarget: "localProject",
        },
      ],
      nextCursor: "nxc1.occurrences.next",
    });
    expect(resolveProjectClient).toHaveBeenCalledWith("project:one");
    expect(projectClient.automationReads).toEqual([
      {
        kind: "occurrences",
        window_start_ms: windowStart.getTime(),
        window_end_ms: windowEnd.getTime(),
        search_query: "planning",
        window: { after: null, first: 200 },
      },
    ]);
    projectClient.enqueueAutomationRead(
      readSnapshot({
        kind: "occurrences",
        window: collectionWindow([]),
      }),
    );
    await expect(
      bridge.listPageOccurrences(
        "project:one",
        windowStart,
        windowEnd,
        "planning",
        "nxc1.occurrences.next",
      ),
    ).resolves.toEqual({ items: [], nextCursor: null });
    expect(projectClient.automationReads[1]).toMatchObject({
      kind: "occurrences",
      window: { after: "nxc1.occurrences.next", first: 200 },
    });

    projectClient.enqueueAutomationRead(
      readSnapshot({
        kind: "occurrences",
        window: collectionWindow([occurrence({ page_key: null })]),
      }),
    );
    await expect(
      bridge.listPageOccurrences("project:one", windowStart, windowEnd),
    ).resolves.toMatchObject({
      items: [{ pageKey: null }],
    });

    projectClient.enqueueAutomationApply(
      committed({
        page_occurrence_mutation: {
          operation_id: "calendar:update:1",
          duplicate: false,
          success: true,
          created_page_id: "page:detached",
        },
      }),
    );
    await expect(
      bridge.updatePageOccurrence("project:one", {
        operationId: "calendar:update:1",
        pageId: "page:planning",
        occurrenceStart: new Date("2026-07-20T01:00:00.000Z"),
        source: "calendar",
        scope: "this-and-future",
        createdPageId: "page:detached",
        updates: {
          scheduledStart: new Date("2026-07-20T04:00:00.000Z"),
          recurrence: null,
          scheduleTimezone: null,
        },
      }),
    ).resolves.toEqual({
      success: true,
      commitCursor: { storeEpoch: "epoch:test", commitSeq: 8 },
    });
    expect(projectClient.automationApplies[0]).toMatchObject({
      operationId: "calendar:update:1",
      intent: {
        kind: "update_page_occurrence",
        page_id: "page:planning",
        occurrence_start_ms: Date.parse("2026-07-20T01:00:00.000Z"),
        scope: "this_and_future",
        created_page_id: "page:detached",
        updates: {
          scheduled_start_ms: Date.parse("2026-07-20T04:00:00.000Z"),
          recurrence: null,
          schedule_timezone: null,
        },
      },
    });

    projectClient.enqueueAutomationApply(
      noOp({
        page_occurrence_mutation: {
          operation_id: "calendar:skip:1",
          duplicate: true,
          success: true,
          created_page_id: null,
        },
      }),
    );
    await expect(
      bridge.skipPageOccurrence("project:one", {
        operationId: "calendar:skip:1",
        pageId: "page:planning",
        occurrenceStart: new Date("2026-07-20T01:00:00.000Z"),
        source: "calendar",
      }),
    ).resolves.toEqual({
      success: true,
      commitCursor: { storeEpoch: "epoch:observed", commitSeq: 13 },
    });
  });

  test("claims and settles reminder leases through the root Automation host", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopAutomationModuleBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    client.enqueueAutomationApply(
      committed({
        reminder_leases: [
          {
            lease_id: "reminder-lease:1",
            project_id: "project:one",
            receipt_project_id: "project:owner",
            page_id: "page:planning",
            occurrence_start_ms: Date.parse("2026-07-20T01:00:00.000Z"),
            reminder_offset_minutes: 30,
            due_at_ms: Date.parse("2026-07-20T00:30:00.000Z"),
            title: "Planning session",
            claimed_at_ms: Date.parse("2026-07-20T00:30:01.000Z"),
            expires_at_ms: Date.parse("2026-07-20T00:32:01.000Z"),
            attempt: 1,
            status: "claimed",
            settled_at_ms: null,
            retry_at_ms: null,
            reason_code: null,
            snooze_id: null,
          },
        ],
      }),
    );
    client.enqueueAutomationApply(committed({}));
    client.enqueueAutomationApply(committed({}));

    await expect(bridge.claimDueReminders(12, 120_000)).resolves.toEqual([
      {
        leaseId: "reminder-lease:1",
        projectId: "project:one",
        pageId: "page:planning",
        occurrenceStart: Date.parse("2026-07-20T01:00:00.000Z"),
        reminderOffsetMinutes: 30,
        dueAt: Date.parse("2026-07-20T00:30:00.000Z"),
        title: "Planning session",
        attempt: 1,
        expiresAt: Date.parse("2026-07-20T00:32:01.000Z"),
      },
    ]);
    await bridge.completeReminderLease("reminder-lease:1");
    await bridge.failReminderLease("reminder-lease:2", 30_000, "notification_failed");

    expect(client.automationApplyOptions.slice(-3)).toEqual([
      { class: "background" },
      { class: "background" },
      { class: "background" },
    ]);

    expect(client.automationApplies.map((apply) => apply.intent)).toEqual([
      {
        kind: "claim_due_reminders",
        limit: 12,
        lease_duration_ms: 120_000,
      },
      {
        kind: "complete_reminder_lease",
        lease_id: "reminder-lease:1",
      },
      {
        kind: "fail_reminder_lease",
        lease_id: "reminder-lease:2",
        retry_delay_ms: 30_000,
        reason_code: "notification_failed",
      },
    ]);
  });

  test("maps inbox/read state and selects the explicit TypeScript fallback", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopAutomationModuleBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    const inboxValue = {
      kind: "inbox" as const,
      window: collectionWindow([inboxItem()]),
      unread_counts: {
        total: 0,
      },
    };
    client.enqueueAutomationRead(readSnapshot(inboxValue));
    await expect(bridge.readInbox(25)).resolves.toMatchObject({
      items: [{ threadId: "thread:daily-report", readAt: 140 }],
      unreadRunCounts: { total: 0 },
    });
  });
});
