import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test, vi } from "vitest";
import { NodexTooltipProvider } from "@/components/ui/tooltip";

import {
  parseDatabaseId,
  parseDatabaseViewId,
} from "../../../shared/database-identities";
import type {
  LibraryNavigationNode,
  LibraryNavigationParent,
  LibraryRouteTarget,
} from "../../../shared/library-module";
import {
  SidebarLibrarySection,
  type SidebarLibraryDataSource,
} from "./sidebar-library-section";

const rootPage: LibraryNavigationNode = {
  kind: "page",
  pageId: "page-root",
  title: "Product notes",
  hasChildren: true,
  parentRevision: 1,
  metadataRevision: 1,
  documentGeneration: 1,
  documentHeadSeq: 1,
  updatedAt: "2026-07-18T00:00:00.000Z",
};
const nestedPage: LibraryNavigationNode = {
  kind: "page",
  pageId: "page-nested",
  title: "Launch plan",
  hasChildren: false,
  parentRevision: 1,
  metadataRevision: 1,
  documentGeneration: 1,
  documentHeadSeq: 1,
  updatedAt: "2026-07-18T00:00:00.000Z",
};
const database: LibraryNavigationNode = {
  kind: "database",
  databaseId: parseDatabaseId("database-1"),
  title: "Tasks",
  defaultViewId: parseDatabaseViewId("view-1"),
  hasMultipleViews: false,
  metadataRevision: 1,
  locationRevision: 1,
  updatedAt: "2026-07-18T00:00:00.000Z",
};

const parentKey = (parent: LibraryNavigationParent): string => {
  if (parent.kind === "library") return "library";
  if (parent.kind === "page") return `page:${parent.pageId}`;
  return `database:${parent.databaseId}`;
};

const dataSource = (
  pathNodes: readonly LibraryNavigationNode[] = [],
): SidebarLibraryDataSource => ({
  useInvalidation: () => undefined,
  usePath: () => ({
    data: pathNodes.length > 0
      ? {
          kind: "path",
          target: { kind: "page", pageId: "page-nested" },
          nodes: pathNodes,
        }
      : undefined,
    isPending: false,
    isError: false,
    refetch: async () => undefined,
  }),
  useChildren: () => ({
    data: {
      kind: "children",
      parent: { kind: "library" },
      items: [rootPage, database],
      nextCursor: null,
      hasMore: false,
      total: 2,
    },
    isPending: false,
    isError: false,
    refetch: async () => undefined,
  }),
  useInfiniteChildren: (parent) => {
    const items = parentKey(parent) === "page:page-root" ? [nestedPage] : [];
    return {
      data: {
        pages: [{
          kind: "children",
          parent,
          items,
          nextCursor: null,
          hasMore: false,
          total: items.length,
        }],
      },
      isPending: false,
      isError: false,
      hasNextPage: false,
      refetch: async () => undefined,
      fetchNextPage: async () => undefined,
    };
  },
});

const renderSection = (element: ReactElement) =>
  render(<NodexTooltipProvider>{element}</NodexTooltipProvider>);

describe("Sidebar Library section", () => {
  test("uses one composite tab stop and follows directional tree navigation", async () => {
    const opened: LibraryRouteTarget[] = [];
    renderSection(
      <SidebarLibrarySection
        collapsed={false}
        activeTarget={null}
        onToggle={() => undefined}
        onOpenLibrary={() => undefined}
        onOpenTarget={(target) => opened.push(target)}
        dataSource={dataSource()}
      />,
    );

    const page = screen.getByRole("treeitem", { name: "Product notes" });
    const databaseRow = screen.getByRole("treeitem", { name: "Tasks" });
    expect(page.tabIndex).toBe(0);
    expect(databaseRow.tabIndex).toBe(-1);

    await act(async () => {
      fireEvent.keyDown(page, { key: "ArrowRight" });
    });
    const nested = await screen.findByRole("treeitem", { name: "Launch plan" });
    expect(page.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      fireEvent.keyDown(page, { key: "ArrowDown" });
    });
    await waitFor(() => expect(document.activeElement).toBe(nested));
    fireEvent.keyDown(nested, { key: "Enter" });
    expect(opened).toEqual([{ kind: "page", pageId: "page-nested" }]);
  });

  test("force-expands the active ownership path without expanding siblings", async () => {
    const onOpenLibrary = vi.fn();
    renderSection(
      <SidebarLibrarySection
        collapsed={false}
        activeTarget={{ kind: "page", pageId: "page-nested" }}
        onToggle={() => undefined}
        onOpenLibrary={onOpenLibrary}
        onOpenTarget={() => undefined}
        dataSource={dataSource([rootPage, nestedPage])}
      />,
    );

    const nested = await screen.findByRole("treeitem", { name: "Launch plan" });
    expect(nested.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("treeitem", { name: "Product notes" })
      .getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("treeitem", { name: "Tasks" })
      .hasAttribute("aria-expanded")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(onOpenLibrary).toHaveBeenCalledOnce();
  });
});
