import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deleteCodexScheduledAutomation,
  deleteActiveHeartbeatAutomationForTargetThread,
  deleteCodexScheduledAutomationWithStatus,
  getCodexScheduledAutomation,
  listDueCodexScheduledAutomationRuns,
  listCodexScheduledAutomations,
  reconcileCodexScheduledAutomations,
  recordCodexScheduledAutomationNextRun,
  recordCodexScheduledAutomationNextScheduledRun,
  recordCodexScheduledAutomationRunDispatched,
  upsertCodexScheduledAutomation,
} from "./codex-scheduled-automations";
import { closeDatabase, getDb, initializeDatabase } from "./database";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: (tempDir: string) => Promise<void> | void): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-scheduled-automations-"));
  process.env.NODEX_HOME = tempDir;
  try {
    await initializeDatabase();
  } catch (error) {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_HOME;
    if (isUnsupportedSqliteError(error)) return false;
    throw error;
  }

  try {
    await run(tempDir);
    return true;
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_HOME;
  }
}

function writeAutomationTomlFixture(tempDir: string, automationId: string, toml: string): void {
  const automationDir = path.join(tempDir, "automations", automationId);
  fs.mkdirSync(automationDir, { recursive: true });
  fs.writeFileSync(path.join(automationDir, "automation.toml"), `${toml.trim()}\n`, "utf8");
}

