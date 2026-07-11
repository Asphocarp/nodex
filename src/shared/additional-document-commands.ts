import {
  stableStringifyBlockPropertyJson,
  type BlockPropertyJsonValue,
} from "./block-property-mutations";
import type {
  BlockTreeNode,
  BlockTreeValue,
} from "./block-documents/block-document-codec";

export const ADDITIONAL_DOCUMENT_COMMAND_VERSION = 1 as const;

export const MAX_ADDITIONAL_DOCUMENT_COMMAND_LENGTH = 2_000_000;
export const MAX_ADDITIONAL_DOCUMENT_ACTOR_LENGTH = 64 * 1024;
export const MAX_ADDITIONAL_DOCUMENT_BLOCKS = 10_000;
export const MAX_ADDITIONAL_DOCUMENT_BLOCK_DEPTH = 64;
export const MAX_ADDITIONAL_DOCUMENT_CODE_LENGTH = 1_800_000;

const MAX_ID_LENGTH = 512;
const MAX_BLOCK_TYPE_LENGTH = 128;
const MAX_DISPLAY_NAME_LENGTH = 512;
const MAX_LANGUAGE_LENGTH = 128;
const MAX_RESULT_BLOCK_IDS = 100_000;

export interface AdditionalDocumentHeadRevision {
  readonly documentId: string;
  readonly generation: number;
  readonly headSeq: number;
}

/**
 * Stable logical Document identity. A SQLite head is deliberately absent: it
 * is renewable execution proof supplied by `coordination`, not user intent.
 */
export interface AdditionalDocumentRevision {
  readonly documentId: string;
  readonly generation: number;
}

export interface AdditionalDocumentOwnerRevision extends AdditionalDocumentRevision {
  readonly ownerBlockId: string;
  readonly metadataRevision: number;
  readonly locationRevision: number;
}

export interface AdditionalDocumentSpaceAnchor {
  readonly blockId: string;
  readonly expectedLocationRevision: number;
}

export interface AdditionalDocumentSpacePlacement {
  readonly kind: "space";
  readonly before?: AdditionalDocumentSpaceAnchor;
}

export type AdditionalDocumentWriteCoordination =
  | { readonly kind: "fifo_only" }
  | {
      /**
       * Recover a durable receipt without pretending a post-commit head still
       * satisfies the original lease. A missing receipt must not execute.
       */
      readonly kind: "receipt_replay";
    }
  | {
      readonly kind: "hub_lease";
      readonly leaseId: string;
      readonly documents: readonly AdditionalDocumentHeadRevision[];
    };

export interface CreateSyncedSourceOperation {
  readonly kind: "create_synced_source";
  readonly sourceBlockId: string;
  readonly documentId: string;
  /** Supplied application Block identities become the source identities. */
  readonly initialBlocks: readonly BlockTreeNode[];
  readonly placement: AdditionalDocumentSpacePlacement;
}

export interface PromoteSyncedSourceOperation {
  readonly kind: "promote_synced_source";
  readonly host: AdditionalDocumentRevision;
  readonly rootBlockId: string;
  readonly referenceBlockId: string;
  readonly sourceBlockId: string;
  readonly sourceDocumentId: string;
}

export interface DemoteSyncedSourceOperation {
  readonly kind: "demote_synced_source";
  readonly host: AdditionalDocumentRevision;
  readonly source: AdditionalDocumentRevision;
  readonly referenceBlockId: string;
  readonly sourceBlockId: string;
}

export interface CreateTemplateOperation {
  readonly kind: "create_template";
  readonly sourceBlockId: string;
  readonly documentId: string;
  readonly displayName: string;
  /** Supplied application Block identities become the template identities. */
  readonly initialBlocks: readonly BlockTreeNode[];
  readonly placement: AdditionalDocumentSpacePlacement;
}

export interface InstantiateTemplateOperation {
  readonly kind: "instantiate_template";
  readonly sourceBlockId: string;
  readonly source: AdditionalDocumentRevision;
  readonly target: AdditionalDocumentRevision;
  readonly parentBlockId?: string;
  readonly beforeBlockId?: string;
  /**
   * The command deliberately carries no destination Block IDs. Every copied
   * identity is derived from operationId by the authoritative kernel.
   */
}

export type LargeDocumentContent =
  | {
      readonly kind: "large_document";
      readonly initialBlocks: readonly BlockTreeNode[];
    }
  | {
      readonly kind: "large_code";
      readonly language: string;
      readonly code: string;
    };

export type LargeDocumentLocation =
  | AdditionalDocumentSpacePlacement
  | {
      readonly kind: "document";
      readonly host: AdditionalDocumentRevision;
      readonly parentBlockId?: string;
      readonly beforeBlockId?: string;
    };

export interface CreateLargeDocumentOperation {
  readonly kind: "create_large_document";
  readonly blockId: string;
  readonly documentId: string;
  readonly displayName: string;
  readonly content: LargeDocumentContent;
  readonly location: LargeDocumentLocation;
}

export type DeletableOwnedSourceKind =
  "synced_block" | "reusable_template" | "large_document" | "large_code";

export interface DeleteOwnedSourceOperation {
  readonly kind: "delete_owned_source";
  readonly ownerKind: DeletableOwnedSourceKind;
  readonly owner: AdditionalDocumentOwnerRevision;
  readonly referencePolicy: "require_unreferenced";
}

export interface CreateCanvasOwnerOperation {
  readonly kind: "create_canvas_owner";
  readonly scope: "non_primary";
  readonly blockId: string;
  readonly documentId: string;
  readonly displayName: string;
  readonly placement: AdditionalDocumentSpacePlacement;
}

export interface DeleteCanvasOwnerOperation {
  readonly kind: "delete_canvas_owner";
  readonly scope: "non_primary";
  readonly owner: AdditionalDocumentOwnerRevision;
  readonly referencePolicy: "require_unreferenced";
}

export type AdditionalDocumentOperation =
  | CreateSyncedSourceOperation
  | PromoteSyncedSourceOperation
  | DemoteSyncedSourceOperation
  | CreateTemplateOperation
  | InstantiateTemplateOperation
  | CreateLargeDocumentOperation
  | DeleteOwnedSourceOperation
  | CreateCanvasOwnerOperation
  | DeleteCanvasOwnerOperation;

export type AdditionalDocumentCommandKind = AdditionalDocumentOperation["kind"];

export interface AdditionalDocumentCommandRequest {
  readonly version: typeof ADDITIONAL_DOCUMENT_COMMAND_VERSION;
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  /** Trusted transports replace these fields; the writer retains first attempt. */
  readonly clientSessionId: string;
  readonly actor: Readonly<Record<string, BlockPropertyJsonValue>>;
  /** Ephemeral write proof. It is validated but excluded from retry identity. */
  readonly coordination: AdditionalDocumentWriteCoordination;
  readonly operation: AdditionalDocumentOperation;
}

export type AdditionalDocumentIdentitySemantics =
  | "create_with_supplied_content_ids"
  | "move_preserving_content_ids_create_source_and_reference_ids"
  | "move_preserving_content_ids_delete_source_and_reference_ids"
  | "copy_deriving_every_content_id_from_operation_id"
  | "create_owner_preserve_supplied_or_derive_code_content_ids"
  | "delete_owner_preserving_retained_history_ids"
  | "create_empty_owner"
  | "delete_canvas_owner_preserving_retained_history_ids";

export interface AdditionalDocumentCommandCapability {
  readonly availability: "kernel_ready" | "capability_gap";
  readonly coordination: "fifo_only" | "hub_lease" | "depends_on_location";
  readonly identitySemantics: AdditionalDocumentIdentitySemantics;
  readonly gap?: string;
}

/**
 * This is an executable capability boundary, not a roadmap claim. A transport
 * must not expose a command whose entry remains capability_gap.
 */
export const ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES: Readonly<
  Record<AdditionalDocumentCommandKind, AdditionalDocumentCommandCapability>
> = {
  create_synced_source: {
    availability: "kernel_ready",
    coordination: "fifo_only",
    identitySemantics: "create_with_supplied_content_ids",
  },
  promote_synced_source: {
    availability: "kernel_ready",
    coordination: "hub_lease",
    identitySemantics:
      "move_preserving_content_ids_create_source_and_reference_ids",
  },
  demote_synced_source: {
    availability: "kernel_ready",
    coordination: "hub_lease",
    identitySemantics:
      "move_preserving_content_ids_delete_source_and_reference_ids",
  },
  create_template: {
    availability: "kernel_ready",
    coordination: "fifo_only",
    identitySemantics: "create_with_supplied_content_ids",
  },
  instantiate_template: {
    availability: "kernel_ready",
    coordination: "hub_lease",
    identitySemantics: "copy_deriving_every_content_id_from_operation_id",
  },
  create_large_document: {
    availability: "kernel_ready",
    coordination: "depends_on_location",
    identitySemantics:
      "create_owner_preserve_supplied_or_derive_code_content_ids",
  },
  delete_owned_source: {
    availability: "kernel_ready",
    coordination: "hub_lease",
    identitySemantics: "delete_owner_preserving_retained_history_ids",
  },
  create_canvas_owner: {
    availability: "kernel_ready",
    coordination: "fifo_only",
    identitySemantics: "create_empty_owner",
  },
  delete_canvas_owner: {
    availability: "kernel_ready",
    coordination: "hub_lease",
    identitySemantics: "delete_canvas_owner_preserving_retained_history_ids",
  },
};

export interface AdditionalDocumentMutationEffect {
  readonly createdBlockIds: readonly string[];
  readonly preservedBlockIds: readonly string[];
  readonly deletedBlockIds: readonly string[];
  readonly documentHeads: readonly AdditionalDocumentHeadRevision[];
}

export interface AdditionalDocumentCommandReceipt {
  readonly version: typeof ADDITIONAL_DOCUMENT_COMMAND_VERSION;
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly operationKind: AdditionalDocumentCommandKind;
  /** Lowercase SHA-256 of encodeAdditionalDocumentCommandSemanticHashInput. */
  readonly semanticHash: string;
  readonly duplicate: boolean;
  readonly effect: AdditionalDocumentMutationEffect;
  readonly changeLogSeq: number;
  readonly committedAt: string;
}

export type AdditionalDocumentCommandErrorCode =
  | "invalid_request"
  | "store_epoch_mismatch"
  | "operation_id_collision"
  | "capability_gap"
  | "project_not_found"
  | "identity_conflict"
  | "block_revision_conflict"
  | "document_head_conflict"
  | "document_generation_mismatch"
  | "source_not_found"
  | "source_referenced"
  | "source_shared"
  | "reference_not_found"
  | "coordination_failed"
  | "document_state_corrupt"
  | "unknown";

export interface AdditionalDocumentCommandError {
  readonly code: AdditionalDocumentCommandErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly operationId: string;
  readonly operationKind: AdditionalDocumentCommandKind | null;
}

export type AdditionalDocumentCommandResult =
  | { readonly ok: true; readonly value: AdditionalDocumentCommandReceipt }
  | { readonly ok: false; readonly error: AdditionalDocumentCommandError };

export class AdditionalDocumentCommandContractError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "AdditionalDocumentCommandContractError";
  }
}

export type AdditionalDocumentExecutionProofErrorCode =
  | "invalid_execution_proof"
  | "document_generation_mismatch"
  | "document_head_regressed";

export class AdditionalDocumentExecutionProofError extends AdditionalDocumentCommandContractError {
  constructor(
    readonly code: AdditionalDocumentExecutionProofErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdditionalDocumentExecutionProofError";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new AdditionalDocumentCommandContractError(
    `${label} must be an object`,
  );
};

const assertExactKeys = (
  record: Readonly<Record<string, unknown>>,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void => {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (Object.hasOwn(record, key)) continue;
    throw new AdditionalDocumentCommandContractError(
      `${label}.${key} is required`,
    );
  }
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue;
    throw new AdditionalDocumentCommandContractError(
      `${label}.${key} is not supported`,
    );
  }
};

