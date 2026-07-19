import * as backups from "./local-store/backups";
import type { DesktopStoreAdministrationPort } from "./core-client/desktop-store-administration-bridge";

export function createTypeScriptStoreAdministrationPort(): DesktopStoreAdministrationPort {
  return {
    listBackups: async () => await backups.listBackups(),
    createBackup: async (input) => await backups.createBackup(input),
    deleteBackup: async (backupId) => await backups.deleteBackup(backupId),
    restoreBackup: async (input) => await backups.restoreBackup(input),
    pruneBackups: async (retainCount) => {
      await backups.pruneAutoBackups(retainCount);
    },
    runMaintenance: async () => {
      throw new Error(
        "TypeScript Store Administration maintenance remains scheduler-owned",
      );
    },
  };
}
