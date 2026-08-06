import type {
  ExecuteNodexAgentDuplicatePageResult,
  NodexAgentDuplicatePageCommand,
  PrepareNodexAgentDuplicatePageRequest,
  PrepareNodexAgentDuplicatePageResult,
} from "../../shared/nodex-agent-tools";
import { BLOCK_TRANSFER_INTENT_CONTRACT_VERSION } from "../../shared/block-transfer";
import { DuplicatePageV3OutputSchema } from "../../shared/nodex-agent-tools/v3-write-schemas";
import type { NodexAgentMutationEnvelope } from "../agent-tools/dynamic-service-v3-port";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { commitCanonicalCopyIntent } from "./block-transfer-adapter";
import {
  canonicalAgentCommandFingerprint,
  canonicalAgentIdentity,
  prepareCanonicalAgentDestination,
  readCanonicalAgentBlockRoots,
} from "./canonical-agent-page-preparation";
import { toCoreAgentExecutionAuthorization } from "./desktop-nodex-agent-resource-authority";
import { materializeCanonicalAgentPage } from "./canonical-agent-page-update";
import { blockRecordSnapshotToWindow } from "../../shared/block-records";
import { canonicalAgentPageEtag } from "./canonical-agent-etag";
import { mapNativeNodexAgentCoreError } from "./native-nodex-agent-page-update";

const MAX_PENDING_NATIVE_PAGE_COPIES = 1_024;

interface PendingNativePageCopy {
  readonly request: PrepareNodexAgentDuplicatePageRequest;
  readonly operationId: string;
  readonly commandFingerprint: string;
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
): string => `nodex-agent-duplicate:${canonicalAgentCommandFingerprint([
  request.threadId,
  request.callId,
  "duplicate_page",
])}`;

const canonicalIntent = (
  request: PrepareNodexAgentDuplicatePageRequest,
  command: NodexAgentDuplicatePageCommand,
  libraryId: string,
) => {
  const target = command.destination;
  const base = {
    version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
    operationId: command.mutationId,
    projectId: command.projectId,
    storeEpoch: command.storeEpoch,
    clientSessionId: command.callId,
    actor: { kind: "nodex_agent" as const, callId: command.callId },
    mode: "copy" as const,
    rootBlockIds: [request.input.pageId],
    source: { kind: "page" as const, pageId: request.input.pageId },
  };
  if (target.kind === "space") {
    return {
      ...base,
      target: {
        kind: "library" as const,
        libraryId,
        ...(target.beforeBlockId ? { beforeBlockId: target.beforeBlockId } : {}),
      },
    };
  }
  if (target.kind === "document") {
    return {
      ...base,
      target: {
        kind: "page" as const,
        pageId: target.pageId,
        ...(target.parentBlockId ? { parentBlockId: target.parentBlockId } : {}),
        ...(target.beforeBlockId ? { beforeBlockId: target.beforeBlockId } : {}),
      },
    };
  }
  const view = target.view;
  if (!view) throw new Error("Canonical Agent Page copy destination requires a View");
  return {
    ...base,
    target: {
      kind: "data_source" as const,
      dataSourceId: target.dataSourceId,
      viewId: view.viewId,
      groupKey: view.groupKey,
      ...(view.beforePageId ? { beforePageId: view.beforePageId } : {}),
    },
  };
};

const location = (
  destination: NodexAgentDuplicatePageCommand["destination"],
  libraryId: string,
) => destination.kind === "space"
  ? { kind: "library" as const, libraryId }
  : destination.kind === "document"
    ? { kind: "page" as const, pageId: destination.pageId }
    : { kind: "data_source" as const, dataSourceId: destination.dataSourceId };

