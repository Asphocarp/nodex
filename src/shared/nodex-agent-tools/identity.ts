export const NODEX_APP_TOOL_NAMESPACE = "nodex_app" as const;
export const NODEX_APP_V2_TOOLSET_REVISION = 2 as const;

export const NODEX_APP_V2_TOOLS = [
  "get_context",
  "get_block",
  "search",
  "query_database",
  "create",
  "edit_document",
  "transfer_blocks",
  "edit_database",
] as const;

export type NodexAgentV2ToolName = (typeof NODEX_APP_V2_TOOLS)[number];

export const NODEX_APP_V3_TOOLSET_REVISION = 3 as const;

export const NODEX_APP_V3_TOOLS = [
  "get_context",
  "search",
  "fetch",
  "query_database_view",
  "advanced_query_database",
  "create_cards",
  "update_card",
  "advanced_update_card",
  "move_cards",
  "duplicate_card",
] as const;

export type NodexAgentV3ToolName = (typeof NODEX_APP_V3_TOOLS)[number];

export const NODEX_APP_TOOLSET_REVISION = NODEX_APP_V3_TOOLSET_REVISION;
export const NODEX_APP_TOOLS = NODEX_APP_V3_TOOLS;
export type NodexAgentToolName = NodexAgentV3ToolName;
