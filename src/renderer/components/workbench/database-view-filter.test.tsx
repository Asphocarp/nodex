import { fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { expect, test, vi } from "vite-plus/test";

import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import { commitDatabaseViewOperations } from "@/lib/database-view-row-mutations";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../../shared/database-identities";
import { testPropertySemantics } from "../../../shared/testing/database-property-record";
import { upgradeDatabaseViewConfigV2 } from "../../../shared/database-view-presentation";
import { render } from "../../test/dom";
import { DatabaseViewFilter } from "./database-view-filter";

const timestamp = "2026-08-11T00:00:00.000Z";
const databaseId = parseDatabaseId("database-filter");
const dataSourceId = parseDataSourceId("source-filter");
const viewId = parseDatabaseViewId("view-filter");
const statusPropertyId = parseDataSourcePropertyId("status");
const config = upgradeDatabaseViewConfigV2({
  schemaKey: "nodex.database-view",
  schemaVersion: 2,
  filter: { kind: "group", operator: "and", children: [] },
  sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
  group: { propertyId: statusPropertyId },
  display: { propertyIds: [], showTitle: true },
});

const model: DatabaseViewRenderModel = {
  accessContext: { kind: "project", projectId: "project-filter" },
  libraryId: "library-filter",
  databaseViewId: viewId,
  databaseId,
  dataSourceId,
  databaseName: "Tasks",
  dataSourceName: "Pages",
  viewName: "Focused",
  storeEpoch: "epoch-filter",
  commitSeq: 1,
  authorization: null,
  columns: [],
  readOnlyReason: null,
  query: {
    database: {
      databaseId,
      libraryId: "library-filter",
      name: "Tasks",
      lifecycle: "active",
      defaultViewId: viewId,
      accessRevision: 1,
      metadataRevision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    dataSource: {
      dataSourceId,
      libraryId: "library-filter",
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
      defaultLayout: "board",
      config,
      isDefault: true,
      revision: 3,
      rankKey: "a",
      lifecycle: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    properties: [
      {
        propertyId: statusPropertyId,
        dataSourceId,
        name: "Status",
        ...testPropertySemantics("select", 2),
        valueType: "select",
        config: {
          options: [
            { id: "build", name: "Build" },
            { id: "ship", name: "Ship" },
          ],
        },
        rankKey: "a",
        lifecycle: "active",
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    rows: [],
  },
};

test("keeps filter edits as a draft until saving the shared View", async () => {
  const commitOperations: typeof commitDatabaseViewOperations = vi.fn(async () => null);
  const onCommitted = vi.fn();
  const screen = render(
    <DatabaseViewFilter
      model={model}
      commitOperations={commitOperations}
      onCommitted={onCommitted}
    />,
  );

  await act(async () => {
    fireEvent.click(screen.getByLabelText("Filter View"));
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole("button", { name: "Ship" }));

  expect(commitOperations).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save filter" }));
    await Promise.resolve();
  });

  await waitFor(() => expect(commitOperations).toHaveBeenCalledTimes(1));
  const input = vi.mocked(commitOperations).mock.calls[0]?.[0];
  const operation = input?.operations[0];
  expect(operation?.kind).toBe("put_view");
  if (operation?.kind !== "put_view") throw new Error("Expected put_view");
  expect(operation.expectedRevision).toBe(3);
  expect(operation.defaultLayout).toBe("board");
  expect(operation.config.filter).toMatchObject({
    kind: "group",
    children: [
      {
        kind: "clause",
        propertyId: "status",
        operator: "equals",
        value: "build",
      },
    ],
  });
  expect(onCommitted).toHaveBeenCalledTimes(1);
});
