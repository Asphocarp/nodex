export interface WholeStoreMaintenanceWriter {
  barrier(): Promise<void>;
  suspendForMaintenance(): Promise<void>;
  resumeAfterMaintenance(): void;
}

export interface WholeStoreDatabaseLease {
  release(): void;
}

export interface WholeStoreMaintenanceDependencies {
  readonly writer: WholeStoreMaintenanceWriter;
  readonly beginStoreMaintenance: () => Promise<WholeStoreDatabaseLease>;
  readonly beginDatabaseMaintenance: () => WholeStoreDatabaseLease;
  readonly closeMainDatabase: () => void;
  readonly resetLiveDocumentClients: (storeEpoch: string) => void;
  readonly reportClientResetFailure?: (error: unknown) => void;
}

export interface WholeStoreRestoreCommit<Value> {
  readonly value: Value;
  readonly storeEpoch: string;
}

/**
 * Coordinates the process-wide parts of backup and restore. Filesystem swap,
 * candidate validation, and rollback stay in the backup service; this class
 * owns the invariant that neither SQLite connection can survive a restore.
 */
export class WholeStoreMaintenanceCoordinator {
  constructor(private readonly dependencies: WholeStoreMaintenanceDependencies) {}

  async snapshot<Value>(operation: () => Promise<Value>): Promise<Value> {
    const storeLease = await this.dependencies.beginStoreMaintenance();
    let suspended = false;
    let databaseLease: WholeStoreDatabaseLease | null = null;
    try {
      await this.dependencies.writer.barrier();
      await this.dependencies.writer.suspendForMaintenance();
      suspended = true;
      databaseLease = this.dependencies.beginDatabaseMaintenance();
      this.dependencies.closeMainDatabase();
      return await operation();
    } finally {
      try {
        databaseLease?.release();
      } finally {
        try {
          if (suspended) {
            this.dependencies.writer.resumeAfterMaintenance();
          }
        } finally {
          storeLease.release();
        }
      }
    }
  }

  async restore<Value>(
    operation: () => Promise<WholeStoreRestoreCommit<Value>>,
  ): Promise<Value> {
    const storeLease = await this.dependencies.beginStoreMaintenance();
    let suspended = false;

    let databaseLease: WholeStoreDatabaseLease | null = null;
    let committed: WholeStoreRestoreCommit<Value> | null = null;
    try {
      await this.dependencies.writer.suspendForMaintenance();
      suspended = true;
      databaseLease = this.dependencies.beginDatabaseMaintenance();
      this.dependencies.closeMainDatabase();
      committed = await operation();
    } finally {
      try {
        databaseLease?.release();
      } finally {
        try {
          if (suspended) {
            this.dependencies.writer.resumeAfterMaintenance();
          }
        } finally {
          storeLease.release();
        }
      }
    }

    if (!committed) {
      throw new Error("Whole-store restore completed without a commit result");
    }
    try {
      this.dependencies.resetLiveDocumentClients(committed.storeEpoch);
    } catch (error) {
      // The file swap and epoch rotation are already durable. A missed
      // best-effort fanout is repaired by the next descriptor/sync boundary;
      // surfacing a restore failure here would invite a destructive retry.
      this.dependencies.reportClientResetFailure?.(error);
    }
    return committed.value;
  }
}
