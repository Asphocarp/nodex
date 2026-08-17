import { fireEvent, render } from "@testing-library/react";
import type { BlockNoteEditor } from "@blocknote/core";
import { describe, expect, test } from "vitest";
import { act, useEffect } from "react";
import { BlockNoteContext } from "../../editor/BlockNoteContext.js";
import { SuggestionMenuWrapper } from "./SuggestionMenuWrapper.js";
import { useGridSuggestionMenuKeyboardNavigation } from "./GridSuggestionMenu/hooks/useGridSuggestionMenuKeyboardNavigation.js";
import { useLoadSuggestionMenuItems } from "./hooks/useLoadSuggestionMenuItems.js";
import { useSuggestionMenuKeyboardNavigation } from "./hooks/useSuggestionMenuKeyboardNavigation.js";
import { SuggestionMenuProps } from "./types.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

function createFakeEditor(domElement = document.createElement("div")): BlockNoteEditor {
  const editor = {
    domElement,
    _tiptapEditor: {
      on: () => undefined,
      off: () => undefined,
    },
    getExtension: () => undefined,
  };

  return editor as unknown as BlockNoteEditor;
}

function LoadItemsHarness<T>({
  getItems,
  getImmediateItems,
  onSnapshot,
  query,
  requestScopeKey,
}: {
  getItems: (query: string) => Promise<T[]>;
  getImmediateItems?: (query: string) => T[];
  onSnapshot: (snapshot: ReturnType<typeof useLoadSuggestionMenuItems<T>>) => void;
  query: string;
  requestScopeKey?: string;
}) {
  const snapshot = useLoadSuggestionMenuItems(
    query,
    getItems,
    getImmediateItems,
    requestScopeKey,
  );

  useEffect(() => {
    onSnapshot(snapshot);
  }, [onSnapshot, snapshot]);

  return null;
}

function SuggestionNavigationHarness({
  items,
  liveQuery,
  onItemClick,
  query,
  target,
  usedQuery,
}: {
  items: string[];
  liveQuery: string;
  onItemClick: (item: string) => void;
  query: string;
  target: HTMLElement;
  usedQuery: string | undefined;
  }) {
  useSuggestionMenuKeyboardNavigation(
    createFakeEditor(),
    query,
    items,
    usedQuery,
    onItemClick,
    () => liveQuery,
    target,
  );

  return null;
}

function GridNavigationHarness({
  editor,
  items,
  liveQuery,
  onItemClick,
  query,
  usedQuery,
}: {
  editor: ReturnType<typeof createFakeEditor>;
  items: string[];
  liveQuery: string;
  onItemClick: (item: string) => void;
  query: string;
  usedQuery: string | undefined;
  }) {
  useGridSuggestionMenuKeyboardNavigation(
    editor,
    query,
    items,
    3,
    usedQuery,
    onItemClick,
    () => liveQuery,
  );

  return null;
}

describe("suggestion menu freshness", () => {
  test("publishes query-fresh synchronous items before async enrichment resolves", () => {
    const deferred = createDeferred<string[]>();
    let latest: ReturnType<typeof useLoadSuggestionMenuItems<string>> | undefined;
    render(
      <LoadItemsHarness
        query="canon"
        getItems={() => deferred.promise}
        getImmediateItems={(query) => [`metadata:${query}`]}
        onSnapshot={(snapshot) => {
          latest = snapshot;
        }}
      />,
    );

    expect(latest?.items).toEqual(["metadata:canon"]);
    expect(latest?.usedQuery).toBe("canon");
    expect(latest?.loadingState).toBe("loading");
  });

  test("invalidates same-query items when the authorization scope changes", async () => {
    const first = createDeferred<string[]>();
    const second = createDeferred<string[]>();
    let latest: ReturnType<typeof useLoadSuggestionMenuItems<string>> | undefined;
    const onSnapshot = (snapshot: ReturnType<typeof useLoadSuggestionMenuItems<string>>) => {
      latest = snapshot;
    };
    const view = render(
      <LoadItemsHarness
        query="page"
        requestScopeKey="project:one"
        getItems={() => first.promise}
        getImmediateItems={() => ["project-one"]}
        onSnapshot={onSnapshot}
      />,
    );
    expect(latest?.items).toEqual(["project-one"]);

    view.rerender(
      <LoadItemsHarness
        query="page"
        requestScopeKey="project:two"
        getItems={() => second.promise}
        getImmediateItems={() => ["project-two"]}
        onSnapshot={onSnapshot}
      />,
    );
    expect(latest?.items).toEqual(["project-two"]);
    expect(latest?.usedRequestScopeKey).toBe("project:two");

    await act(async () => {
      first.resolve(["stale project-one"]);
      await Promise.resolve();
      second.resolve(["fresh project-two"]);
      await Promise.resolve();
    });
    expect(latest?.items).toEqual(["fresh project-two"]);
    expect(latest?.usedRequestScopeKey).toBe("project:two");
  });

  test("ignores older same-query item requests when a newer request finishes first", async () => {
    const first = createDeferred<string[]>();
    const second = createDeferred<string[]>();
    const snapshots: Array<ReturnType<typeof useLoadSuggestionMenuItems<string>>> = [];
    const onSnapshot = (snapshot: ReturnType<typeof useLoadSuggestionMenuItems<string>>) => {
      snapshots.push(snapshot);
    };

    const view = render(
      <LoadItemsHarness
        query="now"
        getItems={() => first.promise}
        onSnapshot={onSnapshot}
      />,
    );

    view.rerender(
      <LoadItemsHarness
        query="now"
        getItems={() => second.promise}
        onSnapshot={onSnapshot}
      />,
    );

    await act(async () => {
      second.resolve(["fresh now"]);
      await Promise.resolve();
    });

    expect(snapshots.at(-1)?.items.length).toBe(1);
    expect(snapshots.at(-1)?.items[0]).toBe("fresh now");
    expect(snapshots.at(-1)?.usedQuery).toBe("now");

    await act(async () => {
      first.resolve(["stale now"]);
      await Promise.resolve();
    });

    expect(snapshots.at(-1)?.items.length).toBe(1);
    expect(snapshots.at(-1)?.items[0]).toBe("fresh now");
  });

  test("defers stale Enter and accepts the first fresh item for the live query", async () => {
    const target = document.createElement("div");
    const clickedItems: string[] = [];
    const onItemClick = (item: string) => {
      clickedItems.push(item);
    };
    const view = render(
      <SuggestionNavigationHarness
        query="no"
        usedQuery="no"
        liveQuery="now"
        items={["no item"]}
        target={target}
        onItemClick={onItemClick}
      />,
    );

    target.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }));

    expect(clickedItems.length).toBe(0);

    view.rerender(
      <SuggestionNavigationHarness
        query="now"
        usedQuery="now"
        liveQuery="now"
        items={["now item", "other item"]}
        target={target}
        onItemClick={onItemClick}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(clickedItems.length).toBe(1);
    expect(clickedItems[0]).toBe("now item");
  });

  test("ignores stale mouse clicks in the wrapper without closing the menu", async () => {
    let closeMenuCalls = 0;
    let clearQueryCalls = 0;
    let itemClickCalls = 0;
    const closeMenu = () => {
      closeMenuCalls += 1;
    };
    const clearQuery = () => {
      clearQueryCalls += 1;
    };
    const onItemClick = () => {
      itemClickCalls += 1;
    };
    const fakeSuggestionMenu = {
      getMenuState: () => ({
        triggerCharacter: "@",
        query: "now",
        show: true,
      }),
    };
    const editor = {
      ...createFakeEditor(),
      getExtension: () => fakeSuggestionMenu,
    };

    function MenuComponent({
      items,
      onItemClick: clickItem,
    }: SuggestionMenuProps<string>) {
      return (
        <button type="button" onClick={() => clickItem?.(items[0]!)}>
          stale item
        </button>
      );
    }

    const view = render(
      <BlockNoteContext.Provider
        value={{
          editor,
          setContentEditableProps: () => undefined,
        }}
      >
        <SuggestionMenuWrapper
          triggerCharacter="@"
          query="no"
          closeMenu={closeMenu}
          clearQuery={clearQuery}
          getItems={async () => ["no item"]}
          onItemClick={onItemClick}
          suggestionMenuComponent={MenuComponent}
        />
      </BlockNoteContext.Provider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(view.getByText("stale item"));

    expect(itemClickCalls).toBe(0);
    expect(closeMenuCalls).toBe(0);
    expect(clearQueryCalls).toBe(0);
  });

  test("can activate a fresh utility item without closing or clearing the menu", async () => {
    let closeMenuCalls = 0;
    let clearQueryCalls = 0;
    const clickedItems: string[] = [];
    const fakeSuggestionMenu = {
      getMenuState: () => ({
        triggerCharacter: "@",
        query: "now",
        show: true,
      }),
    };
    const editor = {
      ...createFakeEditor(),
      getExtension: () => fakeSuggestionMenu,
    };

    function MenuComponent({
      items,
      onItemClick,
    }: SuggestionMenuProps<string>) {
      return (
        <button type="button" onClick={() => onItemClick?.(items[0]!)}>
          more results
        </button>
      );
    }

    const view = render(
      <BlockNoteContext.Provider
        value={{ editor, setContentEditableProps: () => undefined }}
      >
        <SuggestionMenuWrapper
          triggerCharacter="@"
          query="now"
          closeMenu={() => { closeMenuCalls += 1; }}
          clearQuery={() => { clearQueryCalls += 1; }}
          getItems={async () => ["more"]}
          onItemClick={(item) => { clickedItems.push(item); }}
          shouldCloseOnItemClick={() => false}
          suggestionMenuComponent={MenuComponent}
        />
      </BlockNoteContext.Provider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(view.getByText("more results"));

    expect(clickedItems).toEqual(["more"]);
    expect(closeMenuCalls).toBe(0);
    expect(clearQueryCalls).toBe(0);

    editor.domElement.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }));
    expect(clickedItems).toEqual(["more", "more"]);
    expect(closeMenuCalls).toBe(0);
    expect(clearQueryCalls).toBe(0);
  });

  test("applies the same stale Enter guard to grid suggestion menus", async () => {
    const editor = createFakeEditor();
    const clickedItems: string[] = [];
    const onItemClick = (item: string) => {
      clickedItems.push(item);
    };
    const view = render(
      <GridNavigationHarness
        editor={editor}
        query="no"
        usedQuery="no"
        liveQuery="now"
        items={["no item"]}
        onItemClick={onItemClick}
      />,
    );

    editor.domElement.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }));

    expect(clickedItems.length).toBe(0);

    view.rerender(
      <GridNavigationHarness
        editor={editor}
        query="now"
        usedQuery="now"
        liveQuery="now"
        items={["now grid item", "other grid item"]}
        onItemClick={onItemClick}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(clickedItems.length).toBe(1);
    expect(clickedItems[0]).toBe("now grid item");
  });
});
