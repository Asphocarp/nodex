import type {
  BlockId,
  DocumentId,
  OwnedDocumentDescriptor,
} from "../../shared/block-documents/contracts";
import {
  CARD_DOCUMENT_SCHEMA_KEY,
  CARD_DOCUMENT_SCHEMA_VERSION,
} from "../../shared/block-documents/card-document";
import type {
  DocumentSyncCommandResult,
  DocumentSyncErrorCode,
} from "../../shared/block-documents/document-sync";
import {
  BlockDocumentSchemaError,
  getOwnedDocumentSchemaRegistration,
} from "../../shared/block-documents/document-schema-adapters";

export const CARD_BLOCK_DOCUMENT_SCHEMA_KEY = CARD_DOCUMENT_SCHEMA_KEY;
export const CARD_BLOCK_DOCUMENT_SCHEMA_VERSION = CARD_DOCUMENT_SCHEMA_VERSION;

export interface OwnedBlockDocumentRequest {
  readonly projectId: string;
  readonly ownerBlockId: BlockId;
}

export interface ReadyCardBlockDocumentDescriptor extends OwnedDocumentDescriptor {
  readonly ownerType: "card";
  readonly ownerLifecycle: "active";
  readonly schemaKey: typeof CARD_BLOCK_DOCUMENT_SCHEMA_KEY;
  readonly schemaVersion: typeof CARD_BLOCK_DOCUMENT_SCHEMA_VERSION;
  readonly readiness: "ready";
  readonly sync: { readonly kind: "yjs"; readonly stateVector: Uint8Array };
}

export interface ReadyRegisteredOwnedBlockDocumentDescriptor extends OwnedDocumentDescriptor {
  readonly ownerLifecycle: "active";
  readonly readiness: "ready";
}

export type OwnedBlockDocumentErrorCode =
  | DocumentSyncErrorCode
  | "invalid_request"
  | "fetch_failed"
  | "invalid_descriptor"
  | "project_mismatch"
  | "owner_mismatch"
  | "unsupported_owner_type"
  | "owner_not_active"
  | "document_not_ready"
  | "unsupported_document_schema"
  | "unsupported_sync_engine";

export interface OwnedBlockDocumentErrorModel {
  readonly code: OwnedBlockDocumentErrorCode;
  readonly message: string;
}

interface OwnedBlockDocumentRequestModel {
  readonly projectId: string;
  readonly ownerBlockId: BlockId;
}

export type OwnedBlockDocumentModel =
  | (OwnedBlockDocumentRequestModel & {
      readonly status: "loading";
    })
  | (OwnedBlockDocumentRequestModel & {
      readonly status: "error";
      readonly error: OwnedBlockDocumentErrorModel;
    })
  | (OwnedBlockDocumentRequestModel & {
      readonly status: "ready";
      readonly descriptor: ReadyCardBlockDocumentDescriptor;
    });

export type RegisteredOwnedBlockDocumentModel =
  | (OwnedBlockDocumentRequestModel & {
      readonly status: "loading";
    })
  | (OwnedBlockDocumentRequestModel & {
      readonly status: "error";
      readonly error: OwnedBlockDocumentErrorModel;
    })
  | (OwnedBlockDocumentRequestModel & {
      readonly status: "ready";
      readonly descriptor: ReadyRegisteredOwnedBlockDocumentDescriptor;
    });

export type OwnedBlockDocumentQuerySnapshot =
  | { readonly status: "pending" }
  | { readonly status: "error"; readonly error: unknown }
  | {
      readonly status: "success";
      readonly data: ReadyCardBlockDocumentDescriptor;
    };

export type RegisteredOwnedBlockDocumentQuerySnapshot =
  | { readonly status: "pending" }
  | { readonly status: "error"; readonly error: unknown }
  | {
      readonly status: "success";
      readonly data: ReadyRegisteredOwnedBlockDocumentDescriptor;
    };

export type OwnedDocumentDescriptorFetcher = (
  projectId: string,
  ownerBlockId: BlockId,
) => Promise<unknown>;

export class OwnedBlockDocumentBoundaryError extends Error {
  readonly code: OwnedBlockDocumentErrorCode;

  constructor(
    code: OwnedBlockDocumentErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OwnedBlockDocumentBoundaryError";
    this.code = code;
  }
}

