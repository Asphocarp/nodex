import { describe, expect, test } from "vitest";
import { plainTextToPortableRichText } from "../../shared/block-documents";
import type { DatabaseMutationCommandResult } from "../../shared/database-kernel";
import type {
  GeneralDatabasePropertyDefinition,
  GeneralDatabaseRow,
} from "../../shared/database-query";
import type { DatabaseViewRenderModel } from "./database-view-render-model";
import {
  buildDatabaseViewMoveOperations,
  buildDatabaseViewPropertyValueOperations,
  commitDatabaseViewOperations,
} from "./database-view-row-mutations";

const timestamp = "2026-07-12T00:00:00.000Z";

const model = (): DatabaseViewRenderModel => {
  const properties: readonly GeneralDatabasePropertyDefinition[] = [
    {
      id: "property-score",
      databaseBlockId: "database-1",
      key: "score",
      name: "Score",
      valueType: "number" as const,
      config: {},
      rankKey: "a",
      lifecycle: "active" as const,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "property-tags",
      databaseBlockId: "database-1",
      key: "tags",
      name: "Tags",
      valueType: "multi_select" as const,
      config: { options: [{ id: "one", name: "One" }, { id: "two", name: "Two" }] },
      rankKey: "b",
      lifecycle: "active" as const,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
  const view = {
    id: "view-1",
    databaseBlockId: "database-1",
    projectId: "project-1",
    name: "All",
    kind: "list" as const,
    config: {
      schemaKey: "nodex.database-view" as const,
      schemaVersion: 1 as const,
      filter: { kind: "group" as const, operator: "and" as const, children: [] },
      sort: [{ field: { kind: "manual" as const }, direction: "asc" as const, nulls: "last" as const }],
      group: null,
      display: { propertyIds: ["property-score", "property-tags"], showTitle: true },
    },
    isPrimary: false,
    revision: 1,
    rankKey: "a",
    lifecycle: "active" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const database = {
    blockId: "database-1",
    projectId: "project-1",
    name: "Tasks",
    isPrimary: false,
    schemaKey: "nodex.database",
    schemaRevision: 1,
    metadataRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const rows: readonly GeneralDatabaseRow[] = ["card-a", "card-b", "card-c"].map((blockId, index): GeneralDatabaseRow => ({
    membership: {
      id: `membership-${blockId}`,
      databaseBlockId: "database-1",
      cardBlockId: blockId,
      revision: 1,
      createdAt: timestamp,
    },
    card: {
      blockId,
      projectId: "project-1",
      lifecycle: "active" as const,
      location: { kind: "space" as const, rankKey: String(index) },
      locationRevision: 1,
      metadataRevision: 1,
      documentId: `document-${blockId}`,
      documentGeneration: 1,
      documentHeadSeq: 1,
      documentAuthority: "ydoc_primary" as const,
      content: {
        projectedSeq: 1,
        title: blockId,
        richTitle: plainTextToPortableRichText(blockId),
        preview: "",
        plainText: "",
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    values: index === 0
      ? {
          "property-score": { propertyId: "property-score", valueType: "number" as const, value: 1, revision: 3 },
          "property-tags": { propertyId: "property-tags", valueType: "multi_select" as const, value: ["one"], revision: 2 },
        }
      : {},
    position: index === 2 ? null : { groupKey: null, rankKey: String(index), revision: index + 1 },
    effectiveGroupKey: null,
  }));
  return {
    projectId: "project-1",
    databaseViewId: "view-1",
    databaseBlockId: "database-1",
    databaseName: "Tasks",
    viewName: "All",
    storeEpoch: "epoch-1",
    changeLogSeq: 4,
    query: { database, view, properties, rows },
    columns: [{
      id: "all",
      name: "All",
      rows: rows.map((row) => ({
        blockId: row.card.blockId,
        title: row.card.content?.title ?? "Untitled",
        preview: "",
        plainText: "",
        tags: [],
        metadataRevision: 1,
        createdAt: new Date(timestamp),
      })),
    }],
    primaryWriteCompatible: false,
    readOnlyReason: null,
  };
};

describe("selected Database View row mutations", () => {
  test("uses scalar CAS and set-like multi-select intent from one query snapshot", () => {
    const authority = model();
    const scalar = buildDatabaseViewPropertyValueOperations({
      model: authority,
      cardBlockId: "card-a",
      propertyId: "property-score",
      value: 2,
    });
    const setLike = buildDatabaseViewPropertyValueOperations({
      model: authority,
      cardBlockId: "card-a",
      propertyId: "property-tags",
      value: ["two"],
    });
    expect(scalar[0]?.kind).toBe("set_value");
    expect(scalar[0]?.kind === "set_value" ? scalar[0].expectedValueRevision : -1).toBe(3);
    expect(JSON.stringify(setLike[0])).toBe(JSON.stringify({
      kind: "add_remove_value",
      cardBlockId: "card-a",
      databaseBlockId: "database-1",
      propertyId: "property-tags",
      add: ["two"],
      remove: ["one"],
    }));
  });

  test("initializes an unfiltered group's complete manual order atomically", () => {
    const operations = buildDatabaseViewMoveOperations({
      model: model(),
      cardBlockId: "card-a",
      direction: "down",
    });
    const operation = operations[0];
    expect(operation?.kind).toBe("position_cards");
    expect(operation?.kind === "position_cards"
      ? operation.cards.map((card) => card.cardBlockId).join(",")
      : "").toBe("card-b,card-a,card-c");
    expect(operation?.kind === "position_cards"
      ? operation.cards[2]?.expectedPositionRevision
      : -1).toBe(0);
  });

  test("retains the exact request identity across one transport retry", async () => {
    const requests: string[] = [];
    let calls = 0;
    const operations = buildDatabaseViewPropertyValueOperations({
      model: model(),
      cardBlockId: "card-a",
      propertyId: "property-score",
      value: 2,
    });
    const result: DatabaseMutationCommandResult = {
      ok: true,
      value: {
        version: 1,
        operationId: "operation-1",
        projectId: "project-1",
        storeEpoch: "epoch-1",
        operationKinds: ["set_value"],
        affectedDatabaseBlockIds: ["database-1"],
        duplicate: false,
        payload: {},
        changeLogSeq: 5,
        committedAt: timestamp,
      },
    };
    const receipt = await commitDatabaseViewOperations({
      model: model(),
      operations,
      dependencies: {
        mutate: async (_projectId, request) => {
          requests.push(JSON.stringify(request));
          calls += 1;
          if (calls === 1) throw new Error("transport lost ACK");
          return {
            ...result,
            value: { ...result.value, operationId: request.operationId },
          };
        },
      },
    });
    expect(requests.length).toBe(2);
    expect(requests[0]).toBe(requests[1]);
    expect(receipt?.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
