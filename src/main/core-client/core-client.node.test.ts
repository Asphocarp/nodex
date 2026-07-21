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
    let documentSubscription: CoreEventSubscription | undefined;
    let restartedSubscription: CoreEventSubscription | undefined;

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
      await expect(
        client.openEventStream(0, () => undefined),
      ).rejects.toMatchObject({ status: 409 });

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
      await client.workspaceApply({
        operationId: "node-workspace-turn-authority-1",
        intent: {
          kind: "freeze_turn_authority",
          thread_id: "thread:node-integration",
          turn_id: "turn:node-integration",
          root_thread_id: "thread:node-integration",
          actor_project_id: "project:default",
          source: "project_turn",
          inherited_from: null,
        },
      });
      const agentProvenance = {
        profile_id: client.handshake.profile_id,
        authority: {
          thread_id: "thread:node-integration",
          turn_id: "turn:node-integration",
          root_thread_id: "thread:node-integration",
          actor_project_id: "project:default",
          library_id: client.handshake.library_id,
          store_epoch: client.handshake.store_epoch,
          scope: "project" as const,
          source: "project_turn" as const,
        },
      };
      await client.libraryApply({
        operationId: "node-agent-search-grant-1",
        intent: {
          kind: "persist_agent_project_resource_grants",
          provenance: agentProvenance,
          grants: [{
            root: { kind: "page", page_id: "page:node-integration" },
            access: "read",
            library_actions: [],
          }],
        },
      });
      const agentSearch = await client.libraryRead({
        kind: "agent_search",
        authorization: {
          provenance: agentProvenance,
          call_id: "call:node-agent-search",
        },
        query: "integraton",
        target: "pages",
        scope: { kind: "library" },
        block_types: null,
        include_archived: false,
        cursor: null,
        limit: 1,
      });
      expect(agentSearch.value).toMatchObject({
        kind: "agent_search",
        has_more: false,
        next_cursor: null,
        items: [{
          kind: "page",
          id: "page:node-integration",
          matches: [{ source: "title", quality: "fuzzy" }],
        }],
      });
      const databaseCatalog = await client.databaseRead({
        target: { kind: "project_default" },
        mode: "catalog",
        filter: null,
        sort: null,
      });
      if (databaseCatalog.value.kind !== "catalog") {
        throw new Error("Expected native Database catalog");
      }
      const descriptor = databaseCatalog.value.databases[0] as {
        readonly dataSources?: readonly [{ readonly dataSourceId?: string }];
      } | undefined;
      const dataSourceId = descriptor?.dataSources?.[0]?.dataSourceId;
      if (!dataSourceId) throw new Error("Default Project has no Data Source");
      const agentDatabaseQuery = await client.databaseRead({
        target: {
          kind: "agent_data_source",
          data_source_id: dataSourceId,
          query: {
            authorization: {
              provenance: agentProvenance,
              call_id: "call:node-database-query",
            },
            cursor: null,
            limit: 1,
          },
        },
        mode: "query",
        filter: null,
        sort: null,
      });
      expect(agentDatabaseQuery.value).toMatchObject({
        kind: "agent_query",
        has_more: false,
        next_cursor: null,
        value: {
          dataSource: { dataSourceId },
          rows: [],
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
      const noScheduledOccurrences = await client.automationRead({
        kind: "occurrences",
        window_start_ms: Date.now() - 60_000,
        window_end_ms: Date.now() + 60_000,
        search_query: null,
        limit: 10,
      });
      expect(noScheduledOccurrences.value).toEqual({
        kind: "occurrences",
        items: [],
      });
      const noDueReminders = await client.automationApply({
        operationId: "node-reminder-claim-1",
        intent: {
          kind: "claim_due_reminders",
          limit: 3,
          lease_duration_ms: 60_000,
        },
      });
      expect(noDueReminders.value.reminder_leases).toEqual([]);
      const reminderLeases = await client.automationRead({
        kind: "reminder_leases",
        include_settled: true,
        limit: 10,
      });
      expect(reminderLeases.value).toEqual({
        kind: "reminder_leases",
        items: [],
      });
      const reminderSnoozes = await client.automationRead({
        kind: "reminder_snoozes",
        include_consumed: true,
        limit: 10,
      });
      expect(reminderSnoozes.value).toEqual({
        kind: "reminder_snoozes",
        items: [],
      });
      const begunRun = await client.automationApply({
        operationId: "node-automation-run-begin-1",
        intent: {
          kind: "begin_run",
          thread_id: "pending:node-automation-run",
          automation_id: "node-daily-report",
          thread_title: "Node daily report",
          source_cwd: path.join(nodexHome, "workspace"),
        },
      });
      expect(begunRun.value.runs).toMatchObject([
        {
          thread_id: "pending:node-automation-run",
          run_revision: 1,
          status: "IN_PROGRESS",
        },
      ]);
      const replacedRun = await client.automationApply({
        operationId: "node-automation-run-replace-1",
        intent: {
          kind: "replace_pending_run_thread",
          pending_thread_id: "pending:node-automation-run",
          thread_id: "thread:node-integration",
          expected_revision: 1,
        },
      });
      expect(replacedRun.value.runs[0]).toMatchObject({
        thread_id: "thread:node-integration",
        run_revision: 2,
      });
      const completedRun = await client.automationApply({
        operationId: "node-automation-run-complete-1",
        intent: {
          kind: "complete_run_for_review",
          thread_id: "thread:node-integration",
          expected_revision: 2,
          inbox_title: "Report ready",
          inbox_summary: "Review the native run.",
        },
      });
      expect(completedRun.value.runs[0]).toMatchObject({
        run_revision: 3,
        status: "PENDING_REVIEW",
      });
      const runInbox = await client.automationRead({ kind: "inbox", limit: 10 });
      expect(runInbox.value).toMatchObject({
        kind: "inbox",
        items: [
          {
            thread_id: "thread:node-integration",
            title: "Node daily report",
            description: "Review the native run.",
          },
        ],
        unread_counts: { total: 1 },
      });
      const readRun = await client.automationApply({
        operationId: "node-automation-run-read-1",
        intent: {
          kind: "set_run_read_state",
          thread_id: "thread:node-integration",
          expected_revision: 3,
          read: true,
        },
      });
      expect(readRun.value.runs[0]).toMatchObject({
        run_revision: 4,
        read_at_ms: expect.any(Number),
      });
      const nativeCli = await CoreClient.connect({
        nodexHome,
        clientKind: "native_cli",
        buildId: "node-native-cli-test",
        projectId: "project:default",
      });
      const missingOccurrenceInput = {
        operationId: "node-occurrence-missing-1",
        intent: {
          kind: "update_page_occurrence" as const,
          page_id: "page:missing-occurrence",
          occurrence_start_ms: Date.UTC(2026, 6, 18, 9),
          scope: "all" as const,
          updates: { is_all_day: false },
        },
      };
      const missingOccurrence = await client.automationApply(
        missingOccurrenceInput,
      );
      expect(missingOccurrence.value.page_occurrence_mutation).toMatchObject({
        success: false,
        duplicate: false,
        change_log_seq: null,
        code: "page_not_found",
      });
      const missingOccurrenceReplay = await nativeCli.automationApply(
        missingOccurrenceInput,
      );
      expect(missingOccurrenceReplay.event_sequence).toBe(
        missingOccurrence.event_sequence,
      );
      expect(
        missingOccurrenceReplay.value.page_occurrence_mutation,
      ).toMatchObject({
        success: false,
        duplicate: true,
        code: "page_not_found",
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
      const unauthorizedReminderClaim = nativeCli.automationApply({
        operationId: "node-native-cli-reminder-claim-1",
        intent: {
          kind: "claim_due_reminders",
          limit: 1,
          lease_duration_ms: 60_000,
        },
      });
      await expect(unauthorizedReminderClaim).rejects.toMatchObject({
        coreError: { code: "unauthorized" },
      });
      const administrationStatus = await client.administrationRead({ kind: "status" });
      expect(administrationStatus.value).toEqual({
        kind: "status",
        readiness: "ready",
        schema_version: 85,
        schema_owner: "rust",
        integrity: "unknown",
      });
      const backupInput = {
        operationId: "node-administration-backup-1",
        intent: {
          kind: "create_backup" as const,
          label: "Node integration backup",
          include_assets: false,
          trigger: "manual" as const,
        },
      };
      const backupCommitted = await nativeCli.administrationApply(backupInput);
      expect(backupCommitted.value.backup_id).toEqual(expect.any(String));
      expect(backupCommitted.receipt.duplicate).toBe(false);
      const backupReplay = await client.administrationApply(backupInput);
      expect(backupReplay.value.backup_id).toBe(backupCommitted.value.backup_id);
      expect(backupReplay.event_sequence).toBe(backupCommitted.event_sequence);
      expect(backupReplay.receipt.duplicate).toBe(true);
      const backups = await client.administrationRead({ kind: "backups" });
      expect(backups.value).toMatchObject({
        kind: "backups",
        items: [
          {
            backup_id: backupCommitted.value.backup_id,
            label: "Node integration backup",
            byte_length: expect.any(Number),
          },
        ],
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

      documentSubscription = await client.openDocumentEventStream(
        {
          documentId: "document:node-integration",
          clientSessionId: "session:before-store-restore",
          after: 0,
        },
        () => undefined,
        () => undefined,
        () => undefined,
      );
      const restoreInput = {
        operationId: "node-administration-restore-1",
        intent: {
          kind: "restore_backup" as const,
          backup_id: backupCommitted.value.backup_id!,
          create_safety_backup: true,
        },
      };
      const restored = await client.administrationApply(restoreInput);
      expect(restored.receipt.duplicate).toBe(false);
      expect(restored.value.backup_id).toBe(backupCommitted.value.backup_id);
      expect(restored.value.safety_backup_id).toEqual(expect.any(String));
      expect(restored.store_epoch).not.toBe(client.handshake.store_epoch);

      const replacedConnection = readCoreRuntimeConnection(nodexHome);
      expect(replacedConnection.descriptor.store_epoch).toBe(restored.store_epoch);
      expect(replacedConnection.descriptor.readiness_generation).toBe(2);
      const reconnected = await CoreClient.connect({
        nodexHome,
        clientKind: "test",
        buildId: "node-restored-client-test",
        projectId: "project:default",
      });
      expect(reconnected.handshake.store_epoch).toBe(restored.store_epoch);

      await expect(
        client.libraryApply({
          operationId: "node-old-epoch-after-restore",
          intent: {
            kind: "create_page",
            page_id: "page:stale-after-restore",
            document_id: "document:stale-after-restore",
            title: "Stale",
            parent: { kind: "library", before: null },
          },
        }),
      ).rejects.toMatchObject({ coreError: { code: "stale_store_epoch" } });
      await expect(
        client.documentSync({
          documentId: "document:node-integration",
          clientSessionId: "session:before-store-restore",
          stateVector: new Uint8Array(),
        }),
      ).rejects.toMatchObject({ coreError: { code: "unauthorized" } });
      const restoreReplay = await client.administrationApply(restoreInput);
      expect(restoreReplay.receipt.duplicate).toBe(true);
      expect(restoreReplay.store_epoch).toBe(restored.store_epoch);
      await expect(
        reconnected.workspaceRead({
          kind: "project",
          project_id: "project:node-integration",
        }),
      ).rejects.toMatchObject({ coreError: { code: "not_found" } });

      documentSubscription.close();
      await documentSubscription.done;
      documentSubscription = undefined;
      subscription.close();
      await subscription.done;
      subscription = undefined;
      await expect(client.shutdown()).resolves.toEqual({ status: "draining" });
      const exitCodes = await Promise.all(children.map(waitForExit));
      expect(exitCodes).toEqual([0, 0]);
      expect(existsSync(path.join(nodexHome, "run/core/core.sock"))).toBe(false);
      expect(existsSync(path.join(nodexHome, "run/core/core.json"))).toBe(false);
      expect(existsSync(path.join(nodexHome, "run/core/core.auth"))).toBe(false);

      const restartedChild = spawnCore(nodexHome);
      children.push(restartedChild);
      const restartedDescriptor = await readDescriptor(restartedChild);
      expect(restartedDescriptor.start_nonce).not.toBe(descriptors[0]?.start_nonce);
      const restartedClient = await CoreClient.connect({
        nodexHome,
        clientKind: "test",
        buildId: "node-restart-replay-test",
        projectId: "project:default",
      });
      let resolveReplayedEvent: ((event: CoreEventEnvelope) => void) | undefined;
      const replayedEvent = new Promise<CoreEventEnvelope>((resolve) => {
        resolveReplayedEvent = resolve;
      });
      restartedSubscription = await restartedClient.openEventStream(0, (candidate) => {
        if (candidate.event.operation_id !== applyInput.operationId) return;
        resolveReplayedEvent?.(candidate);
      });
      await expect(
        withTimeout(replayedEvent, "Core did not replay a durable event after restart"),
      ).resolves.toMatchObject({
        event: {
          sequence: committed.event_sequence,
          operation_id: applyInput.operationId,
          payload: {
            module: "library",
            event: { kind: "library_changed" },
          },
        },
      });
      restartedSubscription.close();
      await restartedSubscription.done;
      restartedSubscription = undefined;
      await expect(restartedClient.shutdown()).resolves.toEqual({ status: "draining" });
      await expect(waitForExit(restartedChild)).resolves.toBe(0);
      expect(existsSync(path.join(nodexHome, "run/core/core.sock"))).toBe(false);
      expect(existsSync(path.join(nodexHome, "run/core/core.json"))).toBe(false);
      expect(existsSync(path.join(nodexHome, "run/core/core.auth"))).toBe(false);
    } finally {
      restartedSubscription?.close();
      documentSubscription?.close();
      subscription?.close();
      for (const child of children) {
        if (child.exitCode === null) child.kill();
      }
      await Promise.all(children.map((child) => waitForExit(child).catch(() => null)));
      rmSync(nodexHome, { recursive: true, force: true });
    }
  });
});
