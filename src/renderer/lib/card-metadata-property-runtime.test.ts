import { describe, expect, test } from "vitest";

import type { CardMetadataPropertySnapshot } from "../../shared/card-metadata-property-compiler";
import type {
  BlockPropertyMutationCommandResult,
  BlockPropertyMutationRequest,
} from "../../shared/block-property-mutations";
import type { Card } from "./types";
import {
  CardMetadataPropertyMutationError,
  CardMetadataPropertyReadError,
  commitCardMetadataPropertyPatch,
  isCardMetadataPropertyPatch,
  type CardMetadataPropertyRuntimeDependencies,
} from "./card-metadata-property-runtime";

const snapshot = (
  value: unknown = "p2-medium",
  revision = 4,
): CardMetadataPropertySnapshot => ({
  projectId: "project-1",
  storeEpoch: "epoch-1",
  changeLogSeq: 10,
  cardBlockId: "card-1",
  metadataRevision: 7,
  fields: [
    {
      scope: "database",
      field: "priority",
      databaseBlockId: "database-1",
      propertyId: "priority-property",
      revision,
      value: value as never,
    },
  ],
});

const card = (priority: Card["priority"] = "p0-critical"): Card => ({
  id: "card-1",
  status: "draft",
  archived: false,
  title: "Canonical title",
  description: "Canonical body",
  priority,
  tags: [],
  agentBlocked: false,
  revision: 8,
  created: new Date("2026-07-12T00:00:00.000Z"),
  order: 0,
});

const success = (
  request: BlockPropertyMutationRequest,
  duplicate = false,
): BlockPropertyMutationCommandResult => ({
  ok: true,
  value: {
    version: 1,
    mutationId: request.mutationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    duplicate,
    fields: [
      {
        path: "database:database-1:card-1:priority-property",
        scope: "database",
        blockId: "card-1",
        databaseBlockId: "database-1",
        propertyId: "priority-property",
        operation: "set",
        revision: 5,
        value: "p0-critical",
      },
    ],
    blockMetadataRevisions: { "card-1": 8 },
    changeLogSeq: 11,
    committedAt: "2026-07-12T00:00:01.000Z",
  },
});

const dependencies = (
  mutate: CardMetadataPropertyRuntimeDependencies["mutate"],
  options: {
    readonly snapshot?: CardMetadataPropertySnapshot;
    readonly card?: Card | null;
    readonly readCard?: () => Promise<Card | null>;
  } = {},
): CardMetadataPropertyRuntimeDependencies => ({
  readSnapshot: async () => ({
    ok: true,
    value: options.snapshot ?? snapshot(),
  }),
  mutate,
  readCard: async () => options.readCard
    ? await options.readCard()
    : options.card === undefined
      ? card()
      : options.card,
});

