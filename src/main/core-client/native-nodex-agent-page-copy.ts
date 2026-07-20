import type { components } from "@nodex/core-protocol";
import { createHash } from "node:crypto";
import type {
  ExecuteNodexAgentDuplicatePageResult,
  NodexAgentDuplicatePageCommand,
  PrepareNodexAgentDuplicatePageRequest,
  PrepareNodexAgentDuplicatePageResult,
} from "../../shared/nodex-agent-tools";
import { DuplicatePageV3OutputSchema } from "../../shared/nodex-agent-tools/v3-write-schemas";
import { TransferBlocksInputSchema } from "../../shared/nodex-agent-tools/write-schemas";
import type { BlockMutationEnvelope } from "../block-mutation-writer";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { toCoreAgentExecutionAuthorization } from "./desktop-nodex-agent-resource-authority";
import { mapNativeNodexAgentCoreError } from "./native-nodex-agent-page-update";

type CoreCopyRequest = components["schemas"]["LibraryAgentPageCopyRequest"];
type CoreCopyResult = components["schemas"]["LibraryAgentPageCopyResult"];
type CoreCopyPreparation = components["schemas"]["LibraryAgentPageCopyPreparation"];

const MAX_PENDING_NATIVE_PAGE_COPIES = 1_024;

interface PendingNativePageCopy {
  readonly request: PrepareNodexAgentDuplicatePageRequest;
  readonly operationId: string;
  readonly token: string;
  readonly coreRequest: CoreCopyRequest;
  readonly leaseDocuments: NodexAgentDuplicatePageCommand["leaseDocuments"];
}

type AgentSiblingAnchor =
  | { readonly kind: "start" | "end" }
  | { readonly kind: "before" | "after"; readonly blockId: string };

const envelope = <Result>(
  result: Result,
  mutationId: string,
): BlockMutationEnvelope<Result> => ({
  result,
  events: [],
  metrics: {
    mutationId,
    queueWaitMs: 0,
    workerDurationMs: 0,
    transactionMs: 0,
    eventCount: 0,
  },
});

const operationIdFor = (
  request: Pick<PrepareNodexAgentDuplicatePageRequest, "threadId" | "callId">,
): string =>
  `nodex-agent-duplicate:${createHash("sha256").update(JSON.stringify([
    request.threadId,
    request.callId,
    "duplicate_page",
  ])).digest("hex")}`;

const siblingAnchor = (
  anchor: AgentSiblingAnchor | undefined,
): components["schemas"]["LibraryAgentSiblingAnchor"] | null => {
  if (!anchor) return null;
  if ("blockId" in anchor) {
    return { kind: anchor.kind, block_id: anchor.blockId };
  }
  return { kind: anchor.kind };
};

const coreRequest = (
  request: PrepareNodexAgentDuplicatePageRequest,
): CoreCopyRequest => {
  const destination = request.input.destination;
  if (destination.kind === "library") {
    return {
      source_page_id: request.input.pageId,
      destination: {
        kind: "library",
        at: siblingAnchor(destination.at),
      },
      include_block_map: request.input.return?.includes("block_map") ?? false,
      include_etags: request.input.return?.includes("etags") ?? false,
    };
  }
  if (destination.kind === "page") {
    return {
      source_page_id: request.input.pageId,
      destination: {
        kind: "page",
        page_id: destination.pageId,
        at: siblingAnchor(destination.at),
      },
      include_block_map: request.input.return?.includes("block_map") ?? false,
      include_etags: request.input.return?.includes("etags") ?? false,
    };
  }
  return {
    source_page_id: request.input.pageId,
    destination: {
      kind: "data_source",
      data_source_id: destination.dataSourceId,
      values: (destination.values ?? []).map((value) => ({
        property_id: value.propertyId,
        value: value.value,
      })),
      view_id: destination.view?.viewId ?? null,
      group_key: destination.view?.groupKey ?? null,
      at: siblingAnchor(destination.view?.at),
    },
    include_block_map: request.input.return?.includes("block_map") ?? false,
    include_etags: request.input.return?.includes("etags") ?? false,
  };
};

const location = (value: CoreCopyResult["location"]) => {
  if (value.kind === "library") {
    return { kind: "library" as const, libraryId: value.library_id };
  }
  if (value.kind === "page") {
    return { kind: "page" as const, pageId: value.page_id };
  }
  return { kind: "data_source" as const, dataSourceId: value.data_source_id };
};

const output = (
  result: CoreCopyResult,
  includeBlockMap: boolean,
) => DuplicatePageV3OutputSchema.parse({
  data: {
    sourcePageId: result.source_page_id,
    pageId: result.page_id,
    location: location(result.location),
    bodyBlocksCreated: result.body_blocks_created,
    ...(includeBlockMap && result.block_map
      ? { blockMap: result.block_map }
      : {}),
    ...(result.etags
      ? { etags: { title: result.etags.title, body: result.etags.body } }
      : {}),
  },
});