export const unwrapOwnedBlockDocumentPreparationResult = (
  result: DocumentSyncCommandResult<OwnedDocumentDescriptor>,
): OwnedDocumentDescriptor => {
  if (result.ok) return result.value;
  throw new OwnedBlockDocumentBoundaryError(
    result.error.code,
    result.error.message,
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isExactNonEmptyId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.trim() === value;

const requireValidRequest = (
  request: OwnedBlockDocumentRequest,
): OwnedBlockDocumentRequest => {
  if (
    isExactNonEmptyId(request.projectId) &&
    isExactNonEmptyId(request.ownerBlockId)
  ) {
    return request;
  }
  throw new OwnedBlockDocumentBoundaryError(
    "invalid_request",
    "Owned Block Document requests require exact Project and owner Block IDs",
  );
};

const requireDescriptorCore = (value: Record<string, unknown>): void => {
  if (
    isExactNonEmptyId(value.documentId) &&
    isExactNonEmptyId(value.storeEpoch) &&
    Number.isSafeInteger(value.generation) &&
    (value.generation as number) >= 1 &&
    Number.isSafeInteger(value.headSeq) &&
    (value.headSeq as number) >= 0 &&
    isRecord(value.sync) &&
    (value.sync.kind === "canvas_scene" ||
      (value.sync.kind === "yjs" && value.sync.stateVector instanceof Uint8Array))
  ) {
    return;
  }
  throw new OwnedBlockDocumentBoundaryError(
    "invalid_descriptor",
    "Owned Block Document descriptor has invalid runtime identity or head fields",
  );
};

export const validateOwnedBlockDocumentDescriptor = (
  request: OwnedBlockDocumentRequest,
  value: unknown,
): ReadyCardBlockDocumentDescriptor => {
  const requested = requireValidRequest(request);
  if (
    isRecord(value) &&
    value.projectId === requested.projectId &&
    value.ownerBlockId === requested.ownerBlockId &&
    value.ownerType !== "card"
  ) {
    throw new OwnedBlockDocumentBoundaryError(
      "unsupported_owner_type",
      "Card surfaces require a Card-owned Block Document",
    );
  }
  const registered = validateRegisteredOwnedBlockDocumentDescriptor(
    requested,
    value,
  );
  if (
    registered.schemaKey !== CARD_BLOCK_DOCUMENT_SCHEMA_KEY ||
    registered.schemaVersion !== CARD_BLOCK_DOCUMENT_SCHEMA_VERSION ||
    registered.sync.kind !== "yjs"
  ) {
    throw new OwnedBlockDocumentBoundaryError(
      "unsupported_document_schema",
      `Card surfaces require ${CARD_BLOCK_DOCUMENT_SCHEMA_KEY}@${CARD_BLOCK_DOCUMENT_SCHEMA_VERSION}`,
    );
  }
  return registered as ReadyCardBlockDocumentDescriptor;
};

export const validateRegisteredOwnedBlockDocumentDescriptor = (
  request: OwnedBlockDocumentRequest,
  value: unknown,
): ReadyRegisteredOwnedBlockDocumentDescriptor => {
  const requested = requireValidRequest(request);
  if (!isRecord(value)) {
    throw new OwnedBlockDocumentBoundaryError(
      "invalid_descriptor",
      "Owned Block Document descriptor must be an object",
    );
  }
  if (value.projectId !== requested.projectId) {
    throw new OwnedBlockDocumentBoundaryError(
      "project_mismatch",
      "Owned Block Document descriptor does not belong to the requested Project",
    );
  }
  if (value.ownerBlockId !== requested.ownerBlockId) {
    throw new OwnedBlockDocumentBoundaryError(
      "owner_mismatch",
      "Owned Block Document descriptor does not belong to the requested owner Block",
    );
  }
  if (value.ownerLifecycle !== "active") {
    throw new OwnedBlockDocumentBoundaryError(
      "owner_not_active",
      "Owned Block Document surfaces require an active owner Block",
    );
  }
  if (value.readiness !== "ready") {
    throw new OwnedBlockDocumentBoundaryError(
      "document_not_ready",
      "Owned Block Document surfaces require a ready Document",
    );
  }
  if (
    typeof value.ownerType !== "string" ||
    typeof value.schemaKey !== "string" ||
    !Number.isSafeInteger(value.schemaVersion)
  ) {
    throw new OwnedBlockDocumentBoundaryError(
      "unsupported_document_schema",
      "Owned Block Document descriptor has an invalid owner/schema identity",
    );
  }
  let registration;
  try {
    registration = getOwnedDocumentSchemaRegistration({
      ownerType: value.ownerType,
      schemaKey: value.schemaKey,
      schemaVersion: value.schemaVersion as number,
    });
  } catch (error) {
    if (!(error instanceof BlockDocumentSchemaError)) throw error;
    throw new OwnedBlockDocumentBoundaryError(
      "unsupported_document_schema",
      error.message,
      { cause: error },
    );
  }
  if (!isRecord(value.sync) || value.sync.kind !== registration.syncEngine) {
    throw new OwnedBlockDocumentBoundaryError(
      "unsupported_sync_engine",
      "Owned Document descriptor does not match its registered sync engine",
    );
  }
  requireDescriptorCore(value);
  return value as unknown as ReadyRegisteredOwnedBlockDocumentDescriptor;
};

const fetchDescriptor = async <T>(
  request: OwnedBlockDocumentRequest,
  fetcher: OwnedDocumentDescriptorFetcher,
  validate: (request: OwnedBlockDocumentRequest, value: unknown) => T,
): Promise<T> => {
  const requested = requireValidRequest(request);
  let descriptor: unknown;
  try {
    descriptor = await fetcher(requested.projectId, requested.ownerBlockId);
  } catch (error) {
    if (error instanceof OwnedBlockDocumentBoundaryError) throw error;
    throw new OwnedBlockDocumentBoundaryError(
      "fetch_failed",
      error instanceof Error
        ? error.message
        : "Could not load the owned Block Document descriptor",
      { cause: error },
    );
  }
  return validate(requested, descriptor);
};

export const fetchOwnedBlockDocumentDescriptor = async (
  request: OwnedBlockDocumentRequest,
  fetcher: OwnedDocumentDescriptorFetcher,
): Promise<ReadyCardBlockDocumentDescriptor> => {
  return fetchDescriptor(
    request,
    fetcher,
    validateOwnedBlockDocumentDescriptor,
  );
};

export const fetchRegisteredOwnedBlockDocumentDescriptor = (
  request: OwnedBlockDocumentRequest,
  fetcher: OwnedDocumentDescriptorFetcher,
): Promise<ReadyRegisteredOwnedBlockDocumentDescriptor> =>
  fetchDescriptor(
    request,
    fetcher,
    validateRegisteredOwnedBlockDocumentDescriptor,
  );

const toErrorModel = (error: unknown): OwnedBlockDocumentErrorModel => {
  if (error instanceof OwnedBlockDocumentBoundaryError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "fetch_failed",
    message:
      error instanceof Error
        ? error.message
        : "Could not load the owned Block Document descriptor",
  };
};

export const makeOwnedBlockDocumentModel = (
  request: OwnedBlockDocumentRequest,
  snapshot: OwnedBlockDocumentQuerySnapshot,
): OwnedBlockDocumentModel => {
  const identity = {
    projectId: request.projectId,
    ownerBlockId: request.ownerBlockId,
  };
  try {
    requireValidRequest(request);
  } catch (error) {
    return { ...identity, status: "error", error: toErrorModel(error) };
  }
  if (snapshot.status === "pending") {
    return { ...identity, status: "loading" };
  }
  if (snapshot.status === "error") {
    return {
      ...identity,
      status: "error",
      error: toErrorModel(snapshot.error),
    };
  }

  return {
    ...identity,
    status: "ready",
    descriptor: snapshot.data,
  };
};

export const makeRegisteredOwnedBlockDocumentModel = (
  request: OwnedBlockDocumentRequest,
  snapshot: RegisteredOwnedBlockDocumentQuerySnapshot,
): RegisteredOwnedBlockDocumentModel => {
  const identity = {
    projectId: request.projectId,
    ownerBlockId: request.ownerBlockId,
  };
  try {
    requireValidRequest(request);
  } catch (error) {
    return { ...identity, status: "error", error: toErrorModel(error) };
  }
  if (snapshot.status === "pending") {
    return { ...identity, status: "loading" };
  }
  if (snapshot.status === "error") {
    return {
      ...identity,
      status: "error",
      error: toErrorModel(snapshot.error),
    };
  }
  return {
    ...identity,
    status: "ready",
    descriptor: snapshot.data,
  };
};

export const ownedBlockDocumentIdentity = (
  descriptor: ReadyCardBlockDocumentDescriptor,
): {
  readonly documentId: DocumentId;
  readonly storeEpoch: string;
  readonly generation: number;
} => ({
  documentId: descriptor.documentId,
  storeEpoch: descriptor.storeEpoch,
  generation: descriptor.generation,
});
