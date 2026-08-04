import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { act, useRef, useState } from "react";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../../shared/database-identities";
import { testPropertySemantics } from "../../../shared/testing/database-property-record";
import { render } from "../../test/dom";
import { DatabaseViewSurface } from "./database-view-surface";
import { DatabaseViewTabSurface } from "./workbench-db-view-panel";

const timestamp = "2026-07-12T00:00:00.000Z";
const dataSourceId = parseDataSourceId("source-1");
const databaseId = parseDatabaseId("database-1");
const viewId = parseDatabaseViewId("view-focused");
const tagsPropertyId = parseDataSourcePropertyId("tags");

const model: DatabaseViewRenderModel = {
  libraryId: "library-1",
  accessContext: { kind: "project", projectId: "project-1" },
  databaseViewId: viewId,
  databaseId,
  dataSourceId,
  databaseName: "Tasks",
  dataSourceName: "Pages",
  viewName: "Focused",
  storeEpoch: "epoch-1",
  changeLogSeq: 2,
  primaryWriteCompatible: false,
  readOnlyReason: null,
  query: {
    database: {
      databaseId,
      libraryId: "library-1",
      name: "Tasks",
      lifecycle: "active",
      defaultViewId: parseDatabaseViewId("view-default"),
      accessRevision: 1,
      metadataRevision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    dataSource: {
      dataSourceId,
      libraryId: "library-1",
      homeDatabaseId: databaseId,
      name: "Pages",
      schemaKey: "nodex.pages",
      schemaRevision: 1,
      lifecycle: "active",
      rankKey: "a",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    view: {
      viewId,
      databaseId,
      dataSourceId,
      name: "Focused",
      kind: "list",
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 2,
        filter: { kind: "group", operator: "and", children: [] },
        sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
        group: null,
        display: { propertyIds: [tagsPropertyId], showTitle: true },
      },
      isDefault: false,
      revision: 1,
      rankKey: "a",
      lifecycle: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    properties: [{
      propertyId: tagsPropertyId,
      dataSourceId,
      name: "Tags",
      ...testPropertySemantics("multi_select", 2),
      valueType: "multi_select",
      config: {
        options: [
          { id: "o_AAAAAAAA", name: "Selected View" },
          { id: "o_BBBBBBBB", name: "Next" },
        ],
      },
      rankKey: "a",
      lifecycle: "active",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    rows: [{
      membership: {
        membershipId: "membership-focused",
        dataSourceId,
        revision: 1,
        createdAt: timestamp,
      },
      page: {
        pageId: "page-focused",
        libraryId: "library-1",
        parent: { kind: "data_source", dataSourceId },
        lifecycle: "active",
        parentRevision: 1,
        metadataRevision: 1,
        documentId: "document-focused",
        documentGeneration: 1,
        documentHeadSeq: 1,
        title: "Focused Page",
        richTitle: plainTextToPortableRichText("Focused Page"),
        preview: "",
        plainText: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      values: {
        [tagsPropertyId]: {
          propertyId: tagsPropertyId,
          valueType: "multi_select",
          value: ["o_AAAAAAAA"],
          revision: 1,
        },
      },
      position: { groupKey: null, rankKey: "a", revision: 1 },
      effectiveGroupKey: null,
    }],
  },
  columns: [{
    id: "build",
    scopeKey: "key:build",
    name: "In Progress",
    rows: [{
      pageId: "page-focused",
      status: "build",
      title: "Focused Page",
      preview: "",
      plainText: "",
      tags: ["selected-view"],
      metadataRevision: 1,
      createdAt: new Date(timestamp),
    }],
  }],
};

describe("DatabaseViewSurface", () => {
  test("renders the selected View Pages and opens their stable identity", () => {
    const opened: unknown[][] = [];
    const screen = render(
      <DatabaseViewSurface
        model={model}
        searchQuery="focused"
        onOpenPage={(...args) => opened.push(args)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Page Focused Page" }));
    expect(opened[0]).toEqual(["page-focused", "Focused Page"]);
  });

  test("writes a displayed custom property through Page and Data Source identity", async () => {
    const operations: unknown[] = [];
    const screen = render(
      <DatabaseViewSurface
        model={model}
        searchQuery=""
        onOpenPage={() => undefined}
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
    expect(operations[0]).toEqual({
      kind: "edit_property_values",
      edits: [{
        pageId: "page-focused",
        dataSourceId,
        propertyId: tagsPropertyId,
        edit: {
          kind: "patch_set",
          delta: {
            kind: "multi_select",
            addOptionIds: ["o_BBBBBBBB"],
            removeOptionIds: [],
          },
        },
      }],
    });
  });
});

function DatabaseViewTabHarness() {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  return (
    <DatabaseViewTabSurface
      model={model}
      activeSearchQuery={query}
      taskSearchOpen={searchOpen}
      searchShortcutLabel="Ctrl+F"
      taskSearchInputRef={searchInputRef}
      onSearchQueryChange={setQuery}
      onOpenTaskSearch={() => setSearchOpen(true)}
      onCloseTaskSearch={() => setSearchOpen(false)}
      onOpenPage={() => undefined}
    />
  );
}

describe("DatabaseViewTabSurface", () => {
  test("uses the DB View tab toolbar to search the shared Database surface", async () => {
    const screen = render(<DatabaseViewTabHarness />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Search" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Search tasks" }), {
        target: { value: "missing page" },
      });
      await Promise.resolve();
    });

    expect(screen.getByText("No matching Pages")).toBeTruthy();
  });
});
