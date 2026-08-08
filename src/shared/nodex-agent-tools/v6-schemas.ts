import { z } from "zod";
import { createToolSuccessSchema } from "./base-schemas";
import {
  BlockSearchResultV3Schema,
  FetchResourceV3Schema,
  FetchV3DataSchema,
  PageSearchMatchV3Schema,
  PageSearchResultV3Schema,
  QueryDatabaseRowV3Schema,
  QueryDatabaseV3DataSchema,
} from "./v3-read-schemas";
import {
  CreatePagesResultPageV3Schema,
  CreatePagesV3DataSchema,
  DuplicatePageV3DataSchema,
  MovePagesResultPageV3Schema,
  MovePagesV3DataSchema,
} from "./v3-write-schemas";
import {
  checkFetchV5Output,
  checkQueryV5Output,
  checkSearchV5Output,
} from "./v5-schemas";

export const PageKeyV6Schema = z.string().max(28).regex(
  /^[A-Z][A-Z0-9]{1,7}-[1-9]\d*$/,
  "Expected a canonical Page key",
);

const FetchResourceV6Schema = FetchResourceV3Schema.extend({
  pageKey: PageKeyV6Schema.nullable(),
});

const FetchV6DataSchema = FetchV3DataSchema.extend({
  resource: FetchResourceV6Schema,
});

export const FetchV6OutputSchema = createToolSuccessSchema(
  FetchV6DataSchema,
).superRefine(checkFetchV5Output);

const PageKeySearchMatchV6Schema = z.strictObject({
  source: z.literal("page_key"),
  quality: z.literal("exact"),
  pageKey: PageKeyV6Schema,
  isCurrent: z.boolean(),
});

const PageSearchMatchV6Schema = z.union([
  PageKeySearchMatchV6Schema,
  PageSearchMatchV3Schema,
]);

const PageSearchResultV6Schema = PageSearchResultV3Schema.extend({
  pageKey: PageKeyV6Schema.nullable(),
  matches: z.array(PageSearchMatchV6Schema).max(3),
});

const SearchResultV6Schema = z.discriminatedUnion("kind", [
  PageSearchResultV6Schema,
  BlockSearchResultV3Schema,
]);

const SearchV6DataSchema = z.strictObject({
  results: z.array(SearchResultV6Schema).max(100),
});

export const SearchV6OutputSchema = createToolSuccessSchema(
  SearchV6DataSchema,
).superRefine(checkSearchV5Output);

const QueryDatabaseRowV6Schema = QueryDatabaseRowV3Schema.extend({
  pageKey: PageKeyV6Schema.nullable(),
});

const QueryDatabaseV6DataSchema = QueryDatabaseV3DataSchema.extend({
  rows: z.array(QueryDatabaseRowV6Schema).max(200),
});

export const QueryDatabaseV6OutputSchema = createToolSuccessSchema(
  QueryDatabaseV6DataSchema,
).superRefine(checkQueryV5Output);

const CreatePagesResultPageV6Schema = CreatePagesResultPageV3Schema.extend({
  pageKey: PageKeyV6Schema.nullable(),
});

const CreatePagesV6DataSchema = CreatePagesV3DataSchema.extend({
  pages: z.array(CreatePagesResultPageV6Schema).min(1).max(16),
});

export const CreatePagesV6OutputSchema = createToolSuccessSchema(
  CreatePagesV6DataSchema,
);

const MovePagesResultPageV6Schema = MovePagesResultPageV3Schema.extend({
  pageKey: PageKeyV6Schema.nullable(),
});

const MovePagesV6DataSchema = MovePagesV3DataSchema.extend({
  pages: z.array(MovePagesResultPageV6Schema).min(1).max(16),
});

export const MovePagesV6OutputSchema = createToolSuccessSchema(
  MovePagesV6DataSchema,
);

const DuplicatePageV6DataSchema = DuplicatePageV3DataSchema.extend({
  pageKey: PageKeyV6Schema.nullable(),
});

export const DuplicatePageV6OutputSchema = createToolSuccessSchema(
  DuplicatePageV6DataSchema,
);
