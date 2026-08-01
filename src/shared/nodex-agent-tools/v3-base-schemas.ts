import { z } from "zod";
import { MAX_PAGE_WRITE_BODY_BYTES } from "../page-limits";
import { MAX_PORTABLE_RICH_TEXT_BYTES } from "../block-documents/portable-rich-text";
import { parseInlineMarkdownTitle } from "../nfm/agent-title";
import {
  BlockIdSchema,
  DataSourceIdSchema,
  JsonValueSchema,
  LibraryIdSchema,
  PropertyIdSchema,
  SiblingAnchorSchema,
  ViewIdSchema,
} from "./base-schemas";

export const InlineMarkdownTitleSchema = z.string()
  .max(MAX_PORTABLE_RICH_TEXT_BYTES)
  .superRefine((markdown, context) => {
    try {
      parseInlineMarkdownTitle(markdown);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid inline Markdown title",
      });
    }
  })
  .describe("Single-line title using Nested Markdown's title-safe inline subset");

export const NestedMarkdownSchema = z.string()
  .max(MAX_PAGE_WRITE_BODY_BYTES)
  .refine(
    (markdown) => new TextEncoder().encode(markdown).byteLength <= MAX_PAGE_WRITE_BODY_BYTES,
    `Nested Markdown must be at most ${MAX_PAGE_WRITE_BODY_BYTES} UTF-8 bytes`,
  );

export const NestedMarkdownFragmentSchema = NestedMarkdownSchema.refine(
  (markdown) => markdown.trim().length > 0,
  "Nested Markdown insertion must contain at least one Block; use <empty-block/> to insert an intentional empty Block",
);

export const DatabaseValueDraftV3Schema = z.strictObject({
  propertyId: PropertyIdSchema,
  value: JsonValueSchema,
});

export const DatabaseDestinationViewV3Schema = z.strictObject({
  viewId: ViewIdSchema,
  groupKey: z.string().max(4_096).nullable().optional(),
  at: SiblingAnchorSchema.optional(),
});

export const PageLocationV3Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("library"), libraryId: LibraryIdSchema }),
  z.strictObject({ kind: z.literal("page"), pageId: BlockIdSchema }),
  z.strictObject({ kind: z.literal("data_source"), dataSourceId: DataSourceIdSchema }),
]);

export const PageDestinationV3Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("library"),
    at: SiblingAnchorSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("page"),
    pageId: BlockIdSchema,
    at: SiblingAnchorSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("data_source"),
    dataSourceId: DataSourceIdSchema,
    view: DatabaseDestinationViewV3Schema.optional(),
  }),
]);

export function uniqueSelectorList<T extends readonly [string, ...string[]]>(
  selectors: T,
  maximum = selectors.length,
) {
  return z.array(z.enum(selectors)).max(maximum).refine(
    (values) => new Set(values).size === values.length,
    "Return selectors must be unique",
  );
}
