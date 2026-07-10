import { applyToggleStatesFromDom, blockNoteToNfm, serializeNfm } from "@/lib/nfm";
import { blockToCardPatch } from "@/lib/toggle-list/block-mapping";
import type { ToggleListCard } from "@/lib/toggle-list/types";
import type {
  BlockDropImportSourceUpdate,
  CardInput,
} from "@/lib/types";
import type {
  DragSessionBlock,
  ExternalDropAdapter,
} from "./external-block-drag-session";
import { stripProjectedSubtrees } from "./projection-card-toggle";

interface CardStageSourceContext {
  projectId: string;
  columnId: string;
  cardId: string;
}

function serializeEditorDocument(
  document: DragSessionBlock[],
  container: HTMLElement,
): string {
  const strippedDocument = stripProjectedSubtrees(document);
  const nfmBlocks = blockNoteToNfm(strippedDocument);
  applyToggleStatesFromDom(strippedDocument, nfmBlocks, container);
  return serializeNfm(nfmBlocks);
}

interface TogglePatch {
  cardId: string;
  description: string;
}

function collectToggleCardPatches(
  blocks: DragSessionBlock[],
  container: HTMLElement,
): Map<string, TogglePatch> {
  const patches = new Map<string, TogglePatch>();

  for (const block of blocks) {
    const patch = blockToCardPatch(block, container);
    if (!patch) continue;
    patches.set(patch.cardId, {
      cardId: patch.cardId,
      description: patch.description,
    });
  }

  return patches;
}

function toDescriptionUpdate(description: string): Partial<CardInput> {
  return { description };
}

export function createCardStageDropAdapter(
  context: CardStageSourceContext,
  beginOptimisticMutation: ExternalDropAdapter["beginPreparedMutation"],
): ExternalDropAdapter {
  return {
    buildSourceUpdates(sourceDocument, projectedDocument, container) {
      const baseline = serializeEditorDocument(sourceDocument, container);
      const nextDescription = serializeEditorDocument(projectedDocument, container);
      if (nextDescription === baseline) return [];

      return [
        {
          projectId: context.projectId,
          columnId: context.columnId,
          cardId: context.cardId,
          updates: toDescriptionUpdate(nextDescription),
        },
      ];
    },
    beginPreparedMutation: beginOptimisticMutation,
  };
}

export function createToggleListDropAdapter(
  projectId: string,
  cards: ToggleListCard[],
  beginOptimisticMutation: ExternalDropAdapter["beginPreparedMutation"],
  removeLiveBlocks?: ExternalDropAdapter["removeLiveBlocks"],
): ExternalDropAdapter {
  const cardDescriptions = new Map(cards.map((card) => [card.id, card.description]));

  return {
    buildSourceUpdates(sourceDocument, projectedDocument, container) {
      void sourceDocument;
      const nextPatches = collectToggleCardPatches(projectedDocument, container);
      const updates: BlockDropImportSourceUpdate[] = [];

      for (const [cardId, nextPatch] of nextPatches) {
        const persistedDescription = cardDescriptions.get(cardId);
        if (persistedDescription === undefined) continue;
        if (persistedDescription === nextPatch.description) continue;

        updates.push({
          projectId,
          cardId,
          updates: toDescriptionUpdate(nextPatch.description),
        });
      }

      return updates;
    },
    beginPreparedMutation: beginOptimisticMutation,
    removeLiveBlocks,
  };
}
