import type {
  OwnedBlockDocumentDescriptor,
  RelocationCommandResult,
  RelocationIntent,
} from "../../../../shared/block-documents/contracts";
import type { DocumentRelocationRequest } from "../../../../shared/block-documents/relocation-transport";
import type { NfmEditorCollaborativeDocumentSource } from "./nfm-editor-source";

export interface BuildCardBlockRelocationRequestInput {
  readonly projectId: string;
  readonly source: NfmEditorCollaborativeDocumentSource;
  readonly sourceCardId: string;
  readonly rootBlockIds: readonly string[];
  readonly targetCardId: string;
  readonly target: OwnedBlockDocumentDescriptor;
  readonly createRelocationId: () => string;
}

const requireStableBlockIds = (
  blockIds: readonly string[],
): readonly string[] => {
  const normalized = blockIds.map((blockId) => blockId.trim());
  if (
    normalized.length === 0 ||
    normalized.some((blockId) => blockId.length === 0) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new TypeError("Move to Card requires unique stable Block IDs");
  }
  return normalized;
};

export const buildCardBlockRelocationRequest = (
  input: BuildCardBlockRelocationRequestInput,
): DocumentRelocationRequest => {
  if (input.targetCardId === input.sourceCardId) {
    throw new TypeError("Choose a different destination card");
  }
  if (
    input.target.projectId !== input.projectId ||
    input.target.ownerBlockId !== input.targetCardId
  ) {
    throw new TypeError("Destination Card escaped its Project boundary");
  }
  if (
    input.target.ownerType !== "card" ||
    input.target.ownerLifecycle !== "active" ||
    input.target.readiness !== "ready" ||
    input.target.authority !== "ydoc_primary"
  ) {
    throw new TypeError("Destination Card is not an editable Block Document");
  }
  if (input.target.documentId === input.source.documentId) {
    throw new TypeError("Choose a different destination document");
  }
  if (input.target.storeEpoch !== input.source.storeEpoch) {
    throw new TypeError("Destination Card belongs to a different store epoch");
  }
  const relocationId = input.createRelocationId().trim();
  if (!relocationId) throw new TypeError("Relocation ID is required");

  const intent: RelocationIntent = {
    relocationId,
    projectId: input.projectId,
    storeEpoch: input.source.storeEpoch,
    rootBlockIds: requireStableBlockIds(input.rootBlockIds),
    sourceDocumentId: input.source.documentId,
    sourceGeneration: input.source.generation,
    target: {
      kind: "document",
      documentId: input.target.documentId,
      generation: input.target.generation,
    },
  };
  return {
    clientSessionId: input.source.clientSessionId,
    intent,
  };
};

/**
 * A lost response may happen after SQLite already committed. Retry only the
 * exact same logical intent so the durable relocation ledger can answer it
 * idempotently; never manufacture a second relocation ID here.
 */
export const executeCardBlockRelocation = async (
  request: DocumentRelocationRequest,
  relocate: (
    request: DocumentRelocationRequest,
  ) => Promise<RelocationCommandResult>,
): Promise<RelocationCommandResult> => {
  let first: RelocationCommandResult;
  try {
    first = await relocate(request);
  } catch {
    return await relocate(request);
  }
  if (first.ok || first.error.code !== "unknown" || !first.error.retryable) {
    return first;
  }
  return await relocate(request);
};
