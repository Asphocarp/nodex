import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  PAGE_DOCUMENT_SCHEMA_VERSION,
  plainTextToPortableRichText,
} from "../../shared/block-documents";
import type { PageTargetChangedEvent } from "../../shared/page-target-events";
import type { PageTargetReadModel } from "../../shared/page-targets";
import { render } from "../test/dom";
import { TestQueryProvider } from "../test/query";
import { usePageTargetReadModels } from "./block-reference-queries";

const mocks = vi.hoisted(() => ({
  resolvePageTarget: vi.fn(),
  projectListeners: new Map<
    string,
    (event: PageTargetChangedEvent) => void
  >(),
}));

vi.mock("./api", () => ({
  resolvePageTarget: mocks.resolvePageTarget,
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
  }),
}));

function availableTarget(
  pageId: string,
  title: string,
): Extract<PageTargetReadModel, { readonly status: "available" }> {
  return {
    status: "available",
    targetPageId: pageId,
    page: {
      pageId: pageId,
      libraryId: "library:canonical",
      lifecycle: "active",
      parent: { kind: "page", pageId: "host-page" },
      parentRevision: 1,
      metadataRevision: 1,
      documentId: `document:${pageId}`,
      documentGeneration: 1,
      documentHeadSeq: 2,
      title,
      richTitle: plainTextToPortableRichText(title),
      preview: "",
      plainText: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    document: {
      readiness: "ready",
      schemaKey: "nodex.page",
      schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION,
    },
  };
}

function BreadcrumbTargetHarness() {
  const targets = usePageTargetReadModels("host-project", [
    "grandparent-card",
    "parent-card",
  ]);
  return (
    <output>
      {targets.map((target) =>
        target.data?.status === "available"
          ? target.data.page.title
          : "pending").join("|")}
    </output>
  );
}

describe("usePageTargetReadModels", () => {
  beforeEach(() => {
    mocks.projectListeners.clear();
    mocks.resolvePageTarget.mockReset();
  });

  test("keeps every ancestor fresh through identity-specific invalidation", async () => {
    const titles = new Map([
      ["grandparent-card", "Grandparent"],
      ["parent-card", "Parent before rename"],
    ]);
    mocks.resolvePageTarget.mockImplementation(
      async ({ targetPageId }: { targetPageId: string }) =>
        availableTarget(targetPageId, titles.get(targetPageId) ?? "Untitled"),
    );

    const view = render(
      <TestQueryProvider>
        <BreadcrumbTargetHarness />
      </TestQueryProvider>,
    );

    await waitFor(() => {
      expect(view.getByText("Grandparent|Parent before rename")).toBeTruthy();
    });
    expect(mocks.resolvePageTarget).toHaveBeenCalledTimes(2);

    titles.set("parent-card", "Parent after rename");
    await act(async () => {
      mocks.projectListeners.get("host-project")?.({
        libraryId: "library-1",
        targetPageId: "parent-card",
        changeKind: "content",
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(view.getByText("Grandparent|Parent after rename")).toBeTruthy();
    });
    expect(mocks.resolvePageTarget).toHaveBeenCalledTimes(3);
  });
});
