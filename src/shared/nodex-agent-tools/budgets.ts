/**
 * V2 is retained only as an honest before/after baseline during the v3
 * migration. Small headroom catches accidental growth without pretending the
 * legacy catalog meets the new common-path design.
 */
export const NODEX_AGENT_V2_CATALOG_BUDGETS = {
  namespaceBytes: 550,
  eagerBytes: 7_000,
  completeBytes: 41_000,
  tools: {
    create: 7_700,
    edit_database: 3_800,
    edit_document: 10_300,
    get_block: 2_750,
    get_context: 600,
    query_database: 3_950,
    search: 3_000,
    transfer_blocks: 9_900,
  },
} as const;

/** Public acceptance budgets for nodex_app@3. */
export const NODEX_AGENT_V3_CATALOG_BUDGETS = {
  namespaceHintBytes: 200,
  eagerBytes: 5_500,
  completeBytes: 38_000,
  tools: {
    fetch: 2_500,
    query_database_view: 2_500,
    advanced_query_database: 4_500,
    create_cards: 6_000,
    update_card: 4_000,
    move_cards: 5_000,
    duplicate_card: 5_000,
    advanced_update_card: 8_000,
  },
  defaultQueryResultBytes: 4_000,
  defaultMutationResultBytes: 2_000,
  defaultCreateCardsBaseBytes: 512,
  defaultCreateCardsPerCardBytes: 256,
} as const;
