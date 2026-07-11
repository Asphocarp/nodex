import { describe, expect, test } from "vitest";
import type {
  CardLifecycleMutationCommandResult,
  CardLifecycleMutationReceipt,
  CardLifecycleMutationRequest,
} from "./card-lifecycle";
import {
  CardLifecycleRuntimeError,
  compileCardLifecycleRequest,
  executeCardLifecycleIntent,
  type CardLifecycleOwnedBlockAuthority,
  type CardLifecyclePreflightSnapshot,
} from "./card-lifecycle-runtime";
import type { Card } from "./types";

const authority = (
  lifecycle: "active" | "archived" | "deleted" = "active",
): CardLifecycleOwnedBlockAuthority => ({
  cardId: "card-1",
  lifecycle,
  location: { kind: "space", rankKey: lifecycle === "deleted" ? null : "m" },
  metadataRevision: 7,
  locationRevision: 9,
  document: {
    documentId: "document-1",
    generation: 1,
    headSeq: 3,
    readiness: "ready",
    authority: "ydoc_primary",
    schemaKey: "card",
    schemaVersion: 1,
  },
  membership: lifecycle === "deleted"
    ? null
    : {
        membershipId: "membership-1",
        databaseBlockId: "database-1",
        membershipRevision: 2,
        viewId: "view-1",
        viewRevision: 4,
        statusPropertyId: "property-status",
        statusValueRevision: 5,
        status: "draft",
        position: { groupKey: "draft", rankKey: "m", revision: 6 },
      },
  restoreEvidence: lifecycle === "deleted"
    ? {
        deleteOperationId: "delete-1",
        previousLifecycle: "active",
        membership: {
          membershipId: "membership-1",
          databaseBlockId: "database-1",
          viewId: "view-1",
          status: "draft",
        },
      }
    : null,
});

