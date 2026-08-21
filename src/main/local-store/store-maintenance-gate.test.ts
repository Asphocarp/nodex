import { describe, expect, test } from "vitest";
import { StoreMaintenanceGate, StoreMaintenanceInProgressError } from "./store-maintenance-gate";

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
    expect(maintenanceEntered).toBe(false);

    let rejected = false;
    try {
      gate.beginMutation();
    } catch (error) {
      rejected = error instanceof StoreMaintenanceInProgressError;
    }
    expect(rejected).toBe(true);

    mutation.release();
    const maintenance = await pending;
    expect(maintenanceEntered).toBe(true);
    maintenance.release();
    const resumed = gate.beginMutation();
    resumed.release();
  });
});
