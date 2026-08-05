import {
  BLOCK_TRANSFER_CONTRACT_VERSION,
  BlockTransferContractError,
  parseBlockTransferIntent,
  type BlockTransferCommandError,
  type BlockTransferCommandResult,
  type BlockTransferIntent,
  type BlockTransferReceipt,
} from "./block-transfer";
import type { DatabaseJsonValue } from "./database-kernel";

const MAX_ID_LENGTH = 512;
const MAX_MESSAGE_LENGTH = 4_096;

const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readIdentityHint = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) return undefined;
  const candidate = value[key];
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    candidate.length > MAX_ID_LENGTH ||
    candidate !== candidate.trim()
  ) {
    return undefined;
  }
  return candidate;
};

export type PublicBlockTransferIntent = Omit<
  BlockTransferIntent,
  "clientSessionId" | "actor"
>;

export interface TrustedBlockTransferIdentity {
  readonly clientSessionId: string;
  readonly actor: Readonly<Record<string, DatabaseJsonValue>>;
}

export type BoundBlockTransferIntent =
  | { readonly ok: true; readonly value: BlockTransferIntent }
  | { readonly ok: false; readonly error: BlockTransferCommandError };

export const blockTransferFailure = (
  code: BlockTransferCommandError["code"],
  message: string,
  options: {
    readonly operationId?: string;
    readonly retryable?: boolean;
    readonly reloadRequired?: boolean;
  } = {},
): BlockTransferCommandError => ({
  code,
  message:
    message.length <= MAX_MESSAGE_LENGTH
      ? message
      : `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…`,
  retryable: options.retryable ?? false,
  reloadRequired: options.reloadRequired ?? false,
  ...(options.operationId ? { operationId: options.operationId } : {}),
});

const parsePublicIntent = (
  value: unknown,
  identity: TrustedBlockTransferIdentity,
): BlockTransferIntent => {
  if (!isRecord(value)) {
    throw new BlockTransferContractError(
      "blockTransferIntent must be an object",
    );
  }
  const allowed = new Set([
    "version",
    "operationId",
    "projectId",
    "storeEpoch",
    "mode",
    "rootBlockIds",
    "causalDependencies",
    "source",
    "target",
  ]);
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    throw new BlockTransferContractError(
      `blockTransferIntent.${key} is not supported`,
    );
  }
  return parseBlockTransferIntent({
    ...value,
    clientSessionId: identity.clientSessionId,
    actor: identity.actor,
  });
};

/** Bind Project route scope and host-owned audit identity. */
export const bindBlockTransferIntent = (
  rawIntent: unknown,
  rawProjectId: unknown,
  identity: TrustedBlockTransferIdentity,
): BoundBlockTransferIntent => {
  const projectId =
    typeof rawProjectId === "string" &&
    rawProjectId.length > 0 &&
    rawProjectId.length <= MAX_ID_LENGTH &&
    rawProjectId === rawProjectId.trim()
      ? rawProjectId
      : null;
  const operationId = readIdentityHint(rawIntent, "operationId");
  if (!projectId) {
    return {
      ok: false,
      error: blockTransferFailure(
        "invalid_transfer_request",
        "Block transfer Project scope is invalid",
        { operationId },
      ),
    };
  }
  let intent: BlockTransferIntent;
  try {
    intent = parsePublicIntent(rawIntent, identity);
  } catch (error) {
    return {
      ok: false,
      error: blockTransferFailure(
        "invalid_transfer_request",
        error instanceof BlockTransferContractError
          ? error.message
          : "Block transfer intent is invalid",
        { operationId },
      ),
    };
  }
  if (intent.projectId !== projectId) {
    return {
      ok: false,
      error: blockTransferFailure(
        "invalid_transfer_request",
        "Block transfer intent does not match its Project route scope",
        { operationId: intent.operationId },
      ),
    };
  }
  return { ok: true, value: intent };
};

export const blockTransferTransportFailure = (
  intent: BlockTransferIntent,
  error: unknown,
): BlockTransferCommandResult => ({
  ok: false,
  error: blockTransferFailure(
    "unknown",
    error instanceof Error
      ? error.message
      : "The durable Block transfer writer is unavailable",
    { operationId: intent.operationId, retryable: true },
  ),
});

export const blockTransferHttpStatus = (
  error: BlockTransferCommandError,
): 400 | 404 | 409 | 500 | 503 => {
  if (
    error.code === "project_not_found" ||
    error.code === "block_not_found" ||
    error.code === "target_not_found"
  ) {
    return 404;
  }
  if (
    error.code === "store_epoch_mismatch" ||
    error.code === "operation_id_collision" ||
    error.code === "source_parent_mismatch" ||
    error.code === "location_revision_mismatch" ||
    error.code === "source_head_mismatch" ||
    error.code === "target_head_mismatch" ||
    error.code === "membership_revision_mismatch" ||
    error.code === "transfer_cycle" ||
    error.code === "recovery_required"
  ) {
    return 409;
  }
  if (error.code === "unknown") return error.retryable ? 503 : 500;
  return 400;
};

interface BlockTransferReceiptWire
  extends Omit<BlockTransferReceipt, "documentCommits"> {
  readonly documentCommits: readonly (Omit<
    BlockTransferReceipt["documentCommits"][number],
    "update" | "stateVector"
  > & {
    readonly updateBase64: string | null;
    readonly stateVectorBase64: string;
  })[];
}

export type BlockTransferHttpWireResult =
  | { readonly ok: true; readonly value: BlockTransferReceiptWire }
  | { readonly ok: false; readonly error: BlockTransferCommandError };

const bytesToBase64 = (bytes: Uint8Array): string => {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const encodeBlockTransferHttpResult = (
  result: BlockTransferCommandResult,
): BlockTransferHttpWireResult => {
  if (!result.ok) return result;
  return {
    ok: true,
    value: {
      ...result.value,
      documentCommits: result.value.documentCommits.map((commit) => ({
        documentId: commit.documentId,
        generation: commit.generation,
        baseHeadSeq: commit.baseHeadSeq,
        headSeq: commit.headSeq,
        updateId: commit.updateId,
        updateBase64: commit.update ? bytesToBase64(commit.update) : null,
        stateVectorBase64: bytesToBase64(commit.stateVector),
      })),
    },
  };
};

export const decodeBlockTransferHttpResult = (
  value: unknown,
): BlockTransferCommandResult => {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw new BlockTransferContractError(
      "Block transfer response must be a command result",
    );
  }
  if (!value.ok) {
    if (!isRecord(value.error)) {
      throw new BlockTransferContractError(
        "Block transfer error response is invalid",
      );
    }
    return value as unknown as BlockTransferCommandResult;
  }
  if (!isRecord(value.value) || !Array.isArray(value.value.documentCommits)) {
    throw new BlockTransferContractError(
      "Block transfer receipt is invalid",
    );
  }
  const receipt = value.value as unknown as BlockTransferReceiptWire;
  if (receipt.version !== BLOCK_TRANSFER_CONTRACT_VERSION) {
    throw new BlockTransferContractError(
      "Block transfer receipt version is invalid",
    );
  }
  return {
    ok: true,
    value: {
      ...receipt,
      documentCommits: receipt.documentCommits.map((commit) => ({
        documentId: commit.documentId,
        generation: commit.generation,
        baseHeadSeq: commit.baseHeadSeq,
        headSeq: commit.headSeq,
        updateId: commit.updateId,
        update:
          commit.updateBase64 === null
            ? null
            : base64ToBytes(commit.updateBase64),
        stateVector: base64ToBytes(commit.stateVectorBase64),
      })),
    },
  };
};