const readString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  maximumLength = MAX_ID_LENGTH,
  allowEmpty = false,
): string => {
  const value = record[key];
  if (
    typeof value === "string" &&
    value.length <= maximumLength &&
    (allowEmpty || value.length > 0) &&
    (allowEmpty || value === value.trim())
  ) {
    return value;
  }
  throw new AdditionalDocumentCommandContractError(
    `${label}.${key} must be a canonical bounded string`,
  );
};

const readOptionalId = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string | undefined =>
  record[key] === undefined ? undefined : readString(record, key, label);

const readInteger = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  minimum: number,
): number => {
  const value = record[key];
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
  ) {
    return value;
  }
  throw new AdditionalDocumentCommandContractError(
    `${label}.${key} must be a safe integer >= ${minimum}`,
  );
};

const readBoolean = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): boolean => {
  if (typeof record[key] === "boolean") return record[key];
  throw new AdditionalDocumentCommandContractError(
    `${label}.${key} must be a boolean`,
  );
};

const readLiteral = <T extends string>(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  expected: T,
): T => {
  if (record[key] === expected) return expected;
  throw new AdditionalDocumentCommandContractError(
    `${label}.${key} must be ${expected}`,
  );
};

const canonicalJsonValue = (
  value: unknown,
  label: string,
  budget: { characters: number },
): BlockTreeValue => {
  try {
    const canonical = stableStringifyBlockPropertyJson(value);
    budget.characters += canonical.length;
    if (budget.characters > MAX_ADDITIONAL_DOCUMENT_COMMAND_LENGTH) {
      throw new AdditionalDocumentCommandContractError(
        `${label} exceeds the aggregate content budget`,
      );
    }
    return JSON.parse(canonical) as BlockTreeValue;
  } catch (error) {
    throw new AdditionalDocumentCommandContractError(
      `${label} must contain bounded portable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const readActor = (
  value: unknown,
): Readonly<Record<string, BlockPropertyJsonValue>> => {
  if (!isRecord(value)) {
    throw new AdditionalDocumentCommandContractError(
      "additionalDocument.actor must be an object",
    );
  }
  let canonical: string;
  try {
    canonical = stableStringifyBlockPropertyJson(value);
  } catch (error) {
    throw new AdditionalDocumentCommandContractError(
      `additionalDocument.actor must contain bounded portable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (canonical.length > MAX_ADDITIONAL_DOCUMENT_ACTOR_LENGTH) {
    throw new AdditionalDocumentCommandContractError(
      "additionalDocument.actor exceeds the audit size limit",
    );
  }
  return JSON.parse(canonical) as Readonly<
    Record<string, BlockPropertyJsonValue>
  >;
};

const parseHead = (
  value: unknown,
  label: string,
): AdditionalDocumentHeadRevision => {
  const head = readRecord(value, label);
  assertExactKeys(head, label, ["documentId", "generation", "headSeq"]);
  return {
    documentId: readString(head, "documentId", label),
    generation: readInteger(head, "generation", label, 1),
    headSeq: readInteger(head, "headSeq", label, 1),
  };
};

const parseRevision = (
  value: unknown,
  label: string,
): AdditionalDocumentRevision => {
  const revision = readRecord(value, label);
  assertExactKeys(revision, label, ["documentId", "generation"]);
  return {
    documentId: readString(revision, "documentId", label),
    generation: readInteger(revision, "generation", label, 1),
  };
};

const parseOwner = (
  value: unknown,
  label: string,
): AdditionalDocumentOwnerRevision => {
  const owner = readRecord(value, label);
  assertExactKeys(owner, label, [
    "ownerBlockId",
    "metadataRevision",
    "locationRevision",
    "documentId",
    "generation",
  ]);
  return {
    ownerBlockId: readString(owner, "ownerBlockId", label),
    metadataRevision: readInteger(owner, "metadataRevision", label, 1),
    locationRevision: readInteger(owner, "locationRevision", label, 1),
    documentId: readString(owner, "documentId", label),
    generation: readInteger(owner, "generation", label, 1),
  };
};

const parseSpaceAnchor = (
  value: unknown,
  label: string,
): AdditionalDocumentSpaceAnchor => {
  const anchor = readRecord(value, label);
  assertExactKeys(anchor, label, ["blockId", "expectedLocationRevision"]);
  return {
    blockId: readString(anchor, "blockId", label),
    expectedLocationRevision: readInteger(
      anchor,
      "expectedLocationRevision",
      label,
      1,
    ),
  };
};

const parseSpacePlacement = (
  value: unknown,
  label: string,
): AdditionalDocumentSpacePlacement => {
  const placement = readRecord(value, label);
  assertExactKeys(placement, label, ["kind"], ["before"]);
  readLiteral(placement, "kind", label, "space");
  const before =
    placement.before === undefined
      ? undefined
      : parseSpaceAnchor(placement.before, `${label}.before`);
  return { kind: "space", ...(before === undefined ? {} : { before }) };
};

interface BlockTreeReadState {
  readonly ids: Set<string>;
  nodes: number;
  characters: number;
}

const parseBlockTreeNode = (
  value: unknown,
  label: string,
  depth: number,
  state: BlockTreeReadState,
): BlockTreeNode => {
  if (depth > MAX_ADDITIONAL_DOCUMENT_BLOCK_DEPTH) {
    throw new AdditionalDocumentCommandContractError(
      `${label} exceeds the Block nesting limit`,
    );
  }
  state.nodes += 1;
  if (state.nodes > MAX_ADDITIONAL_DOCUMENT_BLOCKS) {
    throw new AdditionalDocumentCommandContractError(
      `${label} exceeds the Block count limit`,
    );
  }
  const block = readRecord(value, label);
  assertExactKeys(
    block,
    label,
    ["id", "type", "props", "children"],
    ["content"],
  );
  const id = readString(block, "id", label);
  if (state.ids.has(id)) {
    throw new AdditionalDocumentCommandContractError(
      `${label}.id duplicates application Block identity ${id}`,
    );
  }
  state.ids.add(id);
  if (!Array.isArray(block.children)) {
    throw new AdditionalDocumentCommandContractError(
      `${label}.children must be an array`,
    );
  }
  const props = canonicalJsonValue(block.props, `${label}.props`, state);
  if (!isRecord(props)) {
    throw new AdditionalDocumentCommandContractError(
      `${label}.props must be an object`,
    );
  }
  const content =
    block.content === undefined
      ? undefined
      : canonicalJsonValue(block.content, `${label}.content`, state);
  return {
    id,
    type: readString(block, "type", label, MAX_BLOCK_TYPE_LENGTH),
    props: props as Readonly<Record<string, BlockTreeValue>>,
    ...(content === undefined ? {} : { content }),
    children: block.children.map((child, index) =>
      parseBlockTreeNode(
        child,
        `${label}.children[${index}]`,
        depth + 1,
        state,
      ),
    ),
  };
};

const parseBlockTree = (
  value: unknown,
  label: string,
): readonly BlockTreeNode[] => {
  if (!Array.isArray(value)) {
    throw new AdditionalDocumentCommandContractError(
      `${label} must be an array`,
    );
  }
  const state: BlockTreeReadState = { ids: new Set(), nodes: 0, characters: 0 };
  return value.map((block, index) =>
    parseBlockTreeNode(block, `${label}[${index}]`, 1, state),
  );
};

const blockTreeContainsId = (
  blocks: readonly BlockTreeNode[],
  blockId: string,
): boolean =>
  blocks.some(
    (block) =>
      block.id === blockId || blockTreeContainsId(block.children, blockId),
  );

const assertNewOwnerDoesNotCollideWithContent = (
  ownerBlockId: string,
  blocks: readonly BlockTreeNode[],
  label: string,
): void => {
  if (!blockTreeContainsId(blocks, ownerBlockId)) return;
  throw new AdditionalDocumentCommandContractError(
    `${label} content cannot reuse its document owner identity`,
  );
};

const parseDocumentLocation = (
  value: unknown,
  label: string,
): LargeDocumentLocation => {
  const location = readRecord(value, label);
  if (location.kind === "space") return parseSpacePlacement(value, label);
  if (location.kind !== "document") {
    throw new AdditionalDocumentCommandContractError(
      `${label}.kind is not supported`,
    );
  }
  assertExactKeys(
    location,
    label,
    ["kind", "host"],
    ["parentBlockId", "beforeBlockId"],
  );
  const parentBlockId = readOptionalId(location, "parentBlockId", label);
  const beforeBlockId = readOptionalId(location, "beforeBlockId", label);
  if (parentBlockId !== undefined && parentBlockId === beforeBlockId) {
    throw new AdditionalDocumentCommandContractError(
      `${label} parent and before identities must differ`,
    );
  }
  return {
    kind: "document",
    host: parseRevision(location.host, `${label}.host`),
    ...(parentBlockId === undefined ? {} : { parentBlockId }),
    ...(beforeBlockId === undefined ? {} : { beforeBlockId }),
  };
};

const parseOperation = (value: unknown): AdditionalDocumentOperation => {
  const label = "additionalDocument.operation";
  const operation = readRecord(value, label);
  const kind = operation.kind;
  if (kind === "create_synced_source") {
    assertExactKeys(operation, label, [
      "kind",
      "sourceBlockId",
      "documentId",
      "initialBlocks",
      "placement",
    ]);
    const sourceBlockId = readString(operation, "sourceBlockId", label);
    const placement = parseSpacePlacement(
      operation.placement,
      `${label}.placement`,
    );
    if (placement.before?.blockId === sourceBlockId) {
      throw new AdditionalDocumentCommandContractError(
        `${label}.placement cannot anchor before the identity being created`,
      );
    }
    const initialBlocks = parseBlockTree(
      operation.initialBlocks,
      `${label}.initialBlocks`,
    );
    assertNewOwnerDoesNotCollideWithContent(
      sourceBlockId,
      initialBlocks,
      label,
    );
    if (
      placement.before !== undefined &&
      blockTreeContainsId(initialBlocks, placement.before.blockId)
    ) {
      throw new AdditionalDocumentCommandContractError(
        `${label}.placement anchor cannot be a newly-created content Block`,
      );
    }
    return {
      kind,
      sourceBlockId,
      documentId: readString(operation, "documentId", label),
      initialBlocks,
      placement,
    };
  }
  if (kind === "promote_synced_source") {
    assertExactKeys(operation, label, [
      "kind",
      "host",
      "rootBlockId",
      "referenceBlockId",
      "sourceBlockId",
      "sourceDocumentId",
    ]);
    const rootBlockId = readString(operation, "rootBlockId", label);
    const referenceBlockId = readString(operation, "referenceBlockId", label);
    const sourceBlockId = readString(operation, "sourceBlockId", label);
    if (new Set([rootBlockId, referenceBlockId, sourceBlockId]).size !== 3) {
      throw new AdditionalDocumentCommandContractError(
        `${label} root, reference, and source identities must differ`,
      );
    }
    return {
      kind,
      host: parseRevision(operation.host, `${label}.host`),
      rootBlockId,
      referenceBlockId,
      sourceBlockId,
      sourceDocumentId: readString(operation, "sourceDocumentId", label),
    };
  }
  if (kind === "demote_synced_source") {
    assertExactKeys(operation, label, [
      "kind",
      "host",
      "source",
      "referenceBlockId",
      "sourceBlockId",
    ]);
    const host = parseRevision(operation.host, `${label}.host`);
    const source = parseRevision(operation.source, `${label}.source`);
    if (host.documentId === source.documentId) {
      throw new AdditionalDocumentCommandContractError(
        `${label} host and source Documents must differ`,
      );
    }
    const referenceBlockId = readString(operation, "referenceBlockId", label);
    const sourceBlockId = readString(operation, "sourceBlockId", label);
    if (referenceBlockId === sourceBlockId) {
      throw new AdditionalDocumentCommandContractError(
        `${label} reference and source identities must differ`,
      );
    }
    return { kind, host, source, referenceBlockId, sourceBlockId };
  }
  if (kind === "create_template") {
    assertExactKeys(operation, label, [
      "kind",
      "sourceBlockId",
      "documentId",
      "displayName",
      "initialBlocks",
      "placement",
    ]);
    const sourceBlockId = readString(operation, "sourceBlockId", label);
    const placement = parseSpacePlacement(
      operation.placement,
      `${label}.placement`,
    );
    if (placement.before?.blockId === sourceBlockId) {
      throw new AdditionalDocumentCommandContractError(
        `${label}.placement cannot anchor before the identity being created`,
      );
    }
    const initialBlocks = parseBlockTree(
      operation.initialBlocks,
      `${label}.initialBlocks`,
    );
    assertNewOwnerDoesNotCollideWithContent(
      sourceBlockId,
      initialBlocks,
      label,
    );
    if (
      placement.before !== undefined &&
      blockTreeContainsId(initialBlocks, placement.before.blockId)
    ) {
      throw new AdditionalDocumentCommandContractError(
        `${label}.placement anchor cannot be a newly-created content Block`,
      );
    }
    return {
      kind,
      sourceBlockId,
      documentId: readString(operation, "documentId", label),
      displayName: readString(
        operation,
        "displayName",
        label,
        MAX_DISPLAY_NAME_LENGTH,
      ),
      initialBlocks,
      placement,
    };
  }
  if (kind === "instantiate_template") {
    assertExactKeys(
      operation,
      label,
      ["kind", "sourceBlockId", "source", "target"],
      ["parentBlockId", "beforeBlockId"],
    );
    const source = parseRevision(operation.source, `${label}.source`);
    const target = parseRevision(operation.target, `${label}.target`);
    if (source.documentId === target.documentId) {
      throw new AdditionalDocumentCommandContractError(
        `${label} source and target Documents must differ`,
      );
    }
    const parentBlockId = readOptionalId(operation, "parentBlockId", label);
    const beforeBlockId = readOptionalId(operation, "beforeBlockId", label);
    if (parentBlockId !== undefined && parentBlockId === beforeBlockId) {
      throw new AdditionalDocumentCommandContractError(
        `${label} parent and before identities must differ`,
      );
    }
    return {
      kind,
      sourceBlockId: readString(operation, "sourceBlockId", label),
      source,
      target,
      ...(parentBlockId === undefined ? {} : { parentBlockId }),
      ...(beforeBlockId === undefined ? {} : { beforeBlockId }),
    };
  }
  if (kind === "create_large_document") {
    assertExactKeys(operation, label, [
      "kind",
      "blockId",
      "documentId",
      "displayName",
      "content",
      "location",
    ]);
    const contentRecord = readRecord(operation.content, `${label}.content`);
    let content: LargeDocumentContent;
    if (contentRecord.kind === "large_document") {
      assertExactKeys(contentRecord, `${label}.content`, [
        "kind",
        "initialBlocks",
      ]);
      const initialBlocks = parseBlockTree(
        contentRecord.initialBlocks,
        `${label}.content.initialBlocks`,
      );
      content = {
        kind: "large_document",
        initialBlocks,
      };
    } else if (contentRecord.kind === "large_code") {
      assertExactKeys(contentRecord, `${label}.content`, [
        "kind",
        "language",
        "code",
      ]);
      content = {
        kind: "large_code",
        language: readString(
          contentRecord,
          "language",
          `${label}.content`,
          MAX_LANGUAGE_LENGTH,
        ),
        code: readString(
          contentRecord,
          "code",
          `${label}.content`,
          MAX_ADDITIONAL_DOCUMENT_CODE_LENGTH,
          true,
        ),
      };
    } else {
      throw new AdditionalDocumentCommandContractError(
        `${label}.content.kind is not supported`,
      );
    }
    const blockId = readString(operation, "blockId", label);
    const location = parseDocumentLocation(
      operation.location,
      `${label}.location`,
    );
    if (content.kind === "large_document") {
      assertNewOwnerDoesNotCollideWithContent(
        blockId,
        content.initialBlocks,
        label,
      );
      const anchorIds =
        location.kind === "space"
          ? location.before === undefined
            ? []
            : [location.before.blockId]
          : [location.parentBlockId, location.beforeBlockId].filter(
              (candidate): candidate is string => candidate !== undefined,
            );
      if (
        anchorIds.some((anchorId) =>
          blockTreeContainsId(content.initialBlocks, anchorId),
        )
      ) {
        throw new AdditionalDocumentCommandContractError(
          `${label}.location anchor cannot be a newly-created content Block`,
        );
      }
    }
    if (location.kind === "space" && location.before?.blockId === blockId) {
      throw new AdditionalDocumentCommandContractError(
        `${label}.location cannot anchor before the identity being created`,
      );
    }
    if (
      location.kind === "document" &&
      (location.parentBlockId === blockId || location.beforeBlockId === blockId)
    ) {
      throw new AdditionalDocumentCommandContractError(
        `${label}.location cannot use the identity being created as an anchor`,
      );
    }
    return {
      kind,
      blockId,
      documentId: readString(operation, "documentId", label),
      displayName: readString(
        operation,
        "displayName",
        label,
        MAX_DISPLAY_NAME_LENGTH,
      ),
      content,
      location,
    };
  }
  if (kind === "delete_owned_source") {
    assertExactKeys(operation, label, [
      "kind",
      "ownerKind",
      "owner",
      "referencePolicy",
    ]);
    const ownerKinds = new Set<DeletableOwnedSourceKind>([
      "synced_block",
      "reusable_template",
      "large_document",
      "large_code",
    ]);
    if (!ownerKinds.has(operation.ownerKind as DeletableOwnedSourceKind)) {
      throw new AdditionalDocumentCommandContractError(
        `${label}.ownerKind is not supported`,
      );
    }
    return {
      kind,
      ownerKind: operation.ownerKind as DeletableOwnedSourceKind,
      owner: parseOwner(operation.owner, `${label}.owner`),
      referencePolicy: readLiteral(
        operation,
        "referencePolicy",
        label,
        "require_unreferenced",
      ),
    };
  }
  if (kind === "create_canvas_owner") {
    assertExactKeys(operation, label, [
      "kind",
      "scope",
      "blockId",
      "documentId",
      "displayName",
      "placement",
    ]);
    const blockId = readString(operation, "blockId", label);
    const placement = parseSpacePlacement(
      operation.placement,
      `${label}.placement`,
    );
    if (placement.before?.blockId === blockId) {
      throw new AdditionalDocumentCommandContractError(
        `${label}.placement cannot anchor before the identity being created`,
      );
    }
    return {
      kind,
      scope: readLiteral(operation, "scope", label, "non_primary"),
      blockId,
      documentId: readString(operation, "documentId", label),
      displayName: readString(
        operation,
        "displayName",
        label,
        MAX_DISPLAY_NAME_LENGTH,
      ),
      placement,
    };
  }
  if (kind === "delete_canvas_owner") {
    assertExactKeys(operation, label, [
      "kind",
      "scope",
      "owner",
      "referencePolicy",
    ]);
    return {
      kind,
      scope: readLiteral(operation, "scope", label, "non_primary"),
      owner: parseOwner(operation.owner, `${label}.owner`),
      referencePolicy: readLiteral(
        operation,
        "referencePolicy",
        label,
        "require_unreferenced",
      ),
    };
  }
  throw new AdditionalDocumentCommandContractError(
    `${label}.kind is not supported`,
  );
};

const requiredLeaseDocuments = (
  operation: AdditionalDocumentOperation,
): readonly AdditionalDocumentRevision[] => {
  switch (operation.kind) {
    case "create_synced_source":
    case "create_template":
    case "create_canvas_owner":
      return [];
    case "promote_synced_source":
      return [operation.host];
    case "demote_synced_source":
      return [operation.host, operation.source];
    case "instantiate_template":
      return [operation.source, operation.target];
    case "create_large_document":
      return operation.location.kind === "document"
        ? [operation.location.host]
        : [];
    case "delete_owned_source":
    case "delete_canvas_owner":
      return [operation.owner];
  }
};

const compareHeads = (
  left: AdditionalDocumentRevision,
  right: AdditionalDocumentRevision,
): number => left.documentId.localeCompare(right.documentId);

const parseCoordination = (
  value: unknown,
  operation: AdditionalDocumentOperation,
): AdditionalDocumentWriteCoordination => {
  const label = "additionalDocument.coordination";
  const coordination = readRecord(value, label);
  const expected = [...requiredLeaseDocuments(operation)].sort(compareHeads);
  if (expected.length === 0) {
    assertExactKeys(coordination, label, ["kind"]);
    readLiteral(coordination, "kind", label, "fifo_only");
    return { kind: "fifo_only" };
  }
  if (coordination.kind === "receipt_replay") {
    assertExactKeys(coordination, label, ["kind"]);
    return { kind: "receipt_replay" };
  }
  assertExactKeys(coordination, label, ["kind", "leaseId", "documents"]);
  readLiteral(coordination, "kind", label, "hub_lease");
  if (!Array.isArray(coordination.documents)) {
    throw new AdditionalDocumentCommandContractError(
      `${label}.documents must be an array`,
    );
  }
  const documents = coordination.documents
    .map((head, index) => parseHead(head, `${label}.documents[${index}]`))
    .sort(compareHeads);
  const unique = new Set(documents.map((head) => head.documentId));
  if (
    documents.length !== expected.length ||
    unique.size !== documents.length
  ) {
    throw new AdditionalDocumentCommandContractError(
      `${label} must fence the exact unique Document set`,
    );
  }
  const matches = expected.every((head, index) => {
    const actual = documents[index];
    return (
      actual?.documentId === head.documentId &&
      actual.generation === head.generation
    );
  });
  if (!matches) {
    throw new AdditionalDocumentCommandContractError(
      `${label} crossed a logical Document identity or generation`,
    );
  }
  return {
    kind: "hub_lease",
    leaseId: readString(coordination, "leaseId", label),
    documents,
  };
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) return serialized;
    throw new AdditionalDocumentCommandContractError(
      "Canonical command contains a non-JSON value",
    );
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

export const parseAdditionalDocumentCommandRequest = (
  value: unknown,
): AdditionalDocumentCommandRequest => {
  const label = "additionalDocument";
  const request = readRecord(value, label);
  assertExactKeys(request, label, [
    "version",
    "operationId",
    "projectId",
    "storeEpoch",
    "clientSessionId",
    "actor",
    "coordination",
    "operation",
  ]);
  if (request.version !== ADDITIONAL_DOCUMENT_COMMAND_VERSION) {
    throw new AdditionalDocumentCommandContractError(
      `${label}.version must be ${ADDITIONAL_DOCUMENT_COMMAND_VERSION}`,
    );
  }
  const operation = parseOperation(request.operation);
  const parsed: AdditionalDocumentCommandRequest = {
    version: ADDITIONAL_DOCUMENT_COMMAND_VERSION,
    operationId: readString(request, "operationId", label),
    projectId: readString(request, "projectId", label),
    storeEpoch: readString(request, "storeEpoch", label),
    clientSessionId: readString(request, "clientSessionId", label),
    actor: readActor(request.actor),
    coordination: parseCoordination(request.coordination, operation),
    operation,
  };
  if (
    stableStringify(parsed).length <= MAX_ADDITIONAL_DOCUMENT_COMMAND_LENGTH
  ) {
    return parsed;
  }
  throw new AdditionalDocumentCommandContractError(
    `${label} exceeds the canonical command size limit`,
  );
};

/**
 * Canonical logical retry identity. Actor/session and the renewable Hub lease
 * are first-attempt/transport evidence and intentionally do not participate.
 */
export const canonicalizeAdditionalDocumentCommandIntent = (
  value: unknown,
): string => {
  const request = parseAdditionalDocumentCommandRequest(value);
  return stableStringify({
    version: request.version,
    operationId: request.operationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    operation: request.operation,
  });
};

/** Canonical bytes consumed by the synchronous writer-side SHA-256. */
export const encodeAdditionalDocumentCommandSemanticHashInput = (
  value: unknown,
): Uint8Array =>
  new TextEncoder().encode(canonicalizeAdditionalDocumentCommandIntent(value));

/**
 * Compile a leased logical command against the durable heads acknowledged by
 * every mounted surface. Document IDs and generations remain part of logical
 * intent; only monotonically advancing headSeq proofs may be renewed.
 */
export const compileAdditionalDocumentCommandExecution = (
  value: unknown,
  input: {
    readonly leaseId: string;
    readonly documents: readonly AdditionalDocumentHeadRevision[];
  },
): AdditionalDocumentCommandRequest & {
  readonly coordination: Extract<
    AdditionalDocumentWriteCoordination,
    { readonly kind: "hub_lease" }
  >;
} => {
  const request = parseAdditionalDocumentCommandRequest(value);
  if (request.coordination.kind !== "hub_lease") {
    throw new AdditionalDocumentExecutionProofError(
      "invalid_execution_proof",
      "Only a Hub-leased command can compile renewable execution heads",
    );
  }
  const initialByDocument = new Map(
    request.coordination.documents.map((head) => [head.documentId, head]),
  );
  for (const head of input.documents) {
    const initial = initialByDocument.get(head.documentId);
    if (!initial) {
      throw new AdditionalDocumentExecutionProofError(
        "invalid_execution_proof",
        `Execution proof introduced unexpected Document ${head.documentId}`,
      );
    }
    if (head.generation !== initial.generation) {
      throw new AdditionalDocumentExecutionProofError(
        "document_generation_mismatch",
        `Document ${head.documentId} generation changed during write coordination`,
      );
    }
    if (head.headSeq < initial.headSeq) {
      throw new AdditionalDocumentExecutionProofError(
        "document_head_regressed",
        `Document ${head.documentId} execution head regressed`,
      );
    }
  }
  if (input.documents.length !== initialByDocument.size) {
    throw new AdditionalDocumentExecutionProofError(
      "invalid_execution_proof",
      "Execution proof must cover the exact logical Document set",
    );
  }
  const compiled = parseAdditionalDocumentCommandRequest({
    ...request,
    coordination: {
      kind: "hub_lease",
      leaseId: input.leaseId,
      documents: input.documents,
    },
  });
  if (compiled.coordination.kind === "hub_lease") {
    return { ...compiled, coordination: compiled.coordination };
  }
  throw new AdditionalDocumentExecutionProofError(
    "invalid_execution_proof",
    "Compiled execution proof did not produce a Hub lease",
  );
};

export const isAdditionalDocumentSemanticHash = (
  value: unknown,
): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

export const additionalDocumentCommandCapability = (
  kind: AdditionalDocumentCommandKind,
): AdditionalDocumentCommandCapability =>
  ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES[kind];

export const additionalDocumentCommandRequiredCoordination = (
  value: unknown,
): "fifo_only" | "hub_lease" => {
  const request = parseAdditionalDocumentCommandRequest(value);
  return requiredLeaseDocuments(request.operation).length === 0
    ? "fifo_only"
    : "hub_lease";
};

const COMMAND_KINDS = new Set<AdditionalDocumentCommandKind>(
  Object.keys(
    ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES,
  ) as AdditionalDocumentCommandKind[],
);

const readCommandKind = (
  value: unknown,
  label: string,
): AdditionalDocumentCommandKind => {
  if (
    typeof value === "string" &&
    COMMAND_KINDS.has(value as AdditionalDocumentCommandKind)
  ) {
    return value as AdditionalDocumentCommandKind;
  }
  throw new AdditionalDocumentCommandContractError(`${label} is not supported`);
};

const readIdArray = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value) || value.length > MAX_RESULT_BLOCK_IDS) {
    throw new AdditionalDocumentCommandContractError(
      `${label} must be a bounded identity array`,
    );
  }
  const ids = value.map((entry, index) =>
    readString({ value: entry }, "value", `${label}[${index}]`),
  );
  if (new Set(ids).size !== ids.length) {
    throw new AdditionalDocumentCommandContractError(
      `${label} must not contain duplicate identities`,
    );
  }
  if (
    ids.reduce((characters, id) => characters + id.length, 0) >
    MAX_ADDITIONAL_DOCUMENT_COMMAND_LENGTH
  ) {
    throw new AdditionalDocumentCommandContractError(
      `${label} exceeds the identity character budget`,
    );
  }
  return ids;
};

