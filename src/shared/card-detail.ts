import type { CardMetadataPropertySnapshot } from "./card-metadata-property-compiler";
import { parseCardMetadataPropertySnapshot } from "./card-metadata-property-snapshot";
import type { CardTargetReadModel } from "./card-targets";
import { decodeCardTargetReadModelHttp } from "./reference-read-http-contract";

export const CARD_DETAIL_CONTRACT_VERSION = 2 as const;

type AvailableCardTarget = Extract<
  CardTargetReadModel,
  { readonly status: "available" }
>;

export interface CardDetailMembership {
  readonly id: string;
  readonly databaseBlockId: string;
  readonly revision: number;
}

export type CardDetailDatabaseContext =
  | { readonly kind: "standalone" }
  | {
      readonly kind: "member";
      readonly membership: CardDetailMembership;
    };

/**
 * Membership-independent read model for opening one Card. Content remains a
 * projection of the owned Y.Doc; `document` is the coordinate used to prepare
 * that authority, and `properties` carries bounded field/revision evidence.
 */
export interface CardDetail {
  readonly version: typeof CARD_DETAIL_CONTRACT_VERSION;
  readonly card: AvailableCardTarget["card"];
  readonly document: AvailableCardTarget["document"];
  readonly properties: CardMetadataPropertySnapshot;
  readonly databaseContext: CardDetailDatabaseContext;
}

export type CardDetailReadErrorCode =
  | "invalid_request"
  | "card_not_found"
  | "card_detail_corrupt"
  | "unknown";

export interface CardDetailReadError {
  readonly code: CardDetailReadErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type CardDetailCommandResult =
  | { readonly ok: true; readonly value: CardDetail }
  | { readonly ok: false; readonly error: CardDetailReadError };

export class CardDetailContractError extends TypeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CardDetailContractError";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> => {
  if (isRecord(value)) return value;
  throw new CardDetailContractError(`${label} must be an object`);
};

