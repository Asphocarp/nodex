import { describe, expect, test } from "vitest";
import {
  canonicalizeCardLifecycleMutationRequest,
  CardLifecycleContractError,
  parseCardLifecycleMutationCommandResult,
  parseCardLifecycleMutationRequest,
} from "./card-lifecycle";

const failsWithContractError = (run: () => unknown): boolean => {
  try {
    run();
    return false;
  } catch (error) {
    return error instanceof CardLifecycleContractError;
  }
};

const createRequest = () => ({
  version: 1,
  operationId: "card-create:one",
  projectId: "project-one",
  storeEpoch: "epoch-one",
  actor: { kind: "test", nested: { z: 1, a: true } },
  operation: {
    kind: "create_card",
    cardId: "card-one",
    title: "First Card",
    nfm: "Body",
    status: "draft",
    tags: ["z", "a", "z"],
    scheduledStart: "2026-07-11T10:00:00.000Z",
    scheduledEnd: "2026-07-11T11:00:00.000Z",
    reminders: [{ offsetMinutes: 30 }, { offsetMinutes: 5 }],
  },
});

describe("Card lifecycle contract", () => {
  test("normalizes omitted Card defaults and set-like create metadata", () => {
    const parsed = parseCardLifecycleMutationRequest(createRequest());
    if (parsed.operation.kind !== "create_card") {
      throw new Error("Expected create_card operation");
    }

    expect(parsed.operation.priority).toBe(null);
    expect(parsed.operation.estimate).toBe(null);
    expect(parsed.operation.tags.join(",")).toBe("a,z");
    expect(
      parsed.operation.reminders.map((item) => item.offsetMinutes).join(","),
    ).toBe("5,30");
    expect(parsed.operation.isAllDay).toBe(false);
    expect(parsed.operation.runInTarget).toBe("localProject");
    expect(parsed.operation.recurrence).toBe(null);
  });

  test("canonical intent discards retired Agent fields and treats explicit defaults like omitted defaults", () => {
    const implicit = createRequest();
    const explicit = {
      ...implicit,
      operation: {
        ...implicit.operation,
        priority: null,
        estimate: null,
        isAllDay: false,
        recurrence: null,
        scheduleTimezone: null,
        assignee: null,
        agentBlocked: false,
        agentStatus: null,
        runInTarget: "localProject",
        runInLocalPath: null,
        runInBaseBranch: null,
        runInWorktreePath: null,
        runInEnvironmentPath: null,
      },
    };

    const retriedFromAnotherSurface = {
      ...explicit,
      clientSessionId: "second-window",
      actor: { kind: "http-retry", transport: "browser" },
    };
    expect(canonicalizeCardLifecycleMutationRequest(implicit)).toBe(
      canonicalizeCardLifecycleMutationRequest(retriedFromAnotherSurface),
    );
  });

  test("rejects non-canonical timestamps and partial schedule ranges", () => {
    const invalidTimestamp = createRequest();
    invalidTimestamp.operation.scheduledStart = "2026-07-11T10:00:00Z";
    expect(
      failsWithContractError(() =>
        parseCardLifecycleMutationRequest(invalidTimestamp),
      ),
    ).toBe(true);

    const partialRange = createRequest();
    delete (partialRange.operation as { scheduledEnd?: string }).scheduledEnd;
    expect(
      failsWithContractError(() =>
        parseCardLifecycleMutationRequest(partialRange),
      ),
    ).toBe(true);
  });

  test("requires revision fences and rejects unknown operation fields", () => {
    expect(
      failsWithContractError(() =>
        parseCardLifecycleMutationRequest({
          version: 1,
          operationId: "delete-one",
          projectId: "project-one",
          storeEpoch: "epoch-one",
          actor: {},
          operation: {
            kind: "delete_card",
            cardId: "card-one",
            expectedMetadataRevision: 2,
            expectedLocationRevision: 3,
            rawRankKey: "client-owned-rank",
          },
        }),
      ),
    ).toBe(true);

    const parsed = parseCardLifecycleMutationRequest({
      version: 1,
      operationId: "move-one",
      projectId: "project-one",
      storeEpoch: "epoch-one",
      actor: {},
      operation: {
        kind: "move_card_in_space",
        cardId: "card-one",
        expectedLocationRevision: 3,
        beforeBlockId: "anchor-one",
      },
    });
    expect(parsed.operation.kind).toBe("move_card_in_space");

    const restore = parseCardLifecycleMutationRequest({
      version: 1,
      operationId: "restore-one",
      projectId: "project-one",
      storeEpoch: "epoch-one",
      actor: {},
      operation: {
        kind: "restore_card",
        cardId: "card-one",
        deleteOperationId: "delete-one",
        expectedMetadataRevision: 3,
        expectedLocationRevision: 4,
        membership: null,
      },
    });
    expect(restore.operation.kind).toBe("restore_card");
  });

  test("parses a complete durable receipt and rejects zero heads", () => {
    const receipt = {
      ok: true,
      value: {
        version: 1,
        operationId: "create-one",
        projectId: "project-one",
        storeEpoch: "epoch-one",
        operationKind: "create_card",
        cardId: "card-one",
        duplicate: false,
        metadataRevision: 1,
        locationRevision: 1,
        lifecycle: "active",
        documentId: "document:card-one",
        documentGeneration: 1,
        documentHeadSeq: 1,
        databaseBlockId: "database-one",
        membershipId: "membership-one",
        viewId: "view-one",
        topLevelRankKey: "7fffffffffffffffffffffffffffffff",
        viewRankKey: "7fffffffffffffffffffffffffffffff",
        createdBlockIds: ["body-one"],
        changeLogSeq: 1,
        committedAt: "2026-07-11T10:00:00.000Z",
      },
    };
    expect(parseCardLifecycleMutationCommandResult(receipt).ok).toBe(true);
    receipt.value.documentHeadSeq = 0;
    expect(
      failsWithContractError(() =>
        parseCardLifecycleMutationCommandResult(receipt),
      ),
    ).toBe(true);
  });
});
