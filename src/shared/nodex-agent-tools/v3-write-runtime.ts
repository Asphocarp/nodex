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
import type { z } from "zod";

export type NodexAgentCardUpdateTool = "update_card" | "advanced_update_card";

export type PrepareNodexAgentCardUpdateRequest = NodexAgentCallIdentity & {
  readonly projectId: string;
} & (
  | {
      readonly tool: "update_card";
      readonly input: z.infer<typeof UpdateCardV3InputSchema>;
    }
  | {
      readonly tool: "advanced_update_card";
      readonly input: z.infer<typeof AdvancedUpdateCardV3InputSchema>;
    }
);

export type NodexAgentCardUpdateOutput =
  | z.infer<typeof UpdateCardV3OutputSchema>
  | z.infer<typeof AdvancedUpdateCardV3OutputSchema>;

export type PrepareNodexAgentCardUpdateResult =
  | {
      readonly ok: true;
      readonly value:
        | { readonly kind: "completed"; readonly output: NodexAgentCardUpdateOutput }
        | {
            readonly kind: "prepared";
            readonly mutation: DocumentMutationRequest;
            readonly effects: AgentDocumentEditEffects;
            readonly targetMarkdown: string;
          };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export interface CompleteNodexAgentCardUpdateRequest extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly tool: NodexAgentCardUpdateTool;
  readonly cardId: string;
  readonly result: DocumentOperationResult;
}

export type CompleteNodexAgentCardUpdateResult =
  | { readonly ok: true; readonly output: NodexAgentCardUpdateOutput }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export interface PreparedNodexAgentCreateCardV3 {
  readonly input: CreateInput;
  readonly cardId: string;
  readonly bodyBlockIds: readonly string[];
  readonly primaryMembershipId: string;
  readonly targetMembershipId: string;
}

export interface NodexAgentCreateCardsCommand extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly requestHash: string;
  readonly mutationId: string;
  readonly storeEpoch: string;
  readonly input: z.infer<typeof CreateCardsV3InputSchema>;
  readonly destination: PreparedNodexAgentCreateDestination;
  readonly cards: readonly PreparedNodexAgentCreateCardV3[];
}

export interface PrepareNodexAgentCreateCardsRequest extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly input: z.infer<typeof CreateCardsV3InputSchema>;
}

export type PrepareNodexAgentCreateCardsResult =
  | {
      readonly ok: true;
      readonly value:
        | {
            readonly kind: "completed";
            readonly output: z.infer<typeof CreateCardsV3OutputSchema>;
          }
        | {
            readonly kind: "prepared";
            readonly command: NodexAgentCreateCardsCommand;
            readonly leaseDocuments: readonly NodexAgentLeaseDocument[];
            readonly previews: readonly {
              readonly cardId: string;
              readonly title: string;
              readonly bodyBlockCount: number;
              readonly targetMarkdown: string;
            }[];
          };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export type ExecuteNodexAgentCreateCardsResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly output: z.infer<typeof CreateCardsV3OutputSchema>;
        readonly duplicate: boolean;
        readonly documentCommits: readonly RelocationDocumentCommit[];
        readonly affectedDatabaseBlockIds: readonly string[];
        readonly changeLogSeq: number;
      };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export interface NodexAgentDuplicateCardCommand extends Omit<
  NodexAgentTransferCommand,
  "input"
> {
  readonly input: z.infer<typeof DuplicateCardV3InputSchema>;
  readonly normalizedInput: NodexAgentTransferCommand["input"];
}

export interface PrepareNodexAgentDuplicateCardRequest extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly input: z.infer<typeof DuplicateCardV3InputSchema>;
}

export type PrepareNodexAgentDuplicateCardResult =
  | {
      readonly ok: true;
      readonly value:
        | {
            readonly kind: "completed";
            readonly output: z.infer<typeof DuplicateCardV3OutputSchema>;
          }
        | {
            readonly kind: "prepared";
            readonly command: NodexAgentDuplicateCardCommand;
            readonly authorization: NodexAgentTransferAuthorizationEvidence;
          };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export type ExecuteNodexAgentDuplicateCardResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly output: z.infer<typeof DuplicateCardV3OutputSchema>;
        readonly duplicate: boolean;
        readonly documentCommits: readonly RelocationDocumentCommit[];
        readonly affectedDatabaseBlockIds: readonly string[];
        readonly changeLogSeq: number;
      };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export interface NodexAgentMoveCardTransferStep {
  readonly cardId: string;
  readonly normalizedInput: NodexAgentTransferCommand["input"];
  readonly transfer: NodexAgentTransferCommand["transfer"];
}

export interface NodexAgentMoveCardsCommand extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly requestHash: string;
  readonly mutationId: string;
  readonly storeEpoch: string;
  readonly input: z.infer<typeof MoveCardsV3InputSchema>;
  readonly destination: PreparedNodexAgentCreateDestination;
  readonly transfers: readonly NodexAgentMoveCardTransferStep[];
  readonly leaseDocuments: readonly NodexAgentLeaseDocument[];
}

export interface PrepareNodexAgentMoveCardsRequest extends NodexAgentCallIdentity {
  readonly projectId: string;
  readonly input: z.infer<typeof MoveCardsV3InputSchema>;
}

export type PrepareNodexAgentMoveCardsResult =
  | {
      readonly ok: true;
      readonly value:
        | {
            readonly kind: "completed";
            readonly output: z.infer<typeof MoveCardsV3OutputSchema>;
          }
        | {
            readonly kind: "prepared";
            readonly command: NodexAgentMoveCardsCommand;
            readonly authorization: NodexAgentTransferAuthorizationEvidence;
          };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };

export type ExecuteNodexAgentMoveCardsResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly output: z.infer<typeof MoveCardsV3OutputSchema>;
        readonly duplicate: boolean;
        readonly documentCommits: readonly RelocationDocumentCommit[];
        readonly affectedDatabaseBlockIds: readonly string[];
        readonly changeLogSeq: number;
      };
    }
  | { readonly ok: false; readonly error: ToolFailure["error"] };