const requireExactKeys = (
  value: Readonly<Record<string, unknown>>,
  label: string,
  keys: readonly string[],
): void => {
  const expected = new Set(keys);
  for (const key of keys) {
    if (Object.hasOwn(value, key)) continue;
    throw new CardDetailContractError(`${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (expected.has(key)) continue;
    throw new CardDetailContractError(`${label}.${key} is not supported`);
  }
};

const requireCanonicalString = (value: unknown, label: string): string => {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value === value.trim()
  ) {
    return value;
  }
  throw new CardDetailContractError(
    `${label} must be a canonical non-empty string`,
  );
};

const requireRevision = (value: unknown, label: string): number => {
  if (Number.isSafeInteger(value) && (value as number) >= 0) {
    return value as number;
  }
  throw new CardDetailContractError(
    `${label} must be a non-negative safe integer`,
  );
};

const parseDatabaseContext = (
  value: unknown,
): CardDetailDatabaseContext => {
  const context = requireRecord(value, "cardDetail.databaseContext");
  if (context.kind === "standalone") {
    requireExactKeys(context, "cardDetail.databaseContext", ["kind"]);
    return { kind: "standalone" };
  }
  if (context.kind !== "member") {
    throw new CardDetailContractError(
      "cardDetail.databaseContext.kind must be standalone or member",
    );
  }
  requireExactKeys(context, "cardDetail.databaseContext", [
    "kind",
    "membership",
  ]);
  const membership = requireRecord(
    context.membership,
    "cardDetail.databaseContext.membership",
  );
  requireExactKeys(membership, "cardDetail.databaseContext.membership", [
    "id",
    "databaseBlockId",
    "revision",
  ]);
  return {
    kind: "member",
    membership: {
      id: requireCanonicalString(
        membership.id,
        "cardDetail.databaseContext.membership.id",
      ),
      databaseBlockId: requireCanonicalString(
        membership.databaseBlockId,
        "cardDetail.databaseContext.membership.databaseBlockId",
      ),
      revision: requireRevision(
        membership.revision,
        "cardDetail.databaseContext.membership.revision",
      ),
    },
  };
};

export const parseCardDetail = (value: unknown): CardDetail => {
  const detail = requireRecord(value, "cardDetail");
  requireExactKeys(detail, "cardDetail", [
    "version",
    "card",
    "document",
    "properties",
    "databaseContext",
  ]);
  if (detail.version !== CARD_DETAIL_CONTRACT_VERSION) {
    throw new CardDetailContractError(
      `cardDetail.version must be ${CARD_DETAIL_CONTRACT_VERSION}`,
    );
  }
  const cardInput = requireRecord(detail.card, "cardDetail.card");
  const targetBlockId = requireCanonicalString(
    cardInput.blockId,
    "cardDetail.card.blockId",
  );
  let target: AvailableCardTarget;
  try {
    const parsed = decodeCardTargetReadModelHttp({
      status: "available",
      targetBlockId,
      card: detail.card,
      document: detail.document,
    });
    if (parsed.status !== "available") {
      throw new CardDetailContractError(
        "cardDetail target must be available",
      );
    }
    target = parsed;
  } catch (error) {
    if (error instanceof CardDetailContractError) throw error;
    throw new CardDetailContractError(
      `cardDetail Card/Document coordinate is invalid: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  let properties: CardMetadataPropertySnapshot;
  try {
    properties = parseCardMetadataPropertySnapshot(detail.properties);
  } catch (error) {
    throw new CardDetailContractError(
      `cardDetail properties are invalid: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const databaseContext = parseDatabaseContext(detail.databaseContext);

  if (
    properties.projectId !== target.card.projectId ||
    properties.cardBlockId !== target.card.blockId ||
    properties.metadataRevision !== target.card.metadataRevision
  ) {
    throw new CardDetailContractError(
      "cardDetail property snapshot does not match its Card coordinate",
    );
  }

  const databaseFields = properties.fields.filter(
    (field) => field.scope === "database",
  );
  if (databaseContext.kind === "standalone") {
    if (target.card.location.kind === "database") {
      throw new CardDetailContractError(
        "Database-located Card must include a member databaseContext",
      );
    }
    if (databaseFields.length > 0) {
      throw new CardDetailContractError(
        "Standalone Card cannot include Database property coordinates",
      );
    }
  } else {
    if (
      target.card.location.kind !== "database" ||
      target.card.location.databaseBlockId !==
        databaseContext.membership.databaseBlockId
    ) {
      throw new CardDetailContractError(
        "Card Database location does not match its active membership",
      );
    }
    if (
      databaseFields.some(
        (field) =>
          field.databaseBlockId !==
          databaseContext.membership.databaseBlockId,
      )
    ) {
      throw new CardDetailContractError(
        "Card Database property coordinates span multiple Databases",
      );
    }
  }

  return {
    version: CARD_DETAIL_CONTRACT_VERSION,
    card: target.card,
    document: target.document,
    properties,
    databaseContext,
  };
};

export const parseCardDetailCommandResult = (
  value: unknown,
): CardDetailCommandResult => {
  const result = requireRecord(value, "cardDetailCommandResult");
  if (result.ok === true) {
    requireExactKeys(result, "cardDetailCommandResult", ["ok", "value"]);
    return { ok: true, value: parseCardDetail(result.value) };
  }
  if (result.ok !== false) {
    throw new CardDetailContractError(
      "cardDetailCommandResult.ok must be a boolean",
    );
  }
  requireExactKeys(result, "cardDetailCommandResult", ["ok", "error"]);
  const error = requireRecord(result.error, "cardDetailCommandResult.error");
  requireExactKeys(error, "cardDetailCommandResult.error", [
    "code",
    "message",
    "retryable",
  ]);
  const code = error.code;
  if (
    code !== "invalid_request" &&
    code !== "card_not_found" &&
    code !== "card_detail_corrupt" &&
    code !== "unknown"
  ) {
    throw new CardDetailContractError(
      "cardDetailCommandResult.error.code is invalid",
    );
  }
  if (typeof error.retryable !== "boolean") {
    throw new CardDetailContractError(
      "cardDetailCommandResult.error.retryable must be a boolean",
    );
  }
  return {
    ok: false,
    error: {
      code,
      message: requireCanonicalString(
        error.message,
        "cardDetailCommandResult.error.message",
      ),
      retryable: error.retryable,
    },
  };
};
