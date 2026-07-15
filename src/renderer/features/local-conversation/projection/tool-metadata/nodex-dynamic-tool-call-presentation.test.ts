import { describe, expect, test } from "vitest";
import type { CodexDynamicToolCallView } from "../../../../lib/types";
import { resolveNodexDynamicToolCallPresentation } from "./nodex-dynamic-tool-call-presentation";

function call(
  tool: string,
  argumentsValue: CodexDynamicToolCallView["arguments"],
  output?: unknown,
): CodexDynamicToolCallView {
  return {
    callId: `call-${tool}`,
    namespace: "nodex_app",
    tool,
    arguments: argumentsValue,
    status: "completed",
    contentItems: output === undefined
      ? null
      : [{ type: "inputText", text: JSON.stringify(output) }],
    success: true,
    durationMs: 12,
    completed: true,
  };
}

describe("resolveNodexDynamicToolCallPresentation", () => {
  test("makes search and create targets visible in compact transcript labels", () => {
    const search = resolveNodexDynamicToolCallPresentation(call(
      "search",
      { query: "migrtion", target: "cards" },
      { data: { target: "cards", results: [{ kind: "card" }, { kind: "card" }] } },
    ));
    const create = resolveNodexDynamicToolCallPresentation(call(
      "create",
      {
        resource: {
          kind: "card",
          title: { kind: "plain", text: "Migration plan" },
          body: { format: "nfm", content: "# Plan\nDetails" },
        },
        destination: { kind: "space" },
      },
      {
        data: { resource: { bodyBlockCount: 2 } },
      },
    ));

    expect(search?.label).toBe("Searched cards for “migrtion” · 2 results");
    expect(create?.label).toBe("Created “Migration plan” · 2 body blocks");
  });

  test("projects exact NFM patches into bounded addition and removal lines", () => {
    const presentation = resolveNodexDynamicToolCallPresentation(call("edit_document", {
      documentId: "document-1",
      body: {
        kind: "nfm.patch",
        patches: [
          { oldNfm: "## Draft\n- [ ] Ship", newNfm: "## Ready\n- [x] Ship" },
          { oldNfm: "Owner: TBD", newNfm: "Owner: Ada" },
        ],
      },
    }));

    expect(presentation?.label).toBe("Edited document · 2 NFM patches");
    expect(presentation?.markdownChange?.additions).toBe(3);
    expect(presentation?.markdownChange?.deletions).toBe(3);
    expect(presentation?.markdownChange?.lines.map((line) => `${line.kind}:${line.text}`)).toEqual([
      "removed:## Draft",
      "removed:- [ ] Ship",
      "added:## Ready",
      "added:- [x] Ship",
      "separator:Patch 2",
      "removed:Owner: TBD",
      "added:Owner: Ada",
    ]);
  });

  test("bounds large NFM previews while retaining exact line statistics", () => {
    const content = Array.from({ length: 120 }, (_, index) => `Line ${index + 1}`).join("\n");
    const presentation = resolveNodexDynamicToolCallPresentation(call("edit_document", {
      documentId: "document-1",
      body: { kind: "nfm.insert", at: { kind: "end" }, content },
    }));

    expect(presentation?.markdownChange?.additions).toBe(120);
    expect(presentation?.markdownChange?.lines).toHaveLength(80);
    expect(presentation?.markdownChange?.omittedLineCount).toBe(40);
  });

  test("keeps both sides of a large exact patch in the bounded preview", () => {
    const oldNfm = Array.from({ length: 100 }, (_, index) => `Old ${index + 1}`).join("\n");
    const newNfm = Array.from({ length: 100 }, (_, index) => `New ${index + 1}`).join("\n");
    const presentation = resolveNodexDynamicToolCallPresentation(call("edit_document", {
      documentId: "document-1",
      body: { kind: "nfm.patch", patches: [{ oldNfm, newNfm }] },
    }));

    expect(presentation?.markdownChange?.lines).toHaveLength(64);
    expect(presentation?.markdownChange?.lines.some((line) => line.text === "Old 1")).toBe(true);
    expect(presentation?.markdownChange?.lines.some((line) => line.text === "New 1")).toBe(true);
    expect(presentation?.markdownChange?.omittedLineCount).toBe(136);
  });

  test("summarizes transfer and database edits by semantic effect", () => {
    const transfer = resolveNodexDynamicToolCallPresentation(call("transfer_blocks", {
      mode: "move",
      blockIds: ["a", "b"],
      from: { kind: "space" },
      destination: { kind: "database" },
    }));
    const database = resolveNodexDynamicToolCallPresentation(call("edit_database", {
      databaseBlockId: "database-1",
      edits: [
        { kind: "value.set" },
        { kind: "view.place", items: [{ blockId: "a" }, { blockId: "b" }] },
      ],
    }));

    expect(transfer?.label).toBe("Moved 2 blocks to database");
    expect(database?.label).toBe("Updated database · 1 value change, 2 placements");
  });

  test("makes v3 fetch and query targets visible before and after results arrive", () => {
    const fetch = resolveNodexDynamicToolCallPresentation(call("fetch", {
      id: "card-launch",
    }, {
      data: {
        resource: {
          id: "card-launch",
          type: "card",
          title: { markdown: "**Launch** plan" },
          lifecycle: "active",
          location: { kind: "space" },
        },
      },
    }));
    const view = resolveNodexDynamicToolCallPresentation(call("query_database_view", {
      viewId: "view-roadmap",
    }, {
      data: {
        database: { name: "Tasks" },
        view: { name: "Roadmap" },
        rows: [{}, {}],
      },
    }));
    const advanced = resolveNodexDynamicToolCallPresentation(call("advanced_query_database", {
      databaseBlockId: "database-tasks",
      filter: { kind: "condition" },
    }, {
      data: { database: { name: "Tasks" }, rows: [{}] },
    }));

    expect(fetch?.label).toBe("Fetched “Launch plan” as markdown");
    expect(view?.label).toBe("Queried view “Roadmap” · 2 rows");
    expect(advanced?.label).toBe("Queried database “Tasks” · 1 row");
  });

  test("summarizes v3 Card creation, movement, and fresh duplicate identity", () => {
    const create = resolveNodexDynamicToolCallPresentation(call("create_cards", {
      destination: { kind: "database", databaseBlockId: "db-1" },
      cards: [
        { title: "Alpha" },
        { title: "Beta" },
        { title: "Gamma" },
      ],
    }, {
      data: {
        cards: [
          { bodyBlocksCreated: 2 },
          { bodyBlocksCreated: 0 },
          { bodyBlocksCreated: 1 },
        ],
        created: 3,
      },
    }));
    const move = resolveNodexDynamicToolCallPresentation(call("move_cards", {
      cardIds: ["card-a", "card-b"],
      destination: { kind: "card", cardId: "parent-1" },
    }));
    const duplicate = resolveNodexDynamicToolCallPresentation(call("duplicate_card", {
      cardId: "source-1",
      destination: { kind: "space" },
    }, {
      data: { sourceCardId: "source-1", cardId: "copy-1" },
    }));

    expect(create?.label).toBe(
      "Created 3 cards: “Alpha”, “Beta” +1 in database “db-1” · 3 body blocks",
    );
    expect(move?.label).toBe("Moved 2 cards to card “parent-1”");
    expect(duplicate?.label).toBe(
      "Duplicated card “source-1” → “copy-1” to Project Space",
    );
  });

  test("renders v3 Nested Markdown patches as a bounded diff and separates stable Block edits", () => {
    const update = resolveNodexDynamicToolCallPresentation(call("update_card", {
      cardId: "card-1",
      body: {
        kind: "patch",
        patches: [
          { oldMarkdown: "Draft", newMarkdown: "Ready" },
          { oldMarkdown: "- [ ] Ship", newMarkdown: "- [x] Ship" },
        ],
      },
    }));
    const advanced = resolveNodexDynamicToolCallPresentation(call("advanced_update_card", {
      cardId: "card-1",
      edits: [
        { kind: "update", blockId: "block-1" },
        { kind: "delete", blockId: "block-2" },
      ],
    }));

    expect(update?.label).toBe(
      "Updated card “card-1” · 2 Nested Markdown patches",
    );
    expect(update?.markdownChange?.additions).toBe(2);
    expect(update?.markdownChange?.deletions).toBe(2);
    expect(update?.markdownChange?.lines.map((line) => `${line.kind}:${line.text}`)).toEqual([
      "removed:Draft",
      "added:Ready",
      "separator:Patch 2",
      "removed:- [ ] Ship",
      "added:- [x] Ship",
    ]);
    expect(advanced?.label).toBe(
      "Updated card “card-1” · 2 stable block changes, 1 delete",
    );
    expect(advanced?.markdownChange).toBeNull();
  });
});
