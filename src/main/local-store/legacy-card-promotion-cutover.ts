import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { MAX_CARD_TITLE_LENGTH } from "../../shared/card-limits";
import { createUuidV7 } from "../../shared/card-id";
import {
  createCanonicalEmptyParagraphBlock,
  materializeCardDocument,
  type BlockTreeNode,
} from "../../shared/block-documents/block-document-codec";
import { assessBlockSemanticContentForCard } from "../../shared/block-documents/block-semantic-content";
import type { DocumentBlockOperation } from "../../shared/block-documents/document-operations";
import {
  plainTextToPortableRichText,
  portableRichTextPlainText,
  portableRichTextSemanticSource,
} from "../../shared/block-documents/portable-rich-text";
import { applyDocumentOperationBatch } from "./block-document-operations";
import { loadPrimaryBlockDocument } from "./block-document-store";
import { createDocumentVersionCheckpoint } from "./document-versions";

interface StoredMutationRow {
  readonly mutation_id: string;
  readonly project_id: string;
  readonly request_hash: string;
  readonly request_json: string;
  readonly result_json: string;
}

interface HistoricalPromotionCandidate {
  readonly operationId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly generation: number;
  readonly baseHeadSeq: number;
  readonly committedHeadSeq: number;
  readonly cardId: string;
  readonly insertedRoot: BlockTreeNode;
}

export interface LegacyCardPromotionCutoverIssue {
  readonly operationId: string;
  readonly projectId: string;
  readonly cardId: string;
  readonly duplicatedRootId: string;
  readonly reason:
    | "authority_unavailable"
    | "root_missing_or_moved"
    | "root_changed"
    | "not_losslessly_promotable"
    | "title_diverged";
  readonly detail: string;
}

export interface LegacyCardPromotionCutoverResult {
  readonly repairedCardIds: readonly string[];
  readonly issues: readonly LegacyCardPromotionCutoverIssue[];
}

export class LegacyCardPromotionCutoverError extends Error {
  constructor(
    readonly result: LegacyCardPromotionCutoverResult,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LegacyCardPromotionCutoverError";
  }
}

const REPAIR_MUTATION_PREFIX = "legacy-card-promotion-cutover:";

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJsonRecord = (
  value: string,
  label: string,
): Readonly<Record<string, unknown>> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new LegacyCardPromotionCutoverError(
      { repairedCardIds: [], issues: [] },
      `${label} is not readable JSON`,
      { cause: error },
    );
  }
  if (isRecord(parsed)) return parsed;
  throw new LegacyCardPromotionCutoverError(
    { repairedCardIds: [], issues: [] },
    `${label} is not an object`,
  );
};

const readBlockTreeNode = (value: unknown): BlockTreeNode | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    !isRecord(value.props) ||
    !Array.isArray(value.children)
  ) {
    return null;
  }
  const children = value.children.map(readBlockTreeNode);
  if (children.some((child) => child === null)) return null;
  return {
    id: value.id,
    type: value.type,
    props: value.props,
    ...(Object.hasOwn(value, "content") ? { content: value.content } : {}),
    children: children as readonly BlockTreeNode[],
  } as BlockTreeNode;
};

const stringArray = (value: unknown): readonly string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;

