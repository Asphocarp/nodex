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
  assertValidLegacyCardDocumentRoots,
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
import {
  LARGE_CODE_BLOCK_TYPE,
  LARGE_CODE_DOCUMENT_SCHEMA_KEY,
  LARGE_CODE_DOCUMENT_SCHEMA_VERSION,
  LARGE_DOCUMENT_BLOCK_TYPE,
  LARGE_DOCUMENT_SCHEMA_KEY,
  LARGE_DOCUMENT_SCHEMA_VERSION,
  REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_KEY,
  REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_VERSION,
  REUSABLE_TEMPLATE_SOURCE_TYPE,
  type AdditionalBlockDocumentKind,
} from "./additional-document-bearing-blocks";
import {
  assertValidBodyOnlyBlockDocumentRoots,
  createBodyOnlyBlockDocument,
  type BodyOnlyBlockDocumentEnvelope,
} from "./body-only-block-document";
import {
  CANVAS_BLOCK_TYPE,
  CANVAS_DOCUMENT_SCHEMA_KEY,
  CANVAS_DOCUMENT_SCHEMA_VERSION,
} from "./canvas-document-identity";
import type { PortableCanvasScene } from "./canvas-scene";
import {
  plainTextToPortableRichText,
  portableRichTextPlainText,
  readPortableRichTextFromYText,
  type PortableRichText,
} from "./portable-rich-text";

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
  readonly richTitle: PortableRichText;
}

export interface SyncedBlockOwnedDocumentMaterialization extends CommonOwnedDocumentMaterialization {
  readonly kind: "synced_block";
}

export interface AdditionalBlockOwnedDocumentMaterialization extends CommonOwnedDocumentMaterialization {
  readonly kind: AdditionalBlockDocumentKind;
}

export type OwnedDocumentMaterialization =
  | CardOwnedDocumentMaterialization
  | SyncedBlockOwnedDocumentMaterialization
  | AdditionalBlockOwnedDocumentMaterialization;

export type RegisteredOwnedDocumentMaterialization =
  | OwnedDocumentMaterialization
  | PortableCanvasScene;

export type BlockTreeOwnedDocumentEnvelope =
  | ({ readonly kind: "card" } & CardDocumentEnvelope)
  | ({ readonly kind: "synced_block" } & SyncedBlockDocumentEnvelope)
  | ({ readonly kind: AdditionalBlockDocumentKind } & BodyOnlyBlockDocumentEnvelope);

export type OwnedDocumentEnvelope = BlockTreeOwnedDocumentEnvelope;

export interface OwnedDocumentInspection {
  readonly envelope: BlockTreeOwnedDocumentEnvelope;
  readonly blocks: readonly ScannedDocumentBlock[];
  readonly materialization: OwnedDocumentMaterialization;
}

export type RegisteredOwnedDocumentInspection = OwnedDocumentInspection;

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
  readonly syncEngine: "yjs";
  readonly ownerType: string;
  readonly schemaKey: string;
  readonly schemaVersion: number;
  readonly capabilities: BlockDocumentSchemaCapabilities;
  readonly limits: BlockDocumentSchemaLimits;
  readonly create: (documentId: DocumentId) => BlockTreeOwnedDocumentEnvelope;
  readonly inspect: (document: Y.Doc) => OwnedDocumentInspection;
}

export type RegisteredBlockDocumentSchemaAdapter = BlockDocumentSchemaAdapter;

export interface OwnedDocumentSchemaRegistration {
  readonly kind: BlockTreeOwnedDocumentEnvelope["kind"] | "scene_graph";
  readonly contentModel: "block_tree" | "scene_graph";
  readonly syncEngine: "yjs" | "canvas_scene";
  readonly ownerType: string;
  readonly schemaKey: string;
  readonly schemaVersion: number;
}

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
  richTitle?: PortableRichText,
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
        richTitle: richTitle ?? [],
      },
    };
  }
  const { title: projectionOnlyTitle, ...materialization } = projected;
  void projectionOnlyTitle;
  return {
    envelope,
    blocks,
    materialization: { kind: envelope.kind, ...materialization },
  };
};

const assertTemplateBodyCanInstantiate = (
  blockTree: readonly BlockTreeNode[],
): void => {
  const pending = [...blockTree];
  while (pending.length > 0) {
    const block = pending.pop();
    if (!block) continue;
    pending.push(...block.children);
    if (
      block.type !== "card" &&
      block.type !== REUSABLE_TEMPLATE_SOURCE_TYPE &&
      block.type !== LARGE_DOCUMENT_BLOCK_TYPE &&
      block.type !== LARGE_CODE_BLOCK_TYPE &&
      block.type !== SYNCED_BLOCK_SOURCE_TYPE
    ) {
      continue;
    }
    throw new BlockDocumentSchemaError(
      `Reusable Template content cannot own nested document-bearing Block ${block.id} (${block.type})`,
    );
  }
};

const assertLargeCodeBody = (blockTree: readonly BlockTreeNode[]): void => {
  const root = blockTree[0];
  if (
    blockTree.length === 1 &&
    root?.type === "codeBlock" &&
    root.children.length === 0
  ) {
    return;
  }
  throw new BlockDocumentSchemaError(
    "Large Code Documents require exactly one childless root codeBlock",
  );
};

const cardDocumentAdapter: BlockDocumentSchemaAdapter = {
  kind: "card",
  contentModel: "block_tree",
  syncEngine: "yjs",
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
    const richTitle = readPortableRichTextFromYText(envelope.title);
    return inspectBlockNoteBody(
      { kind: "card", ...envelope },
      CARD_DOCUMENT_SCHEMA_VERSION,
      "Card",
      portableRichTextPlainText(richTitle),
      richTitle,
    );
  },
};

const legacyCardDocumentAdapter: BlockDocumentSchemaAdapter = {
  ...cardDocumentAdapter,
  schemaVersion: 1,
  inspect: (document) => {
    const envelope = assertValidLegacyCardDocumentRoots(document);
    const richTitle = plainTextToPortableRichText(envelope.title.toString());
    return inspectBlockNoteBody(
      { kind: "card", ...envelope },
      1,
      "Legacy Card",
      envelope.title.toString(),
      richTitle,
    );
  },
};

