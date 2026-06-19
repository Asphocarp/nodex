import { getNodeById } from "@blocknote/core";
import { MultipleNodeSelection } from "@blocknote/core/extensions";
import type { EditorView } from "@tiptap/pm/view";

export interface SideMenuSelectionBlock {
  id?: string;
  children?: SideMenuSelectionBlock[];
}

export interface SideMenuSelectionIntent {
  clickedBlock: SideMenuSelectionBlock;
  blocks: SideMenuSelectionBlock[];
  source: "active-selection" | "clicked-block";
}

export interface SideMenuDragSelectionSnapshot {
  selectedBlockIds?: string[];
  selectionFrom?: number;
  selectionTo?: number;
}

export interface SideMenuSelectionEditor {
  getSelection?: () => { blocks?: SideMenuSelectionBlock[] } | undefined;
  prosemirrorView?: Pick<EditorView, "state" | "dispatch">;
}

interface SideMenuSelectionApplyAdapter {
  selectBlocks: (
    editor: SideMenuSelectionEditor,
    blocks: SideMenuSelectionBlock[],
    fallbackBlock: SideMenuSelectionBlock,
  ) => boolean;
}

export function getSideMenuSelectionBlockId(block: SideMenuSelectionBlock | undefined): string | null {
  return typeof block?.id === "string" && block.id.length > 0 ? block.id : null;
}

function getSelectedBlocks(editor: SideMenuSelectionEditor): SideMenuSelectionBlock[] {
  const blocks = editor.getSelection?.()?.blocks;
  if (!blocks || blocks.length === 0) return [];
  return blocks.filter((block) => getSideMenuSelectionBlockId(block) !== null);
}

interface SelectionNodeLike {
  attrs?: {
    id?: unknown;
  };
}

interface BlockSelectionLike {
  node?: SelectionNodeLike;
  nodes?: SelectionNodeLike[];
}