const stringRecord = (
  value: unknown,
): Readonly<Record<string, string>> | null => {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([, candidate]) => typeof candidate !== "string")) {
    return null;
  }
  return Object.fromEntries(entries) as Readonly<Record<string, string>>;
};

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    .join(",")}}`;
};

const readStoreEpoch = (database: Database.Database): string => {
  const row = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (row) return row.store_epoch;
  throw new LegacyCardPromotionCutoverError(
    { repairedCardIds: [], issues: [] },
    "Block store metadata is missing during legacy Card promotion cutover",
  );
};

const isPermanentlyRetiredCard = (
  database: Database.Database,
  candidate: HistoricalPromotionCandidate,
): boolean =>
  Boolean(
    database
      .prepare(
        `SELECT 1 AS present
         FROM retired_block_identities
         WHERE block_id = ? AND project_id = ? AND block_type = 'card'`,
      )
      .get(candidate.cardId, candidate.projectId),
  );

const readCommittedRows = (
  database: Database.Database,
  mutationKind: string,
): readonly StoredMutationRow[] =>
  database
    .prepare(
      `SELECT mutation_id, project_id, request_hash, request_json, result_json
       FROM block_mutations
       WHERE mutation_kind = ? AND outcome = 'committed'
       ORDER BY mutation_id`,
    )
    .all(mutationKind) as readonly StoredMutationRow[];

const readHistoricalPromotionCandidates = (
  database: Database.Database,
): readonly HistoricalPromotionCandidate[] => {
  const outerTransfers = readCommittedRows(database, "block_transfer").map(
    (row) => {
      if (sha256(row.request_json) !== row.request_hash) {
        throw new LegacyCardPromotionCutoverError(
          { repairedCardIds: [], issues: [] },
          `BlockTransfer ${row.mutation_id} request hash is corrupt`,
        );
      }
      return {
        row,
        request: parseJsonRecord(
          row.request_json,
          `BlockTransfer ${row.mutation_id} request`,
        ),
        receipt: parseJsonRecord(
          row.result_json,
          `BlockTransfer ${row.mutation_id} result`,
        ),
      };
    },
  );
  const nestedRows = readCommittedRows(
    database,
    "document_operation_batch",
  ).filter(
    (row) =>
      !row.mutation_id.startsWith(REPAIR_MUTATION_PREFIX) &&
      (row.mutation_id.endsWith(":promotion-body") ||
        row.mutation_id.endsWith(":copy-promoted-body")),
  );

  return nestedRows.flatMap((row) => {
    if (sha256(row.request_json) !== row.request_hash) {
      throw new LegacyCardPromotionCutoverError(
        { repairedCardIds: [], issues: [] },
        `Legacy promotion mutation ${row.mutation_id} request hash is corrupt`,
      );
    }
    const request = parseJsonRecord(
      row.request_json,
      `Document mutation ${row.mutation_id} request`,
    );
    const result = parseJsonRecord(
      row.result_json,
      `Document mutation ${row.mutation_id} result`,
    );
    const operations = Array.isArray(request.operations)
      ? request.operations
      : [];
    const operation = operations.length === 1 && isRecord(operations[0])
      ? operations[0]
      : null;
    const insertedRoot = operation?.kind === "insert_block"
      ? readBlockTreeNode(operation.block)
      : null;
    const documentId = typeof result.documentId === "string"
      ? result.documentId
      : null;
    const generation = typeof result.generation === "number"
      ? result.generation
      : null;
    const baseHeadSeq = typeof result.baseHeadSeq === "number"
      ? result.baseHeadSeq
      : null;
    const committedHeadSeq = typeof result.headSeq === "number"
      ? result.headSeq
      : null;
    if (
      !insertedRoot ||
      !documentId ||
      generation === null ||
      baseHeadSeq === null ||
      committedHeadSeq === null ||
      documentId !== `document:${documentId.slice("document:".length)}`
    ) {
      throw new LegacyCardPromotionCutoverError(
        { repairedCardIds: [], issues: [] },
        `Legacy promotion mutation ${row.mutation_id} lacks its exact inserted-root evidence`,
      );
    }
    if (
      request.projectId !== row.project_id ||
      request.mutationId !== row.mutation_id ||
      result.projectId !== row.project_id ||
      result.mutationId !== row.mutation_id ||
      request.documentId !== documentId ||
      request.generation !== generation ||
      request.expectedHeadSeq !== baseHeadSeq
    ) {
      throw new LegacyCardPromotionCutoverError(
        { repairedCardIds: [], issues: [] },
        `Legacy promotion mutation ${row.mutation_id} request/result coordinates diverge`,
      );
    }
    const createdBlockIds = stringArray(result.createdBlockIds);
    const touchedBlockIds = stringArray(result.touchedBlockIds);
    const insertedSubtreeIds = (root: BlockTreeNode): readonly string[] => [
      root.id,
      ...root.children.flatMap(insertedSubtreeIds),
    ];
    const immutableSubtreeIds = insertedSubtreeIds(insertedRoot);
    if (
      !createdBlockIds ||
      stableJson([...createdBlockIds].sort()) !==
        stableJson([...immutableSubtreeIds].sort()) ||
      !touchedBlockIds ||
      immutableSubtreeIds.some((blockId) => !touchedBlockIds.includes(blockId))
    ) {
      throw new LegacyCardPromotionCutoverError(
        { repairedCardIds: [], issues: [] },
        `Legacy promotion mutation ${row.mutation_id} created/touched evidence does not match its inserted subtree`,
      );
    }
    const cardId = documentId.slice("document:".length);
    const outer = outerTransfers.find(({ row: outerRow, request: outerRequest, receipt }) => {
      if (
        Object.hasOwn(receipt, "transformationEvidence") ||
        outerRow.project_id !== row.project_id ||
        outerRequest.projectId !== row.project_id ||
        receipt.projectId !== row.project_id ||
        outerRequest.operationId !== outerRow.mutation_id ||
        receipt.operationId !== outerRow.mutation_id ||
        outerRequest.mode !== receipt.mode
      ) {
        return false;
      }
      const commits = Array.isArray(receipt.documentCommits)
        ? receipt.documentCommits
        : [];
      const matchingCommit = commits.find(
        (commit) =>
          isRecord(commit) &&
          commit.documentId === documentId &&
          commit.generation === generation &&
          commit.baseHeadSeq === baseHeadSeq &&
          commit.headSeq === committedHeadSeq &&
          commit.updateId === `document-mutation:${row.request_hash}`,
      );
      if (!matchingCommit) return false;

      const mode = receipt.mode;
      const sourceRoots = stringArray(outerRequest.rootBlockIds);
      const receiptSourceRoots = stringArray(receipt.sourceRootBlockIds);
      const resultRoots = stringArray(receipt.resultRootBlockIds);
      const copiedBlockIds = stringRecord(receipt.copiedBlockIds);
      if (
        outerRequest.projectId !== row.project_id ||
        !sourceRoots ||
        !receiptSourceRoots ||
        stableJson(sourceRoots) !== stableJson(receiptSourceRoots) ||
        !resultRoots ||
        !copiedBlockIds
      ) {
        return false;
      }
      return sourceRoots.some((sourceBlockId) => {
        const expectedCardId =
          mode === "move"
            ? sourceBlockId
            : mode === "copy"
              ? copiedBlockIds[sourceBlockId]
              : null;
        if (expectedCardId !== cardId || !resultRoots.includes(cardId)) {
          return false;
        }
        const rootRequestHash = createHash("sha256")
          .update(`${outerRow.request_hash}\0root\0${sourceBlockId}`)
          .digest("hex");
        const role = mode === "move"
          ? "promotion-body"
          : mode === "copy"
            ? "copy-promoted-body"
            : null;
        return (
          role !== null &&
          row.mutation_id === `block-transfer:${rootRequestHash}:${role}`
        );
      });
    });
    if (!outer) {
      throw new LegacyCardPromotionCutoverError(
        { repairedCardIds: [], issues: [] },
        `Legacy promotion mutation ${row.mutation_id} has no matching outer BlockTransfer receipt`,
      );
    }
    return [{
      operationId: row.mutation_id,
      projectId: row.project_id,
      documentId,
      generation,
      baseHeadSeq,
      committedHeadSeq,
      cardId,
      insertedRoot,
    }];
  });
};

const repairMutationId = (candidate: HistoricalPromotionCandidate): string =>
  `${REPAIR_MUTATION_PREFIX}${candidate.operationId}`;

const isRepairCommitted = (
  database: Database.Database,
  candidate: HistoricalPromotionCandidate,
): boolean =>
  database
    .prepare(
      `SELECT 1 AS present FROM block_mutations
       WHERE mutation_id = ? AND mutation_kind = 'document_operation_batch'
         AND outcome = 'committed'`,
    )
    .get(repairMutationId(candidate)) !== undefined;

const issue = (
  candidate: HistoricalPromotionCandidate,
  reason: LegacyCardPromotionCutoverIssue["reason"],
  detail: string,
): LegacyCardPromotionCutoverIssue => ({
  operationId: candidate.operationId,
  projectId: candidate.projectId,
  cardId: candidate.cardId,
  duplicatedRootId: candidate.insertedRoot.id,
  reason,
  detail,
});

const legacyProjectedTitle = (plainText: string): string => {
  const firstLine = plainText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return (firstLine ?? "Untitled").slice(0, MAX_CARD_TITLE_LENGTH);
};

const prepareRepair = (
  database: Database.Database,
  candidate: HistoricalPromotionCandidate,
):
  | {
      readonly kind: "ready";
      readonly generation: number;
      readonly headSeq: number;
      readonly operations: readonly DocumentBlockOperation[];
    }
  | { readonly kind: "issue"; readonly value: LegacyCardPromotionCutoverIssue } => {
  let loaded;
  try {
    loaded = loadPrimaryBlockDocument(database, candidate.documentId);
  } catch (error) {
    return {
      kind: "issue",
      value: issue(
        candidate,
        "authority_unavailable",
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
  try {
    const materialization = materializeCardDocument(loaded.document);
    const currentRoot = materialization.blockTree.find(
      (root) => root.id === candidate.insertedRoot.id,
    );
    if (!currentRoot) {
      return {
        kind: "issue",
        value: issue(
          candidate,
          "root_missing_or_moved",
          "the generated duplicate root is no longer a top-level body Block",
        ),
      };
    }
    if (stableJson(currentRoot) !== stableJson(candidate.insertedRoot)) {
      return {
        kind: "issue",
        value: issue(
          candidate,
          "root_changed",
          "the generated duplicate root or its subtree has independent edits",
        ),
      };
    }

    let assessment;
    try {
      assessment = assessBlockSemanticContentForCard(candidate.insertedRoot);
    } catch (error) {
      return {
        kind: "issue",
        value: issue(
          candidate,
          "not_losslessly_promotable",
          error instanceof Error ? error.message : String(error),
        ),
      };
    }
    if (assessment.kind !== "promote") {
      return {
        kind: "issue",
        value: issue(
          candidate,
          "not_losslessly_promotable",
          `the historical ${candidate.insertedRoot.type} root now requires ${assessment.kind}`,
        ),
      };
    }
    const expectedLegacyTitle = legacyProjectedTitle(
      portableRichTextPlainText(assessment.primary),
    );
    if (
      portableRichTextSemanticSource(materialization.richTitle) !==
      portableRichTextSemanticSource(
        plainTextToPortableRichText(expectedLegacyTitle),
      )
    ) {
      return {
        kind: "issue",
        value: issue(
          candidate,
          "title_diverged",
          `current title ${JSON.stringify(materialization.title)} differs from immutable projected source title ${JSON.stringify(expectedLegacyTitle)}`,
        ),
      };
    }

    const replacementBodyOperations: readonly DocumentBlockOperation[] =
      assessment.children.length > 0
        ? assessment.children.map((child) => ({
            kind: "move_block" as const,
            blockId: child.id,
            beforeBlockId: candidate.insertedRoot.id,
          }))
        : [
            {
              kind: "insert_block" as const,
              block: createCanonicalEmptyParagraphBlock(createUuidV7()),
              beforeBlockId: candidate.insertedRoot.id,
            },
          ];
    return {
      kind: "ready",
      generation: loaded.head.generation,
      headSeq: loaded.head.headSeq,
      operations: [
        { kind: "set_rich_title", richTitle: assessment.primary },
        ...replacementBodyOperations,
        { kind: "delete_block", blockId: candidate.insertedRoot.id },
      ],
    };
  } finally {
    loaded.document.destroy();
  }
};

const commitRepair = (
  database: Database.Database,
  candidate: HistoricalPromotionCandidate,
  prepared: Extract<ReturnType<typeof prepareRepair>, { readonly kind: "ready" }>,
): void => {
  const storeEpoch = readStoreEpoch(database);
  const actor = {
    kind: "legacy_card_promotion_cutover",
    sourceOperationId: candidate.operationId,
  } as const;
  createDocumentVersionCheckpoint(database, {
    version: 1,
    projectId: candidate.projectId,
    storeEpoch,
    documentId: candidate.documentId,
    expectedGeneration: prepared.generation,
    expectedHeadSeq: prepared.headSeq,
    cause: "before_legacy_card_promotion_cutover",
    label: `Before semantic Card promotion repair for ${candidate.cardId}`,
    actor,
  });
  const mutationId = repairMutationId(candidate);
  const result = applyDocumentOperationBatch(
    database,
    {
      version: 1,
      mutationId,
      projectId: candidate.projectId,
      storeEpoch,
      clientSessionId: "startup:legacy-card-promotion-cutover",
      actor,
      documentId: candidate.documentId,
      generation: prepared.generation,
      expectedHeadSeq: prepared.headSeq,
      operations: prepared.operations,
    },
    {
      writeFence: {
        leaseId: `${mutationId}:lease`,
        documentId: candidate.documentId,
        generation: prepared.generation,
        headSeq: prepared.headSeq,
      },
    },
  );
  if (result.ok) return;
  throw new LegacyCardPromotionCutoverError(
    { repairedCardIds: [], issues: [] },
    `Card ${candidate.cardId} semantic promotion repair failed: ${result.error.message}`,
  );
};

export const finalizeLegacyCardPromotionCutover = (
  database: Database.Database,
): LegacyCardPromotionCutoverResult => {
  const repairedCardIds: string[] = [];
  const issues: LegacyCardPromotionCutoverIssue[] = [];
  for (const candidate of readHistoricalPromotionCandidates(database)) {
    if (isPermanentlyRetiredCard(database, candidate)) continue;
    if (isRepairCommitted(database, candidate)) continue;
    const prepared = prepareRepair(database, candidate);
    if (prepared.kind === "issue") {
      issues.push(prepared.value);
      continue;
    }
    commitRepair(database, candidate, prepared);
    repairedCardIds.push(candidate.cardId);
  }
  return { repairedCardIds, issues };
};

export const assertLegacyCardPromotionCutoverReady = (
  database: Database.Database,
): LegacyCardPromotionCutoverResult => {
  const result = finalizeLegacyCardPromotionCutover(database);
  if (result.issues.length === 0) return result;

  const examples = result.issues
    .slice(0, 3)
    .map(
      (entry) =>
        `${entry.cardId} (operation ${entry.operationId}, root ${entry.duplicatedRootId}): ${entry.detail}`,
    )
    .join("; ");
  throw new LegacyCardPromotionCutoverError(
    result,
    `This development store contains ${result.issues.length} ambiguous Card promotion(s) from the retired duplicated-root compiler: ${examples}. Nodex repaired every provably unchanged promotion but will not guess how to merge these divergent titles/bodies. Export anything you need and reconcile the listed Card manually, or move the current development store directory aside and restart with a clean store.`,
  );
};
