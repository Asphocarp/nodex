import { z } from "zod";
import { MAX_CARD_WRITE_BODY_BYTES } from "../card-limits";
import {
  BlockIdSchema,
  BlockLocationSchema,
  createToolSuccessSchema,
  DatabaseSchemaRevisionSchema,
  DatabaseValueRevisionSchema,
  DocumentAnchorSchema,
  DocumentIdSchema,
  DocumentRevisionSchema,
  JsonValueSchema,
  LocationRevisionSchema,
  PropertyIdSchema,
  SiblingAnchorSchema,
  TextInputSchema,
  ViewIdSchema,
  ViewPlacementRevisionSchema,
  ViewRevisionSchema,
} from "./base-schemas";

const NfmContentSchema = z.string().max(MAX_CARD_WRITE_BODY_BYTES).refine(
  (content) => new TextEncoder().encode(content).byteLength <= MAX_CARD_WRITE_BODY_BYTES,
  `NFM content must be at most ${MAX_CARD_WRITE_BODY_BYTES} UTF-8 bytes`,
);

export const DatabaseValueDraftSchema = z.strictObject({
  propertyId: PropertyIdSchema,
  value: JsonValueSchema,
});

const DatabaseDestinationViewSchema = z.strictObject({
  viewId: ViewIdSchema,
  ifRevision: ViewRevisionSchema,
  groupKey: z.string().max(4_096).nullable().optional(),
  at: SiblingAnchorSchema.optional(),
});

export const CreateDestinationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("space"),
    at: SiblingAnchorSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("document"),
    documentId: DocumentIdSchema,
    ifRevision: DocumentRevisionSchema,
    at: DocumentAnchorSchema,
  }),
  z.strictObject({
    kind: z.literal("database"),
    databaseBlockId: BlockIdSchema,
    ifSchemaRevision: DatabaseSchemaRevisionSchema,
    values: z.array(DatabaseValueDraftSchema).max(512).optional(),
    view: DatabaseDestinationViewSchema.optional(),
  }),
]);

export const CreateInputSchema = z.strictObject({
  resource: z.strictObject({
    kind: z.literal("card"),
    title: TextInputSchema,
    body: z.strictObject({
      format: z.literal("nfm"),
      content: NfmContentSchema,
    }).optional(),
  }),
  destination: CreateDestinationSchema,
});

export const CreateDataSchema = z.strictObject({
  resource: z.strictObject({
    kind: z.literal("card"),
    blockId: BlockIdSchema,
    documentId: DocumentIdSchema,
    documentRevision: DocumentRevisionSchema,
    locationRevision: LocationRevisionSchema,
    createdBodyBlockIds: z.array(BlockIdSchema),
  }),
  database: z.strictObject({
    databaseBlockId: BlockIdSchema,
    valueRevisions: z.record(PropertyIdSchema, DatabaseValueRevisionSchema),
    placementRevision: ViewPlacementRevisionSchema.optional(),
  }).optional(),
  receipt: z.strictObject({ duplicate: z.boolean() }),
});

export const CreateOutputSchema = createToolSuccessSchema(CreateDataSchema);

export const ExactNfmPatchSchema = z.strictObject({
  oldNfm: z.string().min(1).max(MAX_CARD_WRITE_BODY_BYTES),
  newNfm: z.string().max(MAX_CARD_WRITE_BODY_BYTES),
  expectedMatches: z.number().int().min(1).max(100).optional(),
});

export interface NewBlockDraftInput {
  readonly localId: string;
  readonly type: string;
  readonly props?: Readonly<Record<string, z.infer<typeof JsonValueSchema>>>;
  readonly content?: z.infer<typeof JsonValueSchema>;
  readonly children?: readonly NewBlockDraftInput[];
}

export const NewBlockDraftSchema: z.ZodType<NewBlockDraftInput> = z.lazy(() =>
  z.strictObject({
    localId: z.string().trim().min(1).max(256),
    type: z.string().trim().min(1).max(256),
    props: z.record(z.string(), JsonValueSchema).optional(),
    content: JsonValueSchema.optional(),
    children: z.array(NewBlockDraftSchema).max(512).optional(),
  }),
);

export const BlockUpdatePatchSchema = z.strictObject({
  type: z.string().trim().min(1).max(256).optional(),
  props: z.record(z.string(), JsonValueSchema).optional(),
  content: JsonValueSchema.optional(),
  unsetContent: z.literal(true).optional(),
}).refine(
  (patch) => Object.values(patch).some((value) => value !== undefined),
  "A Block update patch must change at least one field",
).refine(
  (patch) => !(patch.content !== undefined && patch.unsetContent === true),
  "content and unsetContent cannot be combined",
);

export const StableBlockEditSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("insert"),
    at: DocumentAnchorSchema,
    block: NewBlockDraftSchema,
  }),
  z.strictObject({
    kind: z.literal("update"),
    blockId: BlockIdSchema,
    patch: BlockUpdatePatchSchema,
  }),
  z.strictObject({
    kind: z.literal("move"),
    blockId: BlockIdSchema,
    at: DocumentAnchorSchema,
  }),
  z.strictObject({
    kind: z.literal("delete"),
    blockId: BlockIdSchema,
  }),
]);

export const DocumentBodyEditSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("nfm.insert"),
    at: DocumentAnchorSchema,
    content: NfmContentSchema,
  }),
  z.strictObject({
    kind: z.literal("nfm.patch"),
    patches: z.array(ExactNfmPatchSchema).min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal("nfm.replace"),
    content: NfmContentSchema,
  }),
  z.strictObject({
    kind: z.literal("blocks"),
    edits: z.array(StableBlockEditSchema).min(1).max(512),
  }),
]);

