import type { components } from "@nodex/core-protocol";
import { createHash } from "node:crypto";
import type {
  ExecuteNodexAgentMovePagesResult,
  NodexAgentDocumentHead,
  NodexAgentMovePagesCommand,
  PrepareNodexAgentMovePagesRequest,
  PrepareNodexAgentMovePagesResult,
} from "../../shared/nodex-agent-tools";
import { MovePagesV3OutputSchema } from "../../shared/nodex-agent-tools/v3-write-schemas";
import { TransferBlocksInputSchema } from "../../shared/nodex-agent-tools/write-schemas";
import type { NodexAgentMutationEnvelope } from "../agent-tools/dynamic-service-v3-port";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { toCoreAgentExecutionAuthorization } from "./desktop-nodex-agent-resource-authority";
import {
  hasExactNativeAgentDocumentHeads,
  nativeAgentDocumentCommits,
  nativeAgentDocumentHeads,
  nativeAgentPageLocation,
  preparedAgentPageDestination,
  toCoreAgentPageDestination,
} from "./native-nodex-agent-page-destination";
import { mapNativeNodexAgentCoreError } from "./native-nodex-agent-page-update";

type CoreMoveRequest = components["schemas"]["LibraryAgentMovePagesRequest"];
type CoreMoveResult = components["schemas"]["LibraryAgentMovePagesResult"];
type CoreMovePreparation = components["schemas"]["LibraryAgentMovePagesPreparation"];
type CoreMovePagePreparation = components["schemas"]["LibraryAgentMovePagePreparation"];

const MAX_PENDING_NATIVE_PAGE_MOVES = 1_024;

interface PendingNativePageMove {
  readonly request: PrepareNodexAgentMovePagesRequest;
  readonly operationId: string;
  readonly token: string;
  readonly coreRequest: CoreMoveRequest;
  readonly documentHeads: readonly NodexAgentDocumentHead[];
}

