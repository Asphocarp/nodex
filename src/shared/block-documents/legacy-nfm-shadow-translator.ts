import { BlockNoteEditor } from "@blocknote/core";
import { blocksToYXmlFragment } from "@blocknote/core/yjs";
import * as Y from "yjs";
import { createUuidV7 } from "../card-id";
import { parseNfm } from "../nfm/parser";
import {
  type BlockTreeNode,
  type CardDocumentMaterialization,
  materializeCardDocument,
} from "./block-document-codec";
import { BLOCK_GROUP_NODE_NAME } from "./block-structure";
import {
  assertValidCardDocumentRoots,
  createCardDocument,
} from "./card-document";
import { MAX_BLOCK_ID_LENGTH, type BlockId } from "./contracts";
import { headlessBlockDocumentSchema } from "./headless-blocknote-schema";
import {
  nfmToBlockNote,
  type BlockNoteBlockValue,
} from "./nfm-blocknote-adapter";
import { cloneXmlSubtree } from "./xml-subtree-codec";

export type LegacyNfmShadowDocumentAuthority = "legacy_shadow" | "ydoc_primary";

export type LegacyNfmShadowDocumentReadiness = "pending_genesis" | "ready";

export interface TranslateLegacyNfmIntoCardDocumentInput {
  /** The ready Card document at the exact durable head being translated. */
  readonly document: Y.Doc;
  readonly authority: LegacyNfmShadowDocumentAuthority;
  readonly readiness: LegacyNfmShadowDocumentReadiness;
  readonly title: string;
  readonly nfm: string;
  readonly allocateBlockId?: () => BlockId;
}

export interface ReplaceCardDocumentBodyFromNfmInput {
  /** A detached current-head Card Document. The input remains read-only. */
  readonly document: Y.Doc;
  readonly nfm: string;
  readonly allocateBlockId?: () => BlockId;
}

export interface LegacyNfmShadowTranslation {
  readonly changed: boolean;
  /** Relative to the input document's state vector. Empty only for a no-op. */
  readonly update: Uint8Array;
  readonly materialization: CardDocumentMaterialization;
}

export class LegacyNfmShadowTranslationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LegacyNfmShadowTranslationError";
  }
}

interface IdentityNode {
  readonly key: number;
  readonly type: string;
  readonly props: unknown;
  readonly content: unknown;
  readonly children: readonly IdentityNode[];
  readonly siblingIndex: number;
  readonly blockId?: BlockId;
  readonly target?: BlockNoteBlockValue;
  readonly localSignature: string;
  readonly semanticSignature: string;
  readonly contentSignature: string;
  readonly propsSignature: string;
  readonly searchText: string;
}

interface IdentityForest {
  readonly roots: readonly IdentityNode[];
  readonly nodes: readonly IdentityNode[];
}

const headlessEditor = BlockNoteEditor.create({
  schema: headlessBlockDocumentSchema,
  generateBlockId: createUuidV7,
});

const EMPTY_UPDATE = new Uint8Array();
const MAX_DYNAMIC_ALIGNMENT_CELLS = 100_000;
const LARGE_ALIGNMENT_LOOKAHEAD = 8;
const MAX_IDENTITY_MATCH_TEXT_LENGTH = 512;

const stableSignature = (
  value: unknown,
  ancestors = new Set<object>(),
): string => {
  if (value === undefined) return "u";
  if (value === null) return "n";
  if (typeof value === "string") return `s:${JSON.stringify(value)}`;
  if (typeof value === "boolean") return value ? "b:1" : "b:0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new LegacyNfmShadowTranslationError(
        "Legacy NFM candidate contains a non-finite number",
      );
    }
    return `d:${String(value)}`;
  }
  if (typeof value !== "object") {
    throw new LegacyNfmShadowTranslationError(
      `Legacy NFM candidate contains unsupported ${typeof value} data`,
    );
  }
  if (ancestors.has(value)) {
    throw new LegacyNfmShadowTranslationError(
      "Legacy NFM candidate contains cyclic data",
    );
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    return `a:[${value
      .map((entry) => stableSignature(entry, nextAncestors))
      .join(",")}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new LegacyNfmShadowTranslationError(
      `Legacy NFM candidate contains unsupported ${value.constructor.name} data`,
    );
  }

  return `o:{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key)}:${stableSignature(entry, nextAncestors)}`,
    )
    .join(",")}}`;
};