const parseEffect = (value: unknown): AdditionalDocumentMutationEffect => {
  const label = "additionalDocumentReceipt.effect";
  const effect = readRecord(value, label);
  assertExactKeys(effect, label, [
    "createdBlockIds",
    "preservedBlockIds",
    "deletedBlockIds",
    "documentHeads",
  ]);
  const createdBlockIds = readIdArray(
    effect.createdBlockIds,
    `${label}.createdBlockIds`,
  );
  const preservedBlockIds = readIdArray(
    effect.preservedBlockIds,
    `${label}.preservedBlockIds`,
  );
  const deletedBlockIds = readIdArray(
    effect.deletedBlockIds,
    `${label}.deletedBlockIds`,
  );
  const allIds = [...createdBlockIds, ...preservedBlockIds, ...deletedBlockIds];
  if (new Set(allIds).size !== allIds.length) {
    throw new AdditionalDocumentCommandContractError(
      `${label} identity categories must be disjoint`,
    );
  }
  if (
    allIds.reduce((characters, id) => characters + id.length, 0) >
    MAX_ADDITIONAL_DOCUMENT_COMMAND_LENGTH
  ) {
    throw new AdditionalDocumentCommandContractError(
      `${label} exceeds the aggregate identity budget`,
    );
  }
  if (!Array.isArray(effect.documentHeads)) {
    throw new AdditionalDocumentCommandContractError(
      `${label}.documentHeads must be an array`,
    );
  }
  if (effect.documentHeads.length > MAX_RESULT_BLOCK_IDS) {
    throw new AdditionalDocumentCommandContractError(
      `${label}.documentHeads exceeds the Document count limit`,
    );
  }
  const documentHeads = effect.documentHeads
    .map((head, index) => parseHead(head, `${label}.documentHeads[${index}]`))
    .sort(compareHeads);
  if (
    new Set(documentHeads.map((head) => head.documentId)).size !==
    documentHeads.length
  ) {
    throw new AdditionalDocumentCommandContractError(
      `${label}.documentHeads must contain unique Documents`,
    );
  }
  return { createdBlockIds, preservedBlockIds, deletedBlockIds, documentHeads };
};

