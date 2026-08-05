import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
} from "../../../shared/database-identities";
import type {
  DatabaseViewGroupsSnapshot,
  DatabaseViewWindowSnapshot,
} from "../../../shared/database-views";
import { TestQueryProvider } from "../../test/query";
import { WorkbenchDatabaseViewSurface } from "./workbench-database-view-surface";

const api = vi.hoisted(() => ({
  readDatabaseViewGroups: vi.fn(),
  readDatabaseViewWindow: vi.fn(),
  readLibraryDatabaseViewGroups: vi.fn(),
  readLibraryDatabaseViewWindow: vi.fn(),
}));

const presenter = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));

vi.mock("../../lib/api", () => api);
vi.mock("./workbench-db-view-panel", () => ({
  DatabaseViewTabSurface: (props: Record<string, unknown>) => {
    presenter.props = props;
    return (
      <button
        type="button"
        onClick={() => {
          const open = props.onOpenPage as (
            pageId: string,
            title: string,
          ) => void;
          open("page-from-database", "From Database");
        }}
      >
        Shared Database View
      </button>
    );
  },
}));

const timestamp = "2026-08-03T00:00:00.000Z";
const databaseId = parseDatabaseId("database:standalone");
const dataSourceId = parseDataSourceId("data-source:standalone");
const viewId = parseDatabaseViewId("database-view:standalone");

const makeWindow = <ProjectScope extends string | null>(
  projectId: ProjectScope,
): DatabaseViewWindowSnapshot<ProjectScope> => ({
  projectId,
  libraryId: "library:test",
  databaseId,
  dataSourceId,
  viewId,
  storeEpoch: "epoch:test",
  commitSeq: 1,
  projectionRevision: 1,
  nextCursor: null,
  rows: [],
  board: { columns: [] },
  view: {
    id: viewId,
    databaseBlockId: databaseId,
    projectId,
    name: "Board",
    kind: "kanban",
    config: {},
    isPrimary: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  query: {
    database: {
      databaseId,
      libraryId: "library:test",
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
      libraryId: "library:test",
      homeDatabaseId: databaseId,
      name: "Pages",
      schemaKey: "nodex.page",
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
      name: "Board",
      kind: "kanban",
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 2,
        filter: { kind: "group", operator: "and", children: [] },
        sort: [],
        group: null,
        display: { propertyIds: [], showTitle: true },
      },
      isDefault: true,
      revision: 1,
      rankKey: "a",
      lifecycle: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    properties: [],
    rows: [],
  },
});

const makeGroups = <ProjectScope extends string | null>(
  projectId: ProjectScope,
): DatabaseViewGroupsSnapshot<ProjectScope> => ({
  projectId,
  libraryId: "library:test",
  databaseId,
  dataSourceId,
  viewId,
  storeEpoch: "epoch:test",
  commitSeq: 1,
  grouped: false,
  totalRows: 0,
  truncated: false,
  groups: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  presenter.props = null;
  api.readLibraryDatabaseViewGroups.mockResolvedValue(makeGroups(null));
  api.readLibraryDatabaseViewWindow.mockResolvedValue(makeWindow(null));
  api.readDatabaseViewGroups.mockResolvedValue(makeGroups("project-alpha"));
  api.readDatabaseViewWindow.mockResolvedValue(makeWindow("project-alpha"));
});

describe("WorkbenchDatabaseViewSurface", () => {
  test("uses Library reads and the shared Database View presenter", async () => {
    const onOpenPage = vi.fn();
    const onPresentationChange = vi.fn();
    render(
      <TestQueryProvider>
        <WorkbenchDatabaseViewSurface
          accessContext={{ kind: "library" }}
          target={{ kind: "database-default", databaseId }}
          onOpenPage={onOpenPage}
          onPresentationChange={onPresentationChange}
        />
      </TestQueryProvider>,
    );

    const sharedView = await screen.findByRole("button", {
      name: "Shared Database View",
    });
    expect(api.readLibraryDatabaseViewGroups).toHaveBeenCalledWith({
      databaseId,
    });
    expect(api.readLibraryDatabaseViewWindow).toHaveBeenCalledWith({
      databaseId,
      first: 50,
    });
    expect(api.readDatabaseViewGroups).not.toHaveBeenCalled();
    expect(onPresentationChange).toHaveBeenCalledWith({
      databaseName: "Tasks",
      viewName: "Board",
    });

    fireEvent.click(sharedView);
    expect(onOpenPage).toHaveBeenCalledWith(
      "page-from-database",
      "From Database",
    );
  });

  test("switches only the transport boundary for Project authority", async () => {
    render(
      <TestQueryProvider>
        <WorkbenchDatabaseViewSurface
          accessContext={{ kind: "project", projectId: "project-alpha" }}
          target={{ kind: "database-view", databaseViewId: viewId }}
          onOpenPage={vi.fn()}
        />
      </TestQueryProvider>,
    );

    await waitFor(() => {
      expect(presenter.props).not.toBeNull();
    });
    expect(api.readDatabaseViewGroups).toHaveBeenCalledWith(
      "project-alpha",
      { databaseViewId: viewId },
    );
    expect(api.readDatabaseViewWindow).toHaveBeenCalledWith(
      "project-alpha",
      { databaseViewId: viewId, first: 50 },
    );
    expect(api.readLibraryDatabaseViewGroups).not.toHaveBeenCalled();
  });

  test("hides read transport details behind a recoverable database error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    api.readLibraryDatabaseViewGroups.mockRejectedValueOnce(
      new Error("databaseModuleReadV2 leaked detail"),
    );
    try {
      render(
        <TestQueryProvider>
          <WorkbenchDatabaseViewSurface
            accessContext={{ kind: "library" }}
            target={{ kind: "database-default", databaseId }}
            onOpenPage={vi.fn()}
          />
        </TestQueryProvider>,
      );
      expect(await screen.findByText("Couldn’t open this database")).toBeTruthy();
      expect(screen.queryByText(/databaseModuleReadV2/)).toBeNull();
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    } finally {
      consoleError.mockRestore();
    }
  });
});
