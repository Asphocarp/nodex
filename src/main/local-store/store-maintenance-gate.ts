export class StoreMaintenanceInProgressError extends Error {
  constructor() {
    super("The local store is temporarily unavailable for maintenance");
    this.name = "StoreMaintenanceInProgressError";
  }
}

export interface StoreMaintenanceGateLease {
  readonly release: () => void;
}

/** A small process-local read/write gate for managed asset filesystem writes. */
export class StoreMaintenanceGate {
  private activeMutations = 0;
  private maintenanceRequested = false;
  private maintenanceActive = false;
  private drainWaiters = new Set<() => void>();

  beginMutation(): StoreMaintenanceGateLease {
    if (this.maintenanceRequested || this.maintenanceActive) {
      throw new StoreMaintenanceInProgressError();
    }
    this.activeMutations += 1;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.activeMutations -= 1;
        if (this.activeMutations !== 0) return;
        const waiters = [...this.drainWaiters];
        this.drainWaiters.clear();
        waiters.forEach((resolve) => resolve());
      },
    };
  }

  async beginMaintenance(): Promise<StoreMaintenanceGateLease> {
    if (this.maintenanceRequested || this.maintenanceActive) {
      throw new StoreMaintenanceInProgressError();
    }
    this.maintenanceRequested = true;
    if (this.activeMutations > 0) {
      await new Promise<void>((resolve) => this.drainWaiters.add(resolve));
    }
    this.maintenanceActive = true;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.maintenanceActive = false;
        this.maintenanceRequested = false;
      },
    };
  }
}

export const storeMaintenanceGate = new StoreMaintenanceGate();
