import { describe, expect, test } from "bun:test";
import {
  StoreMaintenanceGate,
  StoreMaintenanceInProgressError,
} from "./store-maintenance-gate";

describe("StoreMaintenanceGate", () => {
  test("drains accepted asset writes and rejects mutations until maintenance ends", async () => {
    const gate = new StoreMaintenanceGate();
    const mutation = gate.beginMutation();
    let maintenanceEntered = false;
    const pending = gate.beginMaintenance().then((lease) => {
      maintenanceEntered = true;
      return lease;
    });
    await Promise.resolve();
    expect(maintenanceEntered).toBeFalse();

    let rejected = false;
    try {
      gate.beginMutation();
    } catch (error) {
      rejected = error instanceof StoreMaintenanceInProgressError;
    }
    expect(rejected).toBeTrue();

    mutation.release();
    const maintenance = await pending;
    expect(maintenanceEntered).toBeTrue();
    maintenance.release();
    const resumed = gate.beginMutation();
    resumed.release();
  });
});
