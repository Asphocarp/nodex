import { act, render } from "@testing-library/react";
import { describe, expect, test } from "vite-plus/test";
import * as Y from "yjs";

import {
  PageTitleProjectionProvider,
  PageTitleProjectionPublisher,
  type PageTitleDocumentStatusSource,
  type PageTitleProjectionRetentionOwner,
  usePresentedPageTitle,
} from "./page-title-projection-context";
import { createPageTitleProjectionStore } from "./page-title-projection-store";

function PresentedTitle({
  fallback,
  headSeq = 1,
}: {
  readonly fallback: string;
  headSeq?: number;
}) {
  return (
    <span>
      {usePresentedPageTitle("page-a", fallback, undefined, {
        generation: 1,
        headSeq,
      })}
    </span>
  );
}

function createRuntime(initialHeadSeq = 1) {
  let status = {
    phase: "ready" as const,
    ready: true,
    reloadRequired: false,
    descriptor: { generation: 1 },
    provider: { generation: 1, headSeq: initialHeadSeq, pendingUpdateCount: 0 },
  };
  const listeners = new Set<() => void>();
  const runtime: PageTitleDocumentStatusSource = {
    getStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    runtime,
    publishStatus: (provider: {
      readonly headSeq: number;
      readonly pendingUpdateCount: number;
    }) => {
      status = { ...status, provider: { ...status.provider, ...provider } };
      listeners.forEach((listener) => listener());
    },
  };
}

class TestRetentionOwner implements PageTitleProjectionRetentionOwner {
  private readonly resources = new Map<string, { readonly dispose: () => void }>();

  getOrCreateRetainedResource<Resource extends { dispose(): void }>(
    key: string,
    create: () => Resource,
  ): Resource {
    const existing = this.resources.get(key);
    if (existing) return existing as Resource;
    const resource = create();
    this.resources.set(key, resource);
    return resource;
  }

  dispose(): void {
    const retained = [...this.resources.values()];
    this.resources.clear();
    retained.forEach((resource) => resource.dispose());
  }
}

describe("Page title projection context", () => {
  test("projects Y.Text updates and retains the last observed title after unmount", () => {
    const store = createPageTitleProjectionStore();
    const document = new Y.Doc();
    const title = document.getText("title");
    title.insert(0, "Initial title");
    const identity = { libraryId: "library-a", pageId: "page-a" };
    const { runtime, publishStatus } = createRuntime();
    const screen = render(
      <PageTitleProjectionProvider currentLibraryId="library-a" store={store}>
        <PageTitleProjectionPublisher
          key="publisher"
          identity={identity}
          publisherId="editor-a"
          title={title}
          runtime={runtime}
        >
          <PresentedTitle key="published-consumer" fallback="First fallback" />
        </PageTitleProjectionPublisher>
        <PresentedTitle key="persistent-consumer" fallback="Second fallback" />
      </PageTitleProjectionProvider>,
    );

    expect(screen.getAllByText("Initial title")).toHaveLength(2);

    act(() => {
      document.transact(() => {
        title.delete(0, title.length);
        title.insert(0, "Remote title");
      }, "remote-test");
    });
    expect(screen.getAllByText("Remote title")).toHaveLength(2);

    screen.rerender(
      <PageTitleProjectionProvider currentLibraryId="library-a" store={store}>
        <PresentedTitle key="persistent-consumer" fallback="Second fallback" />
      </PageTitleProjectionProvider>,
    );
    expect(screen.getByText("Remote title")).not.toBeNull();

    act(() => {
      publishStatus({ headSeq: 1, pendingUpdateCount: 1 });
      publishStatus({ headSeq: 2, pendingUpdateCount: 0 });
    });

    screen.rerender(
      <PageTitleProjectionProvider currentLibraryId="library-a" store={store}>
        <PresentedTitle key="persistent-consumer" fallback="Newer canonical title" headSeq={3} />
      </PageTitleProjectionProvider>,
    );
    expect(screen.getByText("Newer canonical title")).not.toBeNull();

    document.destroy();
  });

  test("keeps the Y.Text publisher with a retained editor session while its React view detaches", () => {
    const store = createPageTitleProjectionStore();
    const document = new Y.Doc();
    const title = document.getText("title");
    title.insert(0, "123");
    const identity = { libraryId: "library-a", pageId: "page-a" };
    const { runtime, publishStatus } = createRuntime();
    const retentionOwner = new TestRetentionOwner();

    const renderTree = (showPublisher: boolean) => (
      <PageTitleProjectionProvider currentLibraryId="library-a" store={store}>
        {showPublisher ? (
          <PageTitleProjectionPublisher
            identity={identity}
            publisherId="editor-a"
            title={title}
            runtime={runtime}
            retentionOwner={retentionOwner}
          >
            <span>Editor</span>
          </PageTitleProjectionPublisher>
        ) : null}
        <PresentedTitle fallback="123" />
      </PageTitleProjectionProvider>
    );
    const screen = render(renderTree(true));

    act(() => {
      document.transact(() => {
        title.delete(0, title.length);
        title.insert(0, "ABC");
      });
      publishStatus({ headSeq: 1, pendingUpdateCount: 1 });
    });
    expect(screen.getByText("ABC")).not.toBeNull();

    screen.rerender(renderTree(false));
    expect(screen.getByText("ABC")).not.toBeNull();

    act(() => {
      publishStatus({ headSeq: 2, pendingUpdateCount: 0 });
      document.transact(() => {
        title.delete(0, title.length);
        title.insert(0, "Remote while detached");
      }, "remote-test");
      publishStatus({ headSeq: 3, pendingUpdateCount: 0 });
    });
    expect(screen.getByText("Remote while detached")).not.toBeNull();

    act(() => retentionOwner.dispose());
    document.destroy();
  });
});
