import { describe, expect, test, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { act, useRef, useState } from "react";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import { DatabaseViewMutationError } from "@/lib/database-view-row-mutations";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../../shared/database-identities";
import { testPropertySemantics } from "../../../shared/testing/database-property-record";
import { render } from "../../test/dom";
import {
  databaseViewMutationErrorMessage,
  DatabaseViewSurface,
} from "./database-view-surface";
import { DatabaseViewTabSurface } from "./workbench-db-view-panel";

const optionRuntime = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/database-property-options-runtime", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/database-property-options-runtime")>(),
  readPropertyOptionWindow: optionRuntime.read,
}));

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
  commitSeq: 2,
  authorization: null,
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
  test("classifies missing page moves separately from missing Properties", () => {
    const error = new DatabaseViewMutationError({
      code: "resource_not_found",
      message: "raw resource detail",
      retryable: false,
    });
    expect(databaseViewMutationErrorMessage(error, true))
      .toBe("This page is no longer available.");
    expect(databaseViewMutationErrorMessage(error, false))
      .toBe("This property is no longer available.");
  });

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
      fireEvent.click(screen.getByRole("button", { name: "Edit Tags" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Next" }));
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

  test("keeps a successful option registry usable when a sibling registry fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const brokenPropertyId = parseDataSourcePropertyId("p_0123abcd");
    const loadingModel: DatabaseViewRenderModel = {
      ...model,
      query: {
        ...model.query,
        view: {
          ...model.query.view,
          config: {
            ...model.query.view.config,
            display: {
              ...model.query.view.config.display,
              propertyIds: [tagsPropertyId, brokenPropertyId],
            },
          },
        },
        properties: [
          { ...model.query.properties[0]!, optionCount: 3 },
          {
            ...model.query.properties[0]!,
            propertyId: brokenPropertyId,
            name: "Broken select",
            ...testPropertySemantics("select", 1),
            valueType: "select",
            config: {},
            optionCount: 1,
            rankKey: "b",
          },
        ],
      },
    };
    optionRuntime.read.mockImplementation(async (_context, property) => {
      if (property.propertyId === brokenPropertyId) {
        throw new Error("registry unavailable");
      }
      return {
        options: [
          { id: "o_AAAAAAAA", name: "Selected View" },
          { id: "o_BBBBBBBB", name: "Next" },
          { id: "o_CCCCCCCC", name: "Loaded sibling" },
        ],
        nextCursor: null,
        projectionRevision: 1,
      };
    });
    try {
      const screen = render(
        <DatabaseViewSurface
          model={loadingModel}
          searchQuery=""
          onOpenPage={() => undefined}
        />,
      );
      expect(optionRuntime.read).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Edit Tags" }));
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByRole("option", { name: "Loaded sibling" })).toBeTruthy());
      expect(optionRuntime.read).toHaveBeenCalledTimes(1);
      screen.rerender(
        <DatabaseViewSurface
          model={{ ...loadingModel, commitSeq: loadingModel.commitSeq + 1 }}
          searchQuery=""
          onOpenPage={() => undefined}
        />,
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(optionRuntime.read).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("option", { name: "Loaded sibling" })).toBeTruthy();
      await act(async () => {
        fireEvent.keyDown(screen.getByRole("combobox", { name: "Search Tags options" }), {
          key: "Escape",
        });
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByRole("button", {
        name: "Edit Tags",
      }).getAttribute("aria-expanded")).toBe("false"));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Edit Broken select" }));
        await Promise.resolve();
      });
      const retry = await waitFor(() => screen.getByRole("button", {
        name: "Couldn’t load options. Retry",
      }));
      expect(screen.queryByText("registry unavailable")).toBeNull();
      expect(optionRuntime.read).toHaveBeenCalledTimes(2);
      await act(async () => {
        fireEvent.keyDown(retry, { key: "Escape" });
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByRole("button", {
        name: "Edit Broken select",
      }).getAttribute("aria-expanded")).toBe("false"));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Edit Tags" }));
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByRole("option", {
        name: "Loaded sibling",
      })).toBeTruthy());
      expect(optionRuntime.read).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });

  test("keeps a sibling Property interactive while another Property mutation is pending", async () => {
    const flagPropertyId = parseDataSourcePropertyId("p_0123abcd");
    let resolveFirst: (() => void) | undefined;
    const commitOperations = vi.fn()
      .mockImplementationOnce(() => new Promise<null>((resolve) => {
        resolveFirst = () => resolve(null);
      }))
      .mockResolvedValue(null);
    const scopedModel: DatabaseViewRenderModel = {
      ...model,
      query: {
        ...model.query,
        view: {
          ...model.query.view,
          config: {
            ...model.query.view.config,
            display: {
              ...model.query.view.config.display,
              propertyIds: [tagsPropertyId, flagPropertyId],
            },
          },
        },
        properties: [
          ...model.query.properties,
          {
            ...model.query.properties[0]!,
            propertyId: flagPropertyId,
            name: "Flag",
            ...testPropertySemantics("checkbox"),
            valueType: "checkbox",
            config: {},
            optionCount: 0,
            rankKey: "b",
          },
        ],
        rows: model.query.rows.map((row) => ({
          ...row,
          values: {
            ...row.values,
            [flagPropertyId]: {
              propertyId: flagPropertyId,
              valueType: "checkbox",
              value: false,
              revision: 1,
            },
          },
        })),
      },
    };
    const screen = render(
      <DatabaseViewSurface
        model={scopedModel}
        searchQuery=""
        onOpenPage={() => undefined}
        commitOperations={commitOperations}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit Tags" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Next" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(commitOperations).toHaveBeenCalledTimes(1));
    const flag = screen.getByRole("checkbox", { name: "Flag value" }) as HTMLButtonElement;
    expect(flag.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(flag);
      await Promise.resolve();
    });
    expect(commitOperations).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveFirst?.();
      await Promise.resolve();
    });
  });

  test("keeps mutation failures with their Property and hides transport details", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const screen = render(
      <DatabaseViewSurface
        model={model}
        searchQuery=""
        onOpenPage={() => undefined}
        commitOperations={() => Promise.reject(new Error("databaseApplyV2 leaked detail"))}
      />,
    );
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Edit Tags" }));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("option", { name: "Next" }));
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByText("Couldn’t save this property. Try again."))
        .toBeTruthy());
      expect(screen.queryByText(/databaseApplyV2/)).toBeNull();
    } finally {
      consoleError.mockRestore();
    }
  });

  test("keeps option creation open and local when the atomic commit fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const screen = render(
      <DatabaseViewSurface
        model={model}
        searchQuery=""
        onOpenPage={() => undefined}
        commitOperations={async () => {
          throw new Error("atomic option rejected");
        }}
      />,
    );
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Edit Tags" }));
        await Promise.resolve();
      });
      const search = screen.getByRole("combobox", { name: "Search Tags options" });
      await act(async () => {
        fireEvent.change(search, { target: { value: "Fresh" } });
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Create “Fresh”" }));
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByText("Couldn’t create option. Try again."))
        .toBeTruthy());
      expect(screen.queryByText("atomic option rejected")).toBeNull();
      expect(screen.getByRole("combobox", { name: "Search Tags options" })).toBeTruthy();
    } finally {
      consoleError.mockRestore();
    }
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
