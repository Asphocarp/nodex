import type {
  DocumentMutationRequest,
  DocumentOperationCommandResult,
} from "../../shared/block-documents/document-operations";
import type {
  CompleteNodexAgentPageUpdateRequest,
  CompleteNodexAgentPageUpdateResult,
  ExecuteNodexAgentCreatePagesResult,
  ExecuteNodexAgentDuplicatePageResult,
  ExecuteNodexAgentMovePagesResult,
  NodexAgentCreatePagesCommand,
  NodexAgentDuplicatePageCommand,
  NodexAgentLeaseDocument,
  NodexAgentMovePagesCommand,
  NodexAgentV3ReadCommandResult,
  NodexAgentV3ReadRequest,
  PrepareNodexAgentCreatePagesRequest,
  PrepareNodexAgentCreatePagesResult,
  PrepareNodexAgentDuplicatePageRequest,
  PrepareNodexAgentDuplicatePageResult,
  PrepareNodexAgentMovePagesRequest,
  PrepareNodexAgentMovePagesResult,
  PrepareNodexAgentPageUpdateRequest,
  PrepareNodexAgentPageUpdateResult,
} from "../../shared/nodex-agent-tools";

export interface NodexAgentMutationEnvelope<Result> {
  readonly result: Result;
  readonly events: readonly unknown[];
  readonly metrics: {
    readonly mutationId: string;
    readonly queueWaitMs: number;
    readonly workerDurationMs: number;
    readonly transactionMs: number;
    readonly eventCount: number;
  };
}

export interface NodexAgentV3Writer {
  readNodexAgentV3Tool(
    request: NodexAgentV3ReadRequest,
  ): Promise<NodexAgentMutationEnvelope<NodexAgentV3ReadCommandResult>>;
  prepareNodexAgentPageUpdate(
    request: PrepareNodexAgentPageUpdateRequest,
  ): Promise<NodexAgentMutationEnvelope<PrepareNodexAgentPageUpdateResult>>;
  completeNodexAgentPageUpdate(
    request: CompleteNodexAgentPageUpdateRequest,
  ): Promise<NodexAgentMutationEnvelope<CompleteNodexAgentPageUpdateResult>>;
  prepareNodexAgentCreatePages(
    request: PrepareNodexAgentCreatePagesRequest,
  ): Promise<NodexAgentMutationEnvelope<PrepareNodexAgentCreatePagesResult>>;
  prepareNodexAgentDuplicatePage(
    request: PrepareNodexAgentDuplicatePageRequest,
  ): Promise<NodexAgentMutationEnvelope<PrepareNodexAgentDuplicatePageResult>>;
  prepareNodexAgentMovePages(
    request: PrepareNodexAgentMovePagesRequest,
  ): Promise<NodexAgentMutationEnvelope<PrepareNodexAgentMovePagesResult>>;
}

export interface NodexAgentV3DocumentHub {
  applyDocumentMutation(
    request: DocumentMutationRequest,
    authority?: unknown,
  ): Promise<DocumentOperationCommandResult>;
  executeNodexAgentCreatePages(
    command: NodexAgentCreatePagesCommand,
    leaseDocuments: readonly NodexAgentLeaseDocument[],
  ): Promise<ExecuteNodexAgentCreatePagesResult>;
  executeNodexAgentDuplicatePage(
    command: NodexAgentDuplicatePageCommand,
  ): Promise<ExecuteNodexAgentDuplicatePageResult>;
  executeNodexAgentMovePages(
    command: NodexAgentMovePagesCommand,
  ): Promise<ExecuteNodexAgentMovePagesResult>;
}
