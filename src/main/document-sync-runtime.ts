import { blockMutationWriter } from "./block-mutation-writer";
import { DocumentSyncHub } from "./document-sync-hub";

/** One process-wide realtime plane shared by Electron and browser clients. */
export const documentSyncHub = new DocumentSyncHub({
  sync: (request) => blockMutationWriter.syncBlockDocument(request),
  applyUpdate: (request) => blockMutationWriter.applyBlockDocumentUpdate(request),
  syncCanvasScene: (request) => blockMutationWriter.syncCanvasScene(request),
  applyCanvasSceneMutation: (request) =>
    blockMutationWriter.applyCanvasSceneMutation(request),
  applyDocumentMutation: (request, writeFence) =>
    blockMutationWriter.applyDocumentMutation(request, writeFence),
  lookupCommittedRelocation: (intent) =>
    blockMutationWriter.readCommittedRelocation(intent),
  prepareRelocationCommand: (intent) =>
    blockMutationWriter.prepareRelocationCommand(intent),
  relocateBlocks: (command) => blockMutationWriter.relocateBlocks(command),
  applyAdditionalDocumentCommand: (request) =>
    blockMutationWriter.applyAdditionalDocumentCommand(request),
  prepareCardProjectTransfer: (intent) =>
    blockMutationWriter.prepareCardProjectTransfer(intent),
  applyCardProjectTransfer: (request) =>
    blockMutationWriter.applyCardProjectTransfer(request),
  lookupCommittedBlockTransfer: (intent) =>
    blockMutationWriter.readCommittedBlockTransfer(intent),
  prepareBlockTransfer: (intent) =>
    blockMutationWriter.prepareBlockTransfer(intent),
  applyBlockTransfer: async (request) =>
    (await blockMutationWriter.applyBlockTransfer(request)).result,
});
