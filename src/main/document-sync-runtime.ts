import { cardMutationWriter } from "./card-mutation-writer";
import { DocumentSyncHub } from "./document-sync-hub";

/** One process-wide realtime plane shared by Electron and browser clients. */
export const documentSyncHub = new DocumentSyncHub({
  sync: (request) => cardMutationWriter.syncBlockDocument(request),
  applyUpdate: (request) => cardMutationWriter.applyBlockDocumentUpdate(request),
  applyDocumentMutation: (request, writeFence) =>
    cardMutationWriter.applyDocumentMutation(request, writeFence),
  lookupCommittedRelocation: (intent) =>
    cardMutationWriter.readCommittedRelocation(intent),
  prepareRelocationCommand: (intent) =>
    cardMutationWriter.prepareRelocationCommand(intent),
  relocateBlocks: (command) => cardMutationWriter.relocateBlocks(command),
  applyAdditionalDocumentCommand: (request) =>
    cardMutationWriter.applyAdditionalDocumentCommand(request),
  prepareCardProjectTransfer: (intent) =>
    cardMutationWriter.prepareCardProjectTransfer(intent),
  applyCardProjectTransfer: (request) =>
    cardMutationWriter.applyCardProjectTransfer(request),
});
