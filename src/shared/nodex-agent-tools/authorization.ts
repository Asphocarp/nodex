import type { NodexAgentToolName } from "./base-schemas";

export const NODEX_AGENT_AUTHORIZATION_RENDERER_METHOD =
  "nodex-agent-authorization" as const;
export const NODEX_AGENT_AUTHORIZATION_TIMEOUT_MS = 5 * 60_000;

export type NodexAgentAuthorizationDecision =
  | "allow_once"
  | "allow_task"
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
}

export interface NodexAgentAuthorizationRequest {
  readonly type: "nodexAgentAuthorization";
  readonly requestId: string;
  readonly projectId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly tool: Extract<
    NodexAgentToolName,
    "create" | "edit_document" | "transfer_blocks" | "edit_database"
  >;
  readonly effect: "write" | "destructive";
  readonly preview: NodexAgentAuthorizationPreview;
  readonly createdAt: number;
}

export interface NodexAgentAuthorizationResponse {
  readonly decision: NodexAgentAuthorizationDecision;
}