const collectSearchText = (value: unknown, result: string[]): void => {
  if (typeof value === "string") {
    result.push(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectSearchText(entry, result));
    return;
  }
  Object.entries(value).forEach(([key, entry]) => {
    if (key === "type") return;
    collectSearchText(entry, result);
  });
};

const toSearchText = (content: unknown): string => {
  const values: string[] = [];
  collectSearchText(content, values);
  return values
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase()
    .slice(0, MAX_IDENTITY_MATCH_TEXT_LENGTH);
};

const createIdentityForest = (
  roots: readonly (BlockTreeNode | BlockNoteBlockValue)[],
  side: "source" | "target",
): IdentityForest => {
  let nextKey = 0;
  const nodes: IdentityNode[] = [];

  const visit = (
    sourceNodes: readonly (BlockTreeNode | BlockNoteBlockValue)[],
  ): readonly IdentityNode[] =>
    sourceNodes.map((source, siblingIndex) => {
      const key = nextKey++;
      const props = source.props ?? {};
      const content = source.content;
      const propsSignature = stableSignature(props);
      const contentSignature = stableSignature(content);
      const children = visit(source.children ?? []);
      const blockId =
        side === "source" ? (source as BlockTreeNode).id : undefined;
      const node: IdentityNode = {
        key,
        type: source.type,
        props,
        content,
        children,
        siblingIndex,
        ...(blockId ? { blockId } : {}),
        ...(side === "target" ? { target: source as BlockNoteBlockValue } : {}),
        localSignature: stableSignature([source.type, props, content]),
        semanticSignature: stableSignature([source.type, content]),
        contentSignature,
        propsSignature,
        searchText: toSearchText(content),
      };
      nodes.push(node);
      return node;
    });

  return {
    roots: visit(roots),
    nodes: nodes.sort((left, right) => left.key - right.key),
  };
};

const groupBySignature = (
  nodes: readonly IdentityNode[],
  signature: (node: IdentityNode) => string,
): ReadonlyMap<string, readonly IdentityNode[]> => {
  const groups = new Map<string, IdentityNode[]>();
  nodes.forEach((node) => {
    const key = signature(node);
    const group = groups.get(key);
    if (group) {
      group.push(node);
      return;
    }
    groups.set(key, [node]);
  });
  return groups;
};

const diceCoefficient = (left: string, right: string): number => {
  if (left === right) return left.length === 0 ? 0 : 1;
  if (left.length === 0 || right.length === 0) return 0;
  if (left.length === 1 || right.length === 1) {
    return left === right ? 1 : 0;
  }

  const leftPairs = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index += 1) {
    const pair = left.slice(index, index + 2);
    leftPairs.set(pair, (leftPairs.get(pair) ?? 0) + 1);
  }
  let overlap = 0;
  for (let index = 0; index < right.length - 1; index += 1) {
    const pair = right.slice(index, index + 2);
    const remaining = leftPairs.get(pair) ?? 0;
    if (remaining === 0) continue;
    overlap += 1;
    leftPairs.set(pair, remaining - 1);
  }
  return (2 * overlap) / (left.length + right.length - 2);
};

const hasMeaningfulContent = (node: IdentityNode): boolean =>
  node.searchText.length > 0 ||
  (node.content !== undefined && node.content !== null);

const identityMatchScore = (
  source: IdentityNode,
  target: IdentityNode,
): number | null => {
  const sameType = source.type === target.type;
  const sameContent = source.contentSignature === target.contentSignature;
  if (!sameType && !(sameContent && hasMeaningfulContent(source))) return null;

  let score = sameType ? 58 : 42;
  if (sameContent && hasMeaningfulContent(source)) score += 26;
  if (source.propsSignature === target.propsSignature) score += 10;
  score += Math.round(
    diceCoefficient(source.searchText, target.searchText) * 24,
  );
  score += Math.max(0, 6 - Math.abs(source.siblingIndex - target.siblingIndex));
  return Math.min(score, 100);
};

