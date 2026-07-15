import { z } from "zod";
import type {
  DatabasePropertyValueType,
  DatabaseViewFilterClause,
  DatabaseViewFilterGroup,
  DatabaseViewFilterNode,
  DatabaseViewSort,
} from "../database-kernel";
import {
  BlockIdSchema,
  BlockLocationSchema,
  createPageInputSchema,
  createToolSuccessSchema,
  DatabaseSchemaRevisionSchema,
  DatabaseValueRevisionSchema,
  DocumentIdSchema,
  DocumentRevisionSchema,
  JsonValueSchema,
  LocationRevisionSchema,
  ProjectIdSchema,
  PropertyIdSchema,
  TextInputSchema,
  ViewIdSchema,
  ViewPlacementRevisionSchema,
  ViewRevisionSchema,
} from "./base-schemas";

export const DatabasePropertyValueTypeSchema = z.enum([
  "text",
  "number",
  "checkbox",
  "select",
  "multi_select",
  "date",
  "datetime",
  "person",
]) satisfies z.ZodType<DatabasePropertyValueType>;

export const GeneralDatabaseViewKindSchema = z.enum([
  "kanban",
  "list",
  "calendar",
  "canvas",
]);

const DatabaseViewFilterOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "is_empty",
  "is_not_empty",
]);

const DatabaseViewFilterClauseSchema = z.strictObject({
  kind: z.literal("clause"),
  propertyId: PropertyIdSchema,
  operator: DatabaseViewFilterOperatorSchema,
  value: JsonValueSchema.optional(),
}) satisfies z.ZodType<DatabaseViewFilterClause>;

const DatabaseViewFilterGroupSchema: z.ZodType<DatabaseViewFilterGroup> = z.lazy(() =>
  z.strictObject({
    kind: z.literal("group"),
    operator: z.enum(["and", "or"]),
    children: z.array(DatabaseViewFilterNodeSchema).max(1_024),
  }),
);

export const DatabaseViewFilterNodeSchema: z.ZodType<DatabaseViewFilterNode> = z.lazy(() =>
  z.union([DatabaseViewFilterClauseSchema, DatabaseViewFilterGroupSchema]),
);

export type NonManualDatabaseViewSort = Omit<DatabaseViewSort, "field"> & {
  readonly field: Exclude<DatabaseViewSort["field"], { readonly kind: "manual" }>;
};

export const NonManualDatabaseViewSortSchema = z.strictObject({
  field: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("title") }),
    z.strictObject({ kind: z.literal("created") }),
    z.strictObject({ kind: z.literal("property"), propertyId: PropertyIdSchema }),
  ]),
  direction: z.enum(["asc", "desc"]),
  nulls: z.enum(["first", "last"]),
}) satisfies z.ZodType<NonManualDatabaseViewSort>;

const DatabaseSummarySchema = z.strictObject({
  databaseBlockId: BlockIdSchema,
  name: z.string(),
  isPrimary: z.boolean(),
  schemaRevision: DatabaseSchemaRevisionSchema,
  views: z.array(z.strictObject({
    viewId: ViewIdSchema,
    name: z.string(),
    kind: GeneralDatabaseViewKindSchema,
    isPrimary: z.boolean(),
    revision: ViewRevisionSchema,
  })),
});

export const GetContextInputSchema = z.strictObject({
  include: z.strictObject({
    databases: z.boolean().optional(),
    nfmGuide: z.boolean().optional(),
  }).optional(),
});

export const GetContextDataSchema = z.strictObject({
  project: z.strictObject({
    projectId: ProjectIdSchema,
    name: z.string(),
  }).nullable(),
  access: z.strictObject({
    read: z.enum(["allowed", "unavailable"]),
    write: z.enum(["granted", "consent_required", "unavailable"]),
    domains: z.array(z.enum(["document", "placement", "database"])),
  }),
  databases: z.array(DatabaseSummarySchema).optional(),
  nfmGuide: z.strictObject({
    format: z.literal("nfm"),
    specificationVersion: z.string(),
    instructions: z.string(),
    examples: z.array(z.string()),
  }).optional(),
});

