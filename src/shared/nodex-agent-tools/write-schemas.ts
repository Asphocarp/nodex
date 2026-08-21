import { z } from "zod";
import { MAX_PAGE_WRITE_BODY_BYTES } from "../page-limits";
import {
  BlockIdSchema,
  BlockLocationSchema,
  createToolSuccessSchema,
  DataSourceIdSchema,
  DocumentAnchorSchema,
  DocumentIdSchema,
  ETagSchema,
  JsonValueSchema,
  PropertyIdSchema,
  SiblingAnchorSchema,
  TextInputSchema,
  ViewIdSchema,
} from "./base-schemas";

const NfmContentSchema = z
  .string()
  .max(MAX_PAGE_WRITE_BODY_BYTES)
  .refine(
    (content) => new TextEncoder().encode(content).byteLength <= MAX_PAGE_WRITE_BODY_BYTES,
    `NFM content must be at most ${MAX_PAGE_WRITE_BODY_BYTES} UTF-8 bytes`,
  );

const NfmFragmentSchema = NfmContentSchema.refine(
  (content) => content.trim().length > 0,
  "NFM insertion must contain at least one Block; use <empty-block/> to insert an intentional empty Block",
);

export const DatabaseValueDraftSchema = z.strictObject({
  propertyId: PropertyIdSchema,
  value: JsonValueSchema,
});

const DatabaseDestinationViewSchema = z.strictObject({
  viewId: ViewIdSchema,
  groupKey: z.string().max(4_096).nullable().optional(),
  at: SiblingAnchorSchema.optional(),
});

export const CreateDestinationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("library"),
    at: SiblingAnchorSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("document"),
    documentId: DocumentIdSchema,
    at: DocumentAnchorSchema,
  }),
  z.strictObject({
    kind: z.literal("data_source"),
    dataSourceId: DataSourceIdSchema,
    values: z.array(DatabaseValueDraftSchema).max(512).optional(),
    view: DatabaseDestinationViewSchema.optional(),
  }),
]);

export const CreateInputSchema = z.strictObject({
  resource: z.strictObject({
    kind: z.literal("page"),
    title: TextInputSchema,
    body: z
      .strictObject({
        format: z.literal("nfm"),
        content: NfmContentSchema,
      })
      .optional(),
  }),
  destination: CreateDestinationSchema,
  return: z
    .strictObject({
      blockIds: z.boolean().optional(),
      etags: z.boolean().optional(),
    })
    .optional(),
});

export const CreateDataSchema = z.strictObject({
  resource: z.strictObject({
    kind: z.literal("page"),
    blockId: BlockIdSchema,
    documentId: DocumentIdSchema,
    location: BlockLocationSchema,
    bodyBlockCount: z.number().int().min(0),
    createdBodyBlockIds: z.array(BlockIdSchema).optional(),
    etags: z
      .strictObject({
        title: ETagSchema,
        body: ETagSchema,
      })
      .optional(),
  }),
  database: z
    .strictObject({
      databaseBlockId: BlockIdSchema,
    })
    .optional(),
});

export const CreateOutputSchema = createToolSuccessSchema(CreateDataSchema);

export const ExactNfmPatchSchema = z.strictObject({
  oldNfm: z.string().min(1).max(MAX_PAGE_WRITE_BODY_BYTES),
  newNfm: z.string().max(MAX_PAGE_WRITE_BODY_BYTES),
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

export const BlockUpdatePatchSchema = z
  .strictObject({
    type: z.string().trim().min(1).max(256).optional(),
    props: z.record(z.string(), JsonValueSchema).optional(),
    content: JsonValueSchema.optional(),
    unsetContent: z.literal(true).optional(),
  })
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    "A Block update patch must change at least one field",
  )
  .refine(
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
    ifMatch: ETagSchema,
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
    ifMatch: ETagSchema,
  }),
]);

export const DocumentBodyEditSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("nfm.insert"),
    at: DocumentAnchorSchema,
    content: NfmFragmentSchema,
  }),
  z.strictObject({
    kind: z.literal("nfm.patch"),
    patches: z.array(ExactNfmPatchSchema).min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal("nfm.replace"),
    ifMatch: ETagSchema,
    content: NfmContentSchema,
  }),
  z.strictObject({
    kind: z.literal("blocks"),
    edits: z.array(StableBlockEditSchema).min(1).max(512),
  }),
]);

