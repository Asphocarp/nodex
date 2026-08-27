import { Fragment, Node } from "prosemirror-model";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";

import {
  BlockInfo,
  getBlockInfo,
  getBlockInfoFromResolvedPos,
  getNodeId,
} from "../../../getBlockInfoFromPos.js";
import { getNodeById } from "../../../nodeUtil.js";
import { getBlockSchema } from "../../../pmUtil.js";

/**
 * Returns the block info from the parent block
 * or undefined if we're at the root
 */
export const getParentBlockInfo = (
  doc: Node,
  beforePos: number,
): BlockInfo | undefined => {
  const $pos = doc.resolve(beforePos);
  const depth = $pos.depth - 1;

  if (depth < 1) {
    return undefined;
  }

  const parentBeforePos = $pos.before(depth);
  const parentNode = doc.resolve(parentBeforePos).nodeAfter;

  if (!parentNode) {
    return undefined;
  }

  if (!parentNode.type.spec.group?.includes("bnBlock")) {
    return getParentBlockInfo(doc, parentBeforePos);
  }

  const parentBlockInfo = getBlockInfoFromResolvedPos(
    doc.resolve(parentBeforePos),
  );

  return parentBlockInfo;
};

/**
 * Returns the block info from the sibling block before (above) the given block,
 * or undefined if the given block is the first sibling.
 */
export const getPrevBlockInfo = (doc: Node, beforePos: number) => {
  const $pos = doc.resolve(beforePos);

  const indexInParent = $pos.index();

  if (indexInParent === 0) {
    return undefined;
  }

  const prevBlockBeforePos = $pos.posAtIndex(indexInParent - 1);

  const prevBlockInfo = getBlockInfoFromResolvedPos(
    doc.resolve(prevBlockBeforePos),
  );
  return prevBlockInfo;
};

/**
 * Returns the block info from the sibling block after (below) the given block,
 * or undefined if the given block is the last sibling.
 */
export const getNextBlockInfo = (doc: Node, beforePos: number) => {
  const $pos = doc.resolve(beforePos);

  const indexInParent = $pos.index();

  if (indexInParent === $pos.node().childCount - 1) {
    return undefined;
  }

  const nextBlockBeforePos = $pos.posAtIndex(indexInParent + 1);

  const nextBlockInfo = getBlockInfoFromResolvedPos(
    doc.resolve(nextBlockBeforePos),
  );
  return nextBlockInfo;
};

/**
 * If a block has children like this:
 * A
 * - B
 * - C
 * -- D
 *
 * Then the bottom nested block returned is D.
 */
export const getBottomNestedBlockInfo = (doc: Node, blockInfo: BlockInfo) => {
  while (blockInfo.childContainer) {
    const group = blockInfo.childContainer.node;

    const newPos = doc
      .resolve(blockInfo.childContainer.beforePos + 1)
      .posAtIndex(group.childCount - 1);
    blockInfo = getBlockInfoFromResolvedPos(doc.resolve(newPos));
  }

  return blockInfo;
};

const canMerge = (
  state: EditorState,
  prevBlockInfo: BlockInfo,
  nextBlockInfo: BlockInfo,
) => {
  if (!prevBlockInfo.isBlockContainer || !nextBlockInfo.isBlockContainer) {
    return false;
  }

  const blockSchema = getBlockSchema(state.schema);
  const previousContentModel = blockSchema[prevBlockInfo.blockNoteType]?.content;
  const nextContentModel = blockSchema[nextBlockInfo.blockNoteType]?.content;

  if (previousContentModel === "plain") {
    return nextContentModel === "inline" || nextContentModel === "plain";
  }

  return (
    previousContentModel === "inline" &&
    prevBlockInfo.blockContent.node.childCount > 0 &&
    nextContentModel === "inline"
  );
};

function plainContentFromBlockContent(source: Node, target: Node): Fragment {
  const nodes: Node[] = [];
  const appendText = (text: string, sourceNode: Node) => {
    if (!text) return;
    nodes.push(target.type.schema.text(text, target.type.allowedMarks(sourceNode.marks)));
  };

  source.descendants((node) => {
    if (node.isText) {
      appendText(node.text ?? "", node);
      return false;
    }
    if (!node.isLeaf) return true;

    const text =
      node.type.name === "hardBreak"
        ? "\n"
        : (node.type.spec.leafText?.(node) ?? "\ufffc");
    appendText(text, node);
    return false;
  });
  return Fragment.fromArray(nodes);
}

function liftNextBlockChildren(transaction: Transaction, nextBlockInfo: BlockInfo): void {
  if (!nextBlockInfo.isBlockContainer || !nextBlockInfo.childContainer) return;

  const childBlocksStart = transaction.doc.resolve(nextBlockInfo.childContainer.beforePos + 1);
  const childBlocksEnd = transaction.doc.resolve(nextBlockInfo.childContainer.afterPos - 1);
  const childBlocksRange = childBlocksStart.blockRange(childBlocksEnd);
  if (!childBlocksRange) return;

  const nextBlockPosition = transaction.doc.resolve(nextBlockInfo.bnBlock.beforePos);
  transaction.lift(childBlocksRange, nextBlockPosition.depth);
}

