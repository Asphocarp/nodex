import type { z } from "zod";
import type { NodexAgentToolContract } from "./contracts";
import {
  AdvancedQueryDatabaseV3InputSchema,
  FetchV3InputSchema,
  FetchV3OutputSchema,
  GetContextV3InputSchema,
  GetContextV3OutputSchema,
  QueryDatabaseV3OutputSchema,
  QueryDatabaseViewV3InputSchema,
  SearchV3InputSchema,
  SearchV3OutputSchema,
} from "./v3-read-schemas";
import {
  AdvancedUpdateCardV3InputSchema,
  AdvancedUpdateCardV3OutputSchema,
  CreateCardsV3InputSchema,
  CreateCardsV3OutputSchema,
  DuplicateCardV3InputSchema,
  DuplicateCardV3OutputSchema,
  MoveCardsV3InputSchema,
  MoveCardsV3OutputSchema,
  UpdateCardV3InputSchema,
  UpdateCardV3OutputSchema,
} from "./v3-write-schemas";

function defineV3Contract<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  contract: NodexAgentToolContract<TInputSchema, TOutputSchema>,
): NodexAgentToolContract<TInputSchema, TOutputSchema> {
  return contract;
}

export const NODEX_AGENT_V3_TOOL_CONTRACTS = {
  get_context: defineV3Contract({
    description:
      "Read the current Project binding, access state, Database/View catalog, or the full opt-in Nested Markdown guide.",
    inputSchema: GetContextV3InputSchema,
    outputSchema: GetContextV3OutputSchema,
    deferLoading: false,
    classifyEffect: () => "read",
  }),
  search: defineV3Contract({
    description:
      "Discover Cards with typo-tolerant title/property matching or exact/prefix body Blocks; returns excerpts and stable IDs for fetch.",
    inputSchema: SearchV3InputSchema,
    outputSchema: SearchV3OutputSchema,
    deferLoading: false,
    classifyEffect: () => "read",
  }),
  fetch: defineV3Contract({
    description:
      "Fetch a known stable ID. Defaults to complete canonical Nested Markdown; request summary or blocks only for compact or identity-sensitive work.",
    inputSchema: FetchV3InputSchema,
    outputSchema: FetchV3OutputSchema,
    deferLoading: false,
    classifyEffect: () => "read",
  }),
  query_database_view: defineV3Contract({
    description:
      "Query one saved Database View with its persisted filter, sort, grouping, and row order; results omit write validators.",
    inputSchema: QueryDatabaseViewV3InputSchema,
    outputSchema: QueryDatabaseV3OutputSchema,
    deferLoading: true,
    classifyEffect: () => "read",
  }),
  advanced_query_database: defineV3Contract({
    description:
      "Run a typed temporary filter and sort against one known Database; use a saved View query when its persisted behavior is desired.",
    inputSchema: AdvancedQueryDatabaseV3InputSchema,
    outputSchema: QueryDatabaseV3OutputSchema,
    deferLoading: true,
    classifyEffect: () => "read",
  }),
  create_cards: defineV3Contract({
    description:
      "Atomically create one to sixteen complete Cards at one shared destination, with direct inline-Markdown titles and optional Nested Markdown bodies.",
    inputSchema: CreateCardsV3InputSchema,
    outputSchema: CreateCardsV3OutputSchema,
    deferLoading: true,
    classifyEffect: () => "write",
  }),
  update_card: defineV3Contract({
    description:
      "Update one Card title or body. Insert or exact-patch Nested Markdown by default; whole replacement requires a body ETag.",
    inputSchema: UpdateCardV3InputSchema,
    outputSchema: UpdateCardV3OutputSchema,
    deferLoading: true,
    classifyEffect: (input: z.output<typeof UpdateCardV3InputSchema>) =>
      input.body?.kind === "replace" ? "destructive" : "write",
  }),
  advanced_update_card: defineV3Contract({
    description:
      "After fetch format=blocks, perform identity-sensitive insert, update, move, or delete operations using stable Block IDs and narrow ETags.",
    inputSchema: AdvancedUpdateCardV3InputSchema,
    outputSchema: AdvancedUpdateCardV3OutputSchema,
    deferLoading: true,
    classifyEffect: (input: z.output<typeof AdvancedUpdateCardV3InputSchema>) =>
      input.edits.some((edit) => edit.kind === "delete") ? "destructive" : "write",
  }),
  move_cards: defineV3Contract({
    description:
      "Atomically move one to sixteen existing Card roots to one destination; current source locations are resolved and verified by Nodex.",
    inputSchema: MoveCardsV3InputSchema,
    outputSchema: MoveCardsV3OutputSchema,
    deferLoading: true,
    classifyEffect: () => "write",
  }),
  duplicate_card: defineV3Contract({
    description:
      "Duplicate one complete Card ownership subtree to a destination with fresh identities; request the detailed Block map only when needed.",
    inputSchema: DuplicateCardV3InputSchema,
    outputSchema: DuplicateCardV3OutputSchema,
    deferLoading: true,
    classifyEffect: () => "write",
  }),
} as const;
