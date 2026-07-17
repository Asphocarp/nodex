import { createHash } from "node:crypto";

export const NODEX_AGENT_AUTHORITY_PROVENANCE_VERSION = 1 as const;

export type NodexAgentAuthorityScope = "project" | "library";

export type NodexAgentAuthoritySource =
  | "project_turn"
  | "builtin_full_access"
  | "inherited_builtin_full_access";

/**
 * Main-owned execution authority captured for one exact Codex Turn.
 *
 * This is an internal transport shape. It is never exposed in a dynamic-tool
 * schema and must not be reconstructed from model-controlled arguments.
 */
export interface FrozenNodexAgentTurnAuthority {
  readonly threadId: string;
  readonly turnId: string;
  readonly rootThreadId: string;
  readonly actorProjectId: string;
  readonly libraryId: string;
  readonly storeEpoch: string;
  readonly scope: NodexAgentAuthorityScope;
  readonly source: NodexAgentAuthoritySource;
}

export const nodexAgentAuthorityFingerprint = (
  authority: FrozenNodexAgentTurnAuthority,
): string => createHash("sha256")
  .update(JSON.stringify([
    NODEX_AGENT_AUTHORITY_PROVENANCE_VERSION,
    authority.threadId,
    authority.turnId,
    authority.rootThreadId,
    authority.actorProjectId,
    authority.libraryId,
    authority.storeEpoch,
    authority.scope,
    authority.source,
  ]))
  .digest("hex");