describe("Card metadata property runtime", () => {
  test("routes only non-empty metadata-only Card patches", () => {
    expect(isCardMetadataPropertyPatch({ priority: "p1-high" })).toBe(true);
    expect(
      isCardMetadataPropertyPatch({ priority: "p1-high", title: "Title" }),
    ).toBe(false);
    expect(isCardMetadataPropertyPatch({ description: "Body" })).toBe(false);
    expect(isCardMetadataPropertyPatch({})).toBe(false);
  });

  test("compiles one canonical property receipt then refreshes the Card read model", async () => {
    const requests: BlockPropertyMutationRequest[] = [];
    const result = await commitCardMetadataPropertyPatch({
      projectId: "project-1",
      cardBlockId: "card-1",
      mutationId: "metadata-1",
      clientSessionId: "window-1",
      patch: { priority: "p0-critical" },
      dependencies: dependencies(async (_projectId, request) => {
        requests.push(request);
        return success(request);
      }),
    });

    expect(result.status).toBe("updated");
    expect(requests.length).toBe(1);
    expect(requests[0]?.mutationId).toBe("metadata-1");
    expect(requests[0]?.clientSessionId).toBe("window-1");
    expect(requests[0]?.fields[0]?.operation).toBe("set");
    expect(
      requests[0]?.fields[0]?.operation === "set"
        ? requests[0].fields[0].expectedRevision
        : -1,
    ).toBe(4);
    expect(result.status === "updated" ? result.summary.priority : null).toBe(
      "p0-critical",
    );
    expect(result.status === "updated" ? result.revision : -1).toBe(8);
  });

  test("retries a lost response once with the exact same request object", async () => {
    const requests: BlockPropertyMutationRequest[] = [];
    const result = await commitCardMetadataPropertyPatch({
      projectId: "project-1",
      cardBlockId: "card-1",
      mutationId: "metadata-lost-response",
      patch: { priority: "p0-critical" },
      dependencies: dependencies(async (_projectId, request) => {
        requests.push(request);
        if (requests.length === 1) throw new Error("response lost after commit");
        return success(request, true);
      }),
    });

    expect(result.status).toBe("updated");
    expect(requests.length).toBe(2);
    expect(requests[0] === requests[1]).toBe(true);
  });

  test("retries one typed retryable result and never recompiles the intent", async () => {
    const requests: BlockPropertyMutationRequest[] = [];
    const result = await commitCardMetadataPropertyPatch({
      projectId: "project-1",
      cardBlockId: "card-1",
      mutationId: "metadata-retryable",
      patch: { priority: "p0-critical" },
      dependencies: dependencies(async (_projectId, request) => {
        requests.push(request);
        if (requests.length === 1) {
          return {
            ok: false,
            error: {
              code: "unknown",
              message: "writer restarted",
              retryable: true,
              mutationId: request.mutationId,
            },
          };
        }
        return success(request);
      }),
    });

    expect(result.status).toBe("updated");
    expect(requests.length).toBe(2);
    expect(requests[0] === requests[1]).toBe(true);
  });

  test("returns a fresh canonical Card for a stale scalar conflict", async () => {
    let cardReads = 0;
    const runtime = dependencies(
      async (_projectId, request) => ({
        ok: false,
        error: {
          code: "property_conflict",
          message: "priority changed",
          retryable: false,
          mutationId: request.mutationId,
          fieldPath: "database:database-1:card-1:priority-property",
          expectedRevision: 4,
          actualRevision: 5,
        },
      }),
      {
        readCard: async () => {
          cardReads += 1;
          return card("p1-high");
        },
      },
    );

    const result = await commitCardMetadataPropertyPatch({
      projectId: "project-1",
      cardBlockId: "card-1",
      mutationId: "metadata-conflict",
      patch: { priority: "p0-critical" },
      dependencies: runtime,
    });

    expect(result.status).toBe("conflict");
    expect(result.status === "conflict" ? result.card.priority : null).toBe(
      "p1-high",
    );
    expect(cardReads).toBe(1);
  });

  test("does not create a receipt for a semantic no-op", async () => {
    let mutationCalls = 0;
    const result = await commitCardMetadataPropertyPatch({
      projectId: "project-1",
      cardBlockId: "card-1",
      mutationId: "metadata-no-op",
      patch: { priority: "p2-medium" },
      dependencies: dependencies(async () => {
        mutationCalls += 1;
        throw new Error("must not mutate");
      }, { card: card("p2-medium") }),
    });

    expect(result.status).toBe("updated");
    expect(result.status === "updated" ? result.didMutate : true).toBe(false);
    expect(mutationCalls).toBe(0);
  });

  test("rejects snapshot scope mismatch and terminal mutation failures", async () => {
    let readCode = "";
    try {
      await commitCardMetadataPropertyPatch({
        projectId: "project-1",
        cardBlockId: "card-1",
        mutationId: "metadata-scope",
        patch: { priority: "p0-critical" },
        dependencies: dependencies(async () => {
          throw new Error("must not mutate");
        }, { snapshot: { ...snapshot(), projectId: "project-2" } }),
      });
    } catch (error) {
      readCode = error instanceof CardMetadataPropertyReadError
        ? error.code
        : "unexpected";
    }
    expect(readCode).toBe("scope_mismatch");

    let mutationCode = "";
    try {
      await commitCardMetadataPropertyPatch({
        projectId: "project-1",
        cardBlockId: "card-1",
        mutationId: "metadata-terminal",
        patch: { priority: "p0-critical" },
        dependencies: dependencies(async (_projectId, request) => ({
          ok: false,
          error: {
            code: "property_not_found",
            message: "property removed",
            retryable: false,
            mutationId: request.mutationId,
          },
        })),
      });
    } catch (error) {
      mutationCode = error instanceof CardMetadataPropertyMutationError
        ? error.commandError.code
        : "unexpected";
    }
    expect(mutationCode).toBe("property_not_found");
  });
});