const alignWithDynamicProgramming = (
  source: readonly IdentityNode[],
  target: readonly IdentityNode[],
): readonly (readonly [IdentityNode, IdentityNode])[] => {
  const width = target.length + 1;
  const directions = new Uint8Array((source.length + 1) * width);
  let previous = new Float64Array(width);

  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
    const current = new Float64Array(width);
    for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
      const sourceNode = source[sourceIndex - 1];
      const targetNode = target[targetIndex - 1];
      if (!sourceNode || !targetNode) continue;

      let best = previous[targetIndex] ?? 0;
      let direction = 1;
      const skipTarget = current[targetIndex - 1] ?? 0;
      if (skipTarget > best) {
        best = skipTarget;
        direction = 2;
      }

      const score = identityMatchScore(sourceNode, targetNode);
      if (score !== null) {
        const match = (previous[targetIndex - 1] ?? 0) + score;
        if (match >= best) {
          best = match;
          direction = 3;
        }
      }
      current[targetIndex] = best;
      directions[sourceIndex * width + targetIndex] = direction;
    }
    previous = current;
  }

  const matches: [IdentityNode, IdentityNode][] = [];
  let sourceIndex = source.length;
  let targetIndex = target.length;
  while (sourceIndex > 0 && targetIndex > 0) {
    const direction = directions[sourceIndex * width + targetIndex];
    if (direction === 3) {
      const sourceNode = source[sourceIndex - 1];
      const targetNode = target[targetIndex - 1];
      if (sourceNode && targetNode) matches.push([sourceNode, targetNode]);
      sourceIndex -= 1;
      targetIndex -= 1;
      continue;
    }
    if (direction === 2) {
      targetIndex -= 1;
      continue;
    }
    sourceIndex -= 1;
  }
  return matches.reverse();
};

const alignLargeSequence = (
  source: readonly IdentityNode[],
  target: readonly IdentityNode[],
): readonly (readonly [IdentityNode, IdentityNode])[] => {
  const matches: [IdentityNode, IdentityNode][] = [];
  let sourceIndex = 0;
  let targetIndex = 0;

  while (sourceIndex < source.length && targetIndex < target.length) {
    const sourceNode = source[sourceIndex];
    const targetNode = target[targetIndex];
    if (!sourceNode || !targetNode) break;
    const currentScore = identityMatchScore(sourceNode, targetNode);

    let nextTargetOffset = 0;
    let nextTargetScore = currentScore ?? -1;
    for (
      let offset = 1;
      offset <= LARGE_ALIGNMENT_LOOKAHEAD &&
      targetIndex + offset < target.length;
      offset += 1
    ) {
      const candidate = target[targetIndex + offset];
      if (!candidate) continue;
      const score = identityMatchScore(sourceNode, candidate);
      if (score === null || score <= nextTargetScore) continue;
      nextTargetOffset = offset;
      nextTargetScore = score;
    }

    let nextSourceOffset = 0;
    let nextSourceScore = currentScore ?? -1;
    for (
      let offset = 1;
      offset <= LARGE_ALIGNMENT_LOOKAHEAD &&
      sourceIndex + offset < source.length;
      offset += 1
    ) {
      const candidate = source[sourceIndex + offset];
      if (!candidate) continue;
      const score = identityMatchScore(candidate, targetNode);
      if (score === null || score <= nextSourceScore) continue;
      nextSourceOffset = offset;
      nextSourceScore = score;
    }

    if (nextTargetOffset > 0 && nextTargetScore > nextSourceScore) {
      targetIndex += nextTargetOffset;
      continue;
    }
    if (nextSourceOffset > 0 && nextSourceScore > nextTargetScore) {
      sourceIndex += nextSourceOffset;
      continue;
    }
    if (currentScore !== null) {
      matches.push([sourceNode, targetNode]);
      sourceIndex += 1;
      targetIndex += 1;
      continue;
    }

    if (source.length - sourceIndex > target.length - targetIndex) {
      sourceIndex += 1;
      continue;
    }
    targetIndex += 1;
  }

  return matches;
};