const preflight = (
  card: CardLifecycleOwnedBlockAuthority | null,
): CardLifecyclePreflightSnapshot => ({
  version: 1,
  projectId: "project-1",
  storeEpoch: "epoch-1",
  changeLogSeq: 21,
  value: {
    version: 1,
    reservedBlockType: null,
    card,
    primaryDatabase: {
      descriptor: {
        database: {
          blockId: "database-1",
          projectId: "project-1",
          name: "Cards",
          isPrimary: true,
          schemaKey: "nodex.cards",
          schemaRevision: 1,
          metadataRevision: 1,
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
        properties: [],
        views: [
          {
            id: "view-1",
            databaseBlockId: "database-1",
            projectId: "project-1",
            name: "Board",
            kind: "kanban",
            config: {
              schemaKey: "nodex.database-view",
              schemaVersion: 1,
              filter: { kind: "group", operator: "and", children: [] },
              sort: [
                {
                  field: { kind: "manual" },
                  direction: "asc",
                  nulls: "last",
                },
              ],
              group: null,
              display: { propertyIds: [], showTitle: true },
            },
            isPrimary: true,
            revision: 4,
            rankKey: "m",
            lifecycle: "active",
            createdAt: "2026-07-11T00:00:00.000Z",
            updatedAt: "2026-07-11T00:00:00.000Z",
          },
        ],
      },
      query: {
        database: {
          blockId: "database-1",
          projectId: "project-1",
          name: "Cards",
          isPrimary: true,
          schemaKey: "nodex.cards",
          schemaRevision: 1,
          metadataRevision: 1,
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
        view: {
          id: "view-1",
          databaseBlockId: "database-1",
          projectId: "project-1",
          name: "Board",
          kind: "kanban",
          config: {
            schemaKey: "nodex.database-view",
            schemaVersion: 1,
            filter: { kind: "group", operator: "and", children: [] },
            sort: [
              {
                field: { kind: "manual" },
                direction: "asc",
                nulls: "last",
              },
            ],
            group: null,
            display: { propertyIds: [], showTitle: true },
          },
          isPrimary: true,
          revision: 4,
          rankKey: "m",
          lifecycle: "active",
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
        properties: [],
        rows: [
          {
            effectiveGroupKey: "draft",
            card: { blockId: "draft-first" },
          },
        ],
      } as unknown as NonNullable<
        CardLifecyclePreflightSnapshot["value"]
      >["primaryDatabase"]["query"],
    },
  },
});

const receipt = (
  lifecycle: "active" | "archived" | "deleted" = "active",
): CardLifecycleMutationReceipt => ({
  version: 1,
  operationId: "operation-1",
  projectId: "project-1",
  storeEpoch: "epoch-1",
  operationKind: lifecycle === "deleted" ? "delete_card" : "create_card",
  cardId: "card-1",
  duplicate: false,
  metadataRevision: 1,
  locationRevision: 1,
  lifecycle,
  documentId: "document-1",
  documentGeneration: 1,
  documentHeadSeq: 1,
  databaseBlockId: "database-1",
  membershipId: "membership-1",
  viewId: "view-1",
  topLevelRankKey: "m",
  viewRankKey: "m",
  createdBlockIds: ["body-1"],
  changeLogSeq: 22,
  committedAt: "2026-07-11T00:00:00.000Z",
});

const canonicalCard = (archived = false): Card => ({
  id: "card-1",
  status: "draft",
  archived,
  title: "Card",
  description: "",
  tags: [],
  agentBlocked: false,
  created: new Date("2026-07-11T00:00:00.000Z"),
  order: 0,
});

describe("Card lifecycle runtime", () => {
  test("maps top creation only to the primary View anchor", () => {
    const request = compileCardLifecycleRequest({
      intent: {
        kind: "create",
        projectId: "project-1",
        operationId: "operation-1",
        cardId: "card-1",
        status: "draft",
        input: { title: "Card" },
        placement: "top",
      },
      preflight: preflight(null),
    });
    if (request.operation.kind !== "create_card") {
      throw new Error("Expected create_card");
    }
    expect(request.operation.beforeViewCardId).toBe("draft-first");
    expect("beforeBlockId" in request.operation).toBe(false);
  });

  test("compiles exact revision/evidence fences for existing Cards", () => {
    const deleted = preflight(authority("deleted"));
    const restored = compileCardLifecycleRequest({
      intent: {
        kind: "restore",
        projectId: "project-1",
        operationId: "restore-1",
        cardId: "card-1",
        beforeBlockId: "space-anchor",
        beforeViewCardId: "view-anchor",
      },
      preflight: deleted,
    });
    if (restored.operation.kind !== "restore_card") {
      throw new Error("Expected restore_card");
    }
    expect(restored.operation.deleteOperationId).toBe("delete-1");
    expect(restored.operation.expectedMetadataRevision).toBe(7);
    expect(restored.operation.expectedLocationRevision).toBe(9);
    expect(restored.operation.beforeBlockId).toBe("space-anchor");
    expect(restored.operation.membership?.beforeViewCardId).toBe("view-anchor");

    const moved = compileCardLifecycleRequest({
      intent: {
        kind: "move_in_space",
        projectId: "project-1",
        operationId: "move-1",
        cardId: "card-1",
        beforeBlockId: "space-anchor",
      },
      preflight: preflight(authority()),
    });
    if (moved.operation.kind !== "move_card_in_space") {
      throw new Error("Expected move_card_in_space");
    }
    expect(moved.operation.expectedLocationRevision).toBe(9);
  });

  test("retries a lost response with the exact same request object", async () => {
    const requests: CardLifecycleMutationRequest[] = [];
    const committed = receipt();
    const result = await executeCardLifecycleIntent(
      {
        kind: "create",
        projectId: "project-1",
        operationId: "operation-1",
        cardId: "card-1",
        status: "draft",
        input: { title: "Card" },
      },
      {
        readPreflight: async () => ({ ok: true, value: preflight(null) }),
        mutate: async (_projectId, request) => {
          requests.push(request);
          if (requests.length === 1) throw new Error("response lost");
          return { ok: true, value: committed };
        },
        readCard: async () => canonicalCard(),
      },
    );
    expect(requests.length).toBe(2);
    expect(requests[0] === requests[1]).toBe(true);
    expect(result.card?.id).toBe("card-1");
  });

  test("retries one typed retryable response without recompiling intent", async () => {
    const requests: CardLifecycleMutationRequest[] = [];
    const retryable: CardLifecycleMutationCommandResult = {
      ok: false,
      error: {
        code: "unknown",
        message: "writer restarting",
        retryable: true,
        operationId: "operation-1",
        cardId: "card-1",
      },
    };
    await executeCardLifecycleIntent(
      {
        kind: "delete",
        projectId: "project-1",
        operationId: "operation-1",
        cardId: "card-1",
      },
      {
        readPreflight: async () => ({
          ok: true,
          value: preflight(authority()),
        }),
        mutate: async (_projectId, request) => {
          requests.push(request);
          return requests.length === 1
            ? retryable
            : { ok: true, value: receipt("deleted") };
        },
        readCard: async () => null,
      },
    );
    expect(requests.length).toBe(2);
    expect(requests[0] === requests[1]).toBe(true);
  });

  test("fails typed when canonical authority remains stale", async () => {
    let reads = 0;
    let code = "";
    try {
      await executeCardLifecycleIntent(
        {
          kind: "create",
          projectId: "project-1",
          operationId: "operation-1",
          cardId: "card-1",
          status: "draft",
          input: { title: "Card" },
        },
        {
          readPreflight: async () => ({ ok: true, value: preflight(null) }),
          mutate: async () => ({ ok: true, value: receipt() }),
          readCard: async () => {
            reads += 1;
            return null;
          },
        },
      );
    } catch (error) {
      if (error instanceof CardLifecycleRuntimeError) code = error.code;
    }
    expect(reads).toBe(3);
    expect(code).toBe("canonical_read_stale");
  });
});
