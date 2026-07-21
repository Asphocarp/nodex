import type { components } from "@nodex/core-protocol";
import { createHash } from "node:crypto";
import { parseInlineMarkdownTitle } from "../../shared/nfm/agent-title";
import type {
  ExecuteNodexAgentCreatePagesResult,
  NodexAgentCreatePagesCommand,
  NodexAgentLeaseDocument,
  PrepareNodexAgentCreatePagesRequest,
  PrepareNodexAgentCreatePagesResult,
} from "../../shared/nodex-agent-tools";
import { CreatePagesV3OutputSchema } from "../../shared/nodex-agent-tools/v3-write-schemas";
import { CreateInputSchema } from "../../shared/nodex-agent-tools/write-schemas";
import type { NodexAgentMutationEnvelope } from "../agent-tools/dynamic-service-v3-port";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { toCoreAgentExecutionAuthorization } from "./desktop-nodex-agent-resource-authority";
import {
  hasExactNativeAgentLeaseDocuments,
  nativeAgentDocumentCommits,
  nativeAgentLeaseDocuments,
  nativeAgentPageLocation,
  preparedAgentPageDestination,
  toCoreAgentPageDestination,
} from "./native-nodex-agent-page-destination";
import { mapNativeNodexAgentCoreError } from "./native-nodex-agent-page-update";

type CoreCreateRequest = components["schemas"]["LibraryAgentCreatePagesRequest"];
type CoreCreateResult = components["schemas"]["LibraryAgentCreatePagesResult"];
type CoreCreatePreparation = components["schemas"]["LibraryAgentCreatePagesPreparation"];

const MAX_PENDING_NATIVE_PAGE_CREATES = 1_024;

interface PendingNativePageCreate {
  readonly request: PrepareNodexAgentCreatePagesRequest;
  readonly operationId: string;
  readonly token: string;
  readonly coreRequest: CoreCreateRequest;
  readonly leaseDocuments: readonly NodexAgentLeaseDocument[];
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
  request: Pick<PrepareNodexAgentCreatePagesRequest, "threadId" | "callId">,
): string =>
  `nodex-agent-create-pages:${createHash("sha256").update(JSON.stringify([
    request.threadId,
    request.callId,
    "create_pages",
  ])).digest("hex")}`;

const coreRequest = (
  request: PrepareNodexAgentCreatePagesRequest,
): CoreCreateRequest => ({
  destination: toCoreAgentPageDestination(request.input.destination, []),
  pages: request.input.pages.map((page) => ({
    title_markdown: page.title,
    nfm: page.markdown ?? "",
    values: (page.values ?? []).map((value) => ({
      property_id: value.propertyId,
      value: value.value,
    })),
  })),
  include_block_ids: request.input.return?.includes("block_ids") ?? false,
  include_etags: request.input.return?.includes("etags") ?? false,
});

const output = (
  result: CoreCreateResult,
  request: PrepareNodexAgentCreatePagesRequest,
) => CreatePagesV3OutputSchema.parse({
  data: {
    pages: result.pages.map((page) => ({
      pageId: page.page_id,
      location: nativeAgentPageLocation(page.location),
      bodyBlocksCreated: page.body_blocks_created,
      ...(request.input.return?.includes("block_ids")
        ? { blockIds: page.block_ids }
        : {}),
      ...(page.etags
        ? { etags: { title: page.etags.title, body: page.etags.body } }
        : {}),
    })),
    created: result.pages.length,
  },
});

const normalizedDestination = (
  request: PrepareNodexAgentCreatePagesRequest,
  preparation: CoreCreatePreparation,
  pageIndex: number,
) => {
  const destination = request.input.destination;
  if (destination.kind === "library") {
    return { kind: "space" as const, ...(destination.at ? { at: destination.at } : {}) };
  }
  if (destination.kind === "page") {
    const target = preparation.destination_document;
    if (!target) {
      throw new Error("Core Agent Page creation omitted its target Document");
    }
    return {
      kind: "document" as const,
      documentId: target.document_id,
      at: destination.at ?? { kind: "end" as const },
    };
  }
  const databaseId = preparation.destination_database_id;
  if (!databaseId) {
    throw new Error("Core Agent Page creation omitted its target Database");
  }
  const page = request.input.pages[pageIndex];
  if (!page) throw new Error(`Core Agent Page draft ${pageIndex} is unavailable`);
  return {
    kind: "database" as const,
    databaseBlockId: databaseId,
    ...(page.values ? { values: page.values } : {}),
    ...(destination.view ? { view: destination.view } : {}),
  };
};

const command = (
  request: PrepareNodexAgentCreatePagesRequest,
  operationId: string,
  preparation: CoreCreatePreparation,
): NodexAgentCreatePagesCommand => {
  if (!request.authority) {
    throw new Error("Native Agent Page creation requires frozen Turn authority");
  }
  if (preparation.pages.length !== request.input.pages.length) {
    throw new Error("Core Agent Page creation returned a divergent Page batch");
  }
  const destination = preparedAgentPageDestination(preparation);
  return {
    ...request,
    requestHash: operationId,
    mutationId: operationId,
    storeEpoch: request.authority.storeEpoch,
    input: request.input,
    destination,
    pages: preparation.pages.map((page, index) => {
      const draft = request.input.pages[index];
      if (!draft) throw new Error(`Agent Page draft ${index} is unavailable`);
      return {
        input: CreateInputSchema.parse({
          resource: {
            kind: "page",
            title: {
              kind: "rich",
              richText: [...parseInlineMarkdownTitle(draft.title)],
            },
            ...(draft.markdown !== undefined
              ? { body: { format: "nfm", content: draft.markdown } }
              : {}),
          },
          destination: normalizedDestination(request, preparation, index),
          ...(request.input.return
            ? {
                return: {
                  ...(request.input.return.includes("block_ids")
                    ? { blockIds: true }
                    : {}),
                  ...(request.input.return.includes("etags")
                    ? { etags: true }
                    : {}),
                },
              }
            : {}),
        }),
        pageId: page.page_id,
        bodyBlockIds: [...page.body_block_ids],
        primaryMembershipId: page.primary_membership_id,
        targetMembershipId: page.target_membership_id,
      };
    }),
  };
};

export class NativeNodexAgentPageCreateRuntime {
  private readonly pending = new Map<string, PendingNativePageCreate>();

  constructor(private readonly runtime: RustDataAuthorityRuntime) {}

  async prepare(
    request: PrepareNodexAgentCreatePagesRequest,
  ): Promise<NodexAgentMutationEnvelope<PrepareNodexAgentCreatePagesResult>> {
    const operationId = operationIdFor(request);
    try {
      if (!request.authority) {
        throw new Error("Native Agent Page creation requires frozen Turn authority");
      }
      const createRequest = coreRequest(request);
      const snapshot = await this.runtime.clientForProject(request.projectId).libraryRead({
        kind: "prepare_agent_create_pages",
        operation_id: operationId,
        store_epoch: request.authority.storeEpoch,
        authorization: toCoreAgentExecutionAuthorization(
          this.runtime.rootClient.handshake.profile_id,
          request.authority,
          request.callId,
          request.resourceAccess,
        ),
        request: createRequest,
      });
      if (snapshot.value.kind !== "agent_create_pages_preparation") {
        throw new Error("Core returned the wrong Agent Page-create preparation variant");
      }
      const preparation = snapshot.value.value;
      if (preparation.preparation.state === "committed_replay") {
        const committed = preparation.committed?.value.agent_create_pages;
        if (!committed) throw new Error("Core Agent Page-create replay omitted its result");
        this.pending.delete(operationId);
        return envelope({
          ok: true,
          value: { kind: "completed", output: output(committed, request) },
        }, operationId);
      }
      const token = preparation.preparation.token;
      if (!token) throw new Error("Core Agent Page-create preparation omitted its token");
      if (!this.pending.has(operationId)
        && this.pending.size >= MAX_PENDING_NATIVE_PAGE_CREATES) {
        throw new Error("Native Agent Page-create preparation capacity is exhausted");
      }
      const leaseDocuments = nativeAgentLeaseDocuments(preparation.document_heads);
      this.pending.set(operationId, {
        request,
        operationId,
        token,
        coreRequest: createRequest,
        leaseDocuments,
      });
      return envelope({
        ok: true,
        value: {
          kind: "prepared",
          command: command(request, operationId, preparation),
          leaseDocuments,
          previews: preparation.pages.map((page, index) => {
            const draft = request.input.pages[index];
            if (!draft) throw new Error(`Agent Page draft ${index} is unavailable`);
            return {
              pageId: page.page_id,
              title: draft.title,
              bodyBlockCount: page.body_block_ids.length,
              targetMarkdown: draft.markdown ?? "",
            };
          }),
        },
      }, operationId);
    } catch (error) {
      return envelope({ ok: false, error: mapNativeNodexAgentCoreError(error) }, operationId);
    }
  }

  async execute(
    command: NodexAgentCreatePagesCommand,
    leaseDocuments: readonly NodexAgentLeaseDocument[],
  ): Promise<ExecuteNodexAgentCreatePagesResult> {
    const pending = this.pending.get(command.mutationId);
    if (!pending
      || pending.request.projectId !== command.projectId
      || pending.request.callId !== command.callId
      || pending.request.threadId !== command.threadId
      || pending.request.authority?.storeEpoch !== command.storeEpoch
      || !hasExactNativeAgentLeaseDocuments(pending.leaseDocuments, leaseDocuments)) {
      return {
        ok: false,
        error: {
          code: "idempotency_collision",
          message: "Native Agent Page creation has no matching preparation",
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
          message: "Native Agent Page creation lost its frozen Turn authority",
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
            kind: "execute_prepared_agent_create_pages",
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
      const result = committed.value.agent_create_pages;
      if (!result) throw new Error("Core Agent Page-create commit omitted its result");
      this.pending.delete(command.mutationId);
      return {
        ok: true,
        value: {
          output: output(result, pending.request),
          duplicate: committed.receipt.duplicate,
          documentCommits: nativeAgentDocumentCommits(result.document_commits),
          affectedDatabaseBlockIds: [...result.affected_database_ids],
          changeLogSeq: committed.event_sequence,
        },
      };
    } catch (error) {
      return { ok: false, error: mapNativeNodexAgentCoreError(error) };
    }
  }
}
