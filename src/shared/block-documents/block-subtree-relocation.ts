import * as Y from "yjs";
import {
  assertValidBlockDocument,
  BLOCK_CONTAINER_NODE_NAME,
  BLOCK_GROUP_NODE_NAME,
  collectChildlessBlockViolations,
  isChildlessBlockContainer,
  type ScannedDocumentBlock,
} from "./block-structure";
import { assertValidCardDocumentRoots } from "./card-document";
import { MAX_BLOCK_ID_LENGTH, type BlockId } from "./contracts";
import {
  decodeXmlSubtree,
  encodeXmlSubtree,
  type PortableXmlSubtree,
} from "./xml-subtree-codec";

export type BlockSubtreeOperationErrorCode =
  | "invalid_document"
  | "invalid_root_identity"
  | "empty_root_selection"
  | "duplicate_root"
  | "source_block_not_found"
  | "overlapping_roots"
  | "target_parent_not_found"
  | "target_parent_childless"
  | "ancestor_cycle"
  | "target_anchor_not_found"
  | "target_anchor_wrong_parent"
  | "target_anchor_in_moved_subtree"
  | "target_identity_conflict"
  | "stale_capture"
  | "postcondition_failed";

export class BlockSubtreeOperationError extends Error {
  readonly code: BlockSubtreeOperationErrorCode;
  readonly blockId?: BlockId;

  constructor(
    code: BlockSubtreeOperationErrorCode,
    message: string,
    options?: ErrorOptions & { readonly blockId?: BlockId },
  ) {
    super(message, options);
    this.name = "BlockSubtreeOperationError";
    this.code = code;
    this.blockId = options?.blockId;
  }
}

export interface LocatedBlockContainer {
  readonly blockId: BlockId;
  readonly blockType: string;
  readonly parentBlockId: BlockId | null;
  readonly path: readonly number[];
  readonly siblingIndex: number;
  readonly container: Y.XmlElement;
  readonly parentGroup: Y.XmlElement;
  readonly directChildBlockIds: readonly BlockId[];
  readonly descendantBlockIds: readonly BlockId[];
}

export interface BlockDocumentTreeIndex {
  readonly blockIdsInDocumentOrder: readonly BlockId[];
  readonly rootBlockIds: readonly BlockId[];
  readonly blocks: ReadonlyMap<BlockId, LocatedBlockContainer>;
}

export interface CapturedBlockSubtree {
  readonly rootBlockId: BlockId;
  readonly sourceParentBlockId: BlockId | null;
  readonly sourcePath: readonly number[];
  readonly blockIds: readonly BlockId[];
  readonly xml: PortableXmlSubtree;
}

export interface CapturedBlockSubtreeForest {
  readonly roots: readonly CapturedBlockSubtree[];
  readonly rootBlockIds: readonly BlockId[];
  readonly blockIds: readonly BlockId[];
}

export interface BlockSubtreeInsertionTarget {
  readonly parentBlockId?: BlockId;
  readonly beforeBlockId?: BlockId;
}

export interface RelocateBlockSubtreesInput {
  readonly sourceDocument: Y.Doc;
  readonly targetDocument: Y.Doc;
  /** Registered body roots let body-only schemas reuse the subtree codec. */
  readonly sourceBody?: Y.XmlFragment;
  readonly targetBody?: Y.XmlFragment;
  readonly rootBlockIds: readonly BlockId[];
  readonly target: BlockSubtreeInsertionTarget;
  readonly transactionOrigin?: unknown;
}

export interface BlockSubtreeRelocationResult {
  readonly sameDocument: boolean;
  readonly forest: CapturedBlockSubtreeForest;
  readonly sourceBlockIdsBefore: readonly BlockId[];
  readonly sourceBlockIdsAfter: readonly BlockId[];
  readonly targetBlockIdsBefore: readonly BlockId[];
  readonly targetBlockIdsAfter: readonly BlockId[];
}

interface ResolvedInsertionTarget {
  readonly parentBlockId: BlockId | null;
  readonly beforeBlockId: BlockId | null;
  readonly parentContainer: Y.XmlElement | null;
  readonly parentGroup: Y.XmlElement | null;
}

const requireExactBlockId = (
  value: BlockId,
  code: BlockSubtreeOperationErrorCode,
  field: string,
): BlockId => {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_BLOCK_ID_LENGTH &&
    value === value.trim()
  ) {
    return value;
  }
  throw new BlockSubtreeOperationError(
    code,
    `${field} must be a non-empty exact Block identity`,
  );
};