const alignIdentitySequence = (
  source: readonly IdentityNode[],
  target: readonly IdentityNode[],
): readonly (readonly [IdentityNode, IdentityNode])[] => {
  if (source.length === 0 || target.length === 0) return [];
  if (source.length * target.length <= MAX_DYNAMIC_ALIGNMENT_CELLS) {
    return alignWithDynamicProgramming(source, target);
  }
  return alignLargeSequence(source, target);
};

const inferTargetIdentities = (
  sourceForest: IdentityForest,
  targetForest: IdentityForest,
): ReadonlyMap<number, IdentityNode> => {
  const matches = new Map<number, IdentityNode>();
  const claimedSource = new Set<number>();
  const pendingPairs: [readonly IdentityNode[], readonly IdentityNode[]][] = [];
  const processedParents = new Set<number>();
  let nextPendingPair = 0;

  const claim = (source: IdentityNode, target: IdentityNode): boolean => {
    if (claimedSource.has(source.key) || matches.has(target.key)) return false;
    claimedSource.add(source.key);
    matches.set(target.key, source);
    pendingPairs.push([source.children, target.children]);
    return true;
  };

  const pairSignatureGroups = (
    signature: (node: IdentityNode) => string,
  ): void => {
    const sourceGroups = groupBySignature(
      sourceForest.nodes.filter((node) => !claimedSource.has(node.key)),
      signature,
    );
    const targetGroups = groupBySignature(
      targetForest.nodes.filter((node) => !matches.has(node.key)),
      signature,
    );
    targetGroups.forEach((targetGroup, key) => {
      const sourceGroup = sourceGroups.get(key);
      if (!sourceGroup) return;
      const pairCount = Math.min(sourceGroup.length, targetGroup.length);
      for (let index = 0; index < pairCount; index += 1) {
        const source = sourceGroup[index];
        const target = targetGroup[index];
        if (source && target) claim(source, target);
      }
    });
  };

  // Exact local shapes preserve identity across reorder and reparent. The
  // semantic pass then preserves prop-only edits (including custom Blocks).
  pairSignatureGroups((node) => node.localSignature);
  pairSignatureGroups((node) => node.semanticSignature);
  pendingPairs.push([sourceForest.roots, targetForest.roots]);

  const processPendingPairs = (): void => {
    while (nextPendingPair < pendingPairs.length) {
      const pair = pendingPairs[nextPendingPair++];
      if (!pair) continue;
      const [sourceChildren, targetChildren] = pair;
      if (sourceChildren.length === 0 || targetChildren.length === 0) continue;
      const pairKey = targetChildren[0]?.key;
      if (pairKey === undefined) continue;
      if (processedParents.has(pairKey)) continue;
      processedParents.add(pairKey);

      const source = sourceChildren.filter(
        (node) => !claimedSource.has(node.key),
      );
      const target = targetChildren.filter((node) => !matches.has(node.key));
      alignIdentitySequence(source, target).forEach(
        ([sourceNode, targetNode]) => {
          claim(sourceNode, targetNode);
        },
      );
    }
  };

  processPendingPairs();

  // A modified Block that also moved between parents has no sibling anchor.
  // Only infer it globally when its remaining type is unambiguous.
  const remainingSourceByType = groupBySignature(
    sourceForest.nodes.filter((node) => !claimedSource.has(node.key)),
    (node) => node.type,
  );
  const remainingTargetByType = groupBySignature(
    targetForest.nodes.filter((node) => !matches.has(node.key)),
    (node) => node.type,
  );
  remainingTargetByType.forEach((targetGroup, type) => {
    const sourceGroup = remainingSourceByType.get(type);
    if (sourceGroup?.length !== 1 || targetGroup.length !== 1) return;
    const source = sourceGroup[0];
    const target = targetGroup[0];
    if (source && target) claim(source, target);
  });
  processPendingPairs();

  return matches;
};

/**
 * Explicit NFM replacement is intentionally more conservative than the
 * one-time legacy shadow migration. Ambiguous equal siblings receive fresh
 * identities; parent context or a unique high-confidence match is required to
 * preserve an application ID.
 */
