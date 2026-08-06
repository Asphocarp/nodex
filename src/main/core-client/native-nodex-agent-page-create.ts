import type { components } from "@nodex/core-protocol";
import type {
  ExecuteNodexAgentCreatePagesResult,
  NodexAgentCreatePagesCommand,
  PrepareNodexAgentCreatePagesRequest,
  PrepareNodexAgentCreatePagesResult,
} from "../../shared/nodex-agent-tools";
import { CreatePagesV3OutputSchema } from "../../shared/nodex-agent-tools/v3-write-schemas";
import type { NodexAgentMutationEnvelope } from "../agent-tools/dynamic-service-v3-port";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import type { CoreClientPort } from "./types";
import { commitCanonicalAgentPageCreate } from "./canonical-agent-page-commands";
import {
  canonicalAgentIdentity,
  canonicalAgentCommandFingerprint,
  prepareCanonicalAgentDestination,
} from "./canonical-agent-page-preparation";
import { toCoreAgentExecutionAuthorization } from "./desktop-nodex-agent-resource-authority";
import { parseNfm } from "../../shared/nfm/parser";
import { nfmToBlockNoteWithIds } from "../../shared/block-documents/nfm-blocknote-adapter";
import { parseInlineMarkdownTitle } from "../../shared/nfm/agent-title";
import { serializeNfm } from "../../shared/nfm/serializer";
import { canonicalAgentPageEtag } from "./canonical-agent-etag";
import { mapNativeNodexAgentCoreError } from "./native-nodex-agent-page-update";

const MAX_PENDING_NATIVE_PAGE_CREATES = 1_024;

interface PendingNativePageCreate {
  readonly request: PrepareNodexAgentCreatePagesRequest;
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
  request: Pick<PrepareNodexAgentCreatePagesRequest, "threadId" | "callId">,
): string => `nodex-agent-create-pages:${canonicalAgentCommandFingerprint([
  request.threadId,
  request.callId,
  "create_pages",
])}`;

const flattenIds = (
  blocks: readonly { readonly id?: string; readonly children?: readonly unknown[] }[],
): readonly string[] => blocks.flatMap((block) => {
  if (!block.id) throw new Error("Canonical Agent Page body Block is missing its ID");
  return [
    block.id,
    ...flattenIds(
      (block.children ?? []) as readonly {
        readonly id?: string;
        readonly children?: readonly unknown[];
      }[],
    ),
  ];
});

const bodyBlockIds = (operationId: string, pageIndex: number, markdown: string): readonly string[] => {
  let ordinal = 0;
  const blocks = nfmToBlockNoteWithIds(parseNfm(markdown), () => (
    canonicalAgentIdentity(operationId, "block", `${pageIndex}:${ordinal++}`)
  ));
  const ids = flattenIds(blocks);
  if (ids.length !== ordinal) throw new Error("Canonical Agent Page body identity allocation diverged");
  return ids;
};

const buildCommand = async (
  request: PrepareNodexAgentCreatePagesRequest,
  client: CoreClientPort,
  authorization: components["schemas"]["AgentExecutionAuthorization"],
  operationId: string,
): Promise<NodexAgentCreatePagesCommand> => {
  if (!request.authority) throw new Error("Native Agent Page creation requires frozen Turn authority");
  const destination = await prepareCanonicalAgentDestination({
    client,
    destination: request.input.destination,
    authorization,
    libraryId: request.authority.libraryId,
    storeEpoch: request.authority.storeEpoch,
  });
  return {
    ...request,
    requestHash: operationId,
    mutationId: operationId,
    storeEpoch: request.authority.storeEpoch,
    input: request.input,
    destination: destination.destination,
    pages: request.input.pages.map((page, index) => ({
      pageId: canonicalAgentIdentity(operationId, "page", index),
      bodyBlockIds: bodyBlockIds(operationId, index, page.markdown ?? ""),
    })),
  };
};

const location = (
  destination: NodexAgentCreatePagesCommand["destination"],
  libraryId: string,
): { readonly kind: "library"; readonly libraryId: string }
  | { readonly kind: "page"; readonly pageId: string }
  | { readonly kind: "data_source"; readonly dataSourceId: string } => destination.kind === "space"
  ? { kind: "library", libraryId }
  : destination.kind === "document"
    ? { kind: "page", pageId: destination.pageId }
    : { kind: "data_source", dataSourceId: destination.dataSourceId };

const output = (
  request: PrepareNodexAgentCreatePagesRequest,
  commandValue: NodexAgentCreatePagesCommand,
  libraryId: string,
) => CreatePagesV3OutputSchema.parse({
  data: {
    pages: commandValue.pages.map((page, index) => {
      const draft = request.input.pages[index];
      if (!draft) throw new Error(`Canonical Agent Page draft ${index} is unavailable`);
      const normalizedBody = serializeNfm(parseNfm(draft.markdown ?? ""));
      return {
        pageId: page.pageId,
        location: location(commandValue.destination, libraryId),
        bodyBlocksCreated: page.bodyBlockIds.length,
        ...(request.input.return?.includes("block_ids")
          ? { blockIds: page.bodyBlockIds }
          : {}),
        ...(request.input.return?.includes("etags")
          ? {
              etags: {
                title: canonicalAgentPageEtag(
                  "title",
                  page.pageId,
                  parseInlineMarkdownTitle(draft.title),
                ),
                body: canonicalAgentPageEtag("body", page.pageId, normalizedBody),
              },
            }
          : {}),
      };
    }),
    created: commandValue.pages.length,
  },
});

export class NativeNodexAgentPageCreateRuntime {
  private readonly pending = new Map<string, PendingNativePageCreate>();

  constructor(private readonly runtime: RustDataAuthorityRuntime) {}

  async prepare(
    request: PrepareNodexAgentCreatePagesRequest,
  ): Promise<NodexAgentMutationEnvelope<PrepareNodexAgentCreatePagesResult>> {
    const operationId = operationIdFor(request);
    try {
      if (!request.authority) throw new Error("Native Agent Page creation requires frozen Turn authority");
      const client = this.runtime.clientForProject(request.projectId);
      const authorization = toCoreAgentExecutionAuthorization(
        this.runtime.identity.profileId,
        request.authority,
        request.callId,
        request.resourceAccess,
      );
      const preparedCommand = await buildCommand(request, client, authorization, operationId);
      if (!this.pending.has(operationId) && this.pending.size >= MAX_PENDING_NATIVE_PAGE_CREATES) {
        throw new Error("Native Agent Page-create preparation capacity is exhausted");
      }
      this.pending.set(operationId, {
        request,
        operationId,
        commandFingerprint: canonicalAgentCommandFingerprint({
          input: preparedCommand.input,
          destination: preparedCommand.destination,
          pages: preparedCommand.pages,
        }),
      });
      return envelope({
        ok: true,
        value: {
          kind: "prepared",
          command: preparedCommand,
          previews: preparedCommand.pages.map((page, index) => ({
            pageId: page.pageId,
            title: request.input.pages[index]?.title ?? "",
            bodyBlockCount: page.bodyBlockIds.length,
            targetMarkdown: request.input.pages[index]?.markdown ?? "",
          })),
        },
      }, operationId);
    } catch (error) {
      return envelope({ ok: false, error: mapNativeNodexAgentCoreError(error) }, operationId);
    }
  }

  async execute(
    commandValue: NodexAgentCreatePagesCommand,
  ): Promise<ExecuteNodexAgentCreatePagesResult> {
    const pending = this.pending.get(commandValue.mutationId);
    if (
      !pending
      || pending.request.projectId !== commandValue.projectId
      || pending.request.callId !== commandValue.callId
      || pending.request.threadId !== commandValue.threadId
      || pending.request.authority?.storeEpoch !== commandValue.storeEpoch
      || commandValue.requestHash !== pending.operationId
      || canonicalAgentCommandFingerprint({
        input: commandValue.input,
        destination: commandValue.destination,
        pages: commandValue.pages,
      }) !== pending.commandFingerprint
    ) {
      return {
        ok: false,
        error: {
          code: "idempotency_collision",
          message: "Native Agent Page creation has no matching canonical preparation",
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
          message: "Native Agent Page creation lost its frozen Turn authority",
          retryable: false,
          recovery: "start_new_task",
        },
      };
    }
    try {
      const committed = await commitCanonicalAgentPageCreate({
        client: this.runtime.clientForProject(pending.request.projectId),
        actorId: `profile:${this.runtime.identity.profileId}`,
        authorization: toCoreAgentExecutionAuthorization(
          this.runtime.identity.profileId,
          pending.request.authority,
          pending.request.callId,
          pending.request.resourceAccess,
        ),
        libraryId: this.runtime.identity.libraryId,
        projectId: pending.request.projectId,
        storeEpoch: commandValue.storeEpoch,
        operationId: pending.operationId,
        sessionId: pending.request.callId,
        command: commandValue,
      });
      this.pending.delete(commandValue.mutationId);
      return {
        ok: true,
        value: {
          output: output(pending.request, commandValue, this.runtime.identity.libraryId),
          duplicate: committed.duplicate,
          documentCommits: [],
          affectedDatabaseBlockIds: commandValue.destination.kind === "database"
            ? [commandValue.destination.dataSourceId]
            : [],
          changeLogSeq: committed.cursor.commit_seq,
        },
      };
    } catch (error) {
      return { ok: false, error: mapNativeNodexAgentCoreError(error) };
    }
  }
}