const comparePaths = (
  left: readonly number[],
  right: readonly number[],
): number => {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
};

const resolveElementAtPath = (
  body: Y.XmlFragment,
  path: readonly number[],
): Y.XmlElement => {
  let parent: Y.XmlFragment | Y.XmlElement = body;
  for (const index of path) {
    const child: unknown = parent.toArray()[index];
    if (!(child instanceof Y.XmlElement)) {
      throw new BlockSubtreeOperationError(
        "invalid_document",
        `Block path ${path.join(".")} does not resolve to an XML element`,
      );
    }
    parent = child;
  }
  if (parent instanceof Y.XmlElement) return parent;
  throw new BlockSubtreeOperationError(
    "invalid_document",
    "The Card body path did not resolve to a Block container",
  );
};

const validateDocumentBody = (
  body: Y.XmlFragment,
): readonly ScannedDocumentBlock[] => {
  try {
    const blocks = assertValidBlockDocument(body);
    const violation = collectChildlessBlockViolations(body)[0];
    if (!violation) return blocks;
    throw new BlockSubtreeOperationError(
      "invalid_document",
      `Canonical reference Block ${violation.blockId ?? "unknown"} must not contain child Blocks`,
      violation.blockId ? { blockId: violation.blockId } : undefined,
    );
  } catch (error) {
    if (error instanceof BlockSubtreeOperationError) throw error;
    throw new BlockSubtreeOperationError(
      "invalid_document",
      "Card Document structure is invalid for subtree operations",
      { cause: error },
    );
  }
};

const readCanonicalRootGroup = (body: Y.XmlFragment): Y.XmlElement => {
  const group = body.get(0);
  if (
    group instanceof Y.XmlElement &&
    group.nodeName === BLOCK_GROUP_NODE_NAME
  ) {
    return group;
  }
  throw new BlockSubtreeOperationError(
    "invalid_document",
    "Card Document body is missing its canonical root blockGroup",
  );
};

export const indexBlockDocumentTree = (
  body: Y.XmlFragment,
): BlockDocumentTreeIndex => {
  const scannedBlocks = validateDocumentBody(body);
  const mutableLocations = new Map<
    BlockId,
    Omit<LocatedBlockContainer, "directChildBlockIds" | "descendantBlockIds">
  >();
  for (const scanned of scannedBlocks) {
    const siblingIndex = scanned.path[scanned.path.length - 1];
    if (siblingIndex === undefined) {
      throw new BlockSubtreeOperationError(
        "invalid_document",
        `Block ${scanned.id} has no sibling position`,
        { blockId: scanned.id },
      );
    }
    const container = resolveElementAtPath(body, scanned.path);
    const parentGroup = resolveElementAtPath(body, scanned.path.slice(0, -1));
    if (
      container.nodeName !== BLOCK_CONTAINER_NODE_NAME ||
      parentGroup.nodeName !== BLOCK_GROUP_NODE_NAME
    ) {
      throw new BlockSubtreeOperationError(
        "invalid_document",
        `Block ${scanned.id} does not use the canonical container/group hierarchy`,
        { blockId: scanned.id },
      );
    }
    mutableLocations.set(scanned.id, {
      blockId: scanned.id,
      blockType: scanned.blockType,
      parentBlockId: scanned.parentBlockId,
      path: scanned.path,
      siblingIndex,
      container,
      parentGroup,
    });
  }

  const directChildren = new Map<BlockId, BlockId[]>();
  const descendants = new Map<BlockId, BlockId[]>();
  for (const block of scannedBlocks) {
    if (block.parentBlockId) {
      const children = directChildren.get(block.parentBlockId) ?? [];
      children.push(block.id);
      directChildren.set(block.parentBlockId, children);
    }
    let ancestorId = block.parentBlockId;
    while (ancestorId) {
      const ancestorDescendants = descendants.get(ancestorId) ?? [];
      ancestorDescendants.push(block.id);
      descendants.set(ancestorId, ancestorDescendants);
      ancestorId = mutableLocations.get(ancestorId)?.parentBlockId ?? null;
    }
  }

  const locations = new Map<BlockId, LocatedBlockContainer>();
  for (const block of scannedBlocks) {
    const location = mutableLocations.get(block.id);
    if (!location) {
      throw new BlockSubtreeOperationError(
        "invalid_document",
        `Block ${block.id} disappeared while indexing`,
        { blockId: block.id },
      );
    }
    locations.set(block.id, {
      ...location,
      directChildBlockIds: directChildren.get(block.id) ?? [],
      descendantBlockIds: descendants.get(block.id) ?? [],
    });
  }

  return {
    blockIdsInDocumentOrder: scannedBlocks.map((block) => block.id),
    rootBlockIds: scannedBlocks
      .filter((block) => block.parentBlockId === null)
      .map((block) => block.id),
    blocks: locations,
  };
};