export const GetContextOutputSchema = createToolSuccessSchema(GetContextDataSchema);

export const DocumentBlockRecordSchema = z.strictObject({
  blockId: BlockIdSchema,
  parentBlockId: BlockIdSchema.nullable(),
  siblingIndex: z.number().int().min(0),
  depth: z.number().int().min(0),
  type: z.string().min(1).max(256),
  props: z.record(z.string(), JsonValueSchema),
  content: JsonValueSchema.optional(),
});

export const DocumentRepresentationSchema = z.discriminatedUnion("format", [
  z.strictObject({ format: z.literal("summary"), text: z.string() }),
  z.strictObject({
    format: z.literal("nfm"),
    content: z.string(),
    contentHash: z.string().min(1).max(512),
  }),
  z.strictObject({
    format: z.literal("blocks"),
    blocks: z.array(DocumentBlockRecordSchema),
  }),
]);

export const GetBlockInputSchema = z.strictObject({
  blockId: BlockIdSchema,
  include: z.strictObject({
    properties: z.boolean().optional(),
    database: z.boolean().optional(),
    document: z.strictObject({
      format: z.enum(["summary", "nfm", "blocks"]),
      scope: z.enum(["owner", "subtree"]).optional(),
      maxDepth: z.number().int().min(0).max(512).optional(),
    }).optional(),
  }).optional(),
  page: createPageInputSchema(100).optional(),
});

export const GetBlockDataSchema = z.strictObject({
  block: z.strictObject({
    blockId: BlockIdSchema,
    type: z.string().min(1).max(256),
    title: TextInputSchema.optional(),
    lifecycle: z.enum(["active", "archived", "deleted"]),
    location: BlockLocationSchema,
    locationRevision: LocationRevisionSchema,
    properties: z.record(PropertyIdSchema, z.strictObject({
      value: JsonValueSchema,
      revision: DatabaseValueRevisionSchema,
    })).optional(),
  }),
  document: z.strictObject({
    documentId: DocumentIdSchema,
    ownerBlockId: BlockIdSchema,
    revision: DocumentRevisionSchema,
    body: DocumentRepresentationSchema,
  }).optional(),
  database: z.strictObject({
    databaseBlockId: BlockIdSchema,
    schemaRevision: DatabaseSchemaRevisionSchema,
  }).optional(),
});

export const GetBlockOutputSchema = createToolSuccessSchema(GetBlockDataSchema);

const SearchScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project") }),
  z.strictObject({ kind: z.literal("database"), databaseBlockId: BlockIdSchema }),
  z.strictObject({ kind: z.literal("document"), documentId: DocumentIdSchema }),
]);

const SearchQuerySchema = z.string().trim().min(1).max(512).refine(
  (query) => new TextEncoder().encode(query).byteLength <= 512,
  "Search query must be at most 512 UTF-8 bytes",
);

const CardSearchInputSchema = z.strictObject({
  query: SearchQuerySchema,
  target: z.literal("cards").optional(),
  scope: SearchScopeSchema.optional(),
  filters: z.strictObject({ includeArchived: z.boolean().optional() }).optional(),
  page: createPageInputSchema(100).optional(),
});

const BlockSearchInputSchema = z.strictObject({
  query: SearchQuerySchema,
  target: z.literal("blocks"),
  scope: SearchScopeSchema.optional(),
  filters: z.strictObject({
    blockTypes: z.array(z.string().min(1).max(256)).max(64).optional(),
    includeArchived: z.boolean().optional(),
  }).optional(),
  page: createPageInputSchema(100).optional(),
});

export const SearchInputSchema = z.union([
  CardSearchInputSchema,
  BlockSearchInputSchema,
]);

const SearchMatchQualitySchema = z.enum(["exact", "prefix", "fuzzy"]);

