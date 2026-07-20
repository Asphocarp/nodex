import type { components } from "@nodex/core-protocol";
import { createHash } from "node:crypto";
import type {
  DocumentMutationRequest,
  DocumentOperationCommandResult,
  DocumentOperationResult,
} from "../../shared/block-documents";
import {
  type AgentDocumentEditEffects,
  type CompleteNodexAgentPageUpdateRequest,
  type CompleteNodexAgentPageUpdateResult,
  type PrepareNodexAgentPageUpdateRequest,
  type PrepareNodexAgentPageUpdateResult,
  type ToolFailure,
} from "../../shared/nodex-agent-tools";
import { UpdatePageV3OutputSchema } from "../../shared/nodex-agent-tools/v3-write-schemas";
import {
  AgentDocumentEditCompilerError,
  applyExactNfmPatches,
} from "../../shared/nodex-agent-tools/document-edit-compiler";
import type { BlockMutationEnvelope } from "../block-mutation-writer";
import { CoreModuleResponseError } from "./core-client";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { toCoreAgentTurnProvenance } from "./desktop-nodex-agent-resource-authority";

type CoreAgentMutation = components["schemas"]["AgentDocumentSemanticMutation"];
type CoreAgentPreparation = components["schemas"]["AgentOperationPreparation"];
type CoreCommittedDocument = components["schemas"][
  "CommittedModuleValue_OwnedDocumentCommitValue_OwnedDocumentReceipt"
];
type ToolError = ToolFailure["error"];

const MAX_PENDING_NATIVE_AGENT_UPDATES = 1_024;

interface PendingNativePageUpdate {
  readonly request: PrepareNodexAgentPageUpdateRequest;
  readonly operationId: string;
  readonly clientSessionId: string;
  readonly mutation: CoreAgentMutation;
  readonly token: string;
  committed?: CoreCommittedDocument;
}

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

const unsupported = (message: string): ToolError => ({
  code: "unsupported_resource",
  message,
  retryable: false,
  recovery: "none",
  details: { domainCode: "native_agent_update_variant_unavailable" },
});

const mapCoreError = (error: unknown): ToolError => {
  if (!(error instanceof CoreModuleResponseError)) {
    return {
      code: "internal_error",
      message: error instanceof Error ? error.message : "Native Agent Page update failed",
      retryable: false,
      recovery: "none",
    };
  }
  const code = error.coreError.code;
  if (code === "not_found") {
    return {
      code: "not_found",
      message: error.coreError.message,
      retryable: false,
      recovery: "none",
      details: { domainCode: code },
    };
  }
  if (code === "idempotency_key_reused") {
    return {
      code: "idempotency_collision",
      message: error.coreError.message,
      retryable: false,
      recovery: "none",
      details: { domainCode: code },
    };
  }
  if (
    code === "revision_conflict"
    || code === "stale_store_epoch"
    || code === "generation_conflict"
    || code === "head_conflict"
  ) {
    return {
      code: "conflict",
      message: error.coreError.message,
      retryable: error.coreError.retryable,
      recovery: "fetch_again",
      details: { domainCode: code },
    };
  }
  if (code === "unauthorized") {
    return {
      code: "authorization_denied",
      message: error.coreError.message,
      retryable: false,
      recovery: "start_new_task",
      details: { domainCode: code },
    };
  }
  return {
    code: code === "invalid_input" ? "invalid_arguments" : "internal_error",
    message: error.coreError.message,
    retryable: error.coreError.retryable,
    recovery: error.coreError.retryable ? "retry_same" : "none",
    details: { domainCode: code },
  };
};

const operationIdFor = (
  request: Pick<
    PrepareNodexAgentPageUpdateRequest,
    "threadId" | "callId" | "tool"
  >,
): string =>
  `nodex-agent-edit:${createHash("sha256").update(JSON.stringify([
    request.threadId,
    request.callId,
    request.tool,
  ])).digest("hex")}`;

const emptyEffects = (): AgentDocumentEditEffects => ({
  createdBlockIds: [],
  localBlockIds: {},
  copiedBlockIds: {},
  updatedBlockIds: [],
  movedBlockIds: [],
  deletedBlockIds: [],
  deletedOwnerBlockIds: [],
  titleChanged: false,
});

const effectsFromPreparation = (
  pageId: string,
  preparation: CoreAgentPreparation,
  titleChanged: boolean,
): AgentDocumentEditEffects => {
  const moved = new Set(
    preparation.footprint.ownership_transformations.map((item) => item.resource_id),
  );
  const deleted = new Set(preparation.footprint.deleted_roots);
  return {
    ...emptyEffects(),
    updatedBlockIds: preparation.footprint.updated_roots.filter((id) =>
      id !== pageId && !moved.has(id) && !deleted.has(id)
    ),
    movedBlockIds: [...moved],
    deletedBlockIds: [...deleted],
    titleChanged,
  };
};

const effectFromCommit = (
  committed: CoreCommittedDocument,
): NonNullable<CoreCommittedDocument["value"]["mutation_effect"]> | null =>
  committed.value.mutation_effect ?? null;

const toDocumentOperationResult = (
  pending: PendingNativePageUpdate,
  committed: CoreCommittedDocument,
): DocumentOperationResult => {
  const effect = effectFromCommit(committed);
  const committedAt = committed.value.committed_at;
  if (!committedAt) {
    throw new Error("Core Agent Page update omitted its commit timestamp");
  }
  return {
    version: 1,
    mutationKind: pending.request.tool === "update_page"
      && (pending.request.input.body?.kind === "replace"
        || pending.request.input.body?.kind === "patch")
      ? "replace_document_from_nfm"
      : "document_operation_batch",
    mutationId: pending.operationId,
    projectId: pending.request.projectId,
    storeEpoch: committed.store_epoch,
    documentId: committed.value.document_id,
    generation: committed.value.generation,
    baseHeadSeq: effect?.base_head_seq ?? committed.value.head_seq,
    headSeq: committed.value.head_seq,
    touchedBlockIds: effect?.touched_block_ids ?? [],
    createdBlockIds: effect?.created_block_ids ?? [],
    deletedBlockIds: effect?.deleted_block_ids ?? [],
    updatedBlockIds: effect?.updated_block_ids ?? [],
    movedBlockIds: effect?.moved_block_ids ?? [],
    writeFenceBlockIds: effect?.write_fence_block_ids ?? [],
    titleChanged: effect?.title_changed ?? false,
    coordination: effect?.coordination ?? "merge_friendly",
    changeLogSeq: committed.event_sequence,
    committedAt,
    duplicate: committed.receipt.duplicate,
  };
};

const mutationCommands = (
  request: PrepareNodexAgentPageUpdateRequest,
): CoreAgentMutation["commands"] | ToolError => {
  if (request.tool === "advanced_update_page") {
    return unsupported(
      "advanced_update_page will be enabled after native stable-Block ETag operations land",
    );
  }
  if (request.input.return?.includes("etags")) {
    return unsupported(
      "Native update_page ETag return projection is not available yet",
    );
  }
  if (request.input.body?.kind === "insert") {
    return unsupported(
      "Native update_page insertion will be enabled with stable Block insertion",
    );
  }
  return [
    ...(request.input.title
      ? [{
          kind: "set_title" as const,
          inline_markdown: request.input.title.markdown,
          expected_etag: request.input.title.ifMatch,
        }]
      : []),
    ...(request.input.body?.kind === "patch"
      ? request.input.body.patches.map((patch) => ({
          kind: "patch_body" as const,
          old_fragment: patch.oldMarkdown,
          new_fragment: patch.newMarkdown,
          expected_matches: patch.expectedMatches ?? null,
        }))
      : request.input.body?.kind === "replace"
        ? [{
            kind: "replace_body" as const,
            nested_markdown: request.input.body.markdown,
            expected_etag: request.input.body.ifMatch,
          }]
        : []),
  ];
};

const isToolError = (
  value: CoreAgentMutation["commands"] | ToolError,
): value is ToolError => !Array.isArray(value);

export class NativeNodexAgentPageUpdateRuntime {
  private readonly pending = new Map<string, PendingNativePageUpdate>();

  constructor(private readonly runtime: RustDataAuthorityRuntime) {}

  async prepare(
    request: PrepareNodexAgentPageUpdateRequest,
  ): Promise<BlockMutationEnvelope<PrepareNodexAgentPageUpdateResult>> {
    const operationId = operationIdFor(request);
    try {
      if (!request.authority) {
        return envelope({
          ok: false,
          error: {
            code: "authorization_denied",
            message: "Native Agent Page updates require exact Turn authority",
            retryable: false,
            recovery: "start_new_task",
          },
        }, operationId);
      }
      const commands = mutationCommands(request);
      if (isToolError(commands)) {
        return envelope({ ok: false, error: commands }, operationId);
      }
      const contentSnapshot = await this.runtime.rootClient.libraryRead({
        kind: "page_content",
        page_id: request.input.pageId,
      });
      if (contentSnapshot.value.kind !== "page_content") {
        throw new Error("Core returned the wrong Agent Page content variant");
      }
      const content = contentSnapshot.value.value;
      const targetMarkdown = request.tool === "update_page"
        && request.input.body?.kind === "patch"
        ? applyExactNfmPatches(
            content.body_nfm,
            request.input.body.patches.map((patch) => ({
              oldNfm: patch.oldMarkdown,
              newNfm: patch.newMarkdown,
              ...(patch.expectedMatches !== undefined
                ? { expectedMatches: patch.expectedMatches }
                : {}),
            })),
          )
        : request.tool === "update_page" && request.input.body?.kind === "replace"
          ? request.input.body.markdown
          : content.body_nfm;
      const mutation: CoreAgentMutation = {
        document_id: content.document_id,
        generation: content.document_generation,
        expected_head_seq: content.document_head_seq,
        commands,
      };
      const clientSessionId = `nodex-agent:${request.threadId}`.slice(0, 512);
      const client = this.runtime.clientForProject(request.projectId);
      const snapshot = await client.documentRead(clientSessionId, {
        kind: "prepare_agent_semantic_mutation",
        operation_id: operationId,
        store_epoch: request.authority.storeEpoch,
        provenance: toCoreAgentTurnProvenance(
          this.runtime.rootClient.handshake.profile_id,
          request.authority,
        ),
        mutation,
      });
      if (snapshot.value.kind !== "agent_semantic_mutation_preparation") {
        throw new Error("Core returned the wrong Agent Page update preparation variant");
      }
      if (snapshot.value.preparation.state === "committed_replay") {
        if (!snapshot.value.committed) {
          throw new Error("Core Agent replay omitted its committed result");
        }
        const output = await this.output(request, snapshot.value.committed);
        return envelope({ ok: true, value: { kind: "completed", output } }, operationId);
      }
      const token = snapshot.value.preparation.token;
      if (!token) throw new Error("Core Agent preparation omitted its execution token");
      const effects = effectsFromPreparation(
        request.input.pageId,
        snapshot.value.preparation,
        request.tool === "update_page" && request.input.title !== undefined,
      );
      const pending: PendingNativePageUpdate = {
        request,
        operationId,
        clientSessionId,
        mutation,
        token,
      };
      this.retain(pending);
      const fakeMutation: DocumentMutationRequest = {
        version: 1,
        mutationId: operationId,
        projectId: request.projectId,
        storeEpoch: request.authority.storeEpoch,
        clientSessionId,
        actor: {
          kind: "nodex_agent",
          threadId: request.threadId,
          callId: request.callId,
        },
        documentId: content.document_id,
        generation: content.document_generation,
        expectedHeadSeq: content.document_head_seq,
        operations: [],
      };
      return envelope({
        ok: true,
        value: {
          kind: "prepared",
          mutation: fakeMutation,
          effects,
          targetMarkdown,
          ...(request.resourceAccess
            ? { resourceAccess: request.resourceAccess }
            : {}),
        },
      }, operationId);
    } catch (error) {
      const mapped = error instanceof AgentDocumentEditCompilerError
        ? {
            code: error.code,
            message: error.message,
            retryable: false,
            recovery: error.code === "nfm_patch_mismatch"
              || error.code === "nfm_patch_overlap"
              ? "fetch_again" as const
              : "none" as const,
          }
        : mapCoreError(error);
      return envelope({ ok: false, error: mapped }, operationId);
    }
  }

  async apply(
    request: DocumentMutationRequest,
  ): Promise<DocumentOperationCommandResult> {
    const pending = this.pending.get(request.mutationId);
    const authority = pending?.request.authority;
    const matchesPreparation = pending
      && authority
      && request.projectId === pending.request.projectId
      && request.storeEpoch === authority.storeEpoch
      && request.clientSessionId === pending.clientSessionId
      && request.documentId === pending.mutation.document_id
      && request.generation === pending.mutation.generation
      && request.expectedHeadSeq === pending.mutation.expected_head_seq
      && "operations" in request
      && request.operations.length === 0
      && request.actor.kind === "nodex_agent"
      && request.actor.threadId === pending.request.threadId
      && request.actor.callId === pending.request.callId;
    if (!matchesPreparation) {
      return {
        ok: false,
        error: {
          code: "mutation_id_collision",
          message: "Native Agent Page update has no matching preparation",
          retryable: false,
          mutationId: request.mutationId,
        },
      };
    }
    try {
      const committed = await this.runtime.clientForProject(pending.request.projectId)
        .documentApply({
          operationId: pending.operationId,
          clientSessionId: pending.clientSessionId,
          intent: {
            kind: "execute_prepared_agent_semantic_mutation",
            authorization: {
              provenance: toCoreAgentTurnProvenance(
                this.runtime.rootClient.handshake.profile_id,
                authority,
              ),
              token: pending.token,
            },
            mutation: pending.mutation,
          },
        });
      pending.committed = committed;
      return { ok: true, value: toDocumentOperationResult(pending, committed) };
    } catch (error) {
      this.pending.delete(pending.operationId);
      const mapped = mapCoreError(error);
      return {
        ok: false,
        error: {
          code: mapped.code === "conflict"
            ? "document_head_conflict"
            : mapped.code === "not_found"
              ? "document_not_found"
              : "unknown",
          message: mapped.message,
          retryable: mapped.retryable,
          mutationId: pending.operationId,
        },
      };
    }
  }

  async complete(
    request: CompleteNodexAgentPageUpdateRequest,
  ): Promise<BlockMutationEnvelope<CompleteNodexAgentPageUpdateResult>> {
    const operationId = operationIdFor(request);
    const pending = this.pending.get(operationId);
    const committed = pending?.committed;
    const matchesCommit = pending
      && committed
      && request.projectId === pending.request.projectId
      && request.pageId === pending.request.input.pageId
      && request.result.mutationId === operationId
      && request.result.projectId === pending.request.projectId
      && request.result.storeEpoch === committed.store_epoch
      && request.result.documentId === committed.value.document_id
      && request.result.generation === committed.value.generation
      && request.result.headSeq === committed.value.head_seq;
    if (!matchesCommit) {
      return envelope({
        ok: false,
        error: {
          code: "idempotency_collision",
          message: "Native Agent Page update has no matching committed preparation",
          retryable: false,
          recovery: "retry_same",
        },
      }, operationId);
    }
    try {
      const output = await this.output(pending.request, committed);
      this.pending.delete(operationId);
      return envelope({ ok: true, output }, operationId);
    } catch (error) {
      return envelope({ ok: false, error: mapCoreError(error) }, operationId);
    }
  }

  private retain(pending: PendingNativePageUpdate): void {
    this.pending.delete(pending.operationId);
    this.pending.set(pending.operationId, pending);
    while (this.pending.size > MAX_PENDING_NATIVE_AGENT_UPDATES) {
      const oldest = this.pending.keys().next().value as string | undefined;
      if (!oldest) return;
      this.pending.delete(oldest);
    }
  }

  private async output(
    request: PrepareNodexAgentPageUpdateRequest,
    committed: CoreCommittedDocument,
  ) {
    const effect = effectFromCommit(committed);
    const wantsMarkdown = request.input.return?.includes("markdown") ?? false;
    const wantsBlockIds = request.input.return?.includes("block_ids") ?? false;
    const contentSnapshot = wantsMarkdown
      ? await this.runtime.rootClient.libraryRead({
          kind: "page_content",
          page_id: request.input.pageId,
        })
      : null;
    const content = contentSnapshot?.value.kind === "page_content"
      && contentSnapshot.value.value.document_generation === committed.value.generation
      && contentSnapshot.value.value.document_head_seq === committed.value.head_seq
      ? contentSnapshot.value.value
      : null;
    const created = effect?.created_block_ids ?? [];
    const updated = effect?.updated_block_ids ?? [];
    const moved = effect?.moved_block_ids ?? [];
    const deleted = effect?.deleted_block_ids ?? [];
    return UpdatePageV3OutputSchema.parse({
      data: {
        pageId: request.input.pageId,
        effects: {
          created: created.length,
          updated: updated.length,
          moved: moved.length,
          deleted: deleted.length,
          ...(wantsBlockIds
            ? {
                blockIds: {
                  created,
                  local: {},
                  copied: {},
                  updated,
                  moved,
                  deleted,
                },
              }
            : {}),
        },
        ...(content
          ? {
              body: {
                format: "markdown",
                markdown: content.body_nfm,
                contentHash: createHash("sha256")
                  .update(content.body_nfm)
                  .digest("hex"),
              },
            }
          : {}),
      },
    });
  }
}
