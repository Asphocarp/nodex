import { describe, expect, test } from "vitest";
import { NODEX_AGENT_V3_CATALOG_BUDGETS } from "./budgets";
import { GetBlockOutputSchema } from "./read-schemas";
import {
  FetchV3OutputSchema,
  QueryDatabaseV3OutputSchema,
} from "./v3-read-schemas";
import {
  CreateOutputSchema,
  EditDatabaseOutputSchema,
  EditDocumentOutputSchema,
  TransferBlocksOutputSchema,
} from "./write-schemas";
import {
  AdvancedUpdateCardV3OutputSchema,
  CreateCardsV3OutputSchema,
  DuplicateCardV3OutputSchema,
  MoveCardsV3OutputSchema,
  UpdateCardV3OutputSchema,
} from "./v3-write-schemas";

const ETAG = `nxe1.${"a".repeat(43)}`;

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function etagCount(value: unknown): number {
  return JSON.stringify(value).match(/nxe1\.[A-Za-z0-9_-]{43}/gu)?.length ?? 0;
}

describe("Nodex Agent result budgets", () => {
  test("keeps default mutation results sparse", () => {
    const outputs = [
      CreateOutputSchema.parse({
        data: {
          resource: {
            kind: "card",
            blockId: "card-1",
            documentId: "document-1",
            location: { kind: "space" },
            bodyBlockCount: 12,
          },
        },
      }),
      EditDocumentOutputSchema.parse({
        data: {
          documentId: "document-1",
          effects: { created: 2, updated: 1, moved: 0, deleted: 0 },
        },
      }),
      TransferBlocksOutputSchema.parse({
        data: {
          mode: "move",
          results: [{
            sourceBlockId: "card-1",
            resultBlockId: "card-1",
            location: { kind: "space" },
            transformation: "preserved",
          }],
        },
      }),
      EditDatabaseOutputSchema.parse({
        data: {
          databaseBlockId: "database-1",
          effects: { valuesSet: 1, setsChanged: 0, placementsChanged: 0 },
        },
      }),
    ];

    for (const output of outputs) {
      expect(etagCount(output)).toBe(0);
      expect(serializedBytes(output)).toBeLessThan(
        NODEX_AGENT_V3_CATALOG_BUDGETS.defaultMutationResultBytes,
      );
    }
  });

  test("adds exactly one adjacent ETag for each prepared title, body, or Block", () => {
    const prepared = [
      GetBlockOutputSchema.parse({
        data: {
          block: {
            blockId: "card-1",
            type: "card",
            title: { value: { kind: "plain", text: "Card" }, etag: ETAG },
            lifecycle: "active",
            location: { kind: "space" },
          },
        },
      }),
      GetBlockOutputSchema.parse({
        data: {
          block: {
            blockId: "card-1",
            type: "card",
            lifecycle: "active",
            location: { kind: "space" },
          },
          document: {
            documentId: "document-1",
            ownerBlockId: "card-1",
            body: { format: "nfm", content: "Body", contentHash: "hash", etag: ETAG },
          },
        },
      }),
      GetBlockOutputSchema.parse({
        data: {
          block: {
            blockId: "card-1",
            type: "card",
            lifecycle: "active",
            location: { kind: "space" },
          },
          document: {
            documentId: "document-1",
            ownerBlockId: "card-1",
            body: {
              format: "blocks",
              blocks: [{
                blockId: "block-1",
                parentBlockId: null,
                siblingIndex: 0,
                depth: 0,
                type: "paragraph",
                props: {},
                content: [{ type: "text", text: "Body", styles: {} }],
                etag: ETAG,
              }],
            },
          },
        },
      }),
    ];

    for (const output of prepared) {
      expect(etagCount(output)).toBe(1);
    }
  });

  test("treats requested document content separately from bounded metadata", () => {
    const content = "x".repeat(10_000);
    const output = GetBlockOutputSchema.parse({
      data: {
        block: {
          blockId: "card-1",
          type: "card",
          lifecycle: "active",
          location: { kind: "space" },
        },
        document: {
          documentId: "document-1",
          ownerBlockId: "card-1",
          body: { format: "nfm", content, contentHash: "hash" },
        },
      },
    });

    expect(serializedBytes(output) - Buffer.byteLength(content, "utf8")).toBeLessThan(512);
  });

  test("keeps v3 Database queries validator-free and below four KiB", () => {
    const output = QueryDatabaseV3OutputSchema.parse({
      data: {
        database: {
          databaseBlockId: "database-1",
          name: "Tasks",
          properties: [{
            propertyId: "status",
            name: "Status",
            valueType: "select",
            config: {},
          }],
        },
        view: { viewId: "view-1", name: "Board", kind: "kanban" },
        rows: Array.from({ length: 13 }, (_, index) => ({
          cardId: `card-${index + 1}`,
          title: `Task ${index + 1}`,
          values: { status: index % 2 === 0 ? "Todo" : "Done" },
          placement: { viewId: "view-1", groupKey: index % 2 === 0 ? "Todo" : "Done" },
        })),
      },
      page: { hasMore: false },
    });

    expect(etagCount(output)).toBe(0);
    expect(serializedBytes(output)).toBeLessThan(
      NODEX_AGENT_V3_CATALOG_BUDGETS.defaultQueryResultBytes,
    );
  });

  test("keeps every v3 default mutation result sparse", () => {
    const effects = { created: 0, updated: 1, moved: 0, deleted: 0 };
    const outputs = [
      UpdateCardV3OutputSchema.parse({ data: { cardId: "card-1", effects } }),
      AdvancedUpdateCardV3OutputSchema.parse({ data: { cardId: "card-1", effects } }),
      MoveCardsV3OutputSchema.parse({
        data: {
          cards: [{ cardId: "card-1", location: { kind: "space" } }],
          moved: 1,
        },
      }),
      DuplicateCardV3OutputSchema.parse({
        data: {
          sourceCardId: "card-1",
          cardId: "card-2",
          location: { kind: "space" },
          bodyBlocksCreated: 10,
        },
      }),
    ];

    for (const output of outputs) {
      expect(etagCount(output)).toBe(0);
      expect(JSON.stringify(output)).not.toContain("markdown");
      expect(serializedBytes(output)).toBeLessThan(
        NODEX_AGENT_V3_CATALOG_BUDGETS.defaultMutationResultBytes,
      );
    }
  });

  test("scales the default create_cards result only with returned Card summaries", () => {
    for (const cardCount of [1, 16]) {
      const output = CreateCardsV3OutputSchema.parse({
        data: {
          cards: Array.from({ length: cardCount }, (_, index) => ({
            cardId: `card-${index + 1}`,
            location: { kind: "space" },
            bodyBlocksCreated: 10,
          })),
          created: cardCount,
        },
      });
      const cap = NODEX_AGENT_V3_CATALOG_BUDGETS.defaultCreateCardsBaseBytes
        + NODEX_AGENT_V3_CATALOG_BUDGETS.defaultCreateCardsPerCardBytes * cardCount;

      expect(etagCount(output)).toBe(0);
      expect(JSON.stringify(output)).not.toContain("markdown");
      expect(serializedBytes(output)).toBeLessThan(cap);
    }
  });

  test("returns one adjacent v3 ETag only for an explicitly prepared title, body, or Block", () => {
    const resource = {
      id: "card-1",
      type: "card",
      lifecycle: "active",
      location: { kind: "space" },
    } as const;
    const prepared = [
      FetchV3OutputSchema.parse({
        data: {
          resource: { ...resource, title: { markdown: "Card", etag: ETAG } },
        },
      }),
      FetchV3OutputSchema.parse({
        data: {
          resource,
          content: { format: "markdown", markdown: "Body", contentHash: "hash", etag: ETAG },
        },
      }),
      FetchV3OutputSchema.parse({
        data: {
          resource,
          content: {
            format: "blocks",
            blocks: [{
              id: "block-1",
              parentId: null,
              index: 0,
              depth: 0,
              type: "paragraph",
              props: {},
              content: [{ type: "text", text: "Body", styles: {} }],
              etag: ETAG,
            }],
          },
        },
      }),
    ];

    for (const output of prepared) expect(etagCount(output)).toBe(1);
  });
});
