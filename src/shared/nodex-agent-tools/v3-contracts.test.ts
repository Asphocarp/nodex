import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  NESTED_MARKDOWN_AGENT_GUIDE,
  NESTED_MARKDOWN_COMPACT_HINT,
} from "../nfm/agent-guide";
import { NODEX_AGENT_V3_TOOL_CONTRACTS } from "./v3-contracts";
import {
  NODEX_APP_V3_TOOLS,
  NODEX_APP_V3_TOOLSET_REVISION,
} from "./identity";
import {
  AdvancedQueryDatabaseV3InputSchema,
  FetchV3InputSchema,
  GetContextV3InputSchema,
  GetContextV3OutputSchema,
  QueryDatabaseViewV3InputSchema,
  SearchV3InputSchema,
} from "./v3-read-schemas";
import {
  AdvancedUpdateCardV3InputSchema,
  CreateCardsV3InputSchema,
  DuplicateCardV3InputSchema,
  MoveCardsV3InputSchema,
  UpdateCardV3InputSchema,
} from "./v3-write-schemas";

const ETAG = `nxe1.${"a".repeat(43)}`;

describe("nodex_app@3 contracts", () => {
  test("defines one strict contract for every intent tool", () => {
    expect(NODEX_APP_V3_TOOLSET_REVISION).toBe(3);
    expect(Object.keys(NODEX_AGENT_V3_TOOL_CONTRACTS)).toEqual(NODEX_APP_V3_TOOLS);

    for (const [name, contract] of Object.entries(NODEX_AGENT_V3_TOOL_CONTRACTS)) {
      const schema = z.toJSONSchema(contract.inputSchema) as Record<string, unknown>;
      expect(schema.type, name).toBe("object");
      expect(schema.additionalProperties, name).toBe(false);
      expect(contract.description.length, name).toBeGreaterThan(40);
    }
  });

  test("uses only Agent-visible Nested Markdown vocabulary", () => {
    const publicContract = JSON.stringify(Object.values(NODEX_AGENT_V3_TOOL_CONTRACTS).map(
      (contract) => ({
        description: contract.description,
        input: z.toJSONSchema(contract.inputSchema),
        output: z.toJSONSchema(contract.outputSchema),
      }),
    ));

    expect(publicContract).not.toMatch(/NFM|nfm/u);
    expect(publicContract).not.toContain("documentId");
    expect(publicContract).toContain("markdown");
    expect(Buffer.byteLength(NESTED_MARKDOWN_COMPACT_HINT, "utf8")).toBeLessThanOrEqual(200);
  });

  test("keeps the full guide opt-in and aligned with the compact tab rule", () => {
    expect(GetContextV3InputSchema.safeParse({}).success).toBe(true);
    expect(GetContextV3InputSchema.safeParse({
      include: { markdownGuide: true },
    }).success).toBe(true);
    expect(GetContextV3InputSchema.safeParse({ include: { nfmGuide: true } }).success).toBe(false);
    expect(GetContextV3OutputSchema.safeParse({
      data: {
        project: null,
        access: { read: "allowed", write: "consent_required", domains: [] },
        markdownGuide: NESTED_MARKDOWN_AGENT_GUIDE,
      },
    }).success).toBe(true);
    expect(NESTED_MARKDOWN_AGENT_GUIDE.instructions).toContain(
      NESTED_MARKDOWN_COMPACT_HINT,
    );
  });

  test("defaults fetch to content while guarding Block-only controls", () => {
    expect(FetchV3InputSchema.safeParse({ id: "card-1" }).success).toBe(true);
    expect(FetchV3InputSchema.safeParse({ id: "card-1", format: "summary" }).success).toBe(true);
    expect(FetchV3InputSchema.safeParse({ id: "card-1", maxDepth: 2 }).success).toBe(false);
    expect(FetchV3InputSchema.safeParse({
      id: "card-1",
      format: "blocks",
      maxDepth: 2,
      prepareFor: [{ kind: "block_update", blockIds: ["block-1"] }],
      page: { limit: 20 },
    }).success).toBe(true);
    expect(FetchV3InputSchema.safeParse({
      id: "card-1",
      prepareFor: [{ kind: "block_delete", blockIds: ["block-1"] }],
    }).success).toBe(false);
    expect(FetchV3InputSchema.safeParse({
      id: "card-1",
      format: "summary",
      prepareFor: [{ kind: "body" }],
    }).success).toBe(false);
  });

  test("flattens search while retaining target-specific validation", () => {
    expect(SearchV3InputSchema.safeParse({ query: "dynmic tools" }).success).toBe(true);
    expect(SearchV3InputSchema.safeParse({
      query: "decision",
      target: "blocks",
      scope: { kind: "card", cardId: "card-1" },
      blockTypes: ["heading"],
      includeArchived: false,
      page: { limit: 20 },
    }).success).toBe(true);
    expect(SearchV3InputSchema.safeParse({
      query: "decision",
      blockTypes: ["heading"],
    }).success).toBe(false);
    expect(SearchV3InputSchema.safeParse({
      query: "decision",
      filters: { includeArchived: true },
    }).success).toBe(false);
    expect(SearchV3InputSchema.safeParse({
      query: "decision",
      scope: { kind: "document", documentId: "document-1" },
    }).success).toBe(false);
  });

  test("separates saved View queries from advanced ad-hoc queries", () => {
    expect(QueryDatabaseViewV3InputSchema.safeParse({ viewId: "view-1" }).success).toBe(true);
    expect(QueryDatabaseViewV3InputSchema.safeParse({
      databaseBlockId: "database-1",
    }).success).toBe(false);
    expect(AdvancedQueryDatabaseV3InputSchema.safeParse({
      databaseBlockId: "database-1",
      filter: {
        kind: "clause",
        propertyId: "status",
        operator: "equals",
        value: "Todo",
      },
    }).success).toBe(true);
    expect(AdvancedQueryDatabaseV3InputSchema.safeParse({ viewId: "view-1" }).success).toBe(false);
  });

  test("creates one to sixteen complete Cards with direct title/body strings", () => {
    expect(CreateCardsV3InputSchema.safeParse({
      destination: { kind: "space" },
      cards: [{
        title: "**Launch** plan",
        markdown: "▶ Scope\n\tChild paragraph\n\t- [ ] Child task",
      }],
    }).success).toBe(true);
    expect(CreateCardsV3InputSchema.safeParse({
      destination: { kind: "space" },
      cards: [{ title: "  Intentional leading spaces", markdown: "  Body spaces" }],
    }).success).toBe(true);
    expect(CreateCardsV3InputSchema.safeParse({
      destination: { kind: "space" },
      cards: [{ title: { kind: "plain", text: "Old wrapper" } }],
    }).success).toBe(false);
    expect(CreateCardsV3InputSchema.safeParse({
      destination: { kind: "space" },
      cards: [{ title: "Card", values: [{ propertyId: "status", value: "Todo" }] }],
    }).success).toBe(false);
    expect(CreateCardsV3InputSchema.safeParse({
      destination: { kind: "database", databaseBlockId: "database-1" },
      cards: Array.from({ length: 16 }, (_, index) => ({
        title: `Card ${index + 1}`,
        values: [{ propertyId: "status", value: "Todo" }],
      })),
      return: ["block_ids", "etags"],
    }).success).toBe(true);
    expect(CreateCardsV3InputSchema.safeParse({
      destination: { kind: "space" },
      cards: Array.from({ length: 17 }, (_, index) => ({ title: `Card ${index}` })),
    }).success).toBe(false);
  });

  test("keeps default and stable-Block Card updates in separate tools", () => {
    const patch = UpdateCardV3InputSchema.parse({
      cardId: "card-1",
      title: { markdown: "Ready", ifMatch: ETAG },
      body: {
        kind: "patch",
        patches: [
          { oldMarkdown: "old one", newMarkdown: "new one" },
          { oldMarkdown: "old two", newMarkdown: "new two", expectedMatches: 1 },
        ],
      },
      return: ["etags"],
    });
    expect(NODEX_AGENT_V3_TOOL_CONTRACTS.update_card.classifyEffect(patch)).toBe("write");
    expect(UpdateCardV3InputSchema.safeParse({
      cardId: "card-1",
      body: { kind: "replace", markdown: "Replacement" },
    }).success).toBe(false);
    const replacement = UpdateCardV3InputSchema.parse({
      cardId: "card-1",
      body: { kind: "replace", markdown: "Replacement", ifMatch: ETAG },
    });
    expect(NODEX_AGENT_V3_TOOL_CONTRACTS.update_card.classifyEffect(replacement)).toBe(
      "destructive",
    );
    expect(UpdateCardV3InputSchema.safeParse({
      cardId: "card-1",
      edits: [{ kind: "delete", blockId: "block-1", ifMatch: ETAG }],
    }).success).toBe(false);

    const advanced = AdvancedUpdateCardV3InputSchema.parse({
      cardId: "card-1",
      edits: [{ kind: "delete", blockId: "block-1", ifMatch: ETAG }],
    });
    expect(NODEX_AGENT_V3_TOOL_CONTRACTS.advanced_update_card.classifyEffect(advanced)).toBe(
      "destructive",
    );
  });

  test("uses Card-only move and duplicate intents without generic transfer fields", () => {
    expect(MoveCardsV3InputSchema.safeParse({
      cardIds: ["card-1", "card-2"],
      destination: { kind: "card", cardId: "parent-card", at: { kind: "end" } },
    }).success).toBe(true);
    expect(MoveCardsV3InputSchema.safeParse({
      cardIds: ["card-1", "card-1"],
      destination: { kind: "space" },
    }).success).toBe(false);
    expect(MoveCardsV3InputSchema.safeParse({
      mode: "move",
      cardIds: ["card-1"],
      from: { kind: "space" },
      destination: { kind: "space" },
    }).success).toBe(false);
    expect(DuplicateCardV3InputSchema.safeParse({
      cardId: "card-1",
      destination: { kind: "space" },
      return: ["block_map"],
    }).success).toBe(true);
    expect(DuplicateCardV3InputSchema.safeParse({
      cardIds: ["card-1"],
      destination: { kind: "space" },
    }).success).toBe(false);
    expect(DuplicateCardV3InputSchema.safeParse({
      cardId: "card-1",
      destination: { kind: "space" },
      return: ["block_map", "block_map"],
    }).success).toBe(false);
  });
});