const inferConservativeTargetIdentities = (
  sourceForest: IdentityForest,
  targetForest: IdentityForest,
): ReadonlyMap<number, IdentityNode> => {
  const matches = new Map<number, IdentityNode>();
  const claimedSource = new Set<number>();
  const pendingPairs: [readonly IdentityNode[], readonly IdentityNode[]][] = [
    [sourceForest.roots, targetForest.roots],
  ];
  let nextPair = 0;

  const claim = (source: IdentityNode, target: IdentityNode): boolean => {
    if (claimedSource.has(source.key) || matches.has(target.key)) return false;
    claimedSource.add(source.key);
    matches.set(target.key, source);
    pendingPairs.push([source.children, target.children]);
    return true;
  };

  const claimUniqueGroups = (
    sourceNodes: readonly IdentityNode[],
    targetNodes: readonly IdentityNode[],
    signature: (node: IdentityNode) => string,
  ): void => {
    const sourceGroups = groupBySignature(
      sourceNodes.filter((node) => !claimedSource.has(node.key)),
      signature,
    );
    const targetGroups = groupBySignature(
      targetNodes.filter((node) => !matches.has(node.key)),
      signature,
    );
    targetGroups.forEach((targets, key) => {
      const sources = sourceGroups.get(key);
      if (sources?.length !== 1 || targets.length !== 1) return;
      const source = sources[0];
      const target = targets[0];
      if (source && target) claim(source, target);
    });
  };

  // Preserve globally unique exact/mere-prop-edit anchors across reordering.
  claimUniqueGroups(
    sourceForest.nodes,
    targetForest.nodes,
    (node) => node.localSignature,
  );
  claimUniqueGroups(
    sourceForest.nodes,
    targetForest.nodes,
    (node) => node.semanticSignature,
  );

  while (nextPair < pendingPairs.length) {
    const pair = pendingPairs[nextPair++];
    if (!pair) continue;
    const [sourceChildren, targetChildren] = pair;
    claimUniqueGroups(
      sourceChildren,
      targetChildren,
      (node) => node.localSignature,
    );
    claimUniqueGroups(
      sourceChildren,
      targetChildren,
      (node) => node.semanticSignature,
    );

    const remainingSourceByType = groupBySignature(
      sourceChildren.filter((node) => !claimedSource.has(node.key)),
      (node) => node.type,
    );
    const remainingTargetByType = groupBySignature(
      targetChildren.filter((node) => !matches.has(node.key)),
      (node) => node.type,
    );
    remainingTargetByType.forEach((targets, type) => {
      const sources = remainingSourceByType.get(type);
      if (sources?.length !== 1 || targets.length !== 1) return;
      const source = sources[0];
      const target = targets[0];
      if (!source || !target) return;
      const score = identityMatchScore(source, target);
      if (score !== null && score >= 68) claim(source, target);
    });
  }

  // A modified Block may have moved across parents. Preserve it only when the
  // type is globally unique on both sides and the semantic score has margin.
  const remainingSourceByType = groupBySignature(
    sourceForest.nodes.filter((node) => !claimedSource.has(node.key)),
    (node) => node.type,
  );
  const remainingTargetByType = groupBySignature(
    targetForest.nodes.filter((node) => !matches.has(node.key)),
    (node) => node.type,
  );
  remainingTargetByType.forEach((targets, type) => {
    const sources = remainingSourceByType.get(type);
    if (sources?.length !== 1 || targets.length !== 1) return;
    const source = sources[0];
    const target = targets[0];
    if (!source || !target) return;
    const score = identityMatchScore(source, target);
    if (score !== null && score >= 72) claim(source, target);
  });

  return matches;
};

function assertAllocatedBlockId(
  blockId: unknown,
  unavailableIds: ReadonlySet<BlockId>,
): asserts blockId is BlockId {
  if (
    typeof blockId !== "string" ||
    blockId !== blockId.trim() ||
    blockId.length === 0 ||
    blockId.length > MAX_BLOCK_ID_LENGTH ||
    unavailableIds.has(blockId)
  ) {
    throw new LegacyNfmShadowTranslationError(
      "Block ID allocator returned an invalid, duplicate, or previously used identity",
    );
  }
}

