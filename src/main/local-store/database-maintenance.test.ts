import { describe, expect, test } from "bun:test";
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
      expect(isDatabaseMaintenanceActive()).toBeTrue();

      let blocked = false;
      try {
        getDb();
      } catch (error) {
        blocked = isDatabaseMaintenanceInProgressError(error);
      }
      expect(blocked).toBeTrue();

      let nestedBlocked = false;
      try {
        beginDatabaseMaintenance();
      } catch (error) {
        nestedBlocked = isDatabaseMaintenanceInProgressError(error);
      }
      expect(nestedBlocked).toBeTrue();
    } finally {
      lease.release();
      lease.release();
    }

    expect(isDatabaseMaintenanceActive()).toBeFalse();
  });
});
