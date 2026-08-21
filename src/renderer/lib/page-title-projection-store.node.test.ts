import { describe, expect, it, vi } from "vite-plus/test";
import {
  createPageTitleProjectionStore,
  makePageTitleResourceKey,
} from "./page-title-projection-store";

describe("page title projection store", () => {
  const version = (headSeq: number) => ({ generation: 1, headSeq });

  it("projects one Page title across every consumer fallback", () => {
    const store = createPageTitleProjectionStore();
    const key = makePageTitleResourceKey("library-a", "page-a");
    const firstSource = store.createSource(key, "First snapshot");
    const secondSource = store.createSource(key, "Stale duplicate");
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    firstSource.subscribe(firstListener);
    secondSource.subscribe(secondListener);

    store.publishLive(key, "editor-a", "Live title", version(1));

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

    store.publishLive(firstKey, "editor-a", "   ", version(1));

    expect(firstSource.getSnapshot()).toBe("Untitled");
    expect(secondSource.getSnapshot()).toBe("Second snapshot");
  });

  it("keeps another editor live when one publisher retires", () => {
    const store = createPageTitleProjectionStore();
    const key = makePageTitleResourceKey("library-a", "page-a");
    const source = store.createSource(key, "Snapshot");
    const listener = vi.fn();
    source.subscribe(listener);

    store.publishLive(key, "editor-a", "First live title", version(1));
    store.publishLive(key, "editor-b", "Second live title", version(1));
    store.releasePublisher(key, "editor-b");

    expect(source.getSnapshot()).toBe("First live title");

    store.releasePublisher(key, "editor-a");
    expect(source.getSnapshot()).toBe("First live title");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("retains the last live title until a canonical Document head materializes it", () => {
    const store = createPageTitleProjectionStore();
    const key = makePageTitleResourceKey("library-a", "page-a");
    const source = store.createSource(key, "Cold tab snapshot");
    const listener = vi.fn();
    source.subscribe(listener);

    store.publishCanonical(key, "Initial title", version(4));
    store.publishLive(key, "editor-a", "Renamed title", version(4));
    store.publishCanonical(key, "Initial title", version(5));
    store.releasePublisher(key, "editor-a");

    expect(source.getSnapshot()).toBe("Renamed title");

    store.publishCanonical(key, "Renamed title", version(6));

    expect(source.getSnapshot()).toBe("Renamed title");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("lets a newer canonical Document head supersede a retained live title", () => {
    const store = createPageTitleProjectionStore();
    const key = makePageTitleResourceKey("library-a", "page-a");
    const source = store.createSource(key, "Cold tab snapshot");
    source.subscribe(() => undefined);

    store.publishCanonical(key, "Initial title", version(7));
    store.publishLive(key, "editor-a", "Local title", version(7));
    store.releasePublisher(key, "editor-a");
    store.publishCanonical(key, "Stale projection", version(6));

    expect(source.getSnapshot()).toBe("Local title");

    store.publishCanonical(key, "Newer remote title", version(8));

    expect(source.getSnapshot()).toBe("Newer remote title");
  });

  it("does not let a retired subscription delete a remounted publisher", () => {
    const store = createPageTitleProjectionStore();
    const key = makePageTitleResourceKey("library-a", "page-a");
    const retiredSource = store.createSource(key, "Old snapshot");
    const unsubscribeRetiredSource = retiredSource.subscribe(() => undefined);

    unsubscribeRetiredSource();
    store.publishLive(key, "editor-a", "Remounted live title", version(1));
    unsubscribeRetiredSource();

    const remountedSource = store.createSource(key, "New snapshot");
    expect(remountedSource.getSnapshot()).toBe("Remounted live title");
  });

  it("bounds retained titles after their consumers unmount", () => {
    const store = createPageTitleProjectionStore({ maxRetainedTitles: 1 });
    const firstKey = makePageTitleResourceKey("library-a", "page-a");
    const secondKey = makePageTitleResourceKey("library-a", "page-b");

    for (const [key, title] of [
      [firstKey, "First live title"],
      [secondKey, "Second live title"],
    ] as const) {
      const source = store.createSource(key, "Snapshot");
      const unsubscribe = source.subscribe(() => undefined);
      store.publishLive(key, "editor", title, version(1));
      store.releasePublisher(key, "editor");
      unsubscribe();
    }

    expect(store.createSource(firstKey, "First fallback").getSnapshot()).toBe("First fallback");
    expect(store.createSource(secondKey, "Second fallback").getSnapshot()).toBe(
      "Second live title",
    );
  });
});
