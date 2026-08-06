import {
  BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
  type BlockTransferIntent,
} from "../../shared/block-transfer";
import type {
  ExecuteNodexAgentMovePagesResult,
  NodexAgentMovePagesCommand,
  PrepareNodexAgentMovePagesRequest,
  PrepareNodexAgentMovePagesResult,
} from "../../shared/nodex-agent-tools";
import { MovePagesV3OutputSchema } from "../../shared/nodex-agent-tools/v3-write-schemas";
import type { NodexAgentMutationEnvelope } from "../agent-tools/dynamic-service-v3-port";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { commitCanonicalMoveIntent } from "./block-transfer-adapter";
import {
  canonicalAgentCommandFingerprint,
  prepareCanonicalAgentDestination,
  readCanonicalAgentBlockRoots,
} from "./canonical-agent-page-preparation";
import { toCoreAgentExecutionAuthorization } from "./desktop-nodex-agent-resource-authority";
import { mapNativeNodexAgentCoreError } from "./native-nodex-agent-page-update";

const MAX_PENDING_NATIVE_PAGE_MOVES = 1_024;

interface PendingNativePageMove {
  readonly request: PrepareNodexAgentMovePagesRequest;
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
  request: Pick<PrepareNodexAgentMovePagesRequest, "threadId" | "callId">,
): string => `nodex-agent-move-pages:${canonicalAgentCommandFingerprint([
  request.threadId,
  request.callId,
  "move_pages",
])}`;

const canonicalIntent = (
  request: PrepareNodexAgentMovePagesRequest,
  command: NodexAgentMovePagesCommand,
  libraryId: string,
): BlockTransferIntent => {
  const sourcePageId = request.input.pageIds[0];
  if (!sourcePageId) throw new Error("Canonical Agent Page movement has no source Page");
  const base = {
    version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
    operationId: command.mutationId,
    projectId: command.projectId,
    storeEpoch: command.storeEpoch,
    clientSessionId: command.callId,
    actor: { kind: "nodex_agent" as const, callId: command.callId },
    mode: "move" as const,
    rootBlockIds: [...request.input.pageIds],
    source: { kind: "page" as const, pageId: sourcePageId },
  };
  const target = command.destination;
  if (target.kind === "space") {
    return {
      ...base,
      target: {
        kind: "library",
        libraryId,
        ...(target.beforeBlockId ? { beforeBlockId: target.beforeBlockId } : {}),
      },
    };
  }
  if (target.kind === "document") {
    return {
      ...base,
      target: {
        kind: "page",
        pageId: target.pageId,
        ...(target.parentBlockId ? { parentBlockId: target.parentBlockId } : {}),
        ...(target.beforeBlockId ? { beforeBlockId: target.beforeBlockId } : {}),
      },
    };
  }
  const view = target.view;
  if (!view) throw new Error("Canonical Agent Page movement into a Board requires a View");
  return {
    ...base,
    target: {
      kind: "data_source",
      dataSourceId: target.dataSourceId,
      viewId: view.viewId,
      groupKey: view.groupKey,
      ...(view.beforePageId ? { beforePageId: view.beforePageId } : {}),
    },
  };
};

const location = (
  destination: NodexAgentMovePagesCommand["destination"],
  libraryId: string,
) => destination.kind === "space"
  ? { kind: "library" as const, libraryId }
  : destination.kind === "document"
    ? { kind: "page" as const, pageId: destination.pageId }
    : { kind: "data_source" as const, dataSourceId: destination.dataSourceId };

const output = (
  request: PrepareNodexAgentMovePagesRequest,
  command: NodexAgentMovePagesCommand,
  libraryId: string,
) => MovePagesV3OutputSchema.parse({
  data: {
    pages: request.input.pageIds.map((pageId) => ({
      pageId,
      location: location(command.destination, libraryId),
    })),
    moved: request.input.pageIds.length,
  },
});

