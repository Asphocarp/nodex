import type {
  BlockDropImportSourceUpdate,
  CardStatus,
  CardEditorDropInput,
} from "@/lib/types";
import type { DragTransferOperation } from "../../../shared/cross-window-drag";
import { resolveCardDropTargetAtPointer } from "./editor/card-drop-target-registry";
import type { ExternalCardDragSession } from "./editor/external-card-drag-session";

export function resolveExternalCardDropTarget(
  session: ExternalCardDragSession | null,
) {
  if (!session?.pointer) return null;
  return resolveCardDropTargetAtPointer(session.pointer, session.payload);
}

export interface CardEditorDropRequest {
  targetProjectId: string;
  input: CardEditorDropInput;
}

interface BuildCardEditorDropRequestInput {
  operation: DragTransferOperation;
  sourceProjectId: string;
  sourceCards: Array<{
    cardId: string;
    status: CardStatus;
  }>;
  groupId: string;
  targetUpdates: BlockDropImportSourceUpdate[];
}

export function buildCardEditorDropRequest({
  operation,
  sourceProjectId,
  sourceCards,
  groupId,
  targetUpdates,
}: BuildCardEditorDropRequestInput): CardEditorDropRequest | null {
  if (sourceCards.length === 0) return null;
  if (targetUpdates.length === 0) return null;

  const targetProjectId = targetUpdates[0]?.projectId;
  if (!targetProjectId) return null;
  if (targetUpdates.some((update) => update.projectId !== targetProjectId)) {
    return null;
  }

  return {
    targetProjectId,
    input: {
      operation,
      sourceCards: sourceCards.map((source) => ({
        cardId: source.cardId,
        status: source.status,
      })),
      targetUpdates,
      groupId,
      ...(sourceProjectId !== targetProjectId ? { sourceProjectId } : {}),
    },
  };
}
