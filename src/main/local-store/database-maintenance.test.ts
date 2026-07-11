import { describe, expect, test } from "bun:test";
import {
  beginDatabaseMaintenance,
  DatabaseMaintenanceInProgressError,
  getDb,
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
        blocked = error instanceof DatabaseMaintenanceInProgressError;
      }
      expect(blocked).toBeTrue();

      let nestedBlocked = false;
      try {
        beginDatabaseMaintenance();
      } catch (error) {
        nestedBlocked = error instanceof DatabaseMaintenanceInProgressError;
      }
      expect(nestedBlocked).toBeTrue();
    } finally {
      lease.release();
      lease.release();
    }

    expect(isDatabaseMaintenanceActive()).toBeFalse();
  });
});
