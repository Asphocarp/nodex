import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { LibraryPageNavigationNode } from "../../../shared/library-module";
import { SidebarPagesSection, type SidebarPagesDataSource } from "./sidebar-pages-section";

const makePage = (index: number): LibraryPageNavigationNode => ({
  kind: "page",
  pageId: `page:${index}`,
  title: `Page ${index}`,
  hasChildren: false,
  parentRevision: 1,
  metadataRevision: 1,
  documentGeneration: 1,
  documentHeadSeq: 0,
  updatedAt: "2026-08-03T00:00:00.000Z",
});

const dataSource = (items: readonly LibraryPageNavigationNode[]): SidebarPagesDataSource => ({
  useStandaloneRoots: () => ({
    data: {
      pages: [
        {
          kind: "standalone_roots",
          items,
          nextCursor: null,
          hasMore: false,
          total: items.length,
        },
      ],
    },
    isPending: false,
    isError: false,
    hasNextPage: false,
    refetch: vi.fn(async () => undefined),
    fetchNextPage: vi.fn(async () => undefined),
  }),
});

describe("SidebarPagesSection", () => {
  test("shows a complete small root set without a pager", () => {
    render(
      <SidebarPagesSection
        collapsed={false}
        activeRoot={{ kind: "page", pageId: "page:2" }}
        onToggle={vi.fn()}
        onOpenRoot={vi.fn()}
        dataSource={dataSource([makePage(1), makePage(2), makePage(3)])}
        mutationsEnabled={false}
      />,
    );

    const list = screen.getByRole("list", { name: "Pages" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    expect(screen.getByText("Page 2").closest("[data-active]")?.getAttribute("data-active")).toBe(
      "true",
    );
  });

  test("uses the shared Show more and Show less paging behavior", () => {
    render(
      <SidebarPagesSection
        collapsed={false}
        activeRoot={null}
        onToggle={vi.fn()}
        onOpenRoot={vi.fn()}
        dataSource={dataSource(Array.from({ length: 6 }, (_, index) => makePage(index + 1)))}
        mutationsEnabled={false}
      />,
    );

    expect(screen.queryByText("Page 6")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Page 6")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Show less" })).not.toBeNull();
  });
});