const syncedBlockDocumentAdapter: BlockDocumentSchemaAdapter = {
  kind: "synced_block",
  contentModel: "block_tree",
  syncEngine: "yjs",
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

const createAdditionalBodyOnlyAdapter = (input: {
  readonly kind: AdditionalBlockDocumentKind;
  readonly ownerType: string;
  readonly schemaKey: string;
  readonly schemaVersion: number;
  readonly schemaLabel: string;
  readonly nfmReplace: boolean;
  readonly validate?: (blockTree: readonly BlockTreeNode[]) => void;
}): BlockDocumentSchemaAdapter => ({
  kind: input.kind,
  contentModel: "block_tree",
  syncEngine: "yjs",
  ownerType: input.ownerType,
  schemaKey: input.schemaKey,
  schemaVersion: input.schemaVersion,
  capabilities: {
    title: false,
    blockTree: true,
    nfmGenesis: true,
    nfmReplace: input.nfmReplace,
  },
  limits: DEFAULT_BLOCKNOTE_LIMITS,
  create: (documentId) => ({
    kind: input.kind,
    ...createBodyOnlyBlockDocument({ documentId, label: input.schemaLabel }),
  }),
  inspect: (document) => {
    const inspection = inspectBlockNoteBody(
      {
        kind: input.kind,
        ...assertValidBodyOnlyBlockDocumentRoots(document, {
          label: input.schemaLabel,
        }),
      },
      input.schemaVersion,
      input.schemaLabel,
    );
    input.validate?.(inspection.materialization.blockTree);
    return inspection;
  },
});

const reusableTemplateDocumentAdapter = createAdditionalBodyOnlyAdapter({
  kind: "reusable_template",
  ownerType: REUSABLE_TEMPLATE_SOURCE_TYPE,
  schemaKey: REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_KEY,
  schemaVersion: REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_VERSION,
  schemaLabel: "Reusable Template",
  nfmReplace: false,
  validate: assertTemplateBodyCanInstantiate,
});

const largeDocumentAdapter = createAdditionalBodyOnlyAdapter({
  kind: "large_document",
  ownerType: LARGE_DOCUMENT_BLOCK_TYPE,
  schemaKey: LARGE_DOCUMENT_SCHEMA_KEY,
  schemaVersion: LARGE_DOCUMENT_SCHEMA_VERSION,
  schemaLabel: "Large Document",
  nfmReplace: true,
});

const largeCodeDocumentAdapter = createAdditionalBodyOnlyAdapter({
  kind: "large_code",
  ownerType: LARGE_CODE_BLOCK_TYPE,
  schemaKey: LARGE_CODE_DOCUMENT_SCHEMA_KEY,
  schemaVersion: LARGE_CODE_DOCUMENT_SCHEMA_VERSION,
  schemaLabel: "Large Code",
  nfmReplace: true,
  validate: assertLargeCodeBody,
});

const canvasDocumentRegistration: OwnedDocumentSchemaRegistration = {
  kind: "scene_graph",
  contentModel: "scene_graph",
  syncEngine: "canvas_scene",
  ownerType: CANVAS_BLOCK_TYPE,
  schemaKey: CANVAS_DOCUMENT_SCHEMA_KEY,
  schemaVersion: CANVAS_DOCUMENT_SCHEMA_VERSION,
};

const schemaAdapters: readonly BlockDocumentSchemaAdapter[] = [
  legacyCardDocumentAdapter,
  cardDocumentAdapter,
  syncedBlockDocumentAdapter,
  reusableTemplateDocumentAdapter,
  largeDocumentAdapter,
  largeCodeDocumentAdapter,
] as const;

const schemaRegistrations: readonly OwnedDocumentSchemaRegistration[] = [
  ...schemaAdapters.map(({ kind, contentModel, syncEngine, ownerType, schemaKey, schemaVersion }) => ({
    kind,
    contentModel,
    syncEngine,
    ownerType,
    schemaKey,
    schemaVersion,
  })),
  canvasDocumentRegistration,
] as const;

export const getRegisteredBlockDocumentSchemaAdapter = (input: {
  readonly ownerType: string;
  readonly schemaKey: string;
  readonly schemaVersion: number;
}): BlockDocumentSchemaAdapter => {
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

export const getOwnedDocumentSchemaRegistration = (input: {
  readonly ownerType: string;
  readonly schemaKey: string;
  readonly schemaVersion: number;
}): OwnedDocumentSchemaRegistration => {
  const registration = schemaRegistrations.find(
    (candidate) =>
      candidate.ownerType === input.ownerType &&
      candidate.schemaKey === input.schemaKey &&
      candidate.schemaVersion === input.schemaVersion,
  );
  if (registration) return registration;
  throw new BlockDocumentSchemaError(
    `No owned Document schema is registered for ${input.ownerType}/${input.schemaKey}@${input.schemaVersion}`,
  );
};

export const getOwnedDocumentSchemaRegistrationForSchema = (input: {
  readonly schemaKey: string;
  readonly schemaVersion: number;
}): OwnedDocumentSchemaRegistration => {
  const matches = schemaRegistrations.filter(
    (candidate) =>
      candidate.schemaKey === input.schemaKey &&
      candidate.schemaVersion === input.schemaVersion,
  );
  if (matches.length === 1 && matches[0]) return matches[0];
  throw new BlockDocumentSchemaError(
    `Owned Document schema ${input.schemaKey}@${input.schemaVersion} is ${matches.length === 0 ? "not registered" : "ambiguous without an owner type"}`,
  );
};

/** Yjs content code must never receive a scene-native Canvas registration. */
export const getYjsDocumentSchemaAdapter = (input: {
  readonly ownerType: string;
  readonly schemaKey: string;
  readonly schemaVersion: number;
}): BlockDocumentSchemaAdapter => {
  return getRegisteredBlockDocumentSchemaAdapter(input);
};

/** BlockNote/NFM pipelines must opt into the block-tree content model. */
export const getBlockDocumentSchemaAdapter = (input: {
  readonly ownerType: string;
  readonly schemaKey: string;
  readonly schemaVersion: number;
}): BlockDocumentSchemaAdapter => {
  const adapter = getYjsDocumentSchemaAdapter(input);
  if (adapter.contentModel === "block_tree") return adapter;
  throw new BlockDocumentSchemaError(
    `Owned Document ${input.ownerType}/${input.schemaKey}@${input.schemaVersion} does not use the block-tree content model`,
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

export const getRegisteredBlockDocumentSchemaAdapterForSchema = (input: {
  readonly schemaKey: string;
  readonly schemaVersion: number;
}): RegisteredBlockDocumentSchemaAdapter => {
  const matches = schemaAdapters.filter(
    (candidate) =>
      candidate.schemaKey === input.schemaKey &&
      candidate.schemaVersion === input.schemaVersion,
  );
  if (matches.length === 1 && matches[0]) return matches[0];
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
): OwnedDocumentInspection =>
  getRegisteredBlockDocumentSchemaAdapter(input).inspect(document);

/** Relational persistence keeps a non-null title column for Card compatibility. */
export const toPersistedBlockDocumentMaterialization = (
  materialization: OwnedDocumentMaterialization,
): CardDocumentMaterialization => ({
  schemaVersion: materialization.schemaVersion,
  title: materialization.kind === "card" ? materialization.title : "",
  richTitle: materialization.kind === "card" ? materialization.richTitle : [],
  blockTree: materialization.blockTree,
  nfm: materialization.nfm,
  plainText: materialization.plainText,
  preview: materialization.preview,
  references: materialization.references,
  assetRefs: materialization.assetRefs,
});

export const listBlockDocumentSchemaAdapters =
  (): readonly BlockDocumentSchemaAdapter[] => schemaAdapters;
