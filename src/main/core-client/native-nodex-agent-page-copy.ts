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
import type { NodexAgentMutationEnvelope } from "../agent-tools/dynamic-service-v3-port";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { toCoreAgentExecutionAuthorization } from "./desktop-nodex-agent-resource-authority";
import {
  hasExactNativeAgentDocumentHeads,
  nativeAgentDocumentCommits,
  nativeAgentPageLocation,
  nativeAgentDocumentHeads,
  preparedAgentPageDestination,
  toCoreAgentPageDestination,
} from "./native-nodex-agent-page-destination";
import { mapNativeNodexAgentCoreError } from "./native-nodex-agent-page-update";
import { applyResultCursor } from "./types";

type CoreCopyRequest = components["schemas"]["LibraryAgentPageCopyRequest"];
type CoreCopyResult = components["schemas"]["LibraryAgentPageCopyResult"];
type CoreCopyPreparation = components["schemas"]["LibraryAgentPageCopyPreparation"];

const MAX_PENDING_NATIVE_PAGE_COPIES = 1_024;

interface PendingNativePageCopy {
  readonly request: PrepareNodexAgentDuplicatePageRequest;
  readonly operationId: string;
  readonly token: string;
  readonly coreRequest: CoreCopyRequest;
  readonly documentHeads: NodexAgentDuplicatePageCommand["documentHeads"];
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
  request: Pick<PrepareNodexAgentDuplicatePageRequest, "threadId" | "callId">,
): string =>
  `nodex-agent-duplicate:${createHash("sha256").update(JSON.stringify([
    request.threadId,
    request.callId,
    "duplicate_page",
  ])).digest("hex")}`;

const coreRequest = (
  request: PrepareNodexAgentDuplicatePageRequest,
): CoreCopyRequest => ({
    source_page_id: request.input.pageId,
    destination: toCoreAgentPageDestination(request.input.destination),
    include_block_map: request.input.return?.includes("block_map") ?? false,
    include_etags: request.input.return?.includes("etags") ?? false,
  });

const output = (
  result: CoreCopyResult,
  includeBlockMap: boolean,
) => DuplicatePageV3OutputSchema.parse({
  data: {
    sourcePageId: result.source_page_id,
    pageId: result.page_id,
    location: nativeAgentPageLocation(result.location),
    bodyBlocksCreated: result.body_blocks_created,
    ...(includeBlockMap && result.block_map
      ? { blockMap: result.block_map }
      : {}),
    ...(result.etags
      ? { etags: { title: result.etags.title, body: result.etags.body } }
      : {}),
  },
});

const preparedDestination = (
  _request: PrepareNodexAgentDuplicatePageRequest,
  preparation: CoreCopyPreparation,
): NodexAgentDuplicatePageCommand["destination"] =>
  preparedAgentPageDestination(preparation);

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
  ): Promise<NodexAgentMutationEnvelope<PrepareNodexAgentDuplicatePageResult>> {
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
          this.runtime.identity.profileId,
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
        const committed = preparation.committed?.outcome.agent_page_copy;
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
      const documentHeads = nativeAgentDocumentHeads(preparation.document_heads);
      this.pending.set(operationId, {
        request,
        operationId,
        token,
        coreRequest: copyRequest,
        documentHeads,
      });
      const command: NodexAgentDuplicatePageCommand = {
        ...request,
        requestHash: operationId,
        mutationId: operationId,
        storeEpoch: request.authority.storeEpoch,
        input: request.input,
        normalizedInput: normalizedInput(request, preparation),
        destination: preparedDestination(request, preparation),
        documentHeads,
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
            documentIds: documentHeads.map((head) => head.documentId),
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
      || !hasExactNativeAgentDocumentHeads(
        pending.documentHeads,
        command.documentHeads,
      )) {
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
      const result = committed.outcome.agent_page_copy;
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
          documentCommits: nativeAgentDocumentCommits(result.document_commits),
          affectedDatabaseBlockIds: [...result.affected_database_ids],
          commitSeq: applyResultCursor(committed),
        },
      };
    } catch (error) {
      return { ok: false, error: mapNativeNodexAgentCoreError(error) };
    }
  }
}