export const locateBlockContainer = (
  body: Y.XmlFragment,
  blockId: BlockId,
): LocatedBlockContainer => {
  const exactBlockId = requireExactBlockId(
    blockId,
    "source_block_not_found",
    "blockId",
  );
  const location = indexBlockDocumentTree(body).blocks.get(exactBlockId);
  if (location) return location;
  throw new BlockSubtreeOperationError(
    "source_block_not_found",
    `Block ${exactBlockId} does not exist in the source Document`,
    { blockId: exactBlockId },
  );
};

const assertNonOverlappingRoots = (
  roots: readonly LocatedBlockContainer[],
): void => {
  const selectedIds = new Set(roots.map((root) => root.blockId));
  for (const root of roots) {
    if (!root.descendantBlockIds.some((blockId) => selectedIds.has(blockId))) {
      continue;
    }
    throw new BlockSubtreeOperationError(
      "overlapping_roots",
      `Block ${root.blockId} and one of its descendants were both selected`,
      { blockId: root.blockId },
    );
  }
};

export const captureBlockSubtreeForest = (
  body: Y.XmlFragment,
  rootBlockIds: readonly BlockId[],
): CapturedBlockSubtreeForest => {
  if (rootBlockIds.length === 0) {
    throw new BlockSubtreeOperationError(
      "empty_root_selection",
      "At least one root Block must be selected for relocation",
    );
  }

  const index = indexBlockDocumentTree(body);
  const seenRootIds = new Set<BlockId>();
  const roots = rootBlockIds.map((rootBlockId) => {
    const exactRootBlockId = requireExactBlockId(
      rootBlockId,
      "invalid_root_identity",
      "rootBlockId",
    );
    if (seenRootIds.has(exactRootBlockId)) {
      throw new BlockSubtreeOperationError(
        "duplicate_root",
        `Block ${exactRootBlockId} was selected more than once`,
        { blockId: exactRootBlockId },
      );
    }
    seenRootIds.add(exactRootBlockId);
    const location = index.blocks.get(exactRootBlockId);
    if (location) return location;
    throw new BlockSubtreeOperationError(
      "source_block_not_found",
      `Block ${exactRootBlockId} does not exist in the source Document`,
      { blockId: exactRootBlockId },
    );
  });
  assertNonOverlappingRoots(roots);

  const orderedRoots = [...roots].sort((left, right) =>
    comparePaths(left.path, right.path),
  );
  const selectedRootIds = new Set(orderedRoots.map((root) => root.blockId));
  const movedBlockIds = index.blockIdsInDocumentOrder.filter((blockId) => {
    if (selectedRootIds.has(blockId)) return true;
    return orderedRoots.some((root) =>
      root.descendantBlockIds.includes(blockId),
    );
  });
  const capturedRoots = orderedRoots.map((root): CapturedBlockSubtree => ({
    rootBlockId: root.blockId,
    sourceParentBlockId: root.parentBlockId,
    sourcePath: root.path,
    blockIds: [root.blockId, ...root.descendantBlockIds],
    xml: encodeXmlSubtree(root.container),
  }));

  return {
    roots: capturedRoots,
    rootBlockIds: capturedRoots.map((root) => root.rootBlockId),
    blockIds: movedBlockIds,
  };
};

