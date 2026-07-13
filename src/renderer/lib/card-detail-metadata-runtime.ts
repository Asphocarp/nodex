import {
  compileCardMetadataPropertyMutationOrNull,
  type CardMetadataPropertySnapshot,
} from "../../shared/card-metadata-property-compiler";
import type {
  BlockPropertyMutationCommandResult,
  BlockPropertyMutationRequest,
} from "../../shared/block-property-mutations";
import {
  parseCardMetadataPropertySnapshotCommandResult,
  type CardMetadataPropertySnapshotCommandResult,
} from "../../shared/card-metadata-property-snapshot-transport";
import type { CardInput } from "../../shared/types";
import { invoke } from "./api";
import { fetchCardDetail } from "./card-detail-store";
import type { CardStageMetadataMutationResult } from "./card-stage-card";

export interface CardDetailMetadataRuntimeDependencies {
  readonly readSnapshot: (
    projectId: string,
    cardBlockId: string,
  ) => Promise<CardMetadataPropertySnapshotCommandResult>;
  readonly mutate: (
    projectId: string,
    request: BlockPropertyMutationRequest,
  ) => Promise<BlockPropertyMutationCommandResult>;
  readonly refreshDetail: (
    projectId: string,
    cardBlockId: string,
  ) => Promise<unknown>;
}

const DEFAULT_DEPENDENCIES: CardDetailMetadataRuntimeDependencies = {
  readSnapshot: async (projectId, cardBlockId) =>
    parseCardMetadataPropertySnapshotCommandResult(
      await invoke(
        "cards:metadata-properties:snapshot",
        projectId,
        cardBlockId,
      ),
    ),
  mutate: async (projectId, request) =>
    await invoke("block-properties:mutate", projectId, request),
  refreshDetail: fetchCardDetail,
};

const requireSnapshot = (
  result: CardMetadataPropertySnapshotCommandResult,
  projectId: string,
  cardBlockId: string,
): CardMetadataPropertySnapshot => {
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  if (
    result.value.projectId !== projectId ||
    result.value.cardBlockId !== cardBlockId
  ) {
    throw new Error(
      "Card metadata snapshot does not match the requested Project and Block",
    );
  }
  return result.value;
};

const applyExactMutation = async (
  projectId: string,
  request: BlockPropertyMutationRequest,
  dependencies: CardDetailMetadataRuntimeDependencies,
): Promise<BlockPropertyMutationCommandResult> => {
  try {
    const result = await dependencies.mutate(projectId, request);
    if (result.ok || !result.error.retryable) return result;
  } catch {
    // Retrying the same mutation ID and exact request is safe because the
    // Block property writer stores durable receipts.
  }
  return await dependencies.mutate(projectId, request);
};

/**
 * Card Stage writes field-level metadata without asking a Database-row
 * Adapter to reassemble the Card afterward. The canonical refresh is the
 * membership-independent Card Detail command.
 */
export const commitCardDetailMetadataPatch = async (input: {
  readonly projectId: string;
  readonly cardBlockId: string;
  readonly mutationId: string;
  readonly clientSessionId?: string;
  readonly patch: Partial<CardInput>;
  readonly dependencies?: CardDetailMetadataRuntimeDependencies;
}): Promise<CardStageMetadataMutationResult> => {
  const dependencies = input.dependencies ?? DEFAULT_DEPENDENCIES;
  const snapshot = requireSnapshot(
    await dependencies.readSnapshot(input.projectId, input.cardBlockId),
    input.projectId,
    input.cardBlockId,
  );
  const request = compileCardMetadataPropertyMutationOrNull({
    mutationId: input.mutationId,
    ...(input.clientSessionId
      ? { clientSessionId: input.clientSessionId }
      : {}),
    actor: { kind: "card_stage" },
    snapshot,
    patch: input.patch,
  });
  if (!request) {
    await dependencies.refreshDetail(input.projectId, input.cardBlockId);
    return { status: "updated", didMutate: false };
  }

  const result = await applyExactMutation(
    input.projectId,
    request,
    dependencies,
  );
  if (!result.ok) {
    if (result.error.code === "property_conflict") {
      await dependencies.refreshDetail(input.projectId, input.cardBlockId);
      return { status: "conflict" };
    }
    return { status: "error", error: result.error.message };
  }
  await dependencies.refreshDetail(input.projectId, input.cardBlockId);
  return { status: "updated", didMutate: true };
};
