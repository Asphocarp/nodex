import {
  BLOCK_TRANSFER_CONTRACT_VERSION,
  parseBlockTransferIntent,
  type BlockTransferCommandError,
  type BlockTransferCommandResult,
  type BlockTransferIntent,
  type BlockTransferReceipt,
  type BlockTransferTransformationEvidence,
} from "../../shared/block-transfer";
import { blockTransferFailure } from "../../shared/block-transfer-transport";
import type { BlockLocation } from "../../shared/block-documents/contracts";
import { CoreModuleResponseError } from "./core-client";
import { applyResultCursor, rendererLocalCommitApply } from "./types";
import type {
  CoreClientPort,
  LibraryIntent,
  LibraryApplyResult,
} from "./types";

export interface CoreBlockTransferAdapterInput {
  readonly client: CoreClientPort;
  readonly libraryId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
}

export interface CoreBlockTransferAdapter {
  commit(
    intent: BlockTransferIntent,
  ): Promise<BlockTransferCommandResult>;
}

type CoreTransferResult = NonNullable<LibraryApplyResult["outcome"]["block_transfer"]>;
type CoreTransferIntent = Extract<LibraryIntent, { kind: "transfer_blocks" }>["intent"];
const toCoreIntent = (intent: BlockTransferIntent): CoreTransferIntent => ({
  actor: intent.actor,
  mode: intent.mode,
  root_block_ids: intent.rootBlockIds,
  causal_dependencies: (intent.causalDependencies ?? []).map((dependency) => ({
    document_id: dependency.documentId,
    generation: dependency.generation,
    expected_head_seq: dependency.expectedHeadSeq,
  })),
  source: (() => {
    switch (intent.source.kind) {
      case "library":
        return { kind: "library" as const, library_id: intent.source.libraryId };
      case "page":
        return { kind: "page" as const, page_id: intent.source.pageId };
      case "document":
        return { kind: "document" as const, document_id: intent.source.documentId };
      case "data_source":
        return { kind: "data_source" as const, data_source_id: intent.source.dataSourceId };
    }
  })(),
  target: (() => {
    switch (intent.target.kind) {
      case "library":
        return {
          kind: "library" as const,
          library_id: intent.target.libraryId,
          before_block_id: intent.target.beforeBlockId ?? null,
        };
      case "page":
        return {
          kind: "page" as const,
          page_id: intent.target.pageId,
          parent_block_id: intent.target.parentBlockId ?? null,
          before_block_id: intent.target.beforeBlockId ?? null,
        };
      case "document":
        return {
          kind: "document" as const,
          document_id: intent.target.documentId,
          parent_block_id: intent.target.parentBlockId ?? null,
          before_block_id: intent.target.beforeBlockId ?? null,
        };
      case "data_source":
        return {
          kind: "data_source" as const,
          data_source_id: intent.target.dataSourceId,
          view_id: intent.target.viewId,
          group_key: intent.target.groupKey,
          before_page_id: intent.target.beforePageId ?? null,
        };
    }
  })(),
});

const assertIntentScope = (
  input: CoreBlockTransferAdapterInput,
  intent: BlockTransferIntent,
): BlockTransferCommandError | null => {
  if (intent.projectId !== input.projectId) {
    return blockTransferFailure(
      "invalid_transfer_request",
      "Block transfer belongs to another Project",
      { operationId: intent.operationId },
    );
  }
  if (intent.storeEpoch !== input.storeEpoch) {
    return blockTransferFailure(
      "store_epoch_mismatch",
      "Block transfer belongs to another store epoch",
      { operationId: intent.operationId, reloadRequired: true },
    );
  }
  const referencedLibraryIds = [intent.source, intent.target]
    .filter((location) => location.kind === "library")
    .map((location) => location.libraryId);
  if (referencedLibraryIds.some((libraryId) => libraryId !== input.libraryId)) {
    return blockTransferFailure(
      "invalid_transfer_request",
      "Block transfer belongs to another Library",
      { operationId: intent.operationId },
    );
  }
  return null;
};

const fromCoreLocation = (
  location: CoreTransferResult["final_locations"][string],
): BlockLocation => {
  switch (location.kind) {
    case "library":
      return {
        kind: "space",
        projectId: location.project_id,
        rankKey: location.rank_key,
      };
    case "document":
      return { kind: "document", documentId: location.document_id };
    case "data_source":
      return { kind: "database", databaseBlockId: location.database_id };
  }
};

const requireRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  throw new Error(`${label} is not an object`);
};

