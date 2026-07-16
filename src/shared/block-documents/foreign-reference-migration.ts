import * as Y from "yjs";
import {
  materializePageDocument,
  type BlockTreeNode,
  type PageDocumentMaterialization,
} from "./block-document-codec";
import {
  BLOCK_CONTAINER_NODE_NAME,
  BLOCK_GROUP_NODE_NAME,
  BLOCK_ID_ATTRIBUTE,
} from "./block-structure";
import { isLegacyForeignBodyReference } from "./derived-records";
import type { BlockId } from "./contracts";

export type ForeignReferenceResolution =
  | {
      readonly kind: "page";
      readonly sourceBlockId: BlockId;
      readonly targetBlockId: BlockId;
    }
  | {
      readonly kind: "database_view";
      readonly sourceBlockId: BlockId;
      readonly databaseViewId: string;
      readonly displayHint?: string;
    };

export interface ForeignReferenceDocumentMigration {
  readonly update: Uint8Array;
  readonly materialization: PageDocumentMaterialization;
  readonly migratedBlockIds: readonly BlockId[];
  readonly removedDescendantBlockIds: readonly BlockId[];
}

export class ForeignReferenceMigrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ForeignReferenceMigrationError";
  }
}

const requireIdentity = (value: string, field: string): string => {
  if (value.length > 0 && value === value.trim()) return value;
  throw new ForeignReferenceMigrationError(`${field} must be a non-empty exact identity`);
};

const requireDisplayHint = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  if (value.length <= 512) return value;
  throw new ForeignReferenceMigrationError("displayHint exceeds 512 characters");
};

const collectContainers = (
  parent: Y.XmlFragment | Y.XmlElement,
  containers: Map<BlockId, Y.XmlElement>,
): void => {
  for (const child of parent.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.nodeName === BLOCK_CONTAINER_NODE_NAME) {
      const blockId = child.getAttribute(BLOCK_ID_ATTRIBUTE);
      if (typeof blockId !== "string" || blockId.length === 0) {
        throw new ForeignReferenceMigrationError("Legacy reference Block has no identity");
      }
      if (containers.has(blockId)) {
        throw new ForeignReferenceMigrationError(`Duplicate Block identity ${blockId}`);
      }
      containers.set(blockId, child);
    }
    collectContainers(child, containers);
  }
};

const readContentNode = (container: Y.XmlElement): Y.XmlElement => {
  const content = container.toArray().filter(
    (child): child is Y.XmlElement =>
      child instanceof Y.XmlElement && child.nodeName !== BLOCK_GROUP_NODE_NAME,
  );
  if (content.length === 1 && content[0]) return content[0];
  throw new ForeignReferenceMigrationError(
    "Legacy reference Block must contain exactly one content element",
  );
};

const collectDescendantBlockIds = (container: Y.XmlElement): readonly BlockId[] => {
  const ids: BlockId[] = [];
  const visit = (node: Y.XmlElement): void => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.nodeName === BLOCK_CONTAINER_NODE_NAME) {
        const blockId = child.getAttribute(BLOCK_ID_ATTRIBUTE);
        if (typeof blockId === "string" && blockId.length > 0) ids.push(blockId);
      }
      visit(child);
    }
  };
  visit(container);
  return ids;
};

const isLegacyProjectionBlock = (block: BlockTreeNode): boolean => {
  if (block.type === "cardToggle" || block.type === "toggleListInlineView") {
    return true;
  }
  if (
    block.type !== "cardRef"
    && block.type !== "pageRef"
  ) return false;
  const targetBlockId = block.props.targetBlockId;
  return typeof targetBlockId !== "string" || targetBlockId.length === 0;
};

export const collectLegacyProjectionRootIds = (
  blocks: readonly BlockTreeNode[],
): ReadonlySet<BlockId> => {
  const ids = new Set<BlockId>();
  const visit = (block: BlockTreeNode): void => {
    if (isLegacyProjectionBlock(block)) {
      ids.add(block.id);
      return;
    }
    block.children.forEach(visit);
  };
  blocks.forEach(visit);
  return ids;
};

const makePageReferenceNode = (
  resolution: Extract<ForeignReferenceResolution, { readonly kind: "page" }>,
): Y.XmlElement => {
  const node = new Y.XmlElement("pageRef");
  node.setAttribute(
    "targetBlockId",
    requireIdentity(resolution.targetBlockId, "targetBlockId"),
  );
  return node;
};

const makeDatabaseViewReferenceNode = (
  resolution: Extract<
    ForeignReferenceResolution,
    { readonly kind: "database_view" }
  >,
): Y.XmlElement => {
  const node = new Y.XmlElement("databaseViewRef");
  node.setAttribute(
    "databaseViewId",
    requireIdentity(resolution.databaseViewId, "databaseViewId"),
  );
  const displayHint = requireDisplayHint(resolution.displayHint);
  if (displayHint !== undefined) node.setAttribute("displayHint", displayHint);
  return node;
};

