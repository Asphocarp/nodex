import { blockMutationWriter } from "./block-mutation-writer";
import { documentSyncHub } from "./document-sync-runtime";
import {
  beginDatabaseMaintenance,
  closeDatabase,
} from "./local-store/database";
import { storeMaintenanceGate } from "./local-store/store-maintenance-gate";
import { WholeStoreMaintenanceCoordinator } from "./whole-store-maintenance";
import { getLogger } from "./logging/logger";

const logger = getLogger({ subsystem: "backup", component: "store-maintenance" });

export const wholeStoreMaintenance = new WholeStoreMaintenanceCoordinator({
  writer: blockMutationWriter,
  beginStoreMaintenance: () => storeMaintenanceGate.beginMaintenance(),
  beginDatabaseMaintenance,
  closeMainDatabase: closeDatabase,
  resetLiveDocumentClients: (storeEpoch) => {
    documentSyncHub.resetForStoreReplacement(storeEpoch);
  },
  reportClientResetFailure: (error) => {
    logger.error("Restored store but could not fan out the epoch reset", {
      error,
    });
  },
});
