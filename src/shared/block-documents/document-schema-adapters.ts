import * as Y from "yjs";
import {
  materializeBlockDocumentBody,
  type BlockDocumentAssetReference,
  type BlockDocumentReference,
  type BlockTreeNode,
  type CardDocumentMaterialization,
} from "./block-document-codec";
import {
  assertValidBlockDocument,
  type ScannedDocumentBlock,
} from "./block-structure";
import {
  assertValidCardDocumentRoots,
  CARD_DOCUMENT_SCHEMA_KEY,
  CARD_DOCUMENT_SCHEMA_VERSION,
  createCardDocument,
  type CardDocumentEnvelope,
} from "./card-document";
import {
  MAX_CARD_DOCUMENT_BLOCKS,
  MAX_CARD_DOCUMENT_BODY_XML_LENGTH,
  MAX_CARD_DOCUMENT_STATE_BYTES,
  MAX_CARD_DOCUMENT_UPDATE_BYTES,
  MAX_CARD_DOCUMENT_XML_PATH_DEPTH,
  type DocumentId,
} from "./contracts";
import {
  assertValidSyncedBlockDocumentRoots,
  createSyncedBlockDocument,
  SYNCED_BLOCK_DOCUMENT_SCHEMA_KEY,
  SYNCED_BLOCK_DOCUMENT_SCHEMA_VERSION,
  SYNCED_BLOCK_SOURCE_TYPE,
  type SyncedBlockDocumentEnvelope,
} from "./synced-block-document";

export interface CommonOwnedDocumentMaterialization {
  readonly schemaVersion: number;
  readonly blockTree: readonly BlockTreeNode[];
  readonly nfm: string;
  readonly plainText: string;
  readonly preview: string;
  readonly references: readonly BlockDocumentReference[];
  readonly assetRefs: readonly BlockDocumentAssetReference[];
}

export interface CardOwnedDocumentMaterialization extends CommonOwnedDocumentMaterialization {
  readonly kind: "card";
  readonly title: string;
}

export interface SyncedBlockOwnedDocumentMaterialization extends CommonOwnedDocumentMaterialization {
  readonly kind: "synced_block";
}

export type OwnedDocumentMaterialization =
  CardOwnedDocumentMaterialization | SyncedBlockOwnedDocumentMaterialization;

export type BlockTreeOwnedDocumentEnvelope =
  | ({ readonly kind: "card" } & CardDocumentEnvelope)
  | ({ readonly kind: "synced_block" } & SyncedBlockDocumentEnvelope);

/**
 * Reserved contract for scene/canvas-style Documents. It intentionally has no
 * `body` or title root: those adapters must define and validate their own Yjs
 * roots instead of pretending to be BlockNote documents.
 */
export interface SceneGraphOwnedDocumentEnvelope {
  readonly kind: "scene_graph";
  readonly documentId: DocumentId;
  readonly document: Y.Doc;
}

export type OwnedDocumentEnvelope =
  BlockTreeOwnedDocumentEnvelope | SceneGraphOwnedDocumentEnvelope;

export interface OwnedDocumentInspection {
  readonly envelope: BlockTreeOwnedDocumentEnvelope;
  readonly blocks: readonly ScannedDocumentBlock[];
  readonly materialization: OwnedDocumentMaterialization;
}

export interface SceneGraphOwnedDocumentInspection {
  readonly envelope: SceneGraphOwnedDocumentEnvelope;
  readonly materialization: {
    readonly kind: "scene_graph";
    readonly schemaVersion: number;
  };
}

export type RegisteredOwnedDocumentInspection =
  OwnedDocumentInspection | SceneGraphOwnedDocumentInspection;

export interface BlockDocumentSchemaCapabilities {
  readonly title: boolean;
  readonly blockTree: true;
  readonly nfmGenesis: boolean;
  readonly nfmReplace: boolean;
}

export interface BlockDocumentSchemaLimits {
  readonly maxUpdateBytes: number;
  readonly maxStateBytes: number;
  readonly maxBodyXmlLength: number;
  readonly maxBlocks: number;
  readonly maxXmlPathDepth: number;
}

export interface BlockDocumentSchemaAdapter {
  readonly kind: BlockTreeOwnedDocumentEnvelope["kind"];
  readonly contentModel: "block_tree";
  readonly ownerType: string;
  readonly schemaKey: string;
  readonly schemaVersion: number;
  readonly capabilities: BlockDocumentSchemaCapabilities;
  readonly limits: BlockDocumentSchemaLimits;
  readonly create: (documentId: DocumentId) => BlockTreeOwnedDocumentEnvelope;
  readonly inspect: (document: Y.Doc) => OwnedDocumentInspection;
}

export interface SceneGraphDocumentSchemaAdapter {
  readonly kind: "scene_graph";
  readonly contentModel: "scene_graph";
  readonly ownerType: string;
  readonly schemaKey: string;
  readonly schemaVersion: number;
  readonly capabilities: {
    readonly title: false;
    readonly blockTree: false;
    readonly nfmGenesis: false;
    readonly nfmReplace: false;
  };
  readonly limits: Pick<
    BlockDocumentSchemaLimits,
    "maxUpdateBytes" | "maxStateBytes"
  >;
  readonly create: (documentId: DocumentId) => SceneGraphOwnedDocumentEnvelope;
  readonly inspect: (document: Y.Doc) => SceneGraphOwnedDocumentInspection;
}

export type RegisteredBlockDocumentSchemaAdapter =
  BlockDocumentSchemaAdapter | SceneGraphDocumentSchemaAdapter;

export class BlockDocumentSchemaError extends TypeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BlockDocumentSchemaError";
  }
}

const DEFAULT_BLOCKNOTE_LIMITS: BlockDocumentSchemaLimits = {
  maxUpdateBytes: MAX_CARD_DOCUMENT_UPDATE_BYTES,
  maxStateBytes: MAX_CARD_DOCUMENT_STATE_BYTES,
  maxBodyXmlLength: MAX_CARD_DOCUMENT_BODY_XML_LENGTH,
  maxBlocks: MAX_CARD_DOCUMENT_BLOCKS,
  maxXmlPathDepth: MAX_CARD_DOCUMENT_XML_PATH_DEPTH,
};

const inspectBlockNoteBody = (
  envelope: BlockTreeOwnedDocumentEnvelope,
  schemaVersion: number,
  schemaLabel: string,
  title?: string,
): OwnedDocumentInspection => {
  const blocks = assertValidBlockDocument(envelope.body);
  const projected = materializeBlockDocumentBody({
    body: envelope.body,
    schemaVersion,
    title,
    schemaLabel,
  });
  if (envelope.kind === "card") {
    return {
      envelope,
      blocks,
      materialization: {
        kind: "card",
        ...projected,
        title: projected.title,
      },
    };
  }
  const { title: projectionOnlyTitle, ...materialization } = projected;
  void projectionOnlyTitle;
  return {
    envelope,
    blocks,
    materialization: { kind: "synced_block", ...materialization },
  };
};

const cardDocumentAdapter: BlockDocumentSchemaAdapter = {
  kind: "card",
  contentModel: "block_tree",
  ownerType: "card",
  schemaKey: CARD_DOCUMENT_SCHEMA_KEY,
  schemaVersion: CARD_DOCUMENT_SCHEMA_VERSION,
  capabilities: {
    title: true,
    blockTree: true,
    nfmGenesis: true,
    nfmReplace: true,
  },
  limits: DEFAULT_BLOCKNOTE_LIMITS,
  create: (documentId) => ({
    kind: "card",
    ...createCardDocument({ documentId }),
  }),
  inspect: (document) => {
    const envelope = assertValidCardDocumentRoots(document);
    return inspectBlockNoteBody(
      { kind: "card", ...envelope },
      CARD_DOCUMENT_SCHEMA_VERSION,
      "Card",
      envelope.title.toString(),
    );
  },
};

const syncedBlockDocumentAdapter: BlockDocumentSchemaAdapter = {
  kind: "synced_block",
  contentModel: "block_tree",
  ownerType: SYNCED_BLOCK_SOURCE_TYPE,
  schemaKey: SYNCED_BLOCK_DOCUMENT_SCHEMA_KEY,
  schemaVersion: SYNCED_BLOCK_DOCUMENT_SCHEMA_VERSION,
  capabilities: {
    title: false,
    blockTree: true,
    nfmGenesis: true,
    nfmReplace: false,
  },
  limits: DEFAULT_BLOCKNOTE_LIMITS,
  create: (documentId) => ({
    kind: "synced_block",
    ...createSyncedBlockDocument({ documentId }),
  }),
  inspect: (document) =>
    inspectBlockNoteBody(
      {
        kind: "synced_block",
        ...assertValidSyncedBlockDocumentRoots(document),
      },
      SYNCED_BLOCK_DOCUMENT_SCHEMA_VERSION,
      "Synced Block",
    ),
};