function getSelectionNodeBlockId(node: SelectionNodeLike | undefined): string | null {
  const id = node?.attrs?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function getBlockSelectionIds(selection: EditorView["state"]["selection"]): string[] {
  const blockSelection = selection as EditorView["state"]["selection"] & BlockSelectionLike;
  if (Array.isArray(blockSelection.nodes)) {
    return Array.from(new Set(
      blockSelection.nodes
        .map(getSelectionNodeBlockId)
        .filter((id): id is string => id !== null),
    ));
  }

  const nodeId = getSelectionNodeBlockId(blockSelection.node);
  return nodeId ? [nodeId] : [];
}

export function createSideMenuDragSelectionSnapshot(
  editor: SideMenuSelectionEditor,
): SideMenuDragSelectionSnapshot | null {
  const selection = editor.prosemirrorView?.state.selection;
  if (!selection) return null;

  const selectedBlockIds = getBlockSelectionIds(selection);
  if (selectedBlockIds.length > 0) {
    return { selectedBlockIds };
  }

  if (selection.empty || selection.from === selection.to) {
    return null;
  }

  return {
    selectionFrom: selection.from,
    selectionTo: selection.to,
  };
}

function addBlockWithChildren(
  block: SideMenuSelectionBlock,
  output: SideMenuSelectionBlock[],
  seenBlockIds: Set<string>,
) {
  const blockId = getSideMenuSelectionBlockId(block);
  if (blockId && !seenBlockIds.has(blockId)) {
    seenBlockIds.add(blockId);
    output.push(block);
  }

  for (const childBlock of block.children ?? []) {
    addBlockWithChildren(childBlock, output, seenBlockIds);
  }
}

export function expandSideMenuSelectionBlocksWithChildren(
  blocks: SideMenuSelectionBlock[],
): SideMenuSelectionBlock[] {
  const expandedBlocks: SideMenuSelectionBlock[] = [];
  const seenBlockIds = new Set<string>();

  for (const block of blocks) {
    addBlockWithChildren(block, expandedBlocks, seenBlockIds);
  }

  return expandedBlocks;
}

export function createSideMenuSelectionIntent(
  editor: SideMenuSelectionEditor,
  clickedBlock: SideMenuSelectionBlock,
): SideMenuSelectionIntent {
  const clickedBlockId = getSideMenuSelectionBlockId(clickedBlock);
  const selectedBlocks = getSelectedBlocks(editor);
  const selectionIncludesClickedBlock = clickedBlockId !== null
    && selectedBlocks.some((block) => getSideMenuSelectionBlockId(block) === clickedBlockId);

  if (selectionIncludesClickedBlock) {
    return {
      clickedBlock,
      blocks: expandSideMenuSelectionBlocksWithChildren(selectedBlocks),
      source: "active-selection",
    };
  }

  return {
    clickedBlock,
    blocks: expandSideMenuSelectionBlocksWithChildren([clickedBlock]),
    source: "clicked-block",
  };
}

function selectBlockRange(
  editor: SideMenuSelectionEditor,
  block: SideMenuSelectionBlock,
): boolean {
  const blockId = getSideMenuSelectionBlockId(block);
  const view = editor.prosemirrorView;
  if (!blockId || !view) return false;

  const posInfo = getNodeById(blockId, view.state.doc);
  if (!posInfo) return false;

  try {
    view.dispatch(
      view.state.tr.setSelection(
        MultipleNodeSelection.create(
          view.state.doc,
          posInfo.posBeforeNode,
          posInfo.posBeforeNode + posInfo.node.nodeSize,
        ),
      ),
    );
    return true;
  } catch {
    return false;
  }
}

function normalizeBlockRangeAroundSelectionIds(
  from: number,
  to: number,
  doc: EditorView["state"]["doc"],
) {
  try {
    const $from = doc.resolve(from);
    const $to = doc.resolve(to);
    const sharedDepth = $from.sharedDepth($to.pos);
    const normalizedFrom = $from.posAtIndex(
      $from.index(sharedDepth),
      sharedDepth,
    );
    const normalizedTo = $to.posAtIndex($to.indexAfter(sharedDepth), sharedDepth);

    if (normalizedFrom >= normalizedTo) return undefined;
    return { from: normalizedFrom, to: normalizedTo };
  } catch {
    return undefined;
  }
}

function selectBlocksWithBlockRangeSelection(
  editor: SideMenuSelectionEditor,
  blocks: SideMenuSelectionBlock[],
  fallbackBlock: SideMenuSelectionBlock,
): boolean {
  const view = editor.prosemirrorView;
  if (!view) return false;

  const blockPositions = blocks
    .map((block) => {
      const blockId = getSideMenuSelectionBlockId(block);
      return blockId ? getNodeById(blockId, view.state.doc) : undefined;
    })
    .filter((position): position is NonNullable<typeof position> => position !== undefined)
    .sort((a, b) => a.posBeforeNode - b.posBeforeNode);

  if (blockPositions.length === 0) return false;
  if (blockPositions.length === 1) {
    return selectBlockRange(editor, fallbackBlock);
  }

  const firstPosition = blockPositions[0];
  const lastPosition = blockPositions[blockPositions.length - 1];
  const normalizedRange = normalizeBlockRangeAroundSelectionIds(
    firstPosition.posBeforeNode,
    lastPosition.posBeforeNode + lastPosition.node.nodeSize,
    view.state.doc,
  );

  if (!normalizedRange) {
    return selectBlockRange(editor, fallbackBlock);
  }

  try {
    view.dispatch(
      view.state.tr.setSelection(
        MultipleNodeSelection.create(
          view.state.doc,
          normalizedRange.from,
          normalizedRange.to,
        ),
      ),
    );
    return true;
  } catch {
    return selectBlockRange(editor, fallbackBlock);
  }
}

const DEFAULT_APPLY_ADAPTER: SideMenuSelectionApplyAdapter = {
  selectBlocks: selectBlocksWithBlockRangeSelection,
};

export function applySideMenuSelectionIntent(
  editor: SideMenuSelectionEditor,
  intent: SideMenuSelectionIntent,
  adapter: SideMenuSelectionApplyAdapter = DEFAULT_APPLY_ADAPTER,
): boolean {
  return adapter.selectBlocks(editor, intent.blocks, intent.clickedBlock);
}
