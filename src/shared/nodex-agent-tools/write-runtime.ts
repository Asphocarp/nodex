import type {
  DocumentMutationRequest,
  DocumentOperationResult,
} from "../block-documents/document-operations";
import type { RelocationDocumentCommit } from "../block-documents/contracts";
import type {
  BlockTransferRequest,
} from "../block-transfer";
import type { DatabaseMutationRequest } from "../database-kernel";
import type { ToolFailure } from "./base-schemas";
import type { AgentDocumentEditEffects } from "./document-edit-compiler";
import type {
  CreateInput,
  CreateOutput,
  EditDocumentInput,
  EditDocumentOutput,
  EditDatabaseInput,
  EditDatabaseOutput,
  TransferBlocksInput,
  TransferBlocksOutput,
} from "./write-schemas";
import type { FrozenNodexAgentTurnAuthority } from "../nodex-agent-authority";

export interface NodexAgentCallIdentity {
  readonly threadId: string;
  readonly callId: string;
  readonly authority?: FrozenNodexAgentTurnAuthority;
}

export type NodexAgentDocumentEditTool =
  | "edit_document"
  | "update_page"
  | "advanced_update_page";

export interface PrepareNodexAgentDocumentEditRequest extends NodexAgentCallIdentity {
  readonly tool: NodexAgentDocumentEditTool;
  readonly projectId: string;
  readonly input: EditDocumentInput;
}

export type PrepareNodexAgentDocumentEditResult =
  | {
      readonly ok: true;
      readonly value:
        | { readonly kind: "completed"; readonly output: EditDocumentOutput }
        | {
            readonly kind: "prepared";
            readonly mutation: DocumentMutationRequest;
            readonly effects: AgentDocumentEditEffects;
            readonly targetNfm: string;
          };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export interface CompleteNodexAgentDocumentEditRequest extends NodexAgentCallIdentity {
  readonly tool: NodexAgentDocumentEditTool;
  readonly projectId: string;
  readonly result: DocumentOperationResult;
}

export type CompleteNodexAgentDocumentEditResult =
  | { readonly ok: true; readonly output: EditDocumentOutput }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export interface NodexAgentLeaseDocument {
  readonly documentId: string;
  readonly generation: number;
  readonly expectedHeadSeq: number;
}

export type PreparedNodexAgentCreateDestination =
  | {
      readonly kind: "space";
      readonly contentProjectId?: string;
      readonly beforeBlockId?: string;
    }
  | {
      readonly kind: "document";
      readonly contentProjectId?: string;
      readonly documentId: string;
      readonly generation: number;
      readonly expectedHeadSeq: number;
      readonly parentBlockId?: string;
      readonly beforeBlockId?: string;
    }
  | {
      readonly kind: "database";
      readonly contentProjectId?: string;
      readonly databaseBlockId: string;
      readonly schemaRevision: number;
      readonly view?: {
        readonly viewId: string;
        readonly viewRevision: number;
        readonly groupKey: string | null;
        readonly beforePageId?: string;
      };
    };

export interface NodexAgentCreatePageCommand extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly requestHash: string;
  readonly mutationId: string;
  readonly storeEpoch: string;
  readonly input: CreateInput;
  readonly pageId: string;
  readonly bodyBlockIds: readonly string[];
  readonly primaryMembershipId: string;
  readonly targetMembershipId: string;
  readonly destination: PreparedNodexAgentCreateDestination;
}

export interface PrepareNodexAgentCreateRequest extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly input: CreateInput;
}

export type PrepareNodexAgentCreateResult =
  | {
      readonly ok: true;
      readonly value:
        | { readonly kind: "completed"; readonly output: CreateOutput }
        | {
            readonly kind: "prepared";
            readonly command: NodexAgentCreatePageCommand;
            readonly leaseDocuments: readonly NodexAgentLeaseDocument[];
            readonly createdBodyBlockIds: readonly string[];
            readonly targetNfm: string;
          };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export type ExecuteNodexAgentCreateResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly output: CreateOutput;
        readonly duplicate: boolean;
        readonly documentCommits: readonly RelocationDocumentCommit[];
        readonly affectedDatabaseBlockIds: readonly string[];
        readonly changeLogSeq: number;
      };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export interface NodexAgentTransferCommand extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly requestHash: string;
  readonly mutationId: string;
  readonly storeEpoch: string;
  readonly input: TransferBlocksInput;
  readonly transfer: BlockTransferRequest;
  readonly destination: PreparedNodexAgentCreateDestination;
  readonly leaseDocuments: readonly NodexAgentLeaseDocument[];
}

export interface PrepareNodexAgentTransferRequest extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly input: TransferBlocksInput;
}

export interface NodexAgentTransferAuthorizationEvidence {
  readonly roots: Readonly<Record<string, {
    readonly type: string;
    readonly transformation: "preserved" | "promote" | "wrap";
    readonly wrapperReason?:
      | "type_requires_wrapper"
      | "unsupported_primary_content"
      | "unmapped_type_state";
  }>>;
  readonly documentIds: readonly string[];
}

export type PrepareNodexAgentTransferResult =
  | {
      readonly ok: true;
      readonly value:
        | { readonly kind: "completed"; readonly output: TransferBlocksOutput }
        | {
            readonly kind: "prepared";
            readonly command: NodexAgentTransferCommand;
            readonly leaseDocuments: readonly NodexAgentLeaseDocument[];
            readonly authorization: NodexAgentTransferAuthorizationEvidence;
          };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export type ExecuteNodexAgentTransferResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly output: TransferBlocksOutput;
        readonly duplicate: boolean;
        readonly documentCommits: readonly RelocationDocumentCommit[];
        readonly affectedDatabaseBlockIds: readonly string[];
        readonly changeLogSeq: number;
      };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export interface NodexAgentDatabaseEditCommand extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly requestHash: string;
  readonly mutationId: string;
  readonly storeEpoch: string;
  readonly input: EditDatabaseInput;
  readonly mutation: DatabaseMutationRequest;
}

export interface PrepareNodexAgentDatabaseEditRequest extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly input: EditDatabaseInput;
}

export type PrepareNodexAgentDatabaseEditResult =
  | {
      readonly ok: true;
      readonly value:
        | { readonly kind: "completed"; readonly output: EditDatabaseOutput }
        | {
            readonly kind: "prepared";
            readonly command: NodexAgentDatabaseEditCommand;
          };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export type ExecuteNodexAgentDatabaseEditResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly output: EditDatabaseOutput;
        readonly duplicate: boolean;
        readonly affectedDatabaseBlockIds: readonly string[];
        readonly changeLogSeq: number;
      };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };
