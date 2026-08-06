import { createHash } from "node:crypto";
import type {
  DocumentMutationRequest,
  DocumentOperationCommandResult,
  DocumentOperationResult,
} from "../../shared/block-documents/document-operations";
import {
  type CompleteNodexAgentPageUpdateRequest,
  type CompleteNodexAgentPageUpdateResult,
  type PrepareNodexAgentPageUpdateRequest,
  type PrepareNodexAgentPageUpdateResult,
} from "../../shared/nodex-agent-tools/v3-write-runtime";
import type { AgentDocumentEditEffects } from "../../shared/nodex-agent-tools/document-edit-compiler";
import type { ToolFailure } from "../../shared/nodex-agent-tools/base-schemas";
import { UpdatePageV3OutputSchema } from "../../shared/nodex-agent-tools/v3-write-schemas";
import {
  AgentDocumentEditCompilerError,
} from "../../shared/nodex-agent-tools/exact-nfm-patches";
import type { NodexAgentMutationEnvelope } from "../agent-tools/dynamic-service-v3-port";
import { CoreModuleResponseError } from "./core-client";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { toCoreAgentExecutionAuthorization } from "./desktop-nodex-agent-resource-authority";
import type { BlockRecordApplyInput, BlockRecordCommittedValue } from "./types";
import {
  materializeCanonicalAgentPage,
  planCanonicalAgentPageUpdate,
  CanonicalAgentPreconditionError,
} from "./canonical-agent-page-update";
import { blockRecordSnapshotToWindow } from "../../shared/block-records";
import { canonicalAgentPageEtag } from "./canonical-agent-etag";
type ToolError = ToolFailure["error"];

const MAX_PENDING_NATIVE_AGENT_UPDATES = 1_024;

interface PendingNativePageUpdate {
  readonly request: PrepareNodexAgentPageUpdateRequest;
  readonly operationId: string;
  readonly clientSessionId: string;
  readonly apply: BlockRecordApplyInput;
  readonly effects: AgentDocumentEditEffects;
  readonly observedCommitSeq: number;
  committed?: BlockRecordCommittedValue;
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

export const mapNativeNodexAgentCoreError = (error: unknown): ToolError => {
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
  if (code === "protected_owner_deletion") {
    return {
      code: "protected_owner_deletion",
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

const toDocumentOperationResult = (
  pending: PendingNativePageUpdate,
  committed: BlockRecordCommittedValue,
): DocumentOperationResult => {
  const effects = pending.effects;
  const touchedBlockIds = [...new Set([
    ...effects.createdBlockIds,
    ...effects.updatedBlockIds,
    ...effects.movedBlockIds,
    ...effects.deletedBlockIds,
  ])];
  return {
    version: 1,
    mutationKind: pending.request.tool === "update_page"
      && (pending.request.input.body?.kind === "replace"
        || pending.request.input.body?.kind === "patch")
      ? "replace_document_from_nfm"
      : "document_operation_batch",
    mutationId: pending.operationId,
    projectId: pending.request.projectId,
    storeEpoch: committed.cursor.store_epoch,
    documentId: pending.request.input.pageId,
    generation: 1,
    baseHeadSeq: pending.observedCommitSeq,
    headSeq: committed.cursor.commit_seq,
    touchedBlockIds,
    createdBlockIds: effects.createdBlockIds,
    deletedBlockIds: effects.deletedBlockIds,
    updatedBlockIds: effects.updatedBlockIds,
    movedBlockIds: effects.movedBlockIds,
    writeFenceBlockIds: effects.deletedBlockIds,
    titleChanged: effects.titleChanged,
    coordination: effects.deletedBlockIds.length > 0 ? "write_fence" : "merge_friendly",
    changeLogSeq: committed.cursor.commit_seq,
    committedAt: committed.committed_at,
    duplicate: committed.duplicate,
  };
};

export class NativeNodexAgentPageUpdateRuntime {
  private readonly pending = new Map<string, PendingNativePageUpdate>();

  constructor(private readonly runtime: RustDataAuthorityRuntime) {}

  async prepare(
    request: PrepareNodexAgentPageUpdateRequest,
  ): Promise<NodexAgentMutationEnvelope<PrepareNodexAgentPageUpdateResult>> {
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
      const authorization = toCoreAgentExecutionAuthorization(
        this.runtime.identity.profileId,
        request.authority,
        request.callId,
        request.resourceAccess,
      );
      const clientSessionId = `nodex-agent:${request.threadId}`.slice(0, 512);
      const client = this.runtime.clientForProject(request.projectId);
      const plan = await planCanonicalAgentPageUpdate({
        client,
        libraryId: request.authority.libraryId,
        storeEpoch: request.authority.storeEpoch,
        operationId,
        actorId: `profile:${this.runtime.identity.profileId}`,
        sessionId: clientSessionId,
        pageId: request.input.pageId,
        input: request.input,
        authorization,
      });
      const pending: PendingNativePageUpdate = {
        request,
        operationId,
        clientSessionId,
        apply: plan.apply,
        effects: plan.effects,
        observedCommitSeq: plan.current.observedLocalCommit.commitSeq,
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
        documentId: request.input.pageId,
        generation: 1,
        expectedHeadSeq: plan.current.observedLocalCommit.commitSeq,
        operations: [],
      };
      return envelope({
        ok: true,
        value: {
          kind: "prepared",
          mutation: fakeMutation,
          effects: plan.effects,
          targetMarkdown: plan.target.nfm,
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
        : error instanceof CanonicalAgentPreconditionError
          ? {
              code: "conflict" as const,
              message: error.message,
              retryable: false,
              recovery: "fetch_again" as const,
              details: {
                resourceId: error.resourceId,
                domainCode: "canonical_etag_mismatch",
              },
            }
        : mapNativeNodexAgentCoreError(error);
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
      && request.documentId === pending.request.input.pageId
      && request.generation === 1
      && request.expectedHeadSeq === pending.observedCommitSeq
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
        .blockRecordApply(pending.apply);
      pending.committed = committed;
      return { ok: true, value: toDocumentOperationResult(pending, committed) };
    } catch (error) {
      this.pending.delete(pending.operationId);
      const mapped = mapNativeNodexAgentCoreError(error);
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
  ): Promise<NodexAgentMutationEnvelope<CompleteNodexAgentPageUpdateResult>> {
    const operationId = operationIdFor(request);
    const pending = this.pending.get(operationId);
    const committed = pending?.committed;
    const matchesCommit = pending
      && committed
      && request.projectId === pending.request.projectId
      && request.pageId === pending.request.input.pageId
      && request.result.mutationId === operationId
      && request.result.projectId === pending.request.projectId
      && request.result.storeEpoch === committed.cursor.store_epoch
      && request.result.documentId === pending.request.input.pageId
      && request.result.generation === 1
      && request.result.headSeq === committed.cursor.commit_seq;
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
      const output = await this.output(pending.request);
      this.pending.delete(operationId);
      return envelope({ ok: true, output }, operationId);
    } catch (error) {
      return envelope({
        ok: false,
        error: mapNativeNodexAgentCoreError(error),
      }, operationId);
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
  ) {
    const wantsMarkdown = request.input.return?.includes("markdown") ?? false;
    const wantsBlockIds = request.input.return?.includes("block_ids") ?? false;
    const wantsEtags = request.input.return?.includes("etags") ?? false;
    const pending = this.pending.get(operationIdFor(request));
    if (!pending) throw new Error("Canonical Agent Page update pending state disappeared");
    const needsRead = wantsMarkdown || wantsEtags;
    const read = {
      kind: "window" as const,
      parent: { kind: "block" as const, id: request.input.pageId },
      include_content: needsRead,
      include_descendants: needsRead,
    };
    const window = needsRead
      ? blockRecordSnapshotToWindow(
          await this.runtime.clientForProject(request.projectId).blockRecordRead(
            read,
            request.authority
              ? toCoreAgentExecutionAuthorization(
                  this.runtime.identity.profileId,
                  request.authority,
                  request.callId,
                  request.resourceAccess,
                )
              : undefined,
          ),
          read,
        )
      : null;
    const materialization = window
      ? materializeCanonicalAgentPage(window, request.input.pageId)
      : null;
    const created = pending.effects.createdBlockIds;
    const updated = pending.effects.updatedBlockIds;
    const moved = pending.effects.movedBlockIds;
    const deleted = pending.effects.deletedBlockIds;
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
                  local: pending.effects.localBlockIds,
                  copied: {},
                  updated,
                  moved,
                  deleted,
                },
              }
            : {}),
        },
        ...(wantsEtags && materialization
          ? {
              etags: {
                title: canonicalAgentPageEtag(
                  "title",
                  request.input.pageId,
                  materialization.richTitle,
                ),
                body: canonicalAgentPageEtag(
                  "body",
                  request.input.pageId,
                  materialization.nfm,
                ),
              },
            }
          : {}),
        ...(materialization && wantsMarkdown
          ? {
              body: {
                format: "markdown",
                markdown: materialization.nfm,
                contentHash: createHash("sha256")
                  .update(materialization.nfm)
                  .digest("hex"),
              },
            }
          : {}),
      },
    });
  }
}