export const EditDocumentInputSchema = z
  .strictObject({
    documentId: DocumentIdSchema,
    title: z
      .strictObject({
        value: TextInputSchema,
        ifMatch: ETagSchema,
      })
      .optional(),
    body: DocumentBodyEditSchema.optional(),
    safety: z
      .strictObject({
        allowDeletingOwnedBlocks: z.boolean().optional(),
      })
      .optional(),
    return: z
      .strictObject({
        nfm: z.boolean().optional(),
        blockIds: z.boolean().optional(),
        etags: z.boolean().optional(),
      })
      .optional(),
  })
  .refine(
    (input) => input.title !== undefined || input.body !== undefined,
    "edit_document requires title or body",
  );

const BlockIdMapSchema = z.record(BlockIdSchema, BlockIdSchema);

export const EditDocumentDataSchema = z.strictObject({
  documentId: DocumentIdSchema,
  effects: z.strictObject({
    created: z.number().int().min(0),
    updated: z.number().int().min(0),
    moved: z.number().int().min(0),
    deleted: z.number().int().min(0),
    blockIds: z
      .strictObject({
        created: z.array(BlockIdSchema),
        local: z.record(z.string(), BlockIdSchema),
        copied: BlockIdMapSchema,
        updated: z.array(BlockIdSchema),
        moved: z.array(BlockIdSchema),
        deleted: z.array(BlockIdSchema),
      })
      .optional(),
  }),
  body: z
    .strictObject({
      format: z.literal("nfm"),
      content: z.string(),
      contentHash: z.string().min(1).max(512),
    })
    .optional(),
  etags: z
    .strictObject({
      title: ETagSchema,
      body: ETagSchema,
    })
    .optional(),
});

export const EditDocumentOutputSchema = createToolSuccessSchema(EditDocumentDataSchema);

export const TransferDestinationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("library"),
    at: SiblingAnchorSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("document"),
    documentId: DocumentIdSchema,
    at: DocumentAnchorSchema,
  }),
  z.strictObject({
    kind: z.literal("data_source"),
    dataSourceId: DataSourceIdSchema,
    values: z.array(DatabaseValueDraftSchema).max(512).optional(),
    view: DatabaseDestinationViewSchema.optional(),
  }),
]);

const TransferReturnSchema = z.strictObject({
  blockMap: z.boolean().optional(),
});

export const TransferBlocksInputSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("move"),
    blockIds: z.array(BlockIdSchema).min(1).max(16),
    from: BlockLocationSchema,
    destination: TransferDestinationSchema,
    return: TransferReturnSchema.optional(),
  }),
  z.strictObject({
    mode: z.literal("copy"),
    blockIds: z.array(BlockIdSchema).min(1).max(16),
    destination: TransferDestinationSchema,
    return: TransferReturnSchema.optional(),
  }),
]);

export const TransferBlocksDataSchema = z.strictObject({
  mode: z.enum(["move", "copy"]),
  results: z
    .array(
      z.strictObject({
        sourceBlockId: BlockIdSchema,
        resultBlockId: BlockIdSchema,
        location: BlockLocationSchema,
        transformation: z.enum(["preserved", "wrapped", "promoted"]),
      }),
    )
    .max(16),
  copiedBlockIds: BlockIdMapSchema.optional(),
});

export const TransferBlocksOutputSchema = createToolSuccessSchema(TransferBlocksDataSchema);

export const DatabaseEditSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("value.set"),
    blockId: BlockIdSchema,
    propertyId: PropertyIdSchema,
    ifMatch: ETagSchema,
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
    items: z
      .array(
        z.strictObject({
          blockId: BlockIdSchema,
          ifMatch: ETagSchema,
        }),
      )
      .min(1)
      .max(32),
    groupKey: z.string().max(4_096).nullable().optional(),
    at: SiblingAnchorSchema.optional(),
  }),
]);

export const EditDatabaseInputSchema = z.strictObject({
  databaseBlockId: BlockIdSchema,
  edits: z.array(DatabaseEditSchema).min(1).max(32),
  return: z
    .strictObject({
      etags: z.boolean().optional(),
    })
    .optional(),
});

export const EditDatabaseDataSchema = z.strictObject({
  databaseBlockId: BlockIdSchema,
  effects: z.strictObject({
    valuesSet: z.number().int().min(0),
    setsChanged: z.number().int().min(0),
    placementsChanged: z.number().int().min(0),
  }),
  etags: z
    .strictObject({
      values: z.array(
        z.strictObject({
          blockId: BlockIdSchema,
          propertyId: PropertyIdSchema,
          etag: ETagSchema,
        }),
      ),
      placements: z.array(
        z.strictObject({
          blockId: BlockIdSchema,
          viewId: ViewIdSchema,
          etag: ETagSchema,
        }),
      ),
    })
    .optional(),
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
