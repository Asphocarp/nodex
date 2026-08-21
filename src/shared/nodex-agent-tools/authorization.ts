import type { NodexAgentV2ToolName, NodexAgentV3ToolName } from "./identity";

export const NODEX_AGENT_AUTHORIZATION_RENDERER_METHOD = "nodex-agent-authorization" as const;
export const NODEX_AGENT_AUTHORIZATION_TIMEOUT_MS = 5 * 60_000;

export type NodexAgentAuthorizationDecision =
  | "allow_once"
  | "allow_task"
  | "allow_project"
  | "deny";

export interface NodexAgentAuthorizationDetail {
  readonly label: string;
  readonly value: string;
}

export interface NodexAgentAuthorizationPreview {
  readonly title: string;
  readonly summary: string;
  readonly details: readonly NodexAgentAuthorizationDetail[];
  readonly nfmPreview?: string;
  readonly markdownPreview?: string;
}

export interface NodexAgentAuthorizationRequest {
  readonly type: "nodexAgentAuthorization";
  readonly requestId: string;
  readonly projectId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly tool:
    | Extract<
        NodexAgentV2ToolName,
        "create" | "edit_document" | "transfer_blocks" | "edit_database"
      >
    | Extract<
        NodexAgentV3ToolName,
        | "fetch"
        | "search"
        | "query_database_view"
        | "query_data_source"
        | "create_pages"
        | "update_page"
        | "advanced_update_page"
        | "move_pages"
        | "duplicate_page"
      >;
  readonly effect: "read" | "write" | "destructive";
  readonly preview: NodexAgentAuthorizationPreview;
  readonly createdAt: number;
}

export interface NodexAgentAuthorizationResponse {
  readonly decision: NodexAgentAuthorizationDecision;
}