const replaceLegacyReference = (
  container: Y.XmlElement,
  resolution: ForeignReferenceResolution,
): readonly BlockId[] => {
  const content = readContentNode(container);
  const isLegacyPageProjection =
    content.nodeName === "cardRef"
    || content.nodeName === "pageRef"
    || content.nodeName === "cardToggle";
  const isLegacyDatabaseQuery = content.nodeName === "toggleListInlineView";
  if (resolution.kind === "page" && !isLegacyPageProjection) {
    throw new ForeignReferenceMigrationError(
      `Block ${resolution.sourceBlockId} is not a legacy Page projection`,
    );
  }
  if (resolution.kind === "database_view" && !isLegacyDatabaseQuery) {
    throw new ForeignReferenceMigrationError(
      `Block ${resolution.sourceBlockId} is not a legacy Database query`,
    );
  }

  const removedDescendantBlockIds = collectDescendantBlockIds(container);
  const nextContent = resolution.kind === "page"
    ? makePageReferenceNode(resolution)
    : makeDatabaseViewReferenceNode(resolution);
  container.delete(0, container.length);
  container.insert(0, [nextContent]);
  return removedDescendantBlockIds;
};

/**
 * Builds one portable forward update on a detached clone. The source Y.Doc is
 * never mutated, including on validation failure. Application Block IDs are
 * retained at each reference container while legacy snapshot descendants are
 * removed from the host Document.
 */
export const migrateForeignReferences = (
  source: Y.Doc,
  resolutions: readonly ForeignReferenceResolution[],
): ForeignReferenceDocumentMigration => {
  const before = materializePageDocument(source);
  const legacyProjectionRootIds = collectLegacyProjectionRootIds(before.blockTree);
  const legacyReferences = before.references.filter(
    (reference) =>
      isLegacyForeignBodyReference(reference)
      && legacyProjectionRootIds.has(reference.sourceBlockId),
  );
  const resolutionBySource = new Map<BlockId, ForeignReferenceResolution>();
  for (const resolution of resolutions) {
    requireIdentity(resolution.sourceBlockId, "sourceBlockId");
    if (resolutionBySource.has(resolution.sourceBlockId)) {
      throw new ForeignReferenceMigrationError(
        `Duplicate resolution for Block ${resolution.sourceBlockId}`,
      );
    }
    resolutionBySource.set(resolution.sourceBlockId, resolution);
  }
  if (legacyReferences.length !== resolutionBySource.size) {
    throw new ForeignReferenceMigrationError(
      "Every legacy foreign-body reference must have exactly one resolution",
    );
  }
  for (const reference of legacyReferences) {
    const resolution = resolutionBySource.get(reference.sourceBlockId);
    if (!resolution) {
      throw new ForeignReferenceMigrationError(
        `Missing resolution for Block ${reference.sourceBlockId}`,
      );
    }
    if (
      reference.kind === "legacy_card_projection"
      && resolution.kind !== "page"
    ) {
      throw new ForeignReferenceMigrationError(
        `Card projection ${reference.sourceBlockId} requires a Card resolution`,
      );
    }
    if (
      reference.kind === "legacy_database_query"
      && resolution.kind !== "database_view"
    ) {
      throw new ForeignReferenceMigrationError(
        `Database query ${reference.sourceBlockId} requires a Database View resolution`,
      );
    }
  }

  const baseStateVector = Y.encodeStateVector(source);
  const clone = new Y.Doc({ guid: source.guid });
  try {
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(source), "migration-source");
    const body = clone.getXmlFragment("body");
    const containers = new Map<BlockId, Y.XmlElement>();
    collectContainers(body, containers);
    const removedDescendantBlockIds: BlockId[] = [];
    clone.transact(() => {
      for (const resolution of resolutions) {
        const container = containers.get(resolution.sourceBlockId);
        if (!container) {
          throw new ForeignReferenceMigrationError(
            `Reference Block ${resolution.sourceBlockId} is missing from its Document`,
          );
        }
        removedDescendantBlockIds.push(
          ...replaceLegacyReference(container, resolution),
        );
      }
    }, "foreign-reference-migration");

    const materialization = materializePageDocument(clone);
    if (materialization.references.some(isLegacyForeignBodyReference)) {
      throw new ForeignReferenceMigrationError(
        "Foreign reference migration left a legacy projection in the Document",
      );
    }
    const update = Y.encodeStateAsUpdate(clone, baseStateVector);
    if (update.byteLength === 0) {
      throw new ForeignReferenceMigrationError(
        "Foreign reference migration produced no Yjs update",
      );
    }
    return {
      update,
      materialization,
      migratedBlockIds: resolutions.map((resolution) => resolution.sourceBlockId),
      removedDescendantBlockIds,
    };
  } catch (error) {
    if (error instanceof ForeignReferenceMigrationError) throw error;
    throw new ForeignReferenceMigrationError(
      "Could not migrate legacy foreign-body references",
      { cause: error },
    );
  } finally {
    clone.destroy();
  }
};
