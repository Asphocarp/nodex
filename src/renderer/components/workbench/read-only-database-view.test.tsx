import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import { render } from "../../test/dom";
import { ReadOnlyDatabaseView } from "./read-only-database-view";

const model: DatabaseViewRenderModel = {
  projectId: "project-1",
  databaseViewId: "view-focused",
  databaseBlockId: "database-1",
  databaseName: "Tasks",
  viewName: "Focused",
  storeEpoch: "epoch-1",
  changeLogSeq: 2,
  primaryWriteCompatible: false,
  readOnlyReason: null,
  query: {
    database: {
      blockId: "database-1",
      projectId: "project-1",
      name: "Tasks",
      isPrimary: false,
      schemaKey: "nodex.database",
      schemaRevision: 1,
      metadataRevision: 1,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
    view: {
      id: "view-focused",
      databaseBlockId: "database-1",
      projectId: "project-1",
      name: "Focused",
      kind: "list",
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 1,
        filter: { kind: "group", operator: "and", children: [] },
        sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
        group: null,
        display: { propertyIds: ["property-tags"], showTitle: true },
      },
      isPrimary: false,
      revision: 1,
      rankKey: "a",
      lifecycle: "active",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
    properties: [{
      id: "property-tags",
      databaseBlockId: "database-1",
      key: "tags",
      name: "Tags",
      valueType: "multi_select",
      config: { options: [{ id: "selected-view", name: "Selected View" }, { id: "next", name: "Next" }] },
      rankKey: "a",
      lifecycle: "active",
      revision: 1,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    }],
    rows: [{
      membership: {
        id: "membership-focused",
        databaseBlockId: "database-1",
        cardBlockId: "card-focused",
        revision: 1,
        createdAt: "2026-07-12T00:00:00.000Z",
      },
      card: {
        blockId: "card-focused",
        projectId: "project-1",
        lifecycle: "active",
        location: { kind: "space", rankKey: "a" },
        locationRevision: 1,
        metadataRevision: 1,
        documentId: "document-focused",
        documentGeneration: 1,
        documentHeadSeq: 1,
        documentAuthority: "ydoc_primary",
        content: {
          projectedSeq: 1,
          title: "Focused Card",
          richTitle: plainTextToPortableRichText("Focused Card"),
          preview: "",
          plainText: "",
        },
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
      values: {
        "property-tags": {
          propertyId: "property-tags",
          valueType: "multi_select",
          value: ["selected-view"],
          revision: 1,
        },
      },
      position: { groupKey: null, rankKey: "a", revision: 1 },
      effectiveGroupKey: null,
    }],
  },
  columns: [{
      id: "in_progress",
      name: "In Progress",
      rows: [{
        blockId: "card-focused",
        status: "in_progress",
        title: "Focused Card",
        preview: "",
        plainText: "",
        tags: ["selected-view"],
        metadataRevision: 1,
        createdAt: new Date("2026-07-12T00:00:00.000Z"),
      }],
  }],
};

describe("ReadOnlyDatabaseView", () => {
  test("renders the selected View rows and opens their stable Card identity", () => {
    const opened: unknown[][] = [];
    const screen = render(
      <ReadOnlyDatabaseView
        model={model}
        searchQuery="focused"
        openCardStage={(...args) => opened.push(args)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Card Focused Card" }));
    expect(JSON.stringify(opened[0])).toBe(JSON.stringify([
      "project-1",
      "card-focused",
      "Focused Card",
      { openMode: "preview" },
    ]));
  });

  test("writes a displayed custom property through the selected Database identity", async () => {
    const operations: unknown[] = [];
    const screen = render(
      <ReadOnlyDatabaseView
        model={model}
        searchQuery=""
        openCardStage={() => undefined}
        commitOperations={async (input) => {
          operations.push(...input.operations);
          return null;
        }}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await Promise.resolve();
    });
    expect(JSON.stringify(operations[0])).toBe(JSON.stringify({
      kind: "add_remove_value",
      cardBlockId: "card-focused",
      databaseBlockId: "database-1",
      propertyId: "property-tags",
      add: ["next"],
      remove: [],
    }));
  });
});