/**
 * A plain-text block is a semantic sink: rich inline source is flattened,
 * source children are promoted, and the caret stays at the original join.
 */
function mergeIntoPlainTextBlock(
  state: EditorState,
  dispatch: ((args?: any) => any) | undefined,
  prevBlockInfo: BlockInfo,
  nextBlockInfo: BlockInfo,
): boolean {
  if (!prevBlockInfo.isBlockContainer || !nextBlockInfo.isBlockContainer) {
    return false;
  }
  if (!dispatch) return true;

  const targetId = getNodeId(prevBlockInfo.bnBlock.node, state.doc);
  const sourceId = getNodeId(nextBlockInfo.bnBlock.node, state.doc);
  const transaction = state.tr;

  liftNextBlockChildren(transaction, nextBlockInfo);

  const targetNode = getNodeById(targetId, transaction.doc);
  const sourceNode = getNodeById(sourceId, transaction.doc);
  if (!targetNode || !sourceNode) return false;

  const targetInfo = getBlockInfo(targetNode);
  const sourceInfo = getBlockInfo(sourceNode);
  if (!targetInfo.isBlockContainer || !sourceInfo.isBlockContainer) return false;

  const sourceContent = plainContentFromBlockContent(
    nextBlockInfo.blockContent.node,
    targetInfo.blockContent.node,
  );
  const joinPosition = targetInfo.blockContent.afterPos - 1;
  transaction.delete(sourceInfo.bnBlock.beforePos, sourceInfo.bnBlock.afterPos);
  if (sourceContent.size > 0) {
    transaction.insert(joinPosition, sourceContent);
  }
  transaction.setSelection(TextSelection.create(transaction.doc, joinPosition)).scrollIntoView();
  dispatch(transaction);
  return true;
}

const mergeBlocks = (
  state: EditorState,
  dispatch: ((args?: any) => any) | undefined,
  prevBlockInfo: BlockInfo,
  nextBlockInfo: BlockInfo,
) => {
  const blockSchema = getBlockSchema(state.schema);
  if (
    prevBlockInfo.isBlockContainer &&
    blockSchema[prevBlockInfo.blockNoteType]?.content === "plain"
  ) {
    return mergeIntoPlainTextBlock(state, dispatch, prevBlockInfo, nextBlockInfo);
  }

  // Un-nests all children of the next block.
  if (!nextBlockInfo.isBlockContainer) {
    throw new Error(
      `Attempted to merge block at position ${nextBlockInfo.bnBlock.beforePos} into previous block at position ${prevBlockInfo.bnBlock.beforePos}, but next block is not a block container`,
    );
  }

  // Removes a level of nesting all children of the next block by 1 level, if it contains both content and block
  // group nodes.
  if (nextBlockInfo.childContainer) {
    const childBlocksStart = state.doc.resolve(
      nextBlockInfo.childContainer.beforePos + 1,
    );
    const childBlocksEnd = state.doc.resolve(
      nextBlockInfo.childContainer.afterPos - 1,
    );
    const childBlocksRange = childBlocksStart.blockRange(childBlocksEnd);

    if (dispatch) {
      const pos = state.doc.resolve(nextBlockInfo.bnBlock.beforePos);
      state.tr.lift(childBlocksRange!, pos.depth);
    }
  }

  // Deletes the boundary between the two blocks. Can be thought of as
  // removing the closing tags of the first block and the opening tags of the
  // second one to stitch them together.
  if (dispatch) {
    if (!prevBlockInfo.isBlockContainer) {
      throw new Error(
        `Attempted to merge block at position ${nextBlockInfo.bnBlock.beforePos} into previous block at position ${prevBlockInfo.bnBlock.beforePos}, but previous block is not a block container`,
      );
    }

    // TODO: test merging between a columnList and paragraph, between two columnLists, and v.v.
    dispatch(
      state.tr.delete(
        prevBlockInfo.blockContent.afterPos - 1,
        nextBlockInfo.blockContent.beforePos + 1,
      ),
    );
  }

  return true;
};

export const mergeBlocksCommand =
  (posBetweenBlocks: number) =>
  ({
    state,
    dispatch,
  }: {
    state: EditorState;
    dispatch: ((args?: any) => any) | undefined;
  }) => {
    const $pos = state.doc.resolve(posBetweenBlocks);
    const nextBlockInfo = getBlockInfoFromResolvedPos($pos);

    const prevBlockInfo = getPrevBlockInfo(
      state.doc,
      nextBlockInfo.bnBlock.beforePos,
    );

    if (!prevBlockInfo) {
      return false;
    }

    const bottomNestedBlockInfo = getBottomNestedBlockInfo(
      state.doc,
      prevBlockInfo,
    );

    if (!canMerge(state, bottomNestedBlockInfo, nextBlockInfo)) {
      return false;
    }

    return mergeBlocks(state, dispatch, bottomNestedBlockInfo, nextBlockInfo);
  };