const envelope = <Result>(
  result: Result,
  mutationId: string,
): NodexAgentMutationEnvelope<Result> => ({
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
  request: Pick<PrepareNodexAgentMovePagesRequest, "threadId" | "callId">,
): string =>
  `nodex-agent-move-pages:${createHash("sha256").update(JSON.stringify([
    request.threadId,
    request.callId,
    "move_pages",
  ])).digest("hex")}`;

const coreRequest = (
  request: PrepareNodexAgentMovePagesRequest,
): CoreMoveRequest => ({
  page_ids: [...request.input.pageIds],
  destination: toCoreAgentPageDestination(request.input.destination),
});

const output = (result: CoreMoveResult) => MovePagesV3OutputSchema.parse({
  data: {
    pages: result.pages.map((page) => ({
      pageId: page.page_id,
      location: nativeAgentPageLocation(page.location),
    })),
    moved: result.pages.length,
  },
});

const sourceInput = (page: CoreMovePagePreparation) => {
  if (page.source.kind === "library") return { kind: "space" as const };
  if (page.source.kind === "data_source") {
    if (!page.source_database_id) {
      throw new Error(`Core Agent Page move omitted source Database for ${page.page_id}`);
    }
    return { kind: "database" as const, databaseBlockId: page.source_database_id };
  }
  const documentId = page.source.kind === "document"
    ? page.source.document_id
    : page.source_document_id;
  if (!documentId) {
    throw new Error(`Core Agent Page move omitted source Document for ${page.page_id}`);
  }
  return { kind: "document" as const, documentId };
};

const destinationInput = (
  request: PrepareNodexAgentMovePagesRequest,
  preparation: CoreMovePreparation,
) => {
  const destination = request.input.destination;
  if (destination.kind === "library") {
    return {
      kind: "space" as const,
      ...(destination.at ? { at: destination.at } : {}),
    };
  }
  if (destination.kind === "page") {
    const document = preparation.destination_document;
    if (!document) throw new Error("Core Agent Page move omitted its target Document");
    return {
      kind: "document" as const,
      documentId: document.document_id,
      at: destination.at ?? { kind: "end" as const },
    };
  }
  const databaseId = preparation.destination_database_id;
  if (!databaseId) throw new Error("Core Agent Page move omitted its target Database");
  return {
    kind: "database" as const,
    databaseBlockId: databaseId,
    ...(destination.values ? { values: destination.values } : {}),
    ...(destination.view ? { view: destination.view } : {}),
  };
};

const command = (
  request: PrepareNodexAgentMovePagesRequest,
  operationId: string,
  preparation: CoreMovePreparation,
): NodexAgentMovePagesCommand => {
  if (!request.authority) {
    throw new Error("Native Agent Page movement requires frozen Turn authority");
  }
  if (preparation.pages.length !== request.input.pageIds.length) {
    throw new Error("Core Agent Page movement returned a divergent Page batch");
  }
  const destination = preparedAgentPageDestination(preparation);
  const normalizedDestination = destinationInput(request, preparation);
  return {
    ...request,
    requestHash: operationId,
    mutationId: operationId,
    storeEpoch: request.authority.storeEpoch,
    input: request.input,
    destination,
    transfers: preparation.pages.map((page) => ({
      pageId: page.page_id,
      sourceProjectId: page.source_project_id,
      targetProjectId: page.target_project_id,
      normalizedInput: TransferBlocksInputSchema.parse({
        mode: "move",
        blockIds: [page.page_id],
        from: sourceInput(page),
        destination: normalizedDestination,
      }),
      transfer: null,
    })),
    documentHeads: nativeAgentDocumentHeads(preparation.document_heads),
  };
};

export class NativeNodexAgentPageMoveRuntime {
  private readonly pending = new Map<string, PendingNativePageMove>();

  constructor(private readonly runtime: RustDataAuthorityRuntime) {}

  async prepare(
    request: PrepareNodexAgentMovePagesRequest,
  ): Promise<NodexAgentMutationEnvelope<PrepareNodexAgentMovePagesResult>> {
    const operationId = operationIdFor(request);
    try {
      if (!request.authority) {
        throw new Error("Native Agent Page movement requires frozen Turn authority");
      }
      const moveRequest = coreRequest(request);
      const snapshot = await this.runtime.clientForProject(request.projectId).libraryRead({
        kind: "prepare_agent_move_pages",
        operation_id: operationId,
        store_epoch: request.authority.storeEpoch,
        authorization: toCoreAgentExecutionAuthorization(
          this.runtime.identity.profileId,
          request.authority,
          request.callId,
          request.resourceAccess,
        ),
        request: moveRequest,
      });
      if (snapshot.value.kind !== "agent_move_pages_preparation") {
        throw new Error("Core returned the wrong Agent Page-move preparation variant");
      }
      const preparation = snapshot.value.value;
      if (preparation.preparation.state === "committed_replay") {
        const committed = preparation.committed?.value.agent_move_pages;
        if (!committed) throw new Error("Core Agent Page-move replay omitted its result");
        this.pending.delete(operationId);
        return envelope({
          ok: true,
          value: { kind: "completed", output: output(committed) },
        }, operationId);
      }
      const token = preparation.preparation.token;
      if (!token) throw new Error("Core Agent Page-move preparation omitted its token");
      if (!this.pending.has(operationId)
        && this.pending.size >= MAX_PENDING_NATIVE_PAGE_MOVES) {
        throw new Error("Native Agent Page-move preparation capacity is exhausted");
      }
      const documentHeads = nativeAgentDocumentHeads(preparation.document_heads);
      this.pending.set(operationId, {
        request,
        operationId,
        token,
        coreRequest: moveRequest,
        documentHeads,
      });
      return envelope({
        ok: true,
        value: {
          kind: "prepared",
          command: command(request, operationId, preparation),
          authorization: {
            roots: Object.fromEntries(request.input.pageIds.map((pageId) => [
              pageId,
              { type: "page" as const, transformation: "preserved" as const },
            ])),
            documentIds: documentHeads.map((head) => head.documentId),
          },
        },
      }, operationId);
    } catch (error) {
      return envelope({ ok: false, error: mapNativeNodexAgentCoreError(error) }, operationId);
    }
  }

  async execute(command: NodexAgentMovePagesCommand): Promise<ExecuteNodexAgentMovePagesResult> {
    const pending = this.pending.get(command.mutationId);
    if (!pending
      || pending.request.projectId !== command.projectId
      || pending.request.callId !== command.callId
      || pending.request.threadId !== command.threadId
      || pending.request.authority?.storeEpoch !== command.storeEpoch
      || !hasExactNativeAgentDocumentHeads(
        pending.documentHeads,
        command.documentHeads,
      )) {
      return {
        ok: false,
        error: {
          code: "idempotency_collision",
          message: "Native Agent Page movement has no matching preparation",
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
          message: "Native Agent Page movement lost its frozen Turn authority",
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
            kind: "execute_prepared_agent_move_pages",
            authorization: {
              authorization: toCoreAgentExecutionAuthorization(
                this.runtime.identity.profileId,
                authority,
                pending.request.callId,
                pending.request.resourceAccess,
              ),
              token: pending.token,
            },
            request: pending.coreRequest,
          },
        });
      const result = committed.value.agent_move_pages;
      if (!result) throw new Error("Core Agent Page-move commit omitted its result");
      this.pending.delete(command.mutationId);
      return {
        ok: true,
        value: {
          output: output(result),
          duplicate: committed.receipt.duplicate,
          documentCommits: nativeAgentDocumentCommits(result.document_commits),
          affectedDatabaseBlockIds: [...result.affected_database_ids],
          commitSeq:
            committed.commit_seq
            ?? committed.local_commit?.commit_seq
            ?? committed.event_sequence,
        },
      };
    } catch (error) {
      return { ok: false, error: mapNativeNodexAgentCoreError(error) };
    }
  }
}