export class NativeNodexAgentPageMoveRuntime {
  private readonly pending = new Map<string, PendingNativePageMove>();

  constructor(private readonly runtime: RustDataAuthorityRuntime) {}

  async prepare(
    request: PrepareNodexAgentMovePagesRequest,
  ): Promise<NodexAgentMutationEnvelope<PrepareNodexAgentMovePagesResult>> {
    const operationId = operationIdFor(request);
    try {
      if (!request.authority) throw new Error("Native Agent Page movement requires frozen Turn authority");
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
        blockIds: request.input.pageIds,
        authorization,
        libraryId: request.authority.libraryId,
        storeEpoch: request.authority.storeEpoch,
      });
      for (const pageId of request.input.pageIds) {
        const page = source.records.find((record) => record.id === pageId);
        if (!page || page.kind !== "page" || page.lifecycle !== "active") {
          throw new Error(`Canonical Agent Page ${pageId} is unavailable`);
        }
      }
      const command: NodexAgentMovePagesCommand = {
        ...request,
        requestHash: operationId,
        mutationId: operationId,
        storeEpoch: request.authority.storeEpoch,
        input: request.input,
        destination: destination.destination,
        transfers: request.input.pageIds.map((pageId) => ({ pageId })),
      };
      if (!this.pending.has(operationId) && this.pending.size >= MAX_PENDING_NATIVE_PAGE_MOVES) {
        throw new Error("Native Agent Page-move preparation capacity is exhausted");
      }
      this.pending.set(operationId, {
        request,
        operationId,
        commandFingerprint: canonicalAgentCommandFingerprint({
          input: command.input,
          destination: command.destination,
          transfers: command.transfers,
        }),
      });
      return envelope({
        ok: true,
        value: {
          kind: "prepared",
          command,
          authorization: {
            roots: Object.fromEntries(request.input.pageIds.map((pageId) => [
              pageId,
              { type: "page" as const, transformation: "preserved" as const },
            ])),
          },
        },
      }, operationId);
    } catch (error) {
      return envelope({ ok: false, error: mapNativeNodexAgentCoreError(error) }, operationId);
    }
  }

  async execute(command: NodexAgentMovePagesCommand): Promise<ExecuteNodexAgentMovePagesResult> {
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
        transfers: command.transfers,
      }) !== pending.commandFingerprint
    ) {
      return {
        ok: false,
        error: {
          code: "idempotency_collision",
          message: "Native Agent Page movement has no matching canonical preparation",
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
          message: "Native Agent Page movement lost its frozen Turn authority",
          retryable: false,
          recovery: "start_new_task",
        },
      };
    }
    try {
      const transfer = await commitCanonicalMoveIntent({
        client: this.runtime.clientForProject(pending.request.projectId),
        libraryId: this.runtime.identity.libraryId,
        projectId: pending.request.projectId,
        storeEpoch: command.storeEpoch,
        agentAuthorization: toCoreAgentExecutionAuthorization(
          this.runtime.identity.profileId,
          pending.request.authority,
          pending.request.callId,
          pending.request.resourceAccess,
        ),
      }, canonicalIntent(pending.request, command, this.runtime.identity.libraryId));
      if (!transfer || !transfer.ok) {
        throw new Error(transfer?.error.message ?? "Canonical Agent Page movement has no BlockRecord source/target");
      }
      const receipt = transfer.value;
      this.pending.delete(command.mutationId);
      return {
        ok: true,
        value: {
          output: output(pending.request, command, this.runtime.identity.libraryId),
          duplicate: receipt.duplicate,
          documentCommits: [],
          affectedDatabaseBlockIds: command.destination.kind === "database"
            ? [command.destination.dataSourceId]
            : [],
          changeLogSeq: receipt.changeLogSeq,
        },
      };
    } catch (error) {
      return { ok: false, error: mapNativeNodexAgentCoreError(error) };
    }
  }
}
