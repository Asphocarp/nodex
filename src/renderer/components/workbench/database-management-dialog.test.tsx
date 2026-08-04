import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import type {
  DatabaseContainerDescriptorV2,
  DataSourceDescriptorV2,
} from "../../../shared/database-module-v2";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../../shared/database-identities";
import { testPropertySemantics } from "../../../shared/testing/database-property-record";
import {
  DatabaseManagementMutationError,
  DatabaseManagementReadError,
} from "@/lib/database-management-runtime";
import { render } from "../../test/dom";
import {
  DatabaseManagementSurface,
  type DatabaseManagementSurfaceProps,
} from "./database-management-dialog";
import { databaseManagementErrorMessage } from "./database-management-dialog-controller";

const timestamp = "2026-07-12T00:00:00.000Z";
const libraryId = "library-1";
const databaseId = parseDatabaseId("database-primary");
const dataSourceId = parseDataSourceId("source-primary");
const primaryViewId = parseDatabaseViewId("view-primary");
const listViewId = parseDatabaseViewId("view-list");

test("maps database management failures without leaking authority details", () => {
  expect(databaseManagementErrorMessage(
    new DatabaseManagementReadError("databaseModuleReadV2 leaked detail", false),
  )).toBe("Couldn’t load database settings. Try again.");
  expect(databaseManagementErrorMessage(new DatabaseManagementMutationError({
    code: "revision_conflict",
    message: "databaseApplyV2 leaked detail",
    retryable: false,
  }))).toBe("Database settings changed elsewhere. Review and try again.");
});

const databases: readonly DatabaseContainerDescriptorV2[] = [{
  database: {
    databaseId,
    libraryId,
    name: "Tasks",
    lifecycle: "active",
    defaultViewId: primaryViewId,
    accessRevision: 1,
    metadataRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  dataSources: [{
    dataSourceId,
    libraryId,
    homeDatabaseId: databaseId,
    name: "Pages",
    schemaKey: "nodex.pages",
    schemaRevision: 2,
    lifecycle: "active",
    rankKey: "a",
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
  views: [
    {
      viewId: primaryViewId,
      databaseId,
      dataSourceId,
      name: "Board",
      kind: "kanban",
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 2,
        filter: { kind: "group", operator: "and", children: [] },
        sort: [{
          field: { kind: "manual" },
          direction: "asc",
          nulls: "last",
        }],
        group: null,
        display: { propertyIds: ["tags"], showTitle: true },
      },
      isDefault: true,
      revision: 1,
      rankKey: "a",
      lifecycle: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      viewId: listViewId,
      databaseId,
      dataSourceId,
      name: "List",
      kind: "list",
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 2,
        filter: { kind: "group", operator: "and", children: [] },
        sort: [],
        group: null,
        display: { propertyIds: [], showTitle: true },
      },
      isDefault: false,
      revision: 2,
      rankKey: "b",
      lifecycle: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
}];

const source: DataSourceDescriptorV2 = {
  dataSource: databases[0]!.dataSources[0]!,
  properties: [{
    propertyId: parseDataSourcePropertyId("tags"),
    dataSourceId,
    name: "Tags",
    ...testPropertySemantics("multi_select", 1),
    valueType: "multi_select",
    config: {
      options: [{ id: "o_AAAAAAAA", name: "Page first" }],
    },
    rankKey: "a",
    lifecycle: "active",
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
};

const noop = () => undefined;
const baseProps = (): DatabaseManagementSurfaceProps => ({
  databases,
  source,
  selectedDatabaseId: databaseId,
  onSelectDatabase: noop,
  onCreateProperty: noop,
  onDeleteProperty: noop,
  onCreateView: noop,
  onUpdateView: noop,
  onDeleteView: noop,
  onPutPropertyOption: noop,
  onDeletePropertyOption: noop,
});

describe("DatabaseManagementSurface", () => {
  test("presents one Source schema and Views without Project-owned Page membership", () => {
    const screen = render(<DatabaseManagementSurface {...baseProps()} />);

    expect(screen.getByRole("heading", { name: "Tasks" })).toBeTruthy();
    expect(screen.getByText("Pages")).toBeTruthy();
    expect(screen.getByText("Schema owned by this Data Source")).toBeTruthy();
    expect(screen.queryByText("Cards")).toBeNull();
    expect(screen.queryByLabelText("Create Database")).toBeNull();
    expect(screen.queryByText("Add Data Source")).toBeNull();
  });

  test("emits canonical Data Source property and option drafts", async () => {
    const created: unknown[] = [];
    const deletedOptions: unknown[] = [];
    const screen = render(
      <DatabaseManagementSurface
        {...baseProps()}
        onCreateProperty={(draft) => {
          created.push(draft);
        }}
        onDeletePropertyOption={(...args) => {
          deletedOptions.push(args);
        }}
      />,
    );

    fireEvent.input(screen.getByLabelText("New property name"), {
      target: { value: "Owner" },
    });
    fireEvent.change(screen.getByLabelText("New property type"), {
      target: { value: "person" },
    });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText("New property name").closest("form")!);
      await Promise.resolve();
    });
    fireEvent.click(screen.getByLabelText("Delete option Page first"));

    expect(created[0]).toEqual({
      dataSourceId,
      name: "Owner",
      valueType: "person",
    });
    expect(deletedOptions[0]).toEqual([
      dataSourceId,
      "tags",
      "o_AAAAAAAA",
    ]);
  });

  test("saves a View through Container, Source, and View identity", async () => {
    const updates: unknown[] = [];
    const screen = render(
      <DatabaseManagementSurface
        {...baseProps()}
        onUpdateView={(draft) => {
          updates.push(draft);
        }}
      />,
    );

    fireEvent.input(screen.getByLabelText("View name List"), {
      target: { value: "Focused list" },
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Save View List"));
      await Promise.resolve();
    });

    expect(updates[0]).toMatchObject({
      databaseId,
      dataSourceId,
      viewId: "view-list",
      expectedRevision: 2,
      name: "Focused list",
      kind: "list",
    });
  });

  test("requires confirmation before deleting a Property", async () => {
    const deleted: unknown[] = [];
    const screen = render(
      <DatabaseManagementSurface
        {...baseProps()}
        databases={[{
          ...databases[0]!,
          views: databases[0]!.views.map((view) => ({
            ...view,
            config: {
              ...view.config,
              display: { ...view.config.display, propertyIds: [] },
            },
          })),
        }]}
        onDeleteProperty={(...args) => {
          deleted.push(args);
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Delete property Tags"));
    expect(deleted).toEqual([]);
    expect(screen.getByText("Delete this Property and its values from every Page?"))
      .toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Confirm delete property Tags"));
      await Promise.resolve();
    });
    expect(deleted).toEqual([[dataSourceId, "tags"]]);
  });

  test("names Views that block Property deletion", () => {
    const screen = render(<DatabaseManagementSurface {...baseProps()} />);

    fireEvent.click(screen.getByLabelText("Delete property Tags"));

    expect(screen.getByRole("alert").textContent).toContain(
      "Used by Board. Remove it from those Views first.",
    );
    expect(screen.queryByLabelText("Confirm delete property Tags")).toBeNull();
  });
});
