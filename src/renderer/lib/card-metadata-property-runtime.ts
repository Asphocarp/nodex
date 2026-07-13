import {
  compileCardMetadataPropertyMutationOrNull,
  type CardMetadataPropertySnapshot,
} from "../../shared/card-metadata-property-compiler";
import type {
  BlockPropertyMutationCommandError,
  BlockPropertyMutationCommandResult,
  BlockPropertyMutationRequest,
} from "../../shared/block-property-mutations";
import type { CardMetadataPropertySnapshotCommandResult } from "../../shared/card-metadata-property-snapshot-transport";
import { toCardSummary } from "../../shared/card-summary";
import type { Card, CardInput, CardUpdateField, CardUpdateResult } from "./types";
import {
  invoke,
  mutateBlockProperties,
  readCardMetadataPropertySnapshot,
} from "./api";

export interface CardMetadataPropertyRuntimeDependencies {
  readonly readSnapshot: (
    projectId: string,
    cardBlockId: string,
  ) => Promise<CardMetadataPropertySnapshotCommandResult>;
  readonly mutate: (
    projectId: string,
    request: BlockPropertyMutationRequest,
  ) => Promise<BlockPropertyMutationCommandResult>;
  readonly readCard: (
    projectId: string,
    cardBlockId: string,
  ) => Promise<Card | null>;
}

export class CardMetadataPropertyReadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "CardMetadataPropertyReadError";
  }
}

export class CardMetadataPropertyMutationError extends Error {
  constructor(readonly commandError: BlockPropertyMutationCommandError) {
    super(commandError.message);
    this.name = "CardMetadataPropertyMutationError";
  }
}

const defaultDependencies: CardMetadataPropertyRuntimeDependencies = {
  readSnapshot: readCardMetadataPropertySnapshot,
  mutate: mutateBlockProperties,
  readCard: async (projectId, cardBlockId) =>
    (await invoke("database-row:get", projectId, cardBlockId)) as Card | null,
};

const readCanonicalCard = async (
  projectId: string,
  cardBlockId: string,
  dependencies: CardMetadataPropertyRuntimeDependencies,
): Promise<Card | null> => {
  const card = await dependencies.readCard(projectId, cardBlockId);
  if (!card) return null;
  if (card.id === cardBlockId) return card;
  throw new Error(
    `Canonical Card read returned ${card.id} for requested Block ${cardBlockId}`,
  );
};

const requireScopedSnapshot = (
  result: CardMetadataPropertySnapshotCommandResult,
  projectId: string,
  cardBlockId: string,
): CardMetadataPropertySnapshot => {
  if (!result.ok) {
    throw new CardMetadataPropertyReadError(
      result.error.code,
      result.error.message,
      result.error.retryable,
    );
  }
  if (
    result.value.projectId !== projectId ||
    result.value.cardBlockId !== cardBlockId
  ) {
    throw new CardMetadataPropertyReadError(
      "scope_mismatch",
      "Card metadata snapshot does not match the requested Project and Block",
      false,
    );
  }
  return result.value;
};

const applyExactMutation = async (
  projectId: string,
  request: BlockPropertyMutationRequest,
  dependencies: CardMetadataPropertyRuntimeDependencies,
): Promise<BlockPropertyMutationCommandResult> => {
  let first: BlockPropertyMutationCommandResult;
  try {
    first = await dependencies.mutate(projectId, request);
  } catch {
    return await dependencies.mutate(projectId, request);
  }
  if (first.ok || !first.error.retryable) return first;
  return await dependencies.mutate(projectId, request);
};

const changedFields = (patch: Partial<CardInput>): CardUpdateField[] =>
  Object.keys(patch) as CardUpdateField[];

export const isCardMetadataPropertyPatch = (
  patch: Partial<CardInput>,
): boolean => {
  const fields = Object.keys(patch);
  return (
    fields.length > 0 &&
    fields.every((field) => field !== "title" && field !== "description")
  );
};

const updatedResult = (
  projectId: string,
  cardBlockId: string,
  card: Card,
  fields: CardUpdateField[],
  didMutate: boolean,
  fallbackRevision: number,
): Extract<CardUpdateResult, { readonly status: "updated" }> => ({
  status: "updated",
  projectId,
  cardId: cardBlockId,
  revision: card.revision ?? fallbackRevision,
  summary: toCardSummary(card),
  changedFields: fields,
  didMutate,
});

/**
 * Commit one compatibility Card metadata patch through the canonical Block
 * property kernel. A transport ambiguity is retried once with the exact same
 * object and mutation ID; a stale scalar CAS is surfaced with a fresh Card.
 */
export const commitCardMetadataPropertyPatch = async (input: {
  readonly projectId: string;
  readonly cardBlockId: string;
  readonly mutationId: string;
  readonly clientSessionId?: string;
  readonly patch: Partial<CardInput>;
  readonly dependencies?: CardMetadataPropertyRuntimeDependencies;
}): Promise<CardUpdateResult> => {
  const dependencies = input.dependencies ?? defaultDependencies;
  const snapshot = requireScopedSnapshot(
    await dependencies.readSnapshot(input.projectId, input.cardBlockId),
    input.projectId,
    input.cardBlockId,
  );
  const request = compileCardMetadataPropertyMutationOrNull({
    mutationId: input.mutationId,
    ...(input.clientSessionId
      ? { clientSessionId: input.clientSessionId }
      : {}),
    actor: { kind: "renderer_card_metadata" },
    snapshot,
    patch: input.patch,
  });
  if (!request) {
    const card = await readCanonicalCard(
      input.projectId,
      input.cardBlockId,
      dependencies,
    );
    if (!card) return { status: "not_found" };
    return updatedResult(
      input.projectId,
      input.cardBlockId,
      card,
      [],
      false,
      snapshot.metadataRevision,
    );
  }

  const result = await applyExactMutation(
    input.projectId,
    request,
    dependencies,
  );
  if (!result.ok) {
    if (result.error.code !== "property_conflict") {
      throw new CardMetadataPropertyMutationError(result.error);
    }
    const card = await readCanonicalCard(
      input.projectId,
      input.cardBlockId,
      dependencies,
    );
    if (!card) return { status: "not_found" };
    return { status: "conflict", card };
  }

  const card = await readCanonicalCard(
    input.projectId,
    input.cardBlockId,
    dependencies,
  );
  if (!card) return { status: "not_found" };
  return updatedResult(
    input.projectId,
    input.cardBlockId,
    card,
    changedFields(input.patch),
    true,
    result.value.blockMetadataRevisions[input.cardBlockId] ??
      snapshot.metadataRevision,
  );
};