describe("codex scheduled automations store", () => {
  test("persists scheduled automations as TOML and mirrors them in updated order", async () => {
    const ran = await withTempDatabase(async (tempDir) => {
      upsertCodexScheduledAutomation({
        id: "automation-newer",
        kind: "heartbeat",
        status: "ACTIVE",
        targetThreadId: "thread-1",
        name: "Newer heartbeat",
        prompt: "Summarize the thread.",
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        nextRunAt: 1_800_000_000_000,
        createdAt: 20,
        updatedAt: 20,
      });
      upsertCodexScheduledAutomation({
        id: "automation-older",
        kind: "cron",
        status: "PAUSED",
        targetThreadId: null,
        name: "Older cron",
        prompt: "Run the report.",
        rrule: null,
        cwds: ["/tmp/project-alpha"],
        executionEnvironment: "worktree",
        model: "gpt-5",
        reasoningEffort: "medium",
        nextRunAt: null,
        createdAt: 10,
        updatedAt: 10,
      });

      const automations = listCodexScheduledAutomations();
      expect(automations.length).toBe(2);
      expect(automations[0]?.id).toBe("automation-newer");
      expect(automations[1]?.id).toBe("automation-older");
      expect(automations[0]?.targetThreadId).toBe("thread-1");
      expect(automations[0]?.nextRunAt !== null).toBe(true);
      expect(automations[1]?.cwds[0]).toBe("/tmp/project-alpha");
      expect(automations[1]?.model).toBe("gpt-5");
      expect(automations[1]?.reasoningEffort).toBe("medium");

      const cronToml = fs.readFileSync(
        path.join(tempDir, "automations", "automation-older", "automation.toml"),
        "utf8",
      );
      expect(cronToml.includes("version = 1")).toBe(true);
      expect(cronToml.includes("id = \"automation-older\"")).toBe(true);
      expect(cronToml.includes("cwds = [\"/tmp/project-alpha\"]")).toBe(true);
      expect(cronToml.includes("created_at = 10")).toBe(true);
      expect(cronToml.includes("updated_at = 10")).toBe(true);
      expect(cronToml.includes("created_at = \"")).toBe(false);
      expect(cronToml.includes("updated_at = \"")).toBe(false);
      expect(cronToml.includes("next_run_at")).toBe(false);
      expect(cronToml.includes("last_run_at")).toBe(false);

      const heartbeatToml = fs.readFileSync(
        path.join(tempDir, "automations", "automation-newer", "automation.toml"),
        "utf8",
      );
      expect(heartbeatToml.includes("target_thread_id = \"thread-1\"")).toBe(true);
      expect(heartbeatToml.includes("created_at = 20")).toBe(true);
      expect(heartbeatToml.includes("updated_at = 20")).toBe(true);
      expect(heartbeatToml.includes("next_run_at")).toBe(false);
      expect(heartbeatToml.includes("last_run_at")).toBe(false);
      expect(heartbeatToml.includes("cwds =")).toBe(false);

      closeDatabase();
      await initializeDatabase();
      const restarted = listCodexScheduledAutomations();
      expect(restarted.length).toBe(2);
      expect(restarted[0]?.id).toBe("automation-newer");
      expect(restarted[1]?.prompt).toBe("Run the report.");
    });

    if (!ran) expect(true).toBe(true);
  });

  test("reads reference-shaped TOML fixtures with numeric timestamps", async () => {
    const ran = await withTempDatabase((tempDir) => {
      writeAutomationTomlFixture(tempDir, "reference-cron", `
version = 1
id = "reference-cron"
kind = "cron"
name = "Reference cron"
prompt = "Line one\\nLine two \\"quoted\\""
status = "ACTIVE"
rrule = "FREQ=DAILY;BYHOUR=9;BYMINUTE=0"
model = "gpt-5"
reasoning_effort = "medium"
execution_environment = "local"
local_environment_config_path = ".codex/environments/default.toml"
cwds = ["/tmp/project", "/tmp/other"]
created_at = 1783472523000
updated_at = 1783476123000
      `);
      writeAutomationTomlFixture(tempDir, "reference-heartbeat", `
version = 1
id = "reference-heartbeat"
kind = "heartbeat"
name = "Reference heartbeat"
prompt = "Follow up."
status = "PAUSED"
rrule = "FREQ=MINUTELY;INTERVAL=15"
target_thread_id = "thread-reference"
created_at = 1783472523001
updated_at = 1783476123001
      `);

      const automations = listCodexScheduledAutomations();
      expect(automations.length).toBe(2);

      const cron = automations.find((automation) => automation.id === "reference-cron");
      expect(cron?.id).toBe("reference-cron");
      expect(cron?.kind).toBe("cron");
      expect(cron?.status).toBe("ACTIVE");
      expect(cron?.targetThreadId).toBe(null);
      expect(cron?.name).toBe("Reference cron");
      expect(cron?.prompt).toBe("Line one\nLine two \"quoted\"");
      expect(cron?.rrule).toBe("FREQ=DAILY;BYHOUR=9;BYMINUTE=0");
      expect(cron?.model).toBe("gpt-5");
      expect(cron?.reasoningEffort).toBe("medium");
      expect(cron?.executionEnvironment).toBe("local");
      expect(cron?.localEnvironmentConfigPath).toBe(".codex/environments/default.toml");
      expect(cron?.cwds.length).toBe(2);
      expect(cron?.cwds[0]).toBe("/tmp/project");
      expect(cron?.cwds[1]).toBe("/tmp/other");
      expect(cron?.createdAt).toBe(1783472523000);
      expect(cron?.updatedAt).toBe(1783476123000);
      expect(cron?.lastRunAt).toBe(null);
      expect(cron?.nextRunAt !== null).toBe(true);

      const heartbeat = automations.find((automation) => automation.id === "reference-heartbeat");
      expect(heartbeat?.id).toBe("reference-heartbeat");
      expect(heartbeat?.kind).toBe("heartbeat");
      expect(heartbeat?.status).toBe("PAUSED");
      expect(heartbeat?.targetThreadId).toBe("thread-reference");
      expect(heartbeat?.prompt).toBe("Follow up.");
      expect(heartbeat?.rrule).toBe("FREQ=MINUTELY;INTERVAL=15");
      expect(heartbeat?.cwds.length).toBe(0);
      expect(heartbeat?.executionEnvironment).toBe("worktree");
      expect(heartbeat?.createdAt).toBe(1783472523001);
      expect(heartbeat?.updatedAt).toBe(1783476123001);
      expect(heartbeat?.nextRunAt).toBe(null);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("upserts and deletes scheduled automations by id", async () => {
    const ran = await withTempDatabase(() => {
      upsertCodexScheduledAutomation({
        id: "automation-1",
        kind: "heartbeat",
        status: "ACTIVE",
        targetThreadId: "thread-1",
        name: "Daily standup",
        prompt: "Check on blockers.",
        rrule: "FREQ=DAILY",
        nextRunAt: 1_800_000_000_000,
        lastRunAt: 1_700_000_000_000,
        createdAt: 10,
        updatedAt: 10,
      });
      const updated = upsertCodexScheduledAutomation({
        id: "automation-1",
        kind: "heartbeat",
        status: "PAUSED",
        targetThreadId: "thread-2",
        name: "Paused standup",
        rrule: "FREQ=WEEKLY",
        prompt: "Check on blockers, but weekly.",
        nextRunAt: null,
        createdAt: 99,
        updatedAt: 20,
      });

      expect(updated.status).toBe("PAUSED");
      expect(updated.targetThreadId).toBe("thread-2");
      expect(updated.createdAt).toBe(10);
      expect(updated.updatedAt).toBe(20);
      expect(updated.lastRunAt).toBe(1_700_000_000_000);
      expect(updated.nextRunAt).toBe(null);
      const preservedTarget = upsertCodexScheduledAutomation({
        id: "automation-1",
        kind: "heartbeat",
        status: "ACTIVE",
        name: "Resumed standup",
        updatedAt: 30,
      });
      expect(preservedTarget.targetThreadId).toBe("thread-2");
      expect(preservedTarget.prompt).toBe("Check on blockers, but weekly.");
      expect(preservedTarget.rrule).toBe("FREQ=WEEKLY");
      expect(preservedTarget.nextRunAt !== null).toBe(true);
      expect(getCodexScheduledAutomation("automation-1")?.name).toBe("Resumed standup");
      expect(deleteCodexScheduledAutomationWithStatus("automation-1").status).toBe("deleted");
      expect(getCodexScheduledAutomation("automation-1")).toBe(null);
      expect(deleteCodexScheduledAutomationWithStatus("automation-1").status).toBe("not_found");
    });

    if (!ran) expect(true).toBe(true);
  });

  test("updates cron model and reasoning in TOML, SQLite mirror, and restarted reads", async () => {
    const ran = await withTempDatabase(async (tempDir) => {
      upsertCodexScheduledAutomation({
        id: "automation-model",
        kind: "cron",
        status: "ACTIVE",
        targetThreadId: null,
        name: "Model report",
        prompt: "Summarize with the selected model.",
        rrule: "FREQ=DAILY",
        cwds: ["/tmp/project"],
        executionEnvironment: "worktree",
        model: "gpt-5",
        reasoningEffort: "medium",
        createdAt: 10,
        updatedAt: 10,
      });

      const updated = upsertCodexScheduledAutomation({
        id: "automation-model",
        kind: "cron",
        status: "ACTIVE",
        targetThreadId: null,
        name: "Model report",
        prompt: "Summarize with the selected model.",
        rrule: "FREQ=DAILY",
        cwds: ["/tmp/project"],
        executionEnvironment: "local",
        model: "gpt-5.1",
        reasoningEffort: "high",
        updatedAt: 20,
      });

      expect(updated.model).toBe("gpt-5.1");
      expect(updated.reasoningEffort).toBe("high");
      expect(updated.executionEnvironment).toBe("local");

      const toml = fs.readFileSync(
        path.join(tempDir, "automations", "automation-model", "automation.toml"),
        "utf8",
      );
      expect(toml.includes("model = \"gpt-5.1\"")).toBe(true);
      expect(toml.includes("reasoning_effort = \"high\"")).toBe(true);
      expect(toml.includes("execution_environment = \"local\"")).toBe(true);

      const mirror = getDb().prepare(`
        SELECT model, reasoning_effort, execution_environment
        FROM codex_scheduled_automations
        WHERE automation_id = ?
      `).get("automation-model") as {
        model: string | null;
        reasoning_effort: string | null;
        execution_environment: string;
      } | undefined;
      expect(mirror?.model).toBe("gpt-5.1");
      expect(mirror?.reasoning_effort).toBe("high");
      expect(mirror?.execution_environment).toBe("local");

      const listed = listCodexScheduledAutomations().find((automation) => automation.id === "automation-model");
      expect(listed?.model).toBe("gpt-5.1");
      expect(listed?.reasoningEffort).toBe("high");

      closeDatabase();
      await initializeDatabase();
      const restarted = listCodexScheduledAutomations().find((automation) => automation.id === "automation-model");
      expect(restarted?.model).toBe("gpt-5.1");
      expect(restarted?.reasoningEffort).toBe("high");
    });

    if (!ran) expect(true).toBe(true);
  });

  test("rejects unsafe ids, invalid cron payloads, and duplicate active heartbeats", async () => {
    const ran = await withTempDatabase(() => {
      let invalidIdRejected = false;
      try {
        upsertCodexScheduledAutomation({
          id: "../automation",
          kind: "heartbeat",
          status: "ACTIVE",
          targetThreadId: "thread-1",
          name: "Invalid id",
        });
      } catch {
        invalidIdRejected = true;
      }
      expect(invalidIdRejected).toBe(true);

      let invalidCronRejected = false;
      try {
        upsertCodexScheduledAutomation({
          id: "cron-without-cwd",
          kind: "cron",
          status: "ACTIVE",
          targetThreadId: null,
          name: "Cron without cwd",
        });
      } catch {
        invalidCronRejected = true;
      }
      expect(invalidCronRejected).toBe(true);

      upsertCodexScheduledAutomation({
        id: "heartbeat-one",
        kind: "heartbeat",
        status: "ACTIVE",
        targetThreadId: "thread-duplicate",
        name: "Heartbeat one",
      });

      let duplicateRejected = false;
      try {
        upsertCodexScheduledAutomation({
          id: "heartbeat-two",
          kind: "heartbeat",
          status: "ACTIVE",
          targetThreadId: "thread-duplicate",
          name: "Heartbeat two",
        });
      } catch {
        duplicateRejected = true;
      }
      expect(duplicateRejected).toBe(true);

      expect(deleteCodexScheduledAutomation("../automation")).toBe(false);
      expect(deleteCodexScheduledAutomation("heartbeat-one")).toBe(true);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("deletes the active heartbeat automation for an archived target thread", async () => {
    const ran = await withTempDatabase(() => {
      upsertCodexScheduledAutomation({
        id: "active-heartbeat",
        kind: "heartbeat",
        status: "ACTIVE",
        targetThreadId: "thread-target",
        name: "Active heartbeat",
        prompt: "Follow up.",
        rrule: "FREQ=MINUTELY;INTERVAL=5",
        createdAt: 10,
        updatedAt: 10,
      });
      upsertCodexScheduledAutomation({
        id: "paused-heartbeat",
        kind: "heartbeat",
        status: "PAUSED",
        targetThreadId: "thread-target",
        name: "Paused heartbeat",
        prompt: "Follow up later.",
        rrule: "FREQ=MINUTELY;INTERVAL=5",
        createdAt: 20,
        updatedAt: 20,
      });

      expect(deleteActiveHeartbeatAutomationForTargetThread("thread-target")?.id).toBe("active-heartbeat");
      expect(getCodexScheduledAutomation("active-heartbeat")).toBe(null);
      expect(getCodexScheduledAutomation("paused-heartbeat")?.id).toBe("paused-heartbeat");
      expect(deleteActiveHeartbeatAutomationForTargetThread("thread-target")).toBe(null);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("selects due runs and records scheduler dispatch state in the mirror", async () => {
    const ran = await withTempDatabase(() => {
      const now = Date.UTC(2026, 6, 8, 10, 4, 15);
      upsertCodexScheduledAutomation({
        id: "due-cron",
        kind: "cron",
        status: "ACTIVE",
        targetThreadId: null,
        name: "Due cron",
        prompt: "Run due cron.",
        rrule: "FREQ=MINUTELY;INTERVAL=5",
        cwds: ["/repo/due"],
        executionEnvironment: "worktree",
        createdAt: 10,
        updatedAt: 10,
      });
      upsertCodexScheduledAutomation({
        id: "future-cron",
        kind: "cron",
        status: "ACTIVE",
        targetThreadId: null,
        name: "Future cron",
        prompt: "Run future cron.",
        rrule: "FREQ=MINUTELY;INTERVAL=5",
        cwds: ["/repo/future"],
        executionEnvironment: "worktree",
        createdAt: 20,
        updatedAt: 20,
      });

      expect(recordCodexScheduledAutomationNextRun("due-cron", now - 1_000, now - 2_000)?.nextRunAt).toBe(now - 1_000);
      expect(recordCodexScheduledAutomationNextRun("future-cron", now + 60_000, now - 2_000)?.nextRunAt).toBe(now + 60_000);

      const due = listDueCodexScheduledAutomationRuns(now, 3);
      expect(due.length).toBe(1);
      expect(due[0]?.id).toBe("due-cron");

      const dispatched = recordCodexScheduledAutomationRunDispatched("due-cron", now);
      expect(dispatched?.lastRunAt).toBe(now);
      expect((dispatched?.nextRunAt ?? 0) > now).toBe(true);
      expect(getCodexScheduledAutomation("due-cron")?.lastRunAt).toBe(now);

      const skipped = recordCodexScheduledAutomationNextScheduledRun("future-cron", now);
      expect((skipped?.nextRunAt ?? 0) > now).toBe(true);
      expect(skipped?.lastRunAt).toBe(null);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("reconciles missing next-run values for active automations", async () => {
    const ran = await withTempDatabase(() => {
      const now = Date.UTC(2026, 6, 8, 10, 4, 15);
      upsertCodexScheduledAutomation({
        id: "missing-next-run",
        kind: "cron",
        status: "ACTIVE",
        targetThreadId: null,
        name: "Missing next run",
        prompt: "Run on a schedule.",
        rrule: "FREQ=MINUTELY;INTERVAL=5",
        cwds: ["/repo/missing"],
        executionEnvironment: "worktree",
        createdAt: 10,
        updatedAt: 10,
      });
      expect(recordCodexScheduledAutomationNextRun("missing-next-run", null, now)?.nextRunAt).toBe(null);

      expect(reconcileCodexScheduledAutomations(now)).toBe(1);
      expect((getCodexScheduledAutomation("missing-next-run")?.nextRunAt ?? 0) > now).toBe(true);
      expect(reconcileCodexScheduledAutomations(now)).toBe(0);
    });

    if (!ran) expect(true).toBe(true);
  });
});
