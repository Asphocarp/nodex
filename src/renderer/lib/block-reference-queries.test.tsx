import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { PageOwnershipPathsChangedEvent } from "../../shared/page-ownership-path-events";
import type { ProjectionStreamMessage } from "../../shared/projection-stream";
import { render } from "../test/dom";
import { TestQueryProvider } from "../test/query";
import { usePageOwnershipPathReadModel } from "./block-reference-queries";
import { ProjectionInvalidationRegistry } from "./projection-invalidation-registry";

const mocks = vi.hoisted(() => ({
  readLibraryModule: vi.fn(),
  resolvePageOwnershipPath: vi.fn(),
  ownershipPathChangeListener: null as (
    (event: PageOwnershipPathsChangedEvent) => void
  ) | null,
}));

vi.mock("./api", () => ({
  readLibraryModule: mocks.readLibraryModule,
  resolvePageOwnershipPath: mocks.resolvePageOwnershipPath,
  readDatabaseViewReference: vi.fn(),
}));

vi.mock("./renderer-transport", () => ({
  resolveRendererTransport: () => ({
    subscribeBoardChanges: () => () => undefined,
    subscribePageOwnershipPathChanges: (
      _projectId: string,
      listener: (event: PageOwnershipPathsChangedEvent) => void,
    ) => {
      mocks.ownershipPathChangeListener = listener;
      return () => {
        if (mocks.ownershipPathChangeListener === listener) {
          mocks.ownershipPathChangeListener = null;
        }
      };
    },
  }),
}));

function OwnershipPathHarness() {
  const path = usePageOwnershipPathReadModel("host-project", "nested-page");
  return (
    <output>
      {path.data?.status === "available"
        ? path.data.ancestors.map((ancestor) => ancestor.title).join("|")
        : "pending"}
    </output>
  );
}

describe("Page reference queries", () => {
  let projectionListeners: Set<(message: ProjectionStreamMessage) => void>;
  let projectionRegistry: ProjectionInvalidationRegistry;

  beforeEach(() => {
    mocks.readLibraryModule.mockReset();
    mocks.readLibraryModule.mockResolvedValue({
      ok: true,
      value: {
        libraryId: "library-1",
        storeEpoch: "epoch-1",
        changeLogSeq: 0,
        value: { kind: "metadata" },
      },
    });
    mocks.resolvePageOwnershipPath.mockReset();
    mocks.ownershipPathChangeListener = null;
    projectionListeners = new Set();
    projectionRegistry = new ProjectionInvalidationRegistry((_scope, listener) => {
      projectionListeners.add(listener);
      return () => projectionListeners.delete(listener);
    });
  });

  test("refreshes the canonical ownership path when an observed Page moves", async () => {
    let parentTitle = "Parent before move";
    mocks.resolvePageOwnershipPath.mockImplementation(async () => ({
      libraryId: "library-1",
      storeEpoch: "epoch-1",
      changeLogSeq: mocks.resolvePageOwnershipPath.mock.calls.length,
      status: "available",
      targetPageId: "nested-page",
      ancestors: [{
        pageId: "parent-page",
        title: parentTitle,
        lifecycle: "active",
      }],
    }));

    const view = render(
      <TestQueryProvider projectionRegistry={projectionRegistry}>
        <OwnershipPathHarness />
      </TestQueryProvider>,
    );

    await waitFor(() => {
      expect(view.getByText("Parent before move")).toBeTruthy();
    });
    expect(mocks.resolvePageOwnershipPath).toHaveBeenCalledTimes(1);

    parentTitle = "Parent after move";
    await act(async () => {
      for (const listener of projectionListeners) {
        listener({
          version: 1,
          kind: "changed",
          scope: {
            kind: "project",
            libraryId: "library-1",
            projectId: "host-project",
          },
          cursor: { storeEpoch: "epoch-1", changeLogSeq: 2 },
          impact: {
            kind: "resources",
            page_ids: ["parent-page"],
            database_ids: [],
            data_source_ids: [],
            view_ids: [],
            document_heads: [],
          },
        });
      }
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(view.getByText("Parent after move")).toBeTruthy();
    });
    expect(mocks.resolvePageOwnershipPath).toHaveBeenCalledTimes(2);

    parentTitle = "Parent after coarse invalidation";
    await act(async () => {
      mocks.ownershipPathChangeListener?.({
        libraryId: "library-1",
        changeKind: "access",
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(view.getByText("Parent after coarse invalidation")).toBeTruthy();
    });
    expect(mocks.resolvePageOwnershipPath).toHaveBeenCalledTimes(3);
  });
});
