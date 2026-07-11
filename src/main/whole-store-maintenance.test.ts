import { describe, expect, test } from "bun:test";
import { WholeStoreMaintenanceCoordinator } from "./whole-store-maintenance";

describe("WholeStoreMaintenanceCoordinator", () => {
  test("freezes both SQLite connections after the writer barrier", async () => {
    const events: string[] = [];
    const coordinator = new WholeStoreMaintenanceCoordinator({
      writer: {
        barrier: async () => {
          events.push("barrier");
        },
        suspendForMaintenance: async () => {
          events.push("suspend");
        },
        resumeAfterMaintenance: () => events.push("resume"),
      },
      beginStoreMaintenance: async () => {
        events.push("store-lease");
        return { release: () => events.push("store-release") };
      },
      beginDatabaseMaintenance: () => {
        events.push("database-lease");
        return { release: () => events.push("database-release") };
      },
      closeMainDatabase: () => events.push("close"),
      resetLiveDocumentClients: () => undefined,
    });

    const value = await coordinator.snapshot(async () => {
      events.push("snapshot");
      return "complete";
    });
    expect(value).toBe("complete");
    expect(events.join(",")).toBe(
      "store-lease,barrier,suspend,database-lease,close,snapshot,database-release,resume,store-release",
    );
  });

  test("resumes after rollback and resets clients only after a committed restore", async () => {
    const events: string[] = [];
    const coordinator = new WholeStoreMaintenanceCoordinator({
      writer: {
        barrier: async () => undefined,
        suspendForMaintenance: async () => {
          events.push("suspend");
        },
        resumeAfterMaintenance: () => {
          events.push("resume");
        },
      },
      beginStoreMaintenance: async () => ({ release: () => undefined }),
      beginDatabaseMaintenance: () => {
        events.push("lease");
        return { release: () => events.push("release") };
      },
      closeMainDatabase: () => events.push("close"),
      resetLiveDocumentClients: (storeEpoch) => {
        events.push(`reset:${storeEpoch}`);
      },
    });

    let failed = false;
    try {
      await coordinator.restore(async () => {
        events.push("rollback");
        throw new Error("injected restore failure");
      });
    } catch {
      failed = true;
    }
    expect(failed).toBeTrue();
    expect(events.join(",")).toBe(
      "suspend,lease,close,rollback,release,resume",
    );

    events.splice(0);
    const value = await coordinator.restore(async () => {
      events.push("commit");
      return { value: "restored", storeEpoch: "epoch-restored" };
    });
    expect(value).toBe("restored");
    expect(events.join(",")).toBe(
      "suspend,lease,close,commit,release,resume,reset:epoch-restored",
    );
  });

  test("does not report a durable restore as failed when reset fanout throws", async () => {
    let reported = false;
    const coordinator = new WholeStoreMaintenanceCoordinator({
      writer: {
        barrier: async () => undefined,
        suspendForMaintenance: async () => undefined,
        resumeAfterMaintenance: () => undefined,
      },
      beginStoreMaintenance: async () => ({ release: () => undefined }),
      beginDatabaseMaintenance: () => ({ release: () => undefined }),
      closeMainDatabase: () => undefined,
      resetLiveDocumentClients: () => {
        throw new Error("window disappeared");
      },
      reportClientResetFailure: () => {
        reported = true;
      },
    });

    const result = await coordinator.restore(async () => ({
      value: "durable",
      storeEpoch: "epoch-restored",
    }));
    expect(result).toBe("durable");
    expect(reported).toBeTrue();
  });
});
