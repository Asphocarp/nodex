import type {
  DocumentMutationRequest,
  DocumentOperationResult,
  DocumentCommitRef,
} from "../block-documents";
import type { ToolFailure } from "./base-schemas";
import type { AgentDocumentEditEffects } from "./document-edit-compiler";
import type {
  NodexAgentCallIdentity,
} from "./write-runtime";
import type {
  AdvancedUpdatePageV3InputSchema,
  AdvancedUpdatePageV3OutputSchema,
  CreatePagesV3InputSchema,
  CreatePagesV3OutputSchema,
  DuplicatePageV3InputSchema,
  DuplicatePageV3OutputSchema,
  MovePagesV3InputSchema,
  MovePagesV3OutputSchema,
  UpdatePageV3InputSchema,
  UpdatePageV3OutputSchema,
} from "./v3-write-schemas";
import type { z } from "zod";
import type { NodexAgentResourceAccessOverlay } from "../nodex-agent-resource-access";

export type NodexAgentPageUpdateTool = "update_page" | "advanced_update_page";

/**
 * The prepared command carries only canonical ownership coordinates. Page
 * Document generations, Yjs heads and compatibility owner IDs are not part of
 * the Agent write protocol anymore; Core validates BlockRecord revisions when
 * the command is committed.
 */
export type NodexAgentCanonicalPageDestination =
  | {
      readonly kind: "space";
      readonly beforeBlockId?: string;
    }
  | {
      readonly kind: "document";
      readonly pageId: string;
      readonly parentBlockId?: string;
      readonly beforeBlockId?: string;
    }
  | {
      readonly kind: "database";
      readonly dataSourceId: string;
      readonly view?: {
        readonly viewId: string;
        readonly groupKey: string | null;
        readonly beforePageId?: string;
      };
    };

export interface NodexAgentCanonicalAuthorizationEvidence {
  readonly roots: Readonly<Record<string, {
    readonly type: string;
    readonly transformation: "preserved" | "promote" | "wrap";
    readonly wrapperReason?:
      | "type_requires_wrapper"
      | "unsupported_primary_content"
      | "unmapped_type_state";
  }>>;
}

export type PrepareNodexAgentPageUpdateRequest = NodexAgentCallIdentity & {
  readonly projectId: string;
} & (
  | {
      readonly tool: "update_page";
      readonly input: z.infer<typeof UpdatePageV3InputSchema>;
    }
  | {
      readonly tool: "advanced_update_page";
      readonly input: z.infer<typeof AdvancedUpdatePageV3InputSchema>;
    }
);

export type NodexAgentPageUpdateOutput =
  | z.infer<typeof UpdatePageV3OutputSchema>
  | z.infer<typeof AdvancedUpdatePageV3OutputSchema>;

export type PrepareNodexAgentPageUpdateResult =
  | {
      readonly ok: true;
      readonly value:
        | { readonly kind: "completed"; readonly output: NodexAgentPageUpdateOutput }
        | {
            readonly kind: "prepared";
            readonly mutation: DocumentMutationRequest;
            readonly effects: AgentDocumentEditEffects;
            readonly targetMarkdown: string;
            readonly resourceAccess?: NodexAgentResourceAccessOverlay;
          };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export interface CompleteNodexAgentPageUpdateRequest extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly tool: NodexAgentPageUpdateTool;
  readonly pageId: string;
  readonly result: DocumentOperationResult;
}

export type CompleteNodexAgentPageUpdateResult =
  | { readonly ok: true; readonly output: NodexAgentPageUpdateOutput }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export interface PreparedNodexAgentCreatePageV3 {
  readonly pageId: string;
  readonly bodyBlockIds: readonly string[];
}

export interface NodexAgentCreatePagesCommand extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly requestHash: string;
  readonly mutationId: string;
  readonly storeEpoch: string;
  readonly input: z.infer<typeof CreatePagesV3InputSchema>;
  readonly destination: NodexAgentCanonicalPageDestination;
  readonly pages: readonly PreparedNodexAgentCreatePageV3[];
}

export interface PrepareNodexAgentCreatePagesRequest extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly input: z.infer<typeof CreatePagesV3InputSchema>;
}

export type PrepareNodexAgentCreatePagesResult =
  | {
      readonly ok: true;
      readonly value:
        | {
            readonly kind: "completed";
            readonly output: z.infer<typeof CreatePagesV3OutputSchema>;
          }
        | {
            readonly kind: "prepared";
            readonly command: NodexAgentCreatePagesCommand;
            readonly previews: readonly {
              readonly pageId: string;
              readonly title: string;
              readonly bodyBlockCount: number;
              readonly targetMarkdown: string;
            }[];
          };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export type ExecuteNodexAgentCreatePagesResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly output: z.infer<typeof CreatePagesV3OutputSchema>;
        readonly duplicate: boolean;
        readonly documentCommits: readonly DocumentCommitRef[];
        readonly affectedDatabaseBlockIds: readonly string[];
        readonly changeLogSeq: number;
      };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export interface NodexAgentDuplicatePageCommand extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly requestHash: string;
  readonly mutationId: string;
  readonly storeEpoch: string;
  readonly input: z.infer<typeof DuplicatePageV3InputSchema>;
  readonly destination: NodexAgentCanonicalPageDestination;
  readonly canonical?: {
    readonly newPageId: string;
    readonly primaryViewRankKey?: string;
  };
}

export interface PrepareNodexAgentDuplicatePageRequest extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly input: z.infer<typeof DuplicatePageV3InputSchema>;
}

export type PrepareNodexAgentDuplicatePageResult =
  | {
      readonly ok: true;
      readonly value:
        | {
            readonly kind: "completed";
            readonly output: z.infer<typeof DuplicatePageV3OutputSchema>;
          }
        | {
            readonly kind: "prepared";
            readonly command: NodexAgentDuplicatePageCommand;
            readonly authorization: NodexAgentCanonicalAuthorizationEvidence;
          };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export type ExecuteNodexAgentDuplicatePageResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly output: z.infer<typeof DuplicatePageV3OutputSchema>;
        readonly duplicate: boolean;
        readonly documentCommits: readonly DocumentCommitRef[];
        readonly affectedDatabaseBlockIds: readonly string[];
        readonly changeLogSeq: number;
      };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export interface NodexAgentMovePageTransferStep {
  readonly pageId: string;
}

export interface NodexAgentMovePagesCommand extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly requestHash: string;
  readonly mutationId: string;
  readonly storeEpoch: string;
  readonly input: z.infer<typeof MovePagesV3InputSchema>;
  readonly destination: NodexAgentCanonicalPageDestination;
  readonly transfers: readonly NodexAgentMovePageTransferStep[];
}

export interface PrepareNodexAgentMovePagesRequest extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly input: z.infer<typeof MovePagesV3InputSchema>;
}

export type PrepareNodexAgentMovePagesResult =
  | {
      readonly ok: true;
      readonly value:
        | {
            readonly kind: "completed";
            readonly output: z.infer<typeof MovePagesV3OutputSchema>;
          }
        | {
            readonly kind: "prepared";
            readonly command: NodexAgentMovePagesCommand;
            readonly authorization: NodexAgentCanonicalAuthorizationEvidence;
          };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export type ExecuteNodexAgentMovePagesResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly output: z.infer<typeof MovePagesV3OutputSchema>;
        readonly duplicate: boolean;
        readonly documentCommits: readonly DocumentCommitRef[];
        readonly affectedDatabaseBlockIds: readonly string[];
        readonly changeLogSeq: number;
      };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };
