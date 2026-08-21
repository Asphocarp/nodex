import { describe, expect, it, vi } from "vite-plus/test";
import {
  createPageTitleProjectionStore,
  makePageTitleResourceKey,
} from "./page-title-projection-store";

describe("page title projection store", () => {
  it("projects one Page title across every consumer fallback", () => {
    const store = createPageTitleProjectionStore();
    const key = makePageTitleResourceKey("library-a", "page-a");
    const firstSource = store.createSource(key, "First snapshot");
    const secondSource = store.createSource(key, "Stale duplicate");
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    firstSource.subscribe(firstListener);
    secondSource.subscribe(secondListener);

    store.publishLive(key, "editor-a", "Live title");

    expect(firstSource.getSnapshot()).toBe("Live title");
    expect(secondSource.getSnapshot()).toBe("Live title");
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);
  });

  it("isolates distinct Page resources and presents empty titles", () => {
    const store = createPageTitleProjectionStore();
    const firstKey = makePageTitleResourceKey("library-a", "page-a");
    const secondKey = makePageTitleResourceKey("library-a", "page-b");
    const firstSource = store.createSource(firstKey, "First snapshot");
    const secondSource = store.createSource(secondKey, "Second snapshot");

    store.publishLive(firstKey, "editor-a", "   ");

    expect(firstSource.getSnapshot()).toBe("Untitled");
    expect(secondSource.getSnapshot()).toBe("Second snapshot");
  });

  it("keeps another editor live when one publisher retires", () => {
    const store = createPageTitleProjectionStore();
    const key = makePageTitleResourceKey("library-a", "page-a");
    const source = store.createSource(key, "Snapshot");
    const listener = vi.fn();
    source.subscribe(listener);

    store.publishLive(key, "editor-a", "First live title");
    store.publishLive(key, "editor-b", "Second live title");
    store.releasePublisher(key, "editor-b");

    expect(source.getSnapshot()).toBe("First live title");

    store.releasePublisher(key, "editor-a");
    expect(source.getSnapshot()).toBe("Snapshot");
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("does not let a retired subscription delete a remounted publisher", () => {
    const store = createPageTitleProjectionStore();
    const key = makePageTitleResourceKey("library-a", "page-a");
    const retiredSource = store.createSource(key, "Old snapshot");
    const unsubscribeRetiredSource = retiredSource.subscribe(() => undefined);

    unsubscribeRetiredSource();
    store.publishLive(key, "editor-a", "Remounted live title");
    unsubscribeRetiredSource();

    const remountedSource = store.createSource(key, "New snapshot");
    expect(remountedSource.getSnapshot()).toBe("Remounted live title");
  });
});
