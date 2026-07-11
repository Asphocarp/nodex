import { describe, expect, test } from "vitest";
import {
  beginDatabaseMaintenance,
  getDb,
  isDatabaseMaintenanceInProgressError,
  isDatabaseMaintenanceActive,
} from "./database";

describe("database maintenance lease", () => {
  test("fails closed until its owning lease is released", () => {
    const lease = beginDatabaseMaintenance();
    try {
      expect(isDatabaseMaintenanceActive()).toBe(true);

      let blocked = false;
      try {
        getDb();
      } catch (error) {
        blocked = isDatabaseMaintenanceInProgressError(error);
      }
      expect(blocked).toBe(true);

      let nestedBlocked = false;
      try {
        beginDatabaseMaintenance();
      } catch (error) {
        nestedBlocked = isDatabaseMaintenanceInProgressError(error);
      }
      expect(nestedBlocked).toBe(true);
    } finally {
      lease.release();
      lease.release();
    }

    expect(isDatabaseMaintenanceActive()).toBe(false);
  });
});
