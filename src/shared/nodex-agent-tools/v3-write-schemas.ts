import { z } from "zod";
import {
  BlockIdSchema,
  createToolSuccessSchema,
  DocumentAnchorSchema,
  ETagSchema,
  SiblingAnchorSchema,
} from "./base-schemas";
import {
  BlockUpdatePatchSchema,
  NewBlockDraftSchema,
} from "./write-schemas";
import {
  CardDestinationV3Schema,
  CardLocationV3Schema,
  DatabaseDestinationViewV3Schema,
  DatabaseValueDraftV3Schema,
  InlineMarkdownTitleSchema,
  NestedMarkdownSchema,
  uniqueSelectorList,
} from "./v3-base-schemas";

const BlockIdMapV3Schema = z.record(BlockIdSchema, BlockIdSchema);

const CreateCardDraftV3Schema = z.strictObject({
  title: InlineMarkdownTitleSchema,
  markdown: NestedMarkdownSchema.optional(),
  values: z.array(DatabaseValueDraftV3Schema).max(512).optional(),
});

export const CreateCardsV3InputSchema = z.strictObject({
  destination: CardDestinationV3Schema,
  cards: z.array(CreateCardDraftV3Schema).min(1).max(16),
  return: uniqueSelectorList(["block_ids", "etags"]).optional(),
}).superRefine((input, context) => {
  const bodyBytes = input.cards.reduce(
    (total, card) => total + new TextEncoder().encode(card.markdown ?? "").byteLength,
    0,
  );
  if (bodyBytes > 2 * 1024 * 1024) {
    context.addIssue({
      code: "custom",
      message: "The Card batch exceeds the 2 MiB aggregate Nested Markdown limit",
      path: ["cards"],
    });
  }
  if (input.destination.kind === "database") return;
  input.cards.forEach((card, index) => {
    if (card.values === undefined) return;
    context.addIssue({
      code: "custom",
      message: "Initial values require a Database destination",
      path: ["cards", index, "values"],
    });
  });
});

const CardMutationEtagsV3Schema = z.strictObject({
  title: ETagSchema,
  body: ETagSchema,
});

export const CreateCardsV3DataSchema = z.strictObject({
  cards: z.array(z.strictObject({
    cardId: BlockIdSchema,
    location: CardLocationV3Schema,
    bodyBlocksCreated: z.number().int().min(0),
    blockIds: z.array(BlockIdSchema).optional(),
    etags: CardMutationEtagsV3Schema.optional(),
  })).min(1).max(16),
  created: z.number().int().min(1).max(16),
});

export const CreateCardsV3OutputSchema = createToolSuccessSchema(CreateCardsV3DataSchema);

const ExactMarkdownPatchV3Schema = z.strictObject({
  oldMarkdown: z.string().min(1).max(2 * 1024 * 1024),
  newMarkdown: NestedMarkdownSchema,
  expectedMatches: z.number().int().min(1).max(100).optional(),
});

export const CardBodyUpdateV3Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("insert"),
    at: DocumentAnchorSchema,
    markdown: NestedMarkdownSchema,
  }),
  z.strictObject({
    kind: z.literal("patch"),
    patches: z.array(ExactMarkdownPatchV3Schema).min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal("replace"),
    markdown: NestedMarkdownSchema,
    ifMatch: ETagSchema,
  }),
]);

const CardUpdateReturnV3Schema = uniqueSelectorList([
  "markdown",
  "block_ids",
  "etags",
]);

export const UpdateCardV3InputSchema = z.strictObject({
  cardId: BlockIdSchema,
  title: z.strictObject({
    markdown: InlineMarkdownTitleSchema,
    ifMatch: ETagSchema,
  }).optional(),
  body: CardBodyUpdateV3Schema.optional(),
  safety: z.strictObject({
    allowDeletingOwnedBlocks: z.boolean().optional(),
  }).optional(),
  return: CardUpdateReturnV3Schema.optional(),
}).refine(
  (input) => input.title !== undefined || input.body !== undefined,
  "update_card requires title or body",
);