const documentCommits = (
  result: CoreCopyResult,
) => result.document_commits.map((commit) => ({
  documentId: commit.document_id,
  generation: commit.generation,
  baseHeadSeq: commit.base_head_seq,
  headSeq: commit.head_seq,
  updateId: commit.update_id,
  update: new Uint8Array(commit.update),
  stateVector: new Uint8Array(commit.state_vector),
}));

const hasExactLeaseDocuments = (
  expected: NodexAgentDuplicatePageCommand["leaseDocuments"],
  actual: NodexAgentDuplicatePageCommand["leaseDocuments"],
): boolean => expected.length === actual.length
  && expected.every((head, index) => {
    const candidate = actual[index];
    return candidate?.documentId === head.documentId
      && candidate.generation === head.generation
      && candidate.expectedHeadSeq === head.expectedHeadSeq;
  });

const preparedDestination = (
  request: PrepareNodexAgentDuplicatePageRequest,
  preparation: CoreCopyPreparation,
): NodexAgentDuplicatePageCommand["destination"] => {
  const destination = preparation.destination;
  const destinationProjectId = preparation.destination_project_id;
  if (!destination) {
    throw new Error("Core Agent Page copy preparation omitted its destination");
  }
  if (!destinationProjectId) {
    throw new Error("Core Agent Page copy preparation omitted its target Project");
  }
  if (destination.kind === "library") {
    return {
      kind: "space",
      contentProjectId: destinationProjectId,
      ...(destination.before ? { beforeBlockId: destination.before.block_id } : {}),
    };
  }
  if (destination.kind === "page") {
    const target = preparation.destination_document;
    if (!target) {
      throw new Error("Core Agent Page copy preparation omitted its target Document");
    }
    return {
      kind: "document",
      contentProjectId: destinationProjectId,
      documentId: target.document_id,
      generation: target.generation,
      expectedHeadSeq: target.expected_head_seq,
      ...(destination.before ? { beforeBlockId: destination.before.block_id } : {}),
    };
  }
  const databaseId = preparation.destination_database_id;
  if (!databaseId) {
    throw new Error("Core Agent Page copy preparation omitted its target Database");
  }
  return {
    kind: "database",
    contentProjectId: destinationProjectId,
    databaseBlockId: databaseId,
    dataSourceId: destination.data_source_id,
    schemaRevision: destination.expected_data_source_revision,
    ...(destination.view
      ? {
          view: {
            viewId: destination.view.view_id,
            viewRevision: destination.view.expected_view_revision,
            groupKey: destination.view.group_key ?? null,
            ...(destination.view.before
              ? { beforePageId: destination.view.before.page_id }
              : {}),
          },
        }
      : {}),
  };
};

const normalizedInput = (
  request: PrepareNodexAgentDuplicatePageRequest,
  preparation: CoreCopyPreparation,
): NodexAgentDuplicatePageCommand["normalizedInput"] => {
  const destination = request.input.destination;
  if (destination.kind === "library") {
    return TransferBlocksInputSchema.parse({
      mode: "copy",
      blockIds: [request.input.pageId],
      destination: { kind: "space", ...(destination.at ? { at: destination.at } : {}) },
      return: { blockMap: request.input.return?.includes("block_map") ?? false },
    });
  }
  if (destination.kind === "page") {
    const target = preparation.destination_document;
    if (!target) {
      throw new Error("Core Agent Page copy preparation omitted its target Document");
    }
    return TransferBlocksInputSchema.parse({
      mode: "copy",
      blockIds: [request.input.pageId],
      destination: {
        kind: "document",
        documentId: target.document_id,
        at: destination.at?.kind === "before" || destination.at?.kind === "after"
          ? { kind: destination.at.kind, blockId: destination.at.blockId }
          : { kind: destination.at?.kind ?? "end" },
      },
      return: { blockMap: request.input.return?.includes("block_map") ?? false },
    });
  }
  const databaseId = preparation.destination_database_id;
  if (!databaseId) {
    throw new Error("Core Agent Page copy preparation omitted its target Database");
  }
  return TransferBlocksInputSchema.parse({
    mode: "copy",
    blockIds: [request.input.pageId],
    destination: {
      kind: "database",
      databaseBlockId: databaseId,
      values: destination.values,
      ...(destination.view
        ? {
            view: {
              viewId: destination.view.viewId,
              groupKey: destination.view.groupKey,
              at: destination.view.at,
            },
          }
        : {}),
    },
    return: { blockMap: request.input.return?.includes("block_map") ?? false },
  });
};

export class NativeNodexAgentPageCopyRuntime {
  private readonly pending = new Map<string, PendingNativePageCopy>();

  constructor(private readonly runtime: RustDataAuthorityRuntime) {}