const assignTargetIdentities = (
  sourceForest: IdentityForest,
  targetForest: IdentityForest,
  matches: ReadonlyMap<number, IdentityNode>,
  allocateBlockId: () => BlockId,
): readonly BlockNoteBlockValue[] => {
  const unavailableIds = new Set(
    sourceForest.nodes.flatMap((node) => (node.blockId ? [node.blockId] : [])),
  );
  const assignedIds = new Map<number, BlockId>();

  targetForest.nodes.forEach((target) => {
    const matchedId = matches.get(target.key)?.blockId;
    if (matchedId) {
      assignedIds.set(target.key, matchedId);
      return;
    }
    const allocatedId: unknown = allocateBlockId();
    assertAllocatedBlockId(allocatedId, unavailableIds);
    unavailableIds.add(allocatedId);
    assignedIds.set(target.key, allocatedId);
  });

  const toBlock = (node: IdentityNode): BlockNoteBlockValue => {
    const target = node.target;
    const id = assignedIds.get(node.key);
    if (!target || !id) {
      throw new LegacyNfmShadowTranslationError(
        "Legacy NFM identity assignment is incomplete",
      );
    }
    return {
      ...target,
      id,
      children: node.children.map(toBlock),
    };
  };
  return targetForest.roots.map(toBlock);
};

const buildValidatedCandidate = (
  documentId: string,
  title: string,
  blocks: readonly BlockNoteBlockValue[],
): {
  readonly document: Y.Doc;
  readonly materialization: CardDocumentMaterialization;
} => {
  const envelope = createCardDocument({
    documentId: `${documentId}:legacy-shadow-candidate`,
    initialTitle: title,
    initializeBody: false,
  });
  try {
    blocksToYXmlFragment(
      headlessEditor,
      blocks as (typeof headlessBlockDocumentSchema.Block)[],
      envelope.body,
    );
    if (envelope.body.length === 0) {
      envelope.body.insert(0, [new Y.XmlElement(BLOCK_GROUP_NODE_NAME)]);
    }
    return {
      document: envelope.document,
      materialization: materializeCardDocument(envelope.document),
    };
  } catch (error) {
    envelope.document.destroy();
    throw new LegacyNfmShadowTranslationError(
      `Could not build a valid legacy NFM candidate for Document ${documentId}`,
      { cause: error },
    );
  }
};

const materializationsHaveSameContent = (
  left: CardDocumentMaterialization,
  right: CardDocumentMaterialization,
): boolean => left.title === right.title && left.nfm === right.nfm;

const assertEquivalentMaterialization = (
  expected: CardDocumentMaterialization,
  actual: CardDocumentMaterialization,
): void => {
  if (
    !materializationsHaveSameContent(expected, actual) ||
    stableSignature(expected.blockTree) !== stableSignature(actual.blockTree)
  ) {
    throw new LegacyNfmShadowTranslationError(
      "Legacy NFM update did not reproduce the validated candidate",
    );
  }
};

/**
 * Converts a legacy whole-Card snapshot into one update on the current Card
 * document. The input Y.Doc is always read-only: candidate construction and
 * mutation happen on disposable documents, so validation failures are pure.
 *
 * NFM carries no Block IDs. Identity inference is therefore deterministic but
 * necessarily resolves indistinguishable duplicate Blocks by traversal order.
 */