const CardUpdateEffectsV3Schema = z.strictObject({
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
  moved: z.number().int().min(0),
  deleted: z.number().int().min(0),
  blockIds: z.strictObject({
    created: z.array(BlockIdSchema),
    local: z.record(z.string(), BlockIdSchema),
    copied: BlockIdMapV3Schema,
    updated: z.array(BlockIdSchema),
    moved: z.array(BlockIdSchema),
    deleted: z.array(BlockIdSchema),
  }).optional(),
});

export const CardUpdateV3DataSchema = z.strictObject({
  cardId: BlockIdSchema,
  effects: CardUpdateEffectsV3Schema,
  body: z.strictObject({
    format: z.literal("markdown"),
    markdown: z.string(),
    contentHash: z.string().min(1).max(512),
  }).optional(),
  etags: CardMutationEtagsV3Schema.optional(),
});

export const UpdateCardV3OutputSchema = createToolSuccessSchema(CardUpdateV3DataSchema);

export const StableBlockEditV3Schema = z.discriminatedUnion("kind", [
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

export const AdvancedUpdateCardV3InputSchema = z.strictObject({
  cardId: BlockIdSchema,
  edits: z.array(StableBlockEditV3Schema).min(1).max(512),
  safety: z.strictObject({
    allowDeletingOwnedBlocks: z.boolean().optional(),
  }).optional(),
  return: CardUpdateReturnV3Schema.optional(),
});

export const AdvancedUpdateCardV3OutputSchema = createToolSuccessSchema(
  CardUpdateV3DataSchema,
);

const MoveCardsDestinationV3Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("space"), at: SiblingAnchorSchema.optional() }),
  z.strictObject({
    kind: z.literal("card"),
    cardId: BlockIdSchema,
    at: SiblingAnchorSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("database"),
    databaseBlockId: BlockIdSchema,
    values: z.array(DatabaseValueDraftV3Schema).max(512).optional(),
    view: DatabaseDestinationViewV3Schema.optional(),
  }),
]);

export const MoveCardsV3InputSchema = z.strictObject({
  cardIds: z.array(BlockIdSchema).min(1).max(16).refine(
    (ids) => new Set(ids).size === ids.length,
    "cardIds must be unique",
  ),
  destination: MoveCardsDestinationV3Schema,
});

export const MoveCardsV3DataSchema = z.strictObject({
  cards: z.array(z.strictObject({
    cardId: BlockIdSchema,
    location: CardLocationV3Schema,
  })).min(1).max(16),
  moved: z.number().int().min(1).max(16),
});

export const MoveCardsV3OutputSchema = createToolSuccessSchema(MoveCardsV3DataSchema);

const DuplicateCardDestinationV3Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("space"), at: SiblingAnchorSchema.optional() }),
  z.strictObject({
    kind: z.literal("card"),
    cardId: BlockIdSchema,
    at: SiblingAnchorSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("database"),
    databaseBlockId: BlockIdSchema,
    values: z.array(DatabaseValueDraftV3Schema).max(512).optional(),
    view: DatabaseDestinationViewV3Schema.optional(),
  }),
]);

export const DuplicateCardV3InputSchema = z.strictObject({
  cardId: BlockIdSchema,
  destination: DuplicateCardDestinationV3Schema,
  return: uniqueSelectorList(["block_map", "etags"]).optional(),
});

export const DuplicateCardV3DataSchema = z.strictObject({
  sourceCardId: BlockIdSchema,
  cardId: BlockIdSchema,
  location: CardLocationV3Schema,
  bodyBlocksCreated: z.number().int().min(0),
  blockMap: BlockIdMapV3Schema.optional(),
  etags: CardMutationEtagsV3Schema.optional(),
});

export const DuplicateCardV3OutputSchema = createToolSuccessSchema(DuplicateCardV3DataSchema);
