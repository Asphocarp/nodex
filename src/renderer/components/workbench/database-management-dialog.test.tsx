import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import type {
  DatabaseContainerDescriptor,
  DataSourceDescriptor,
} from "../../../shared/database-module";
import { render } from "../../test/dom";
import {
  DatabaseManagementSurface,
  type DatabaseManagementSurfaceProps,
} from "./database-management-dialog";

const timestamp = "2026-07-12T00:00:00.000Z";
const libraryId = "library-1";
const databaseId = "database-primary";
const dataSourceId = "source-primary";

const databases: readonly DatabaseContainerDescriptor[] = [{
  database: {
    databaseId,
    libraryId,
    name: "Tasks",
    lifecycle: "active",
    defaultViewId: "view-primary",
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
      viewId: "view-primary",
      databaseId,
      dataSourceId,
      name: "Board",
      kind: "kanban",
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 1,
        filter: { kind: "group", operator: "and", children: [] },
        sort: [{
          field: { kind: "manual" },
          direction: "asc",
          nulls: "last",
        }],
        group: null,
        display: { propertyIds: ["property-tags"], showTitle: true },
      },
      isDefault: true,
      revision: 1,
      rankKey: "a",
      lifecycle: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      viewId: "view-list",
      databaseId,
      dataSourceId,
      name: "List",
      kind: "list",
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 1,
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

const source: DataSourceDescriptor = {
  dataSource: databases[0]!.dataSources[0]!,
  properties: [{
    propertyId: "property-tags",
    dataSourceId,
    key: "tags",
    name: "Tags",
    valueType: "multi_select",
    config: {
      options: [{ id: "option-page-first", name: "Page first" }],
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
      "property-tags",
      "option-page-first",
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
});
