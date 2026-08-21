import { act, render } from "@testing-library/react";
import { describe, expect, test } from "vite-plus/test";
import * as Y from "yjs";

import {
  PageTitleProjectionProvider,
  PageTitleProjectionPublisher,
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

describe("Page title projection context", () => {
  test("projects Y.Text updates and retains the last observed title after unmount", () => {
    const store = createPageTitleProjectionStore();
    const document = new Y.Doc();
    const title = document.getText("title");
    title.insert(0, "Initial title");
    const identity = { libraryId: "library-a", pageId: "page-a" };
    const screen = render(
      <PageTitleProjectionProvider currentLibraryId="library-a" store={store}>
        <PageTitleProjectionPublisher
          key="publisher"
          identity={identity}
          publisherId="editor-a"
          authorityVersion={{ generation: 1, headSeq: 1 }}
          title={title}
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

    screen.rerender(
      <PageTitleProjectionProvider currentLibraryId="library-a" store={store}>
        <PresentedTitle key="persistent-consumer" fallback="Newer canonical title" headSeq={2} />
      </PageTitleProjectionProvider>,
    );
    expect(screen.getByText("Newer canonical title")).not.toBeNull();

    document.destroy();
  });
});
