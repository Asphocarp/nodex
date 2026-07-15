import { describe, expect, test } from "vitest";

import type { CardMetadataPropertySnapshot } from "../../shared/card-metadata-property-compiler";
import type {
  BlockPropertyMutationCommandResult,
  BlockPropertyMutationRequest,
} from "../../shared/block-property-mutations";
import {
  commitCardDetailMetadataPatch,
  type CardDetailMetadataRuntimeDependencies,
} from "./card-detail-metadata-runtime";

const standaloneSnapshot = (): CardMetadataPropertySnapshot => ({
  projectId: "project-1",
  storeEpoch: "epoch-1",
  changeLogSeq: 4,
  cardBlockId: "card-1",
  metadataRevision: 2,
  fields: [
    {
      scope: "intrinsic",
      field: "runInBaseBranch",
      revision: 3,
      value: null,
    },
  ],
});

const success = (
  request: BlockPropertyMutationRequest,
): BlockPropertyMutationCommandResult => ({
  ok: true,
  value: {
    version: 1,
    mutationId: request.mutationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    duplicate: false,
    fields: [],
    blockMetadataRevisions: { "card-1": 3 },
    changeLogSeq: 5,
    committedAt: "2026-07-14T00:00:00.000Z",
  },
});

const dependencies = (input: {
  readonly requests: BlockPropertyMutationRequest[];
  readonly refreshes: string[];
}): CardDetailMetadataRuntimeDependencies => ({
  readSnapshot: async () => ({ ok: true, value: standaloneSnapshot() }),
  mutate: async (_projectId, request) => {
    input.requests.push(request);
    return success(request);
  },
  refreshDetail: async (_projectId, cardBlockId) => {
    input.refreshes.push(cardBlockId);
  },
});

describe("Card Detail metadata runtime", () => {
  test("mutates an intrinsic field for a standalone Card and refreshes Card Detail", async () => {
    const requests: BlockPropertyMutationRequest[] = [];
    const refreshes: string[] = [];

    const result = await commitCardDetailMetadataPatch({
      projectId: "project-1",
      cardBlockId: "card-1",
      mutationId: "standalone-base-branch",
      patch: { runInBaseBranch: "main" },
      dependencies: dependencies({ requests, refreshes }),
    });

    expect(result).toEqual({ status: "updated", didMutate: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.fields).toEqual([
      {
        scope: "intrinsic",
        blockId: "card-1",
        propertyKey: "run.baseBranch",
        operation: "set",
        expectedRevision: 3,
        value: "main",
      },
    ]);
    expect(refreshes).toEqual(["card-1"]);
  });

  test("does not invent Database coordinates for a standalone Card", async () => {
    const requests: BlockPropertyMutationRequest[] = [];
    const refreshes: string[] = [];

    await expect(
      commitCardDetailMetadataPatch({
        projectId: "project-1",
        cardBlockId: "card-1",
        mutationId: "standalone-priority",
        patch: { priority: "p1-high" },
        dependencies: dependencies({ requests, refreshes }),
      }),
    ).rejects.toThrow("Card metadata snapshot is missing priority");
    expect(requests).toHaveLength(0);
    expect(refreshes).toHaveLength(0);
  });
});
