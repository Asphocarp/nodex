import type { BlockPropertyJsonValue } from "./block-property-mutations";
import {
  CardProjectTransferContractError,
  parseCardProjectTransferIntent,
  parseCardProjectTransferCommandResult,
  type CardProjectTransferCommandError,
  type CardProjectTransferCommandResult,
  type CardProjectTransferIntent,
} from "./card-project-transfer";

const MAX_ID_LENGTH = 512;

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

export type PublicCardProjectTransferIntent = Omit<
  CardProjectTransferIntent,
  "clientSessionId" | "actor"
>;

export interface TrustedCardProjectTransferIdentity {
  readonly clientSessionId: string;
  readonly actor: Readonly<Record<string, BlockPropertyJsonValue>>;
}

export type BoundCardProjectTransferIntent =
  | { readonly ok: true; readonly value: CardProjectTransferIntent }
  | { readonly ok: false; readonly error: CardProjectTransferCommandError };

export const cardProjectTransferFailure = (
  code: CardProjectTransferCommandError["code"],
  message: string,
  options: {
    readonly operationId?: string;
    readonly cardId?: string;
    readonly retryable?: boolean;
  } = {},
): CardProjectTransferCommandError => ({
  code,
  message: message.length <= 4_096 ? message : `${message.slice(0, 4_095)}…`,
  retryable: options.retryable ?? false,
  ...(options.operationId === undefined
    ? {}
    : { operationId: options.operationId }),
  ...(options.cardId === undefined ? {} : { cardId: options.cardId }),
});

const parsePublicIntent = (
  value: unknown,
  identity: TrustedCardProjectTransferIdentity,
): CardProjectTransferIntent => {
  if (!isRecord(value)) {
    throw new CardProjectTransferContractError(
      "cardProjectTransferIntent must be an object",
    );
  }
  const allowed = new Set([
    "version",
    "operationId",
    "sourceProjectId",
    "targetProjectId",
    "cardId",
    "target",
  ]);
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    throw new CardProjectTransferContractError(
      `cardProjectTransferIntent.${key} is not supported`,
    );
  }
  return parseCardProjectTransferIntent({
    ...value,
    clientSessionId: identity.clientSessionId,
    actor: identity.actor,
  });
};

/** Bind route scope and audit identity at the trusted host boundary. */
export const bindCardProjectTransferIntent = (
  rawIntent: unknown,
  rawSourceProjectId: unknown,
  identity: TrustedCardProjectTransferIdentity,
): BoundCardProjectTransferIntent => {
  const sourceProjectId =
    typeof rawSourceProjectId === "string" &&
    rawSourceProjectId.length > 0 &&
    rawSourceProjectId.length <= MAX_ID_LENGTH &&
    rawSourceProjectId === rawSourceProjectId.trim()
      ? rawSourceProjectId
      : null;
  const operationId = readIdentityHint(rawIntent, "operationId");
  const cardId = readIdentityHint(rawIntent, "cardId");
  if (!sourceProjectId) {
    return {
      ok: false,
      error: cardProjectTransferFailure(
        "invalid_card_project_transfer_request",
        "Card transfer source Project scope is invalid",
        { operationId, cardId },
      ),
    };
  }

  let intent: CardProjectTransferIntent;
  try {
    intent = parsePublicIntent(rawIntent, identity);
  } catch (error) {
    return {
      ok: false,
      error: cardProjectTransferFailure(
        "invalid_card_project_transfer_request",
        error instanceof CardProjectTransferContractError
          ? error.message
          : "Card Project transfer intent is invalid",
        { operationId, cardId },
      ),
    };
  }
  if (intent.sourceProjectId !== sourceProjectId) {
    return {
      ok: false,
      error: cardProjectTransferFailure(
        "invalid_card_project_transfer_request",
        "Card transfer intent does not match its source Project route scope",
        { operationId: intent.operationId, cardId: intent.cardId },
      ),
    };
  }
  return { ok: true, value: intent };
};

export const cardProjectTransferTransportFailure = (
  intent: CardProjectTransferIntent,
  error: unknown,
): CardProjectTransferCommandResult =>
  parseCardProjectTransferCommandResult({
    ok: false,
    error: cardProjectTransferFailure(
      "unknown",
      error instanceof Error
        ? error.message
        : "The durable Card Project transfer writer is unavailable",
      {
        operationId: intent.operationId,
        cardId: intent.cardId,
        retryable: true,
      },
    ),
  });

export const cardProjectTransferHttpStatus = (
  error: CardProjectTransferCommandError,
): 400 | 404 | 409 | 500 | 503 => {
  if (
    error.code === "source_project_not_found" ||
    error.code === "target_project_not_found" ||
    error.code === "card_not_found"
  ) {
    return 404;
  }
  if (
    error.code === "operation_id_collision" ||
    error.code === "store_epoch_mismatch" ||
    error.code === "block_authority_conflict" ||
    error.code === "document_authority_conflict" ||
    error.code === "document_generation_mismatch" ||
    error.code === "document_head_conflict" ||
    error.code === "membership_authority_conflict" ||
    error.code === "target_database_conflict" ||
    error.code === "target_view_conflict" ||
    error.code === "position_anchor_not_found" ||
    error.code === "position_anchor_group_mismatch"
  ) {
    return 409;
  }
  if (
    error.retryable &&
    (error.code === "coordination_failed" || error.code === "unknown")
  ) {
    return 503;
  }
  if (
    error.code === "operation_receipt_corrupt" ||
    error.code === "foreign_key_violation" ||
    error.code === "unknown"
  ) {
    return 500;
  }
  return 400;
};