const resolveInsertionTarget = (
  body: Y.XmlFragment,
  index: BlockDocumentTreeIndex,
  target: BlockSubtreeInsertionTarget,
): ResolvedInsertionTarget => {
  const parentBlockId =
    target.parentBlockId === undefined
      ? null
      : requireExactBlockId(
          target.parentBlockId,
          "target_parent_not_found",
          "target.parentBlockId",
        );
  const beforeBlockId =
    target.beforeBlockId === undefined
      ? null
      : requireExactBlockId(
          target.beforeBlockId,
          "target_anchor_not_found",
          "target.beforeBlockId",
        );
  const parent = parentBlockId ? index.blocks.get(parentBlockId) : undefined;
  if (parentBlockId && !parent) {
    throw new BlockSubtreeOperationError(
      "target_parent_not_found",
      `Target parent Block ${parentBlockId} does not exist`,
      { blockId: parentBlockId },
    );
  }
  if (parent && isChildlessBlockContainer(parent.container)) {
    throw new BlockSubtreeOperationError(
      "target_parent_childless",
      `Canonical reference Block ${parentBlockId} cannot contain child Blocks`,
      { blockId: parentBlockId ?? undefined },
    );
  }

  const anchor = beforeBlockId ? index.blocks.get(beforeBlockId) : undefined;
  if (beforeBlockId && !anchor) {
    throw new BlockSubtreeOperationError(
      "target_anchor_not_found",
      `Target anchor Block ${beforeBlockId} does not exist`,
      { blockId: beforeBlockId },
    );
  }
  if (anchor && anchor.parentBlockId !== parentBlockId) {
    throw new BlockSubtreeOperationError(
      "target_anchor_wrong_parent",
      `Target anchor Block ${beforeBlockId} is not a direct child of the target parent`,
      { blockId: beforeBlockId ?? undefined },
    );
  }

  return {
    parentBlockId,
    beforeBlockId,
    parentContainer: parent?.container ?? null,
    parentGroup: parent
      ? readChildGroup(parent.container)
      : readCanonicalRootGroup(body),
  };
};

const readChildGroup = (container: Y.XmlElement): Y.XmlElement | null => {
  const group = container
    .toArray()
    .find(
      (child): child is Y.XmlElement =>
        child instanceof Y.XmlElement &&
        child.nodeName === BLOCK_GROUP_NODE_NAME,
    );
  return group ?? null;
};

const createDecodedRoots = (
  forest: CapturedBlockSubtreeForest,
): readonly Y.XmlElement[] =>
  forest.roots.map((root) => {
    if (
      root.xml.kind !== "element" ||
      root.xml.nodeName !== BLOCK_CONTAINER_NODE_NAME ||
      root.xml.attributes.id !== root.rootBlockId
    ) {
      throw new BlockSubtreeOperationError(
        "stale_capture",
        `Captured root ${root.rootBlockId} is not a matching Block container`,
        { blockId: root.rootBlockId },
      );
    }
    const decoded = decodeXmlSubtree(root.xml);
    if (decoded instanceof Y.XmlElement) return decoded;
    throw new BlockSubtreeOperationError(
      "stale_capture",
      `Captured root ${root.rootBlockId} decoded to a non-element node`,
      { blockId: root.rootBlockId },
    );
  });

const assertForestMatchesIndex = (
  index: BlockDocumentTreeIndex,
  forest: CapturedBlockSubtreeForest,
): void => {
  const actualMovedIds = index.blockIdsInDocumentOrder.filter((blockId) =>
    forest.roots.some((root) => {
      if (root.rootBlockId === blockId) return true;
      return root.blockIds.includes(blockId);
    }),
  );
  if (actualMovedIds.join("\u0000") !== forest.blockIds.join("\u0000")) {
    throw new BlockSubtreeOperationError(
      "stale_capture",
      "The captured Block subtree no longer matches the source Document",
    );
  }
  for (const root of forest.roots) {
    const current = index.blocks.get(root.rootBlockId);
    const currentBlockIds = current
      ? [current.blockId, ...current.descendantBlockIds]
      : [];
    if (currentBlockIds.join("\u0000") === root.blockIds.join("\u0000")) {
      continue;
    }
    throw new BlockSubtreeOperationError(
      "stale_capture",
      `Captured root ${root.rootBlockId} changed before relocation`,
      { blockId: root.rootBlockId },
    );
  }
};

