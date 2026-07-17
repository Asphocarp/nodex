import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { PageTargetChangedEvent } from "../../shared/page-target-events";
import type { PageOwnershipPathsChangedEvent } from "../../shared/page-ownership-path-events";
import { render } from "../test/dom";
import { TestQueryProvider } from "../test/query";
import { usePageOwnershipPathReadModel } from "./block-reference-queries";

const mocks = vi.hoisted(() => ({
  resolvePageOwnershipPath: vi.fn(),
  projectListeners: new Map<
    string,
    (event: PageTargetChangedEvent) => void
  >(),
  ownershipPathChangeListener: null as (
    (event: PageOwnershipPathsChangedEvent) => void
  ) | null,
}));

vi.mock("./api", () => ({
  resolvePageOwnershipPath: mocks.resolvePageOwnershipPath,
  readDatabaseViewReference: vi.fn(),
}));

vi.mock("./renderer-transport", () => ({
  resolveRendererTransport: () => ({
    subscribeBoardChanges: () => () => undefined,
    subscribePageTargetChanges: (
      projectId: string,
      listener: (event: PageTargetChangedEvent) => void,
    ) => {
      mocks.projectListeners.set(projectId, listener);
      return () => {
        if (mocks.projectListeners.get(projectId) === listener) {
          mocks.projectListeners.delete(projectId);
        }
      };
    },
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
  beforeEach(() => {
    mocks.projectListeners.clear();
    mocks.resolvePageOwnershipPath.mockReset();
    mocks.ownershipPathChangeListener = null;
  });

  test("refreshes the canonical ownership path when an observed Page moves", async () => {
    let parentTitle = "Parent before move";
    mocks.resolvePageOwnershipPath.mockImplementation(async () => ({
      status: "available",
      targetPageId: "nested-page",
      ancestors: [{
        pageId: "parent-page",
        title: parentTitle,
        lifecycle: "active",
      }],
    }));

    const view = render(
      <TestQueryProvider>
        <OwnershipPathHarness />
      </TestQueryProvider>,
    );

    await waitFor(() => {
      expect(view.getByText("Parent before move")).toBeTruthy();
    });
    expect(mocks.resolvePageOwnershipPath).toHaveBeenCalledTimes(1);

    parentTitle = "Parent after move";
    await act(async () => {
      mocks.projectListeners.get("host-project")?.({
        libraryId: "library-1",
        targetPageId: "parent-page",
        changeKind: "location",
      });
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
