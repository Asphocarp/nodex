import { cardMutationWriter } from "./card-mutation-writer";
import { DocumentSyncHub } from "./document-sync-hub";

/** One process-wide realtime plane shared by Electron and browser clients. */
export const documentSyncHub = new DocumentSyncHub({
  sync: (request) => cardMutationWriter.syncBlockDocument(request),
  applyUpdate: (request) => cardMutationWriter.applyBlockDocumentUpdate(request),
});