const assertNoIdentityConflicts = (
  sourceIndex: BlockDocumentTreeIndex,
  targetIndex: BlockDocumentTreeIndex,
  forest: CapturedBlockSubtreeForest,
  sameDocument: boolean,
): void => {
  if (sameDocument) return;
  const sourceIds = new Set(sourceIndex.blockIdsInDocumentOrder);
  const duplicate = targetIndex.blockIdsInDocumentOrder.find((blockId) =>
    sourceIds.has(blockId),
  );
  if (!duplicate) return;
  const moved = forest.blockIds.includes(duplicate);
  throw new BlockSubtreeOperationError(
    "target_identity_conflict",
    moved
      ? `Target Document already contains moved Block ${duplicate}`
      : `Source and target Documents already share Block identity ${duplicate}`,
    { blockId: duplicate },
  );
};

const assertTargetOutsideMovedSubtrees = (
  resolvedTarget: ResolvedInsertionTarget,
  forest: CapturedBlockSubtreeForest,
): void => {
  if (
    resolvedTarget.parentBlockId &&
    forest.blockIds.includes(resolvedTarget.parentBlockId)
  ) {
    throw new BlockSubtreeOperationError(
      "ancestor_cycle",
      `Cannot move a Block beneath its own subtree ${resolvedTarget.parentBlockId}`,
      { blockId: resolvedTarget.parentBlockId },
    );
  }
  if (
    resolvedTarget.beforeBlockId &&
    forest.blockIds.includes(resolvedTarget.beforeBlockId)
  ) {
    throw new BlockSubtreeOperationError(
      "target_anchor_in_moved_subtree",
      `Target anchor ${resolvedTarget.beforeBlockId} is part of the moved subtree`,
      { blockId: resolvedTarget.beforeBlockId },
    );
  }
};

const deleteForestFromBody = (
  body: Y.XmlFragment,
  forest: CapturedBlockSubtreeForest,
): void => {
  const index = indexBlockDocumentTree(body);
  assertForestMatchesIndex(index, forest);
  const locations = forest.roots.map((root) => {
    const location = index.blocks.get(root.rootBlockId);
    if (location) return location;
    throw new BlockSubtreeOperationError(
      "stale_capture",
      `Captured root ${root.rootBlockId} no longer exists`,
      { blockId: root.rootBlockId },
    );
  });
  locations
    .sort((left, right) => comparePaths(right.path, left.path))
    .forEach((location) =>
      location.parentGroup.delete(location.siblingIndex, 1),
    );

  const parentGroups = new Set(
    locations
      .map((location) => location.parentGroup)
      .filter((group) => group !== readCanonicalRootGroup(body)),
  );
  for (const group of parentGroups) {
    if (group.length !== 0) continue;
    const parent = group.parent;
    if (!(parent instanceof Y.XmlElement)) continue;
    const groupIndex = parent.toArray().indexOf(group);
    if (groupIndex >= 0) parent.delete(groupIndex, 1);
  }
};

const ensureInsertionGroup = (
  body: Y.XmlFragment,
  target: ResolvedInsertionTarget,
): Y.XmlElement => {
  if (target.parentGroup) return target.parentGroup;
  if (!target.parentContainer) return readCanonicalRootGroup(body);
  const group = new Y.XmlElement(BLOCK_GROUP_NODE_NAME);
  target.parentContainer.insert(target.parentContainer.length, [group]);
  return group;
};

const insertForestIntoBody = (
  body: Y.XmlFragment,
  forest: CapturedBlockSubtreeForest,
  target: BlockSubtreeInsertionTarget,
  decodedRoots: readonly Y.XmlElement[],
): void => {
  const index = indexBlockDocumentTree(body);
  const resolved = resolveInsertionTarget(body, index, target);
  const group = ensureInsertionGroup(body, resolved);
  const anchor = resolved.beforeBlockId
    ? index.blocks.get(resolved.beforeBlockId)
    : undefined;
  const insertionIndex = anchor?.siblingIndex ?? group.length;
  group.insert(insertionIndex, [...decodedRoots]);
};

const assertExactBlockSet = (
  actual: readonly BlockId[],
  expected: ReadonlySet<BlockId>,
  label: string,
): void => {
  if (
    actual.length === expected.size &&
    actual.every((blockId) => expected.has(blockId))
  ) {
    return;
  }
  throw new BlockSubtreeOperationError(
    "postcondition_failed",
    `${label} Block identity set diverged during subtree relocation`,
  );
};

