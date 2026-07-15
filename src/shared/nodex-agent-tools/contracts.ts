import type { z } from "zod";
import {
  GetBlockInputSchema,
  GetBlockOutputSchema,
  GetContextInputSchema,
  GetContextOutputSchema,
  QueryDatabaseInputSchema,
  QueryDatabaseOutputSchema,
  SearchInputSchema,
  SearchOutputSchema,
} from "./read-schemas";
import {
  CreateInputSchema,
  CreateOutputSchema,
  EditDatabaseInputSchema,
  EditDatabaseOutputSchema,
  EditDocumentInputSchema,
  EditDocumentOutputSchema,
  TransferBlocksInputSchema,
  TransferBlocksOutputSchema,
} from "./write-schemas";

export type NodexAgentToolEffect = "read" | "write" | "destructive";

export interface NodexAgentToolContract<
  TInputSchema extends z.ZodType = z.ZodType,
  TOutputSchema extends z.ZodType = z.ZodType,
> {
  readonly description: string;
  readonly inputSchema: TInputSchema;
  readonly outputSchema: TOutputSchema;
  readonly deferLoading: boolean;
  readonly classifyEffect: (input: z.output<TInputSchema>) => NodexAgentToolEffect;
}

function defineNodexAgentToolContract<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  contract: NodexAgentToolContract<TInputSchema, TOutputSchema>,
): NodexAgentToolContract<TInputSchema, TOutputSchema> {
  return contract;
}

export const NODEX_AGENT_TOOL_CONTRACTS = {
  get_context: defineNodexAgentToolContract({
    description:
      "Read the current Nodex Project binding, access state, Database/View catalog, and a compact NFM authoring guide. This is the only Nodex content tool available without a bound Project.",
    inputSchema: GetContextInputSchema,
    outputSchema: GetContextOutputSchema,
    deferLoading: false,
    classifyEffect: () => "read",
  }),
  get_block: defineNodexAgentToolContract({
    description:
      "Read one known Block by stable identity. For Cards or document Blocks, request a summary, complete canonical NFM, or paged structural Blocks together with opaque revisions for safe later edits.",
    inputSchema: GetBlockInputSchema,
    outputSchema: GetBlockOutputSchema,
    deferLoading: false,
    classifyEffect: () => "read",
  }),
  search: defineNodexAgentToolContract({
    description:
      "Discover Cards or exact document Blocks in the current Project. Card search is typo-tolerant for titles and property display values; body and Block search use exact/prefix matching and return stable identities.",
    inputSchema: SearchInputSchema,
    outputSchema: SearchOutputSchema,
    deferLoading: false,
    classifyEffect: () => "read",
  }),
  query_database: defineNodexAgentToolContract({
    description:
      "Query a persisted Database View or run a typed ad-hoc Database filter/sort. Returns schema, values, placement state, and opaque revisions needed for later Database edits.",
    inputSchema: QueryDatabaseInputSchema,
    outputSchema: QueryDatabaseOutputSchema,
    deferLoading: true,
    classifyEffect: () => "read",
  }),
  create: defineNodexAgentToolContract({
    description:
      "Atomically create one complete aggregate. Version 1 creates a Card with a title and optional multi-Block NFM body directly in Space, a Document, or a Database with initial values and View placement.",
    inputSchema: CreateInputSchema,
    outputSchema: CreateOutputSchema,
    deferLoading: true,
    classifyEffect: () => "write",
  }),
  edit_document: defineNodexAgentToolContract({
    description:
      "Atomically edit one Card document and optional title. Prefer complete NFM replace for substantial rewrites, NFM insert for appending many Blocks, exact simultaneous NFM patches for focused text edits, and stable Block operations for identity-sensitive changes.",
    inputSchema: EditDocumentInputSchema,
    outputSchema: EditDocumentOutputSchema,
    deferLoading: true,
    classifyEffect: (input: z.output<typeof EditDocumentInputSchema>) => {
      if (input.body?.kind === "nfm.patch" || input.body?.kind === "nfm.replace") {
        return "destructive";
      }
      if (
        input.body?.kind === "blocks"
        && input.body.edits.some((edit) => edit.kind === "delete")
      ) {
        return "destructive";
      }
      return "write";
    },
  }),
  transfer_blocks: defineNodexAgentToolContract({
    description:
      "Move or copy a bounded ordered set of root Blocks between Space, Documents, and Databases. The host resolves and verifies the shared source; Database destinations can atomically set initial values and View placement.",
    inputSchema: TransferBlocksInputSchema,
    outputSchema: TransferBlocksOutputSchema,
    deferLoading: true,
    classifyEffect: () => "write",
  }),
  edit_database: defineNodexAgentToolContract({
    description:
      "Atomically change typed Database values or persisted View placement. Membership changes use transfer_blocks; schema and View-definition changes are intentionally not exposed in version 1.",
    inputSchema: EditDatabaseInputSchema,
    outputSchema: EditDatabaseOutputSchema,
    deferLoading: true,
    classifyEffect: () => "write",
  }),
} as const;
