import { act, render } from "@testing-library/react";
import { describe, expect, test } from "vite-plus/test";
import * as Y from "yjs";

import {
  PageTitleProjectionProvider,
  PageTitleProjectionPublisher,
  usePresentedPageTitle,
} from "./page-title-projection-context";
import { createPageTitleProjectionStore } from "./page-title-projection-store";

function PresentedTitle({ fallback }: { readonly fallback: string }) {
  return <span>{usePresentedPageTitle("page-a", fallback)}</span>;
}

describe("Page title projection context", () => {
  test("projects Y.Text updates and releases only the mounted publisher", () => {
    const store = createPageTitleProjectionStore();
    const document = new Y.Doc();
    const title = document.getText("title");
    title.insert(0, "Initial title");
    const identity = { libraryId: "library-a", pageId: "page-a" };
    const screen = render(
      <PageTitleProjectionProvider currentLibraryId="library-a" store={store}>
        <PageTitleProjectionPublisher identity={identity} publisherId="editor-a" title={title}>
          <PresentedTitle fallback="First fallback" />
        </PageTitleProjectionPublisher>
        <PresentedTitle fallback="Second fallback" />
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
        <PresentedTitle fallback="Second fallback" />
      </PageTitleProjectionProvider>,
    );
    expect(screen.getByText("Second fallback")).not.toBeNull();

    document.destroy();
  });
});
