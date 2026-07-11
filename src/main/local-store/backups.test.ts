import { describe, expect, vi, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-backup-unit-"));
const liveDbPath = path.join(fixtureRoot, "nodex.db");
const liveAssetsPath = path.join(fixtureRoot, "assets");

const state = {
  projects: [{ id: "default" }],
  notifications: [] as Array<[string, string, string]>,
  maintenanceEvents: [] as string[],
  failEpochRotation: false,
};

vi.mock("./backups-deps", () => ({
  getLocalStoreDir: () => fixtureRoot,
  getDatabasePath: () => liveDbPath,
  dbNotifier: {
    notifyChange: (projectId: string, changeType: string, columnId: string) => {
      state.notifications.push([projectId, changeType, columnId]);
    },
  },
  listProjects: () => state.projects,
  openStandaloneBackupDatabase: () => ({
    backup: async (destinationPath: string) => {
      fs.copyFileSync(liveDbPath, destinationPath);
      return { totalPages: 1, remainingPages: 0 };
    },
    close: () => undefined,
  }),
}));

vi.mock("../whole-store-maintenance-runtime", () => ({
  wholeStoreMaintenance: {
    snapshot: async <T>(operation: () => Promise<T>) => {
      state.maintenanceEvents.push("snapshot:start");
      try {
        return await operation();
      } finally {
        state.maintenanceEvents.push("snapshot:end");
      }
    },
    restore: async <T>(
      operation: () => Promise<{ value: T; storeEpoch: string }>,
    ) => {
      state.maintenanceEvents.push("restore:start");
      const result = await operation();
      state.maintenanceEvents.push(`reset:${result.storeEpoch}`);
      return result.value;
    },
  },
}));

vi.mock("./backup-store-validation", () => ({
  validateBackupStore: (databasePath: string) => {
    const content = fs.readFileSync(databasePath, "utf8");
    if (content.startsWith("invalid")) throw new Error("invalid database");
    return {
      schemaVersion: 66,
      storeEpoch: "epoch-before",
      projectCount: 1,
      documentCount: 1,
    };
  },
  rotateBackupStoreEpoch: (databasePath: string) => {
    if (state.failEpochRotation) throw new Error("injected epoch rotation failure");
    const content = fs.readFileSync(databasePath, "utf8");
    if (content.startsWith("invalid")) throw new Error("invalid database");
    return {
      schemaVersion: 66,
      storeEpoch: "epoch-restored",
      projectCount: 1,
      documentCount: 1,
    };
  },
}));

const backupService = await import("./backups");

function resetState(): void {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.writeFileSync(liveDbPath, "live-db", "utf8");
  state.notifications = [];
  state.maintenanceEvents = [];
  state.failEpochRotation = false;
}

function writeAsset(fileName: string, content: string): void {
  fs.mkdirSync(liveAssetsPath, { recursive: true });
  fs.writeFileSync(path.join(liveAssetsPath, fileName), content, "utf8");
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("backup service", () => {
  test("creates backup containing db and assets", async () => {
    resetState();
    writeAsset("a.txt", "asset-a");

    const backup = await backupService.createBackup({
      trigger: "manual",
      label: "first",
    });

    expect(backup.trigger).toBe("manual");
    expect(backup.includesAssets).toBe(true);
    expect(backup.dbBytes > 0).toBe(true);
    expect(backup.totalBytes >= backup.dbBytes).toBe(true);

    const backupDir = path.join(fixtureRoot, "backups", backup.id);
    expect(fs.existsSync(path.join(backupDir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, "nodex.db"))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, "assets", "a.txt"))).toBe(true);
    expect(state.maintenanceEvents.join(",")).toBe(
      "snapshot:start,snapshot:end",
    );
  });

  test("lists backups newest first", async () => {
    resetState();

    const first = await backupService.createBackup({ trigger: "manual", label: "first" });
    await sleep(5);
    const second = await backupService.createBackup({ trigger: "manual", label: "second" });

    const backups = await backupService.listBackups();
    expect(backups.length).toBe(2);
    expect(backups[0].id).toBe(second.id);
    expect(backups[1].id).toBe(first.id);
  });

  test("restore requires explicit confirm", async () => {
    resetState();
    const backup = await backupService.createBackup({ trigger: "manual" });

    let message = "";
    try {
      await backupService.restoreBackup({
        backupId: backup.id,
        confirm: false,
      });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message.includes("confirm=true")).toBe(true);
  });

  test("restore creates pre-restore safety backup by default", async () => {
    resetState();
    const target = await backupService.createBackup({ trigger: "manual", label: "target" });
    fs.writeFileSync(liveDbPath, "live-db-updated", "utf8");
    state.maintenanceEvents = [];

    const result = await backupService.restoreBackup({
      backupId: target.id,
      confirm: true,
    });

    expect(result.success).toBe(true);
    expect(result.restoredBackupId).toBe(target.id);
    expect(Boolean(result.safetyBackupId)).toBe(true);
    expect(state.notifications.length > 0).toBe(true);
    expect(state.maintenanceEvents.join(",")).toBe(
      "restore:start,reset:epoch-restored",
    );

    const allBackups = await backupService.listBackups();
    const safety = allBackups.find((item) => item.id === result.safetyBackupId);
    expect(Boolean(safety)).toBe(true);
    expect(safety?.trigger).toBe("pre-restore");
  });

  test("deletes an existing backup", async () => {
    resetState();
    const backup = await backupService.createBackup({ trigger: "manual", label: "delete-me" });

    const result = await backupService.deleteBackup(backup.id);
    expect(result.success).toBe(true);
    expect(result.deletedBackupId).toBe(backup.id);

    const backupDir = path.join(fixtureRoot, "backups", backup.id);
    expect(fs.existsSync(backupDir)).toBe(false);

    const backups = await backupService.listBackups();
    expect(backups.length).toBe(0);
  });

  test("prunes only auto backups beyond retention", async () => {
    resetState();

    await backupService.createBackup({ trigger: "manual", label: "manual" });
    await backupService.createBackup({ trigger: "pre-restore", label: "safety" });
    for (let index = 0; index < 4; index += 1) {
      await sleep(2);
      await backupService.createBackup({ trigger: "auto", label: `auto-${index}` });
    }

    const pruneResult = await backupService.pruneAutoBackups(2);
    expect(pruneResult.removed.length).toBe(2);

    const backups = await backupService.listBackups();
    expect(backups.filter((item) => item.trigger === "auto").length).toBe(2);
    expect(backups.filter((item) => item.trigger === "manual").length).toBe(1);
    expect(backups.filter((item) => item.trigger === "pre-restore").length).toBe(1);
  });

  test("restore rolls back when validation fails", async () => {
    resetState();
    fs.writeFileSync(liveDbPath, "baseline-live-db", "utf8");
    const backup = await backupService.createBackup({ trigger: "manual", label: "baseline" });

    const backupDbPath = path.join(fixtureRoot, "backups", backup.id, "nodex.db");
    fs.writeFileSync(backupDbPath, "invalid-backup-db", "utf8");

    let failed = false;
    try {
      await backupService.restoreBackup({
        backupId: backup.id,
        confirm: true,
        createSafetyBackup: false,
      });
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
    expect(fs.readFileSync(liveDbPath, "utf8")).toBe("baseline-live-db");
  });

  test("restore rolls back an installed store when epoch rotation fails", async () => {
    resetState();
    const backup = await backupService.createBackup({ trigger: "manual" });
    fs.writeFileSync(liveDbPath, "newer-live-db", "utf8");
    state.maintenanceEvents = [];
    state.failEpochRotation = true;

    let failed = false;
    try {
      await backupService.restoreBackup({
        backupId: backup.id,
        confirm: true,
        createSafetyBackup: false,
      });
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
    expect(fs.readFileSync(liveDbPath, "utf8")).toBe("newer-live-db");
    expect(state.maintenanceEvents.join(",")).toBe("restore:start");
  });

  test("restore rejects unsafe backup ids", async () => {
    resetState();

    let message = "";
    try {
      await backupService.restoreBackup({
        backupId: "../outside",
        confirm: true,
        createSafetyBackup: false,
      });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message.includes("Invalid backup id")).toBe(true);
  });

  test("delete rejects missing backup ids", async () => {
    resetState();

    let message = "";
    try {
      await backupService.deleteBackup("missing-backup");
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message.includes("Backup not found")).toBe(true);
  });
});