const readIsoTimestamp = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string => {
  const value = readString(record, key, label, 64);
  try {
    if (new Date(value).toISOString() === value) return value;
  } catch {
    // Fall through to the stable contract error below.
  }
  throw new AdditionalDocumentCommandContractError(
    `${label}.${key} must be a canonical ISO timestamp`,
  );
};

export const parseAdditionalDocumentCommandReceipt = (
  value: unknown,
): AdditionalDocumentCommandReceipt => {
  const label = "additionalDocumentReceipt";
  const receipt = readRecord(value, label);
  assertExactKeys(receipt, label, [
    "version",
    "operationId",
    "projectId",
    "storeEpoch",
    "operationKind",
    "semanticHash",
    "duplicate",
    "effect",
    "changeLogSeq",
    "committedAt",
  ]);
  if (receipt.version !== ADDITIONAL_DOCUMENT_COMMAND_VERSION) {
    throw new AdditionalDocumentCommandContractError(
      `${label}.version must be ${ADDITIONAL_DOCUMENT_COMMAND_VERSION}`,
    );
  }
  const operationKind = readCommandKind(
    receipt.operationKind,
    `${label}.operationKind`,
  );
  if (
    ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES[operationKind].availability ===
    "capability_gap"
  ) {
    throw new AdditionalDocumentCommandContractError(
      `${label} cannot claim success for capability gap ${operationKind}`,
    );
  }
  if (!isAdditionalDocumentSemanticHash(receipt.semanticHash)) {
    throw new AdditionalDocumentCommandContractError(
      `${label}.semanticHash must be lowercase SHA-256 hex`,
    );
  }
  const parsed: AdditionalDocumentCommandReceipt = {
    version: ADDITIONAL_DOCUMENT_COMMAND_VERSION,
    operationId: readString(receipt, "operationId", label),
    projectId: readString(receipt, "projectId", label),
    storeEpoch: readString(receipt, "storeEpoch", label),
    operationKind,
    semanticHash: receipt.semanticHash,
    duplicate: readBoolean(receipt, "duplicate", label),
    effect: parseEffect(receipt.effect),
    changeLogSeq: readInteger(receipt, "changeLogSeq", label, 1),
    committedAt: readIsoTimestamp(receipt, "committedAt", label),
  };
  if (
    stableStringify(parsed).length <= MAX_ADDITIONAL_DOCUMENT_COMMAND_LENGTH
  ) {
    return parsed;
  }
  throw new AdditionalDocumentCommandContractError(
    `${label} exceeds the canonical receipt size limit`,
  );
};