const translateNfmIntoCardDocument = ({
  document,
  title,
  nfm,
  allocateBlockId = createUuidV7,
  identityPolicy = "legacy",
}: Omit<TranslateLegacyNfmIntoCardDocumentInput, "authority" | "readiness"> & {
  readonly identityPolicy?: "legacy" | "conservative";
}): LegacyNfmShadowTranslation => {
  let currentMaterialization: CardDocumentMaterialization;
  let targetBlocks: readonly BlockNoteBlockValue[];
  try {
    currentMaterialization = materializeCardDocument(document);
    targetBlocks = nfmToBlockNote(parseNfm(nfm));
  } catch (error) {
    throw new LegacyNfmShadowTranslationError(
      `Could not read legacy NFM translation input for Document ${document.guid}`,
      { cause: error },
    );
  }

  const sourceForest = createIdentityForest(
    currentMaterialization.blockTree,
    "source",
  );
  const targetForest = createIdentityForest(targetBlocks, "target");
  const matches =
    identityPolicy === "conservative"
      ? inferConservativeTargetIdentities(sourceForest, targetForest)
      : inferTargetIdentities(sourceForest, targetForest);
  const identifiedTarget = assignTargetIdentities(
    sourceForest,
    targetForest,
    matches,
    allocateBlockId,
  );
  const candidate = buildValidatedCandidate(
    document.guid,
    title,
    identifiedTarget,
  );

  if (
    materializationsHaveSameContent(
      currentMaterialization,
      candidate.materialization,
    )
  ) {
    candidate.document.destroy();
    return {
      changed: false,
      update: EMPTY_UPDATE,
      materialization: currentMaterialization,
    };
  }

  const sourceState = Y.encodeStateAsUpdate(document);
  const sourceStateVector = Y.encodeStateVector(document);
  const working = new Y.Doc({ guid: document.guid });
  try {
    Y.applyUpdate(working, sourceState);
    const workingEnvelope = assertValidCardDocumentRoots(working);
    const candidateEnvelope = assertValidCardDocumentRoots(candidate.document);
    const candidateRoot = candidateEnvelope.body.toArray()[0];
    if (!(candidateRoot instanceof Y.XmlElement)) {
      throw new LegacyNfmShadowTranslationError(
        "Validated legacy NFM candidate is missing its body root",
      );
    }

    // Candidate validation is complete before the disposable current-head
    // replica is changed. The authoritative input document remains untouched.
    working.transact(() => {
      if (workingEnvelope.title.toString() !== title) {
        workingEnvelope.title.delete(0, workingEnvelope.title.length);
        if (title.length > 0) workingEnvelope.title.insert(0, title);
      }
      workingEnvelope.body.delete(0, workingEnvelope.body.length);
      workingEnvelope.body.insert(0, [cloneXmlSubtree(candidateRoot)]);
    }, "legacy-nfm-shadow-translation");

    const materialization = materializeCardDocument(working);
    assertEquivalentMaterialization(candidate.materialization, materialization);
    const update = Y.encodeStateAsUpdate(working, sourceStateVector);
    if (update.byteLength === 0) {
      throw new LegacyNfmShadowTranslationError(
        "Changed legacy NFM translation produced no Yjs update",
      );
    }
    return { changed: true, update, materialization };
  } catch (error) {
    if (error instanceof LegacyNfmShadowTranslationError) throw error;
    throw new LegacyNfmShadowTranslationError(
      `Could not translate legacy NFM into Document ${document.guid}`,
      { cause: error },
    );
  } finally {
    working.destroy();
    candidate.document.destroy();
  }
};

export const translateLegacyNfmIntoCardDocument = (
  input: TranslateLegacyNfmIntoCardDocumentInput,
): LegacyNfmShadowTranslation => {
  if (input.authority !== "legacy_shadow") {
    throw new LegacyNfmShadowTranslationError(
      "Legacy NFM translation requires legacy_shadow authority",
    );
  }
  if (input.readiness !== "ready") {
    throw new LegacyNfmShadowTranslationError(
      "Legacy NFM translation requires a ready Card document",
    );
  }
  return translateNfmIntoCardDocument(input);
};

/**
 * Explicit BF-07 import seam. It preserves the current title, deterministically
 * aligns stable application IDs, and returns one forward update relative to the
 * supplied current-head Y.Doc. It never replaces or mutates that input Y.Doc.
 */
export const replaceCardDocumentBodyFromNfm = ({
  document,
  nfm,
  allocateBlockId,
}: ReplaceCardDocumentBodyFromNfmInput): LegacyNfmShadowTranslation =>
  translateNfmIntoCardDocument({
    document,
    title: assertValidCardDocumentRoots(document).title.toString(),
    nfm,
    identityPolicy: "conservative",
    ...(allocateBlockId ? { allocateBlockId } : {}),
  });