export const EditDocumentInputSchema = z.strictObject({
  documentId: DocumentIdSchema,
  ifRevision: DocumentRevisionSchema,
  title: TextInputSchema.optional(),
  body: DocumentBodyEditSchema.optional(),
  safety: z.strictObject({
    allowDeletingOwnedBlocks: z.boolean().optional(),
  }).optional(),
}).refine(
  (input) => input.title !== undefined || input.body !== undefined,
  "edit_document requires title or body",
);

const BlockIdMapSchema = z.record(BlockIdSchema, BlockIdSchema);

export const EditDocumentDataSchema = z.strictObject({
  documentId: DocumentIdSchema,
  revision: DocumentRevisionSchema,
  effects: z.strictObject({
    createdBlockIds: z.array(BlockIdSchema),
    localBlockIds: z.record(z.string(), BlockIdSchema),
    copiedBlockIds: BlockIdMapSchema,
    updatedBlockIds: z.array(BlockIdSchema),
    movedBlockIds: z.array(BlockIdSchema),
    deletedBlockIds: z.array(BlockIdSchema),
  }),
  body: z.union([
    z.strictObject({
      format: z.literal("nfm"),
      content: z.string(),
      contentHash: z.string().min(1).max(512),
    }),
    z.strictObject({ contentOmitted: z.literal(true) }),
  ]),
  receipt: z.strictObject({ duplicate: z.boolean() }),
});

export const EditDocumentOutputSchema = createToolSuccessSchema(EditDocumentDataSchema);

export const TransferDestinationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("space"),
    at: SiblingAnchorSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("document"),
    documentId: DocumentIdSchema,
    ifRevision: DocumentRevisionSchema,
    at: DocumentAnchorSchema,
  }),
  z.strictObject({
    kind: z.literal("database"),
    databaseBlockId: BlockIdSchema,
    ifSchemaRevision: DatabaseSchemaRevisionSchema,
    values: z.array(DatabaseValueDraftSchema).max(512).optional(),
    view: DatabaseDestinationViewSchema.optional(),
  }),
]);

export const TransferBlocksInputSchema = z.strictObject({
  mode: z.enum(["move", "copy"]),
  items: z.array(z.strictObject({
    blockId: BlockIdSchema,
    ifLocationRevision: LocationRevisionSchema,
  })).min(1).max(16),
  destination: TransferDestinationSchema,
});

export const TransferBlocksDataSchema = z.strictObject({
  mode: z.enum(["move", "copy"]),
  results: z.array(z.strictObject({
    sourceBlockId: BlockIdSchema,
    resultBlockId: BlockIdSchema,
    location: BlockLocationSchema,
    locationRevision: LocationRevisionSchema,
    transformation: z.enum(["preserved", "wrapped", "promoted"]),
  })).max(16),
  copiedBlockIds: BlockIdMapSchema,
  receipt: z.strictObject({ duplicate: z.boolean() }),
});

export const TransferBlocksOutputSchema = createToolSuccessSchema(TransferBlocksDataSchema);

export const DatabaseEditSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("value.set"),
    blockId: BlockIdSchema,
    propertyId: PropertyIdSchema,
    ifRevision: DatabaseValueRevisionSchema,
    value: JsonValueSchema,
  }),
  z.strictObject({
    kind: z.literal("value.add_remove"),
    blockId: BlockIdSchema,
    propertyId: PropertyIdSchema,
    add: z.array(z.string().min(1).max(4_096)).max(512),
    remove: z.array(z.string().min(1).max(4_096)).max(512),
  }),
  z.strictObject({
    kind: z.literal("view.place"),
    viewId: ViewIdSchema,
    ifViewRevision: ViewRevisionSchema,
    items: z.array(z.strictObject({
      blockId: BlockIdSchema,
      ifRevision: ViewPlacementRevisionSchema,
    })).min(1).max(32),
    groupKey: z.string().max(4_096).nullable().optional(),
    at: SiblingAnchorSchema.optional(),
  }),
]);

export const EditDatabaseInputSchema = z.strictObject({
  databaseBlockId: BlockIdSchema,
  ifSchemaRevision: DatabaseSchemaRevisionSchema,
  edits: z.array(DatabaseEditSchema).min(1).max(32),
});

export const EditDatabaseDataSchema = z.strictObject({
  databaseBlockId: BlockIdSchema,
  valueRevisions: z.array(z.strictObject({
    blockId: BlockIdSchema,
    propertyId: PropertyIdSchema,
    revision: DatabaseValueRevisionSchema,
  })),
  placementRevisions: z.array(z.strictObject({
    blockId: BlockIdSchema,
    viewId: ViewIdSchema,
    revision: ViewPlacementRevisionSchema,
  })),
  receipt: z.strictObject({ duplicate: z.boolean() }),
});

export const EditDatabaseOutputSchema = createToolSuccessSchema(EditDatabaseDataSchema);

export type CreateInput = z.infer<typeof CreateInputSchema>;
export type CreateOutput = z.infer<typeof CreateOutputSchema>;
export type EditDocumentInput = z.infer<typeof EditDocumentInputSchema>;
export type EditDocumentOutput = z.infer<typeof EditDocumentOutputSchema>;
export type TransferBlocksInput = z.infer<typeof TransferBlocksInputSchema>;
export type TransferBlocksOutput = z.infer<typeof TransferBlocksOutputSchema>;
export type EditDatabaseInput = z.infer<typeof EditDatabaseInputSchema>;
export type EditDatabaseOutput = z.infer<typeof EditDatabaseOutputSchema>;