const output = (
  request: PrepareNodexAgentDuplicatePageRequest,
  command: NodexAgentDuplicatePageCommand,
  libraryId: string,
  result: Extract<
    Awaited<ReturnType<typeof commitCanonicalCopyIntent>>,
    { readonly ok: true }
  >["value"],
  etags?: { readonly title: string; readonly body: string },
) => {
  const pageId = result.resultRootBlockIds[0];
  if (!pageId) throw new Error("Canonical Agent Page copy omitted its target Page");
  return DuplicatePageV3OutputSchema.parse({
    data: {
      sourcePageId: request.input.pageId,
      pageId,
      location: location(command.destination, libraryId),
      bodyBlocksCreated: Math.max(0, Object.keys(result.copiedBlockIds).length - 1),
      ...(request.input.return?.includes("block_map")
        ? { blockMap: result.copiedBlockIds }
        : {}),
      ...(request.input.return?.includes("etags") && etags ? { etags } : {}),
    },
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
      if (!request.authority) throw new Error("Native Agent Page copy requires frozen Turn authority");
      const client = this.runtime.clientForProject(request.projectId);
      const authorization = toCoreAgentExecutionAuthorization(
        this.runtime.identity.profileId,
        request.authority,
        request.callId,
        request.resourceAccess,
      );
      const destination = await prepareCanonicalAgentDestination({
        client,
        destination: request.input.destination,
        authorization,
        libraryId: request.authority.libraryId,
        storeEpoch: request.authority.storeEpoch,
      });
      const source = await readCanonicalAgentBlockRoots({
        client,
        blockIds: [request.input.pageId],
        authorization,
        libraryId: request.authority.libraryId,
        storeEpoch: request.authority.storeEpoch,
      });
      const sourceRoot = source.records.find((record) => record.id === request.input.pageId);
      if (!sourceRoot || sourceRoot.kind !== "page" || sourceRoot.lifecycle !== "active") {
        throw new Error("Canonical Agent Page copy source is unavailable");
      }
      const newPageId = canonicalAgentIdentity(operationId, "page", "copy");
      const command: NodexAgentDuplicatePageCommand = {
        ...request,
        requestHash: operationId,
        mutationId: operationId,
        storeEpoch: request.authority.storeEpoch,
        input: request.input,
        destination: destination.destination,
        canonical: { newPageId },
      };
      if (!this.pending.has(operationId) && this.pending.size >= MAX_PENDING_NATIVE_PAGE_COPIES) {
        throw new Error("Native Agent Page-copy preparation capacity is exhausted");
      }
      this.pending.set(operationId, {
        request,
        operationId,
        commandFingerprint: canonicalAgentCommandFingerprint({
          input: command.input,
          destination: command.destination,
          canonical: command.canonical,
        }),
      });
      return envelope({
        ok: true,
        value: {
          kind: "prepared",
          command,
          authorization: {
            roots: {
              [request.input.pageId]: {
                type: sourceRoot.kind,
                transformation: "preserved",
              },
            },
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
    if (
      !pending
      || pending.request.projectId !== command.projectId
      || pending.request.callId !== command.callId
      || pending.request.threadId !== command.threadId
      || pending.request.authority?.storeEpoch !== command.storeEpoch
      || command.requestHash !== pending.operationId
      || canonicalAgentCommandFingerprint({
        input: command.input,
        destination: command.destination,
        canonical: command.canonical,
      }) !== pending.commandFingerprint
    ) {
      return {
        ok: false,
        error: {
          code: "idempotency_collision",
          message: "Native Agent Page copy has no matching canonical preparation",
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
      const authorization = toCoreAgentExecutionAuthorization(
        this.runtime.identity.profileId,
        pending.request.authority,
        pending.request.callId,
        pending.request.resourceAccess,
      );
      const transfer = await commitCanonicalCopyIntent({
        client: this.runtime.clientForProject(pending.request.projectId),
        libraryId: this.runtime.identity.libraryId,
        projectId: pending.request.projectId,
        storeEpoch: command.storeEpoch,
        agentAuthorization: authorization,
      }, canonicalIntent(pending.request, command, this.runtime.identity.libraryId), command.canonical?.newPageId);
      if (!transfer || !transfer.ok) {
        throw new Error(transfer?.error.message ?? "Canonical Agent Page copy has no BlockRecord source/target");
      }
      const result = transfer.value;
      let etags: { title: string; body: string } | undefined;
      if (pending.request.input.return?.includes("etags")) {
        const read = {
          kind: "window" as const,
          block_ids: [result.resultRootBlockIds[0]!],
          include_content: true,
          include_descendants: true,
        };
        const window = blockRecordSnapshotToWindow(
          await this.runtime.clientForProject(pending.request.projectId)
            .blockRecordRead(read, authorization),
          read,
        );
        const materialization = materializeCanonicalAgentPage(window, result.resultRootBlockIds[0]!);
        etags = {
          title: canonicalAgentPageEtag("title", result.resultRootBlockIds[0]!, materialization.richTitle),
          body: canonicalAgentPageEtag("body", result.resultRootBlockIds[0]!, materialization.nfm),
        };
      }
      this.pending.delete(command.mutationId);
      return {
        ok: true,
        value: {
          output: output(pending.request, command, this.runtime.identity.libraryId, result, etags),
          duplicate: result.duplicate,
          documentCommits: [],
          affectedDatabaseBlockIds: command.destination.kind === "database"
            ? [command.destination.dataSourceId]
            : [],
          changeLogSeq: result.changeLogSeq,
        },
      };
    } catch (error) {
      return { ok: false, error: mapNativeNodexAgentCoreError(error) };
    }
  }
}