const assertTargetPlacement = (
  index: BlockDocumentTreeIndex,
  forest: CapturedBlockSubtreeForest,
  target: BlockSubtreeInsertionTarget,
): void => {
  const parentBlockId = target.parentBlockId ?? null;
  const siblings = parentBlockId
    ? (index.blocks.get(parentBlockId)?.directChildBlockIds ?? [])
    : index.rootBlockIds;
  const startIndex = siblings.indexOf(forest.rootBlockIds[0] ?? "");
  const rootsMatch = forest.rootBlockIds.every(
    (blockId, offset) => siblings[startIndex + offset] === blockId,
  );
  const nextBlockId = siblings[startIndex + forest.rootBlockIds.length];
  const anchorMatches = target.beforeBlockId
    ? nextBlockId === target.beforeBlockId
    : startIndex + forest.rootBlockIds.length === siblings.length;
  if (startIndex >= 0 && rootsMatch && anchorMatches) return;
  throw new BlockSubtreeOperationError(
    "postcondition_failed",
    "Moved roots did not land consecutively at the requested target anchor",
  );
};

/**
 * Mutates the supplied working Documents after complete structural preflight.
 * Cross-Document durability is intentionally outside this DOM-neutral Module:
 * the SQLite writer must call it on disposable clones and commit both updates
 * in one database transaction before publishing either result.
 */
export const relocateBlockSubtrees = ({
  sourceDocument,
  targetDocument,
  sourceBody: registeredSourceBody,
  targetBody: registeredTargetBody,
  rootBlockIds,
  target,
  transactionOrigin,
}: RelocateBlockSubtreesInput): BlockSubtreeRelocationResult => {
  const sourceBody =
    registeredSourceBody ?? assertValidCardDocumentRoots(sourceDocument).body;
  const targetBody =
    registeredTargetBody ?? assertValidCardDocumentRoots(targetDocument).body;
  const sameDocument = sourceDocument === targetDocument;
  const sourceIndex = indexBlockDocumentTree(sourceBody);
  const targetIndex = sameDocument
    ? sourceIndex
    : indexBlockDocumentTree(targetBody);
  const forest = captureBlockSubtreeForest(sourceBody, rootBlockIds);
  assertForestMatchesIndex(sourceIndex, forest);
  assertNoIdentityConflicts(sourceIndex, targetIndex, forest, sameDocument);
  const resolvedTarget = resolveInsertionTarget(
    targetBody,
    targetIndex,
    target,
  );
  assertTargetOutsideMovedSubtrees(resolvedTarget, forest);
  const decodedRoots = createDecodedRoots(forest);
  const sourceBlockIdsBefore = sourceIndex.blockIdsInDocumentOrder;
  const targetBlockIdsBefore = targetIndex.blockIdsInDocumentOrder;

  if (sameDocument) {
    sourceDocument.transact(() => {
      deleteForestFromBody(sourceBody, forest);
      insertForestIntoBody(targetBody, forest, target, decodedRoots);
    }, transactionOrigin);
  } else {
    targetDocument.transact(() => {
      insertForestIntoBody(targetBody, forest, target, decodedRoots);
    }, transactionOrigin);
    sourceDocument.transact(() => {
      deleteForestFromBody(sourceBody, forest);
    }, transactionOrigin);
  }

  const sourceAfterIndex = indexBlockDocumentTree(sourceBody);
  const targetAfterIndex = sameDocument
    ? sourceAfterIndex
    : indexBlockDocumentTree(targetBody);
  const movedIds = new Set(forest.blockIds);
  const expectedSourceIds = new Set(
    sameDocument
      ? sourceBlockIdsBefore
      : sourceBlockIdsBefore.filter((blockId) => !movedIds.has(blockId)),
  );
  const expectedTargetIds = new Set([
    ...targetBlockIdsBefore,
    ...(sameDocument ? [] : forest.blockIds),
  ]);
  assertExactBlockSet(
    sourceAfterIndex.blockIdsInDocumentOrder,
    expectedSourceIds,
    "Source Document",
  );
  assertExactBlockSet(
    targetAfterIndex.blockIdsInDocumentOrder,
    expectedTargetIds,
    "Target Document",
  );
  assertTargetPlacement(targetAfterIndex, forest, target);

  return {
    sameDocument,
    forest,
    sourceBlockIdsBefore,
    sourceBlockIdsAfter: sourceAfterIndex.blockIdsInDocumentOrder,
    targetBlockIdsBefore,
    targetBlockIdsAfter: targetAfterIndex.blockIdsInDocumentOrder,
  };
};
