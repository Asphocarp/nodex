import { describe, expect, it, vi } from "vitest";
import {
  createCardStageTabTitleStore,
  makeCardStageTabTitleKey,
} from "./card-stage-tab-title-store";

describe("card stage tab title store", () => {
  it("projects committed and live titles with publisher lifecycle fallback", () => {
    const store = createCardStageTabTitleStore();
    const key = makeCardStageTabTitleKey("session-a", "card-tab");
    const source = store.createSource(key, "Persisted snapshot");
    const listener = vi.fn();
    const unsubscribe = source.subscribe(listener);

    expect(source.getSnapshot()).toBe("Persisted snapshot");

    store.publishCommitted(key, "Committed title");
    expect(source.getSnapshot()).toBe("Committed title");

    store.publishLive(key, "Live title");
    expect(source.getSnapshot()).toBe("Live title");

    store.publishCommitted(key, "New committed title");
    expect(source.getSnapshot()).toBe("Live title");

    store.clearLive(key);
    expect(source.getSnapshot()).toBe("New committed title");

    store.release(key);
    expect(source.getSnapshot()).toBe("Persisted snapshot");
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
  });

  it("presents empty authoritative titles without leaking between tab publishers", () => {
    const store = createCardStageTabTitleStore();
    const firstKey = makeCardStageTabTitleKey("session-a", "first-card-tab");
    const secondKey = makeCardStageTabTitleKey("session-a", "second-card-tab");
    const firstSource = store.createSource(firstKey, "First snapshot");
    const secondSource = store.createSource(secondKey, "Second snapshot");

    store.publishLive(firstKey, "   ");

    expect(firstSource.getSnapshot()).toBe("Untitled");
    expect(secondSource.getSnapshot()).toBe("Second snapshot");
  });

  it("does not let a retired subscription delete a remounted publisher", () => {
    const store = createCardStageTabTitleStore();
    const key = makeCardStageTabTitleKey("session-a", "card-tab");
    const retiredSource = store.createSource(key, "Old snapshot");
    const unsubscribeRetiredSource = retiredSource.subscribe(() => undefined);

    store.release(key);
    store.publishLive(key, "Remounted live title");
    unsubscribeRetiredSource();

    const remountedSource = store.createSource(key, "New snapshot");
    expect(remountedSource.getSnapshot()).toBe("Remounted live title");
  });
});
