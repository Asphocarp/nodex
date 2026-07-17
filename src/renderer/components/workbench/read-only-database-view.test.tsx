import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../../shared/database-identities";
import { render } from "../../test/dom";
import { DatabaseViewSurface } from "./read-only-database-view";

const timestamp = "2026-07-12T00:00:00.000Z";
const dataSourceId = parseDataSourceId("source-1");
const databaseId = parseDatabaseId("database-1");
const viewId = parseDatabaseViewId("view-focused");
const tagsPropertyId = parseDataSourcePropertyId("tags");

const model: DatabaseViewRenderModel = {
  projectId: "project-1",
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
    id: "in_progress",
    name: "In Progress",
    rows: [{
      pageId: "page-focused",
      status: "in_progress",
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
        openPageStage={(...args) => opened.push(args)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Page Focused Page" }));
    expect(opened[0]).toEqual([
      "project-1",
      "page-focused",
      "Focused Page",
      { openMode: "preview" },
    ]);
  });

  test("writes a displayed custom property through Page and Data Source identity", async () => {
    const operations: unknown[] = [];
    const screen = render(
      <DatabaseViewSurface
        model={model}
        searchQuery=""
        openPageStage={() => undefined}
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
      kind: "add_remove_value",
      pageId: "page-focused",
      dataSourceId,
      propertyId: tagsPropertyId,
      add: ["o_BBBBBBBB"],
      remove: [],
    });
  });
});