const requireString = (
  value: unknown,
  label: string,
): string => {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${label} is not a non-empty string`);
};

const requireStringArray = (
  value: unknown,
  label: string,
): readonly string[] => {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  throw new Error(`${label} is not a string array`);
};

const fromCoreTransformation = (
  value: unknown,
): BlockTransferTransformationEvidence => {
  const evidence = requireRecord(value, "Core Block transformation evidence");
  const kind = evidence.kind;
  if (kind !== "promote" && kind !== "wrap") {
    throw new Error("Core Block transformation kind is invalid");
  }
  const sourceToResult = requireRecord(
    evidence.sourceToResultBlockIds,
    "Core Block transformation identity map",
  );
  const sourceToResultBlockIds = Object.fromEntries(
    Object.entries(sourceToResult).map(([sourceId, resultId]) => [
      sourceId,
      requireString(resultId, `Core Block transformation identity ${sourceId}`),
    ]),
  );
  const wrapperReason = evidence.wrapperReason;
  if (
    wrapperReason != null &&
    wrapperReason !== "type_requires_wrapper" &&
    wrapperReason !== "unsupported_primary_content" &&
    wrapperReason !== "unmapped_type_state"
  ) {
    throw new Error("Core Block transformation wrapper reason is invalid");
  }
  return {
    sourceBlockId: requireString(evidence.sourceBlockId, "Core transformation source"),
    resultPageId: requireString(evidence.resultPageId, "Core transformation Page"),
    kind,
    sourceBlockType: requireString(evidence.sourceBlockType, "Core transformation type"),
    semanticTitleHash: requireString(
      evidence.semanticTitleHash,
      "Core transformation title hash",
    ),
    consumedPropertyKeys: requireStringArray(
      evidence.consumedPropertyKeys,
      "Core transformation consumed properties",
    ),
    ...(wrapperReason == null ? {} : { wrapperReason }),
    bodyRootBlockIds: requireStringArray(
      evidence.bodyRootBlockIds,
      "Core transformation body roots",
    ),
    sourceToResultBlockIds,
  };
};

const fromCoreResult = (
  intent: BlockTransferIntent,
  result: CoreTransferResult,
  duplicate: boolean,
  commitSeq: number,
  committedAt: string,
): BlockTransferReceipt => {
  return {
    version: BLOCK_TRANSFER_CONTRACT_VERSION,
    operationId: intent.operationId,
    projectId: intent.projectId,
    storeEpoch: intent.storeEpoch,
    mode: result.mode,
    duplicate,
    sourceRootBlockIds: result.source_root_block_ids,
    resultRootBlockIds: result.result_root_block_ids,
    copiedBlockIds: result.copied_block_ids,
    transformationEvidence: result.transformation_evidence.map(fromCoreTransformation),
    finalLocations: Object.fromEntries(
      Object.entries(result.final_locations).map(([blockId, location]) => [
        blockId,
        fromCoreLocation(location),
      ]),
    ),
    finalLocationRevisions: result.final_location_revisions,
    documentCommits: result.document_commits.map((commit) => ({
      documentId: commit.document_id,
      generation: commit.generation,
      baseHeadSeq: commit.base_head_seq,
      headSeq: commit.head_seq,
      updateId: commit.update_id,
      update: Uint8Array.from(commit.update),
      stateVector: Uint8Array.from(commit.state_vector),
    })),
    affectedDatabaseBlockIds: result.affected_database_ids,
    commitSeq,
    committedAt,
  };
};

const coreFailure = (
  intent: Pick<BlockTransferIntent, "operationId">,
  error: unknown,
): BlockTransferCommandError => {
  if (!(error instanceof CoreModuleResponseError)) {
    return blockTransferFailure(
      "unknown",
      error instanceof Error ? error.message : String(error),
      { operationId: intent.operationId, retryable: true },
    );
  }
  const options = {
    operationId: intent.operationId,
    retryable: error.coreError.retryable,
  };
  switch (error.coreError.code) {
    case "invalid_input":
      return blockTransferFailure("unsupported_transfer", error.message, options);
    case "unauthorized":
      return blockTransferFailure("invalid_transfer_request", error.message, options);
    case "not_found":
      return blockTransferFailure("block_not_found", error.message, options);
    case "stale_store_epoch":
      return blockTransferFailure("store_epoch_mismatch", error.message, {
        ...options,
        reloadRequired: true,
      });
    case "idempotency_key_reused":
      return blockTransferFailure("operation_id_collision", error.message, options);
    case "revision_conflict":
    case "head_conflict":
    case "generation_conflict":
      return blockTransferFailure("source_head_mismatch", error.message, {
        ...options,
        reloadRequired: true,
      });
    case "store_corrupt":
      return blockTransferFailure("recovery_required", error.message, {
        ...options,
        reloadRequired: true,
      });
    default:
      return blockTransferFailure("unknown", error.message, options);
  }
};

export const createCoreBlockTransferAdapter = (
  input: CoreBlockTransferAdapterInput,
): CoreBlockTransferAdapter => {
  return {
    commit: async (rawIntent) => {
      let intent: BlockTransferIntent;
      try {
        intent = parseBlockTransferIntent(rawIntent);
      } catch (error) {
        return { ok: false, error: coreFailure(rawIntent, error) };
      }
      const scopeError = assertIntentScope(input, intent);
      if (scopeError) return { ok: false, error: scopeError };
      try {
        const committed = await input.client.libraryApply({
          operationId: intent.operationId,
          intent: {
            kind: "transfer_blocks",
            intent: toCoreIntent(intent),
          },
        });
        const result = committed.outcome.block_transfer;
        if (!result || committed.receipt.operation_kind !== "transfer_blocks") {
          throw new Error("Core returned the wrong Library commit for Block transfer");
        }
        return {
          ok: true,
          localCommit: rendererLocalCommitApply(committed),
          value: fromCoreResult(
            intent,
            result,
            committed.receipt.duplicate,
            applyResultCursor(committed),
            committed.receipt.committed_at,
          ),
        };
      } catch (error) {
        return { ok: false, error: coreFailure(intent, error) };
      }
    },
  };
};