const schemaAdapters: readonly RegisteredBlockDocumentSchemaAdapter[] = [
  cardDocumentAdapter,
  syncedBlockDocumentAdapter,
] as const;

export const getRegisteredBlockDocumentSchemaAdapter = (input: {
  readonly ownerType: string;
  readonly schemaKey: string;
  readonly schemaVersion: number;
}): RegisteredBlockDocumentSchemaAdapter => {
  const adapter = schemaAdapters.find(
    (candidate) =>
      candidate.ownerType === input.ownerType &&
      candidate.schemaKey === input.schemaKey &&
      candidate.schemaVersion === input.schemaVersion,
  );
  if (adapter) return adapter;
  throw new BlockDocumentSchemaError(
    `No owned Document Adapter is registered for ${input.ownerType}/${input.schemaKey}@${input.schemaVersion}`,
  );
};

/** BlockNote/NFM pipelines must opt into the block-tree content model. */
export const getBlockDocumentSchemaAdapter = (input: {
  readonly ownerType: string;
  readonly schemaKey: string;
  readonly schemaVersion: number;
}): BlockDocumentSchemaAdapter => {
  const adapter = getRegisteredBlockDocumentSchemaAdapter(input);
  if (adapter.contentModel === "block_tree") return adapter;
  throw new BlockDocumentSchemaError(
    `Owned Document ${input.ownerType}/${input.schemaKey}@${input.schemaVersion} uses ${adapter.contentModel}, not the block-tree pipeline`,
  );
};

export const getBlockDocumentSchemaAdapterForSchema = (input: {
  readonly schemaKey: string;
  readonly schemaVersion: number;
}): BlockDocumentSchemaAdapter => {
  const matches = schemaAdapters.filter(
    (candidate) =>
      candidate.schemaKey === input.schemaKey &&
      candidate.schemaVersion === input.schemaVersion,
  );
  if (matches.length === 1 && matches[0]) {
    if (matches[0].contentModel === "block_tree") return matches[0];
    throw new BlockDocumentSchemaError(
      `Owned Document schema ${input.schemaKey}@${input.schemaVersion} uses ${matches[0].contentModel}, not the block-tree pipeline`,
    );
  }
  throw new BlockDocumentSchemaError(
    `Owned Document schema ${input.schemaKey}@${input.schemaVersion} is ${matches.length === 0 ? "not registered" : "ambiguous without an owner type"}`,
  );
};

export const inspectOwnedBlockDocument = (
  document: Y.Doc,
  input: {
    readonly ownerType: string;
    readonly schemaKey: string;
    readonly schemaVersion: number;
  },
): OwnedDocumentInspection =>
  getBlockDocumentSchemaAdapter(input).inspect(document);

export const inspectRegisteredOwnedBlockDocument = (
  document: Y.Doc,
  input: {
    readonly ownerType: string;
    readonly schemaKey: string;
    readonly schemaVersion: number;
  },
): RegisteredOwnedDocumentInspection =>
  getRegisteredBlockDocumentSchemaAdapter(input).inspect(document);

/** Relational persistence keeps a non-null title column for Card compatibility. */
export const toPersistedBlockDocumentMaterialization = (
  materialization: OwnedDocumentMaterialization,
): CardDocumentMaterialization => ({
  schemaVersion: materialization.schemaVersion,
  title: materialization.kind === "card" ? materialization.title : "",
  blockTree: materialization.blockTree,
  nfm: materialization.nfm,
  plainText: materialization.plainText,
  preview: materialization.preview,
  references: materialization.references,
  assetRefs: materialization.assetRefs,
});

export const listBlockDocumentSchemaAdapters =
  (): readonly RegisteredBlockDocumentSchemaAdapter[] => schemaAdapters;