const ERROR_CODES = new Set<AdditionalDocumentCommandErrorCode>([
  "invalid_request",
  "store_epoch_mismatch",
  "operation_id_collision",
  "capability_gap",
  "project_not_found",
  "identity_conflict",
  "block_revision_conflict",
  "document_head_conflict",
  "document_generation_mismatch",
  "source_not_found",
  "source_referenced",
  "source_shared",
  "reference_not_found",
  "coordination_failed",
  "document_state_corrupt",
  "unknown",
]);

const parseError = (value: unknown): AdditionalDocumentCommandError => {
  const label = "additionalDocumentResult.error";
  const error = readRecord(value, label);
  assertExactKeys(error, label, [
    "code",
    "message",
    "retryable",
    "operationId",
    "operationKind",
  ]);
  if (
    typeof error.code !== "string" ||
    !ERROR_CODES.has(error.code as AdditionalDocumentCommandErrorCode)
  ) {
    throw new AdditionalDocumentCommandContractError(
      `${label}.code is not supported`,
    );
  }
  const operationKind =
    error.operationKind === null
      ? null
      : readCommandKind(error.operationKind, `${label}.operationKind`);
  const parsed: AdditionalDocumentCommandError = {
    code: error.code as AdditionalDocumentCommandErrorCode,
    message: readString(error, "message", label, 4_096),
    retryable: readBoolean(error, "retryable", label),
    operationId: readString(error, "operationId", label),
    operationKind,
  };
  if (parsed.code !== "capability_gap") return parsed;
  if (
    parsed.retryable ||
    parsed.operationKind === null ||
    ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES[parsed.operationKind]
      .availability !== "capability_gap"
  ) {
    throw new AdditionalDocumentCommandContractError(
      `${label} capability_gap must name a current non-retryable gap`,
    );
  }
  return parsed;
};

export const parseAdditionalDocumentCommandResult = (
  value: unknown,
): AdditionalDocumentCommandResult => {
  const label = "additionalDocumentResult";
  const result = readRecord(value, label);
  if (result.ok === true) {
    assertExactKeys(result, label, ["ok", "value"]);
    return {
      ok: true,
      value: parseAdditionalDocumentCommandReceipt(result.value),
    };
  }
  if (result.ok === false) {
    assertExactKeys(result, label, ["ok", "error"]);
    return { ok: false, error: parseError(result.error) };
  }
  throw new AdditionalDocumentCommandContractError(
    `${label}.ok must be a boolean`,
  );
};
