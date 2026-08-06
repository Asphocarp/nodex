import type { components } from "@nodex/core-protocol";
import { createHash } from "node:crypto";
import {
  BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
  type BlockTransferIntent,
} from "../../shared/block-transfer";
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
import { commitCanonicalCopyIntent } from "./block-transfer-adapter";
import { toCoreAgentExecutionAuthorization } from "./desktop-nodex-agent-resource-authority";
import {
  hasExactNativeAgentDocumentHeads,
  nativeAgentPageLocation,
  nativeAgentDocumentHeads,
  preparedAgentPageDestination,
  toCoreAgentPageDestination,
} from "./native-nodex-agent-page-destination";
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

const canonicalEtag = (operationId: string, value: unknown): string => (
  `nxe1.${createHash("sha256").update(JSON.stringify([operationId, value])).digest("base64url")}`
);

const canonicalIntent = (
  request: PrepareNodexAgentDuplicatePageRequest,
  command: NodexAgentDuplicatePageCommand,
  libraryId: string,
): BlockTransferIntent => {
  const target = command.destination;
  if (target.kind === "space") {
    return {
      version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
      operationId: command.mutationId,
      projectId: command.projectId,
      storeEpoch: command.storeEpoch,
      clientSessionId: command.callId,
      actor: { kind: "nodex_agent", callId: command.callId },
      mode: "copy",
      rootBlockIds: [request.input.pageId],
      source: { kind: "page", pageId: request.input.pageId },
      target: {
        kind: "library",
        libraryId,
        ...(target.beforeBlockId ? { beforeBlockId: target.beforeBlockId } : {}),
      },
    };
  }
  if (target.kind === "document") {
    if (request.input.destination.kind !== "page") {
      throw new Error("Canonical Agent Page copy destination does not identify a Page");
    }
    return {
      version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
      operationId: command.mutationId,
      projectId: command.projectId,
      storeEpoch: command.storeEpoch,
      clientSessionId: command.callId,
      actor: { kind: "nodex_agent", callId: command.callId },
      mode: "copy",
      rootBlockIds: [request.input.pageId],
      source: { kind: "page", pageId: request.input.pageId },
      target: {
        kind: "page",
        pageId: request.input.destination.pageId,
        ...(target.beforeBlockId ? { beforeBlockId: target.beforeBlockId } : {}),
      },
    };
  }
  const view = target.view;
  if (!view) throw new Error("Canonical Agent Board copy destination requires a View");
  return {
    version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
    operationId: command.mutationId,
    projectId: command.projectId,
    storeEpoch: command.storeEpoch,
    clientSessionId: command.callId,
    actor: { kind: "nodex_agent", callId: command.callId },
    mode: "copy",
    rootBlockIds: [request.input.pageId],
    source: { kind: "page", pageId: request.input.pageId },
    target: {
      kind: "data_source",
      dataSourceId: target.dataSourceId,
      viewId: view.viewId,
      groupKey: view.groupKey,
      ...(view.beforePageId ? { beforePageId: view.beforePageId } : {}),
    },
  };
};

const canonicalOutput = (
  request: PrepareNodexAgentDuplicatePageRequest,
  command: NodexAgentDuplicatePageCommand,
  libraryId: string,
  result: Extract<Awaited<ReturnType<typeof commitCanonicalCopyIntent>>, { readonly ok: true }> ["value"],
) => {
  const pageId = result.resultRootBlockIds[0];
  if (!pageId) throw new Error("Canonical Agent Page copy omitted its target Page");
  const location = command.destination.kind === "space"
    ? { kind: "library" as const, libraryId }
    : command.destination.kind === "document"
      ? {
          kind: "page" as const,
          pageId: request.input.destination.kind === "page"
            ? request.input.destination.pageId
            : (() => { throw new Error("Canonical Agent Page copy destination is invalid"); })(),
        }
      : {
          kind: "data_source" as const,
          dataSourceId: command.destination.dataSourceId,
        };
  return DuplicatePageV3OutputSchema.parse({
    data: {
      sourcePageId: request.input.pageId,
      pageId,
      location,
      bodyBlocksCreated: Math.max(0, Object.keys(result.copiedBlockIds).length - 1),
      ...(request.input.return?.includes("block_map")
        ? { blockMap: result.copiedBlockIds }
        : {}),
      ...(request.input.return?.includes("etags")
        ? {
            etags: {
              title: canonicalEtag(command.mutationId, [pageId, "title"]),
              body: canonicalEtag(command.mutationId, [pageId, "body"]),
            },
          }
        : {}),
    },
  });
};

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
    if (!pending.request.authority) {
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
      const targetPageId = command.canonical?.newPageId;
      if (!targetPageId) {
        throw new Error("Canonical Agent Page copy omitted its target identity");
      }
      const transfer = await commitCanonicalCopyIntent({
        client: this.runtime.clientForProject(pending.request.projectId),
        libraryId: this.runtime.identity.libraryId,
        projectId: pending.request.projectId,
        storeEpoch: command.storeEpoch,
      }, canonicalIntent(pending.request, command, this.runtime.identity.libraryId), targetPageId);
      if (!transfer) {
        throw new Error("Canonical Agent Page copy has no BlockRecord source/target");
      }
      if (!transfer.ok) throw new Error(transfer.error.message);
      const result = transfer.value;
      this.pending.delete(command.mutationId);
      return {
        ok: true,
        value: {
          output: canonicalOutput(
            pending.request,
            command,
            this.runtime.identity.libraryId,
            result,
          ),
          duplicate: result.duplicate,
          documentCommits: [],
          affectedDatabaseBlockIds: command.destination.kind === "database"
            ? [command.destination.databaseBlockId]
            : [],
          changeLogSeq: result.changeLogSeq,
        },
      };
    } catch (error) {
      return { ok: false, error: mapNativeNodexAgentCoreError(error) };
    }
  }
}
