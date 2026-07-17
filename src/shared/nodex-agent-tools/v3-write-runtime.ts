import type {
  DocumentMutationRequest,
  DocumentOperationResult,
  RelocationDocumentCommit,
} from "../block-documents";
import type { ToolFailure } from "./base-schemas";
import type { AgentDocumentEditEffects } from "./document-edit-compiler";
import type {
  NodexAgentCallIdentity,
  NodexAgentLeaseDocument,
  NodexAgentTransferAuthorizationEvidence,
  NodexAgentTransferCommand,
  PreparedNodexAgentCreateDestination,
} from "./write-runtime";
import type { CreateInput } from "./write-schemas";
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
  readonly input: CreateInput;
  readonly pageId: string;
  readonly bodyBlockIds: readonly string[];
  readonly primaryMembershipId: string;
  readonly targetMembershipId: string;
}

export interface NodexAgentCreatePagesCommand extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly requestHash: string;
  readonly mutationId: string;
  readonly storeEpoch: string;
  readonly input: z.infer<typeof CreatePagesV3InputSchema>;
  readonly destination: PreparedNodexAgentCreateDestination;
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
            readonly leaseDocuments: readonly NodexAgentLeaseDocument[];
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
        readonly documentCommits: readonly RelocationDocumentCommit[];
        readonly affectedDatabaseBlockIds: readonly string[];
        readonly changeLogSeq: number;
      };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export interface NodexAgentDuplicatePageCommand extends Omit<
  NodexAgentTransferCommand,
  "input"
> {
  readonly input: z.infer<typeof DuplicatePageV3InputSchema>;
  readonly normalizedInput: NodexAgentTransferCommand["input"];
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
            readonly authorization: NodexAgentTransferAuthorizationEvidence;
          };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export type ExecuteNodexAgentDuplicatePageResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly output: z.infer<typeof DuplicatePageV3OutputSchema>;
        readonly duplicate: boolean;
        readonly documentCommits: readonly RelocationDocumentCommit[];
        readonly affectedDatabaseBlockIds: readonly string[];
        readonly changeLogSeq: number;
      };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export interface NodexAgentMovePageTransferStep {
  readonly pageId: string;
  readonly sourceProjectId?: string;
  readonly targetProjectId?: string;
  readonly normalizedInput: NodexAgentTransferCommand["input"];
  readonly transfer: NodexAgentTransferCommand["transfer"] | null;
  readonly rehome?: {
    readonly operationId: string;
    readonly callIdentity: string;
    readonly requestHash: string;
    readonly actorProjectId: string;
    readonly sourceProjectId: string;
    readonly targetProjectId: string;
    readonly libraryId: string;
    readonly storeEpoch: string;
    readonly rootPageIds: readonly string[];
    readonly blockIds: readonly string[];
    readonly documentIds: readonly string[];
    readonly databaseBlockIds: readonly string[];
    readonly databaseViewIds: readonly string[];
  };
}

export interface NodexAgentMovePagesCommand extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly requestHash: string;
  readonly mutationId: string;
  readonly storeEpoch: string;
  readonly input: z.infer<typeof MovePagesV3InputSchema>;
  readonly destination: PreparedNodexAgentCreateDestination;
  readonly transfers: readonly NodexAgentMovePageTransferStep[];
  readonly leaseDocuments: readonly NodexAgentLeaseDocument[];
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
            readonly authorization: NodexAgentTransferAuthorizationEvidence;
          };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export type ExecuteNodexAgentMovePagesResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly output: z.infer<typeof MovePagesV3OutputSchema>;
        readonly duplicate: boolean;
        readonly documentCommits: readonly RelocationDocumentCommit[];
        readonly affectedDatabaseBlockIds: readonly string[];
        readonly changeLogSeq: number;
      };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };
