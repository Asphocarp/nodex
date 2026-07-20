import {
  BLOCK_TRANSFER_CONTRACT_VERSION,
  blockTransferIntentFromRequest,
  parseBlockTransferIntent,
  parseBlockTransferRequest,
  type BlockTransferCommandError,
  type BlockTransferCommandResult,
  type BlockTransferDocumentHead,
  type BlockTransferIntent,
  type BlockTransferPreparation,
  type BlockTransferReceipt,
  type BlockTransferRequest,
  type BlockTransferTransformationEvidence,
} from "../../shared/block-transfer";
import { blockTransferFailure } from "../../shared/block-transfer-transport";
import type { BlockLocation } from "../../shared/block-documents/contracts";
import { CoreModuleResponseError } from "./core-client";
import type {
  CoreClientPort,
  LibraryIntent,
  LibraryRead,
  LibraryReadSnapshot,
} from "./types";

export interface CoreBlockTransferAdapterInput {
  readonly client: CoreClientPort;
  readonly libraryId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
}

export interface CoreBlockTransferAdapter {
  lookupCommitted(
    intent: BlockTransferIntent,
  ): Promise<BlockTransferCommandResult<BlockTransferReceipt | null>>;
  prepare(
    intent: BlockTransferIntent,
  ): Promise<BlockTransferCommandResult<BlockTransferPreparation>>;
  apply(request: BlockTransferRequest): Promise<BlockTransferCommandResult>;
}

type CoreTransferPlan = Extract<
  LibraryReadSnapshot["value"],
  { kind: "block_transfer_plan" }
>["value"];
type CoreTransferResult = Extract<CoreTransferPlan, { kind: "committed" }>["result"];
type CoreTransferIntent = Extract<LibraryIntent, { kind: "transfer_blocks" }>["intent"];
type CoreTransferWriteFence = NonNullable<
  Extract<LibraryIntent, { kind: "transfer_blocks" }>["write_fence"]
>;

const toCoreIntent = (intent: BlockTransferIntent): CoreTransferIntent => ({
  actor: intent.actor,
  mode: intent.mode,
  root_block_ids: intent.rootBlockIds,
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

const corePlanRead = (intent: BlockTransferIntent): LibraryRead => ({
  kind: "plan_block_transfer",
  operation_id: intent.operationId,
  store_epoch: intent.storeEpoch,
  intent: toCoreIntent(intent),
});

const readPlan = async (
  client: CoreClientPort,
  intent: BlockTransferIntent,
): Promise<CoreTransferPlan> => {
  const snapshot = await client.libraryRead(corePlanRead(intent));
  if (snapshot.store_epoch !== intent.storeEpoch) {
    throw new Error("Core returned a Block transfer plan from another store epoch");
  }
  if (snapshot.value.kind !== "block_transfer_plan") {
    throw new Error("Core returned the wrong Library read projection for Block transfer");
  }
  return snapshot.value.value;
};

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

const toDocumentHead = (
  head: {
    readonly document_id: string;
    readonly generation: number;
    readonly expected_head_seq: number;
  },
): BlockTransferDocumentHead => ({
  documentId: head.document_id,
  generation: head.generation,
  expectedHeadSeq: head.expected_head_seq,
});

const requireHead = (
  heads: readonly BlockTransferDocumentHead[],
  documentId: string,
): BlockTransferDocumentHead => {
  const head = heads.find((candidate) => candidate.documentId === documentId);
  if (!head) throw new Error(`Core omitted Block transfer Document head ${documentId}`);
  return head;
};

const toPreparedRequest = (
  intent: BlockTransferIntent,
  plan: Extract<CoreTransferPlan, { kind: "prepared" }>["preparation"],
): BlockTransferPreparation => {
  const leaseDocuments = plan.write_fence.documents.map(toDocumentHead);
  const source: BlockTransferRequest["source"] = (() => {
    if (intent.source.kind === "library") {
      if (plan.source_document_id != null || plan.source_database_id != null) {
        throw new Error("Core returned storage authority for a Library source");
      }
      return { kind: "space", libraryId: intent.source.libraryId };
    }
    if (intent.source.kind === "data_source") {
      if (plan.source_document_id != null || plan.source_database_id == null) {
        throw new Error("Core returned invalid Data Source source authority");
      }
      return {
        kind: "database",
        databaseBlockId: plan.source_database_id,
        dataSourceId: intent.source.dataSourceId,
        memberships: Object.fromEntries(
          Object.entries(plan.write_fence.source_memberships).map(
            ([blockId, membership]) => [blockId, {
              membershipId: membership.membership_id,
              revision: membership.revision,
            }],
          ),
        ),
      };
    }
    if (plan.source_document_id == null || plan.source_database_id != null) {
      throw new Error("Core omitted the Block transfer source Document");
    }
    const sourceHead = requireHead(leaseDocuments, plan.source_document_id);
    return {
      kind: "document",
      documentId: plan.source_document_id,
      ...(intent.source.kind === "page" ? { pageId: intent.source.pageId } : {}),
      generation: sourceHead.generation,
      expectedHeadSeq: sourceHead.expectedHeadSeq,
    };
  })();
  const target: BlockTransferRequest["target"] = (() => {
    if (intent.target.kind === "library") {
      if (plan.target_document_id != null || plan.target_database_id != null) {
        throw new Error("Core returned storage authority for a Library placement");
      }
      return {
        kind: "space",
        libraryId: intent.target.libraryId,
        ...(intent.target.beforeBlockId
          ? { beforeBlockId: intent.target.beforeBlockId }
          : {}),
      };
    }
    if (intent.target.kind === "data_source") {
      if (plan.target_document_id != null || plan.target_database_id == null) {
        throw new Error("Core returned invalid Data Source placement authority");
      }
      return {
        kind: "database",
        databaseBlockId: plan.target_database_id,
        dataSourceId: intent.target.dataSourceId,
        viewId: intent.target.viewId,
        groupKey: intent.target.groupKey,
        ...(intent.target.beforePageId
          ? { beforePageId: intent.target.beforePageId }
          : {}),
      };
    }
    if (plan.target_document_id == null || plan.target_database_id != null) {
      throw new Error("Core omitted the Block transfer target Document");
    }
    const targetHead = requireHead(leaseDocuments, plan.target_document_id);
    return {
      kind: "document",
      documentId: plan.target_document_id,
      ...(intent.target.kind === "page" ? { pageId: intent.target.pageId } : {}),
      generation: targetHead.generation,
      expectedHeadSeq: targetHead.expectedHeadSeq,
      ...(intent.target.parentBlockId
        ? { parentBlockId: intent.target.parentBlockId }
        : {}),
      ...(intent.target.beforeBlockId
        ? { beforeBlockId: intent.target.beforeBlockId }
        : {}),
    };
  })();
  const request: BlockTransferRequest = {
    version: BLOCK_TRANSFER_CONTRACT_VERSION,
    operationId: intent.operationId,
    projectId: intent.projectId,
    storeEpoch: intent.storeEpoch,
    ...(intent.clientSessionId ? { clientSessionId: intent.clientSessionId } : {}),
    actor: intent.actor,
    mode: intent.mode,
    rootBlockIds: intent.rootBlockIds,
    expectedLocationRevisions: plan.write_fence.location_revisions,
    source,
    target,
  };
  return { request: parseBlockTransferRequest(request), leaseDocuments };
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
  changeLogSeq: number,
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
    changeLogSeq,
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

const exactWriteFence = (request: BlockTransferRequest) => {
  const heads: BlockTransferDocumentHead[] = [];
  if (request.source.kind === "document") {
    heads.push({
      documentId: request.source.documentId,
      generation: request.source.generation,
      expectedHeadSeq: request.source.expectedHeadSeq,
    });
  }
  if (request.target.kind === "document") {
    heads.push({
      documentId: request.target.documentId,
      generation: request.target.generation,
      expectedHeadSeq: request.target.expectedHeadSeq,
    });
  }
  return {
    documents: [...new Map(heads.map((head) => [head.documentId, head])).values()]
      .sort((left, right) => left.documentId.localeCompare(right.documentId))
      .map((head) => ({
        document_id: head.documentId,
        generation: head.generation,
        expected_head_seq: head.expectedHeadSeq,
      })),
    location_revisions: request.expectedLocationRevisions,
    source_memberships: request.source.kind === "database"
      ? Object.fromEntries(
          Object.entries(request.source.memberships).map(([blockId, membership]) => [
            blockId,
            {
              membership_id: membership.membershipId,
              revision: membership.revision,
            },
          ]),
        )
      : {},
  };
};

const canUsePreparedWriteFence = (
  prepared: CoreTransferWriteFence,
  declared: CoreTransferWriteFence,
): boolean => {
  const preparedDocuments = new Map(
    prepared.documents.map((head) => [head.document_id, head]),
  );
  return declared.documents.every((head) => {
    const planned = preparedDocuments.get(head.document_id);
    return planned?.generation === head.generation
      && planned.expected_head_seq === head.expected_head_seq;
  })
    && JSON.stringify(prepared.location_revisions)
      === JSON.stringify(declared.location_revisions)
    && JSON.stringify(prepared.source_memberships)
      === JSON.stringify(declared.source_memberships);
};

export const createCoreBlockTransferAdapter = (
  input: CoreBlockTransferAdapterInput,
): CoreBlockTransferAdapter => {
  const preparedWriteFences = new Map<string, {
    readonly intent: CoreTransferIntent;
    readonly writeFence: CoreTransferWriteFence;
  }>();
  return {
  lookupCommitted: async (rawIntent) => {
    let intent: BlockTransferIntent;
    try {
      intent = parseBlockTransferIntent(rawIntent);
    } catch (error) {
      return { ok: false, error: coreFailure(rawIntent, error) };
    }
    const scopeError = assertIntentScope(input, intent);
    if (scopeError) return { ok: false, error: scopeError };
    try {
      const plan = await readPlan(input.client, intent);
      if (plan.kind === "prepared") return { ok: true, value: null };
      return {
        ok: true,
        value: fromCoreResult(
          intent,
          plan.result,
          true,
          plan.change_log_seq,
          plan.committed_at,
        ),
      };
    } catch (error) {
      return { ok: false, error: coreFailure(intent, error) };
    }
  },
  prepare: async (rawIntent) => {
    let intent: BlockTransferIntent;
    try {
      intent = parseBlockTransferIntent(rawIntent);
    } catch (error) {
      return { ok: false, error: coreFailure(rawIntent, error) };
    }
    const scopeError = assertIntentScope(input, intent);
    if (scopeError) return { ok: false, error: scopeError };
    try {
      const plan = await readPlan(input.client, intent);
      if (plan.kind === "committed") {
        return {
          ok: false,
          error: blockTransferFailure(
            "unknown",
            "Block transfer committed while its lease plan was being refreshed; retry recovers the receipt",
            { operationId: intent.operationId, retryable: true },
          ),
        };
      }
      const preparation = toPreparedRequest(intent, plan.preparation);
      preparedWriteFences.set(intent.operationId, {
        intent: toCoreIntent(intent),
        writeFence: plan.preparation.write_fence,
      });
      return { ok: true, value: preparation };
    } catch (error) {
      return { ok: false, error: coreFailure(intent, error) };
    }
  },
  apply: async (rawRequest) => {
    let request: BlockTransferRequest;
    let intent: BlockTransferIntent;
    try {
      request = parseBlockTransferRequest(rawRequest);
      intent = blockTransferIntentFromRequest(request);
    } catch (error) {
      return { ok: false, error: coreFailure(rawRequest, error) };
    }
    const scopeError = assertIntentScope(input, intent);
    if (scopeError) return { ok: false, error: scopeError };
    try {
      const declaredWriteFence = exactWriteFence(request);
      const prepared = preparedWriteFences.get(request.operationId);
      const coreIntent = toCoreIntent(intent);
      const writeFence = prepared
        && JSON.stringify(prepared.intent) === JSON.stringify(coreIntent)
        && canUsePreparedWriteFence(prepared.writeFence, declaredWriteFence)
        ? prepared.writeFence
        : declaredWriteFence;
      const committed = await input.client.libraryApply({
        operationId: request.operationId,
        intent: {
          kind: "transfer_blocks",
          intent: coreIntent,
          write_fence: writeFence,
        },
      });
      const result = committed.value.block_transfer;
      if (!result || committed.receipt.operation_kind !== "transfer_blocks") {
        throw new Error("Core returned the wrong Library commit for Block transfer");
      }
      preparedWriteFences.delete(request.operationId);
      return {
        ok: true,
        value: fromCoreResult(
          intent,
          result,
          committed.receipt.duplicate,
          committed.receipt.change_log_seq,
          committed.receipt.committed_at,
        ),
      };
    } catch (error) {
      return { ok: false, error: coreFailure(intent, error) };
    }
    },
  };
};