  async prepare(
    request: PrepareNodexAgentDuplicatePageRequest,
  ): Promise<BlockMutationEnvelope<PrepareNodexAgentDuplicatePageResult>> {
    const operationId = operationIdFor(request);
    try {
      if (!request.authority) {
        throw new Error("Native Agent Page copy requires frozen Turn authority");
      }
      const copyRequest = coreRequest(request);
      const snapshot = await this.runtime.clientForProject(request.projectId).libraryRead({
        kind: "prepare_agent_page_copy",
        operation_id: operationId,
        store_epoch: request.authority.storeEpoch,
        authorization: toCoreAgentExecutionAuthorization(
          this.runtime.rootClient.handshake.profile_id,
          request.authority,
          request.callId,
          request.resourceAccess,
        ),
        request: copyRequest,
      });
      if (snapshot.value.kind !== "agent_page_copy_preparation") {
        throw new Error("Core returned the wrong Agent Page copy preparation variant");
      }
      const preparation = snapshot.value.value;
      if (preparation.preparation.state === "committed_replay") {
        const committed = preparation.committed?.value.agent_page_copy;
        if (!committed) throw new Error("Core Agent Page copy replay omitted its result");
        this.pending.delete(operationId);
        return envelope({
          ok: true,
          value: {
            kind: "completed",
            output: output(
              committed,
              request.input.return?.includes("block_map") ?? false,
            ),
          },
        }, operationId);
      }
      const token = preparation.preparation.token;
      if (!token) throw new Error("Core Agent Page copy preparation omitted its token");
      if (!this.pending.has(operationId)
        && this.pending.size >= MAX_PENDING_NATIVE_PAGE_COPIES) {
        throw new Error("Native Agent Page copy preparation capacity is exhausted");
      }
      const leaseDocuments = preparation.document_heads.map((head) => ({
        documentId: head.document_id,
        generation: head.generation,
        expectedHeadSeq: head.expected_head_seq,
      }));
      this.pending.set(operationId, {
        request,
        operationId,
        token,
        coreRequest: copyRequest,
        leaseDocuments,
      });
      const command: NodexAgentDuplicatePageCommand = {
        ...request,
        requestHash: operationId,
        mutationId: operationId,
        storeEpoch: request.authority.storeEpoch,
        input: request.input,
        normalizedInput: normalizedInput(request, preparation),
        destination: preparedDestination(request, preparation),
        leaseDocuments,
        canonical: { newPageId: preparation.page_id },
      };
      return envelope({
        ok: true,
        value: {
          kind: "prepared",
          command,
          authorization: {
            roots: {
              [request.input.pageId]: {
                type: "page",
                transformation: "preserved",
              },
            },
            documentIds: leaseDocuments.map((head) => head.documentId),
          },
        },
      }, operationId);
    } catch (error) {
      return envelope({ ok: false, error: mapNativeNodexAgentCoreError(error) }, operationId);
    }
  }

  async execute(
    command: NodexAgentDuplicatePageCommand,
  ): Promise<ExecuteNodexAgentDuplicatePageResult> {
    const pending = this.pending.get(command.mutationId);
    if (!pending
      || pending.request.projectId !== command.projectId
      || pending.request.callId !== command.callId
      || pending.request.threadId !== command.threadId
      || pending.request.authority?.storeEpoch !== command.storeEpoch
      || !hasExactLeaseDocuments(pending.leaseDocuments, command.leaseDocuments)) {
      return {
        ok: false,
        error: {
          code: "idempotency_collision",
          message: "Native Agent Page copy has no matching preparation",
          retryable: false,
          recovery: "none",
        },
      };
    }
    const authority = pending.request.authority;
    if (!authority) {
      return {
        ok: false,
        error: {
          code: "authorization_denied",
          message: "Native Agent Page copy lost its frozen Turn authority",
          retryable: false,
          recovery: "start_new_task",
        },
      };
    }
    try {
      const committed = await this.runtime.clientForProject(pending.request.projectId)
        .libraryApply({
          operationId: pending.operationId,
          intent: {
            kind: "execute_prepared_agent_page_copy",
            authorization: {
              authorization: toCoreAgentExecutionAuthorization(
                this.runtime.rootClient.handshake.profile_id,
                authority,
                pending.request.callId,
                pending.request.resourceAccess,
              ),
              token: pending.token,
            },
            request: pending.coreRequest,
          },
        });
      const result = committed.value.agent_page_copy;
      if (!result) throw new Error("Core Agent Page copy commit omitted its result");
      this.pending.delete(command.mutationId);
      return {
        ok: true,
        value: {
          output: output(
            result,
            pending.request.input.return?.includes("block_map") ?? false,
          ),
          duplicate: committed.receipt.duplicate,
          documentCommits: documentCommits(result),
          affectedDatabaseBlockIds: [...result.affected_database_ids],
          changeLogSeq: committed.event_sequence,
        },
      };
    } catch (error) {
      return { ok: false, error: mapNativeNodexAgentCoreError(error) };
    }
  }
}