const CardSearchMatchSchema = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("identity"),
    quality: z.enum(["exact", "prefix"]),
    excerpt: z.string(),
  }),
  z.strictObject({
    source: z.literal("title"),
    quality: SearchMatchQualitySchema,
    excerpt: z.string(),
  }),
  z.strictObject({
    source: z.literal("property"),
    quality: SearchMatchQualitySchema,
    propertyId: PropertyIdSchema,
    propertyName: z.string(),
    excerpt: z.string(),
  }),
  z.strictObject({
    source: z.literal("body"),
    quality: z.enum(["exact", "prefix"]),
    blockId: BlockIdSchema,
    blockType: z.string(),
    excerpt: z.string(),
  }),
]);

const CardSearchResultSchema = z.strictObject({
  kind: z.literal("card"),
  blockId: BlockIdSchema,
  title: z.string(),
  location: BlockLocationSchema,
  matches: z.array(CardSearchMatchSchema).max(3),
});

const BlockSearchResultSchema = z.strictObject({
  kind: z.literal("block"),
  blockId: BlockIdSchema,
  blockType: z.string(),
  ownerBlockId: BlockIdSchema,
  documentId: DocumentIdSchema,
  source: z.enum(["title", "body"]),
  quality: z.enum(["exact", "prefix"]),
  excerpt: z.string(),
});

export const SearchDataSchema = z.discriminatedUnion("target", [
  z.strictObject({
    target: z.literal("cards"),
    results: z.array(CardSearchResultSchema).max(100),
  }),
  z.strictObject({
    target: z.literal("blocks"),
    results: z.array(BlockSearchResultSchema).max(100),
  }),
]);

export const SearchOutputSchema = createToolSuccessSchema(SearchDataSchema);

const DatabaseQuerySourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("view"), viewId: ViewIdSchema }),
  z.strictObject({
    kind: z.literal("database"),
    databaseBlockId: BlockIdSchema,
    filter: DatabaseViewFilterNodeSchema.optional(),
    sort: z.array(NonManualDatabaseViewSortSchema).max(64).optional(),
  }),
]);

export const QueryDatabaseInputSchema = z.strictObject({
  source: DatabaseQuerySourceSchema,
  select: z.strictObject({
    propertyIds: z.array(PropertyIdSchema).max(512).optional(),
    documentSummary: z.boolean().optional(),
  }).optional(),
  page: createPageInputSchema(200).optional(),
});

export const QueryDatabaseDataSchema = z.strictObject({
  database: z.strictObject({
    databaseBlockId: BlockIdSchema,
    name: z.string(),
    schemaRevision: DatabaseSchemaRevisionSchema,
    properties: z.array(z.strictObject({
      propertyId: PropertyIdSchema,
      name: z.string(),
      valueType: DatabasePropertyValueTypeSchema,
      config: z.record(z.string(), JsonValueSchema),
    })),
  }),
  view: z.strictObject({
    viewId: ViewIdSchema,
    name: z.string(),
    kind: GeneralDatabaseViewKindSchema,
    revision: ViewRevisionSchema,
  }).optional(),
  rows: z.array(z.strictObject({
    blockId: BlockIdSchema,
    title: z.string(),
    locationRevision: LocationRevisionSchema,
    values: z.record(PropertyIdSchema, z.strictObject({
      value: JsonValueSchema,
      revision: DatabaseValueRevisionSchema,
    })),
    placement: z.strictObject({
      viewId: ViewIdSchema,
      groupKey: z.string().nullable(),
      revision: ViewPlacementRevisionSchema,
    }).optional(),
    documentSummary: z.string().optional(),
  })).max(200),
});

export const QueryDatabaseOutputSchema = createToolSuccessSchema(QueryDatabaseDataSchema);

export type GetContextInput = z.infer<typeof GetContextInputSchema>;
export type GetContextOutput = z.infer<typeof GetContextOutputSchema>;
export type GetBlockInput = z.infer<typeof GetBlockInputSchema>;
export type GetBlockOutput = z.infer<typeof GetBlockOutputSchema>;
export type SearchInput = z.infer<typeof SearchInputSchema>;
export type SearchOutput = z.infer<typeof SearchOutputSchema>;
export type QueryDatabaseInput = z.infer<typeof QueryDatabaseInputSchema>;
export type QueryDatabaseOutput = z.infer<typeof QueryDatabaseOutputSchema>;
