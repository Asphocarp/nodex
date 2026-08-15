import { describe, expect, it } from "vitest";
import { createPageReferenceSearchController } from "./search-controller";
import type { PageReferenceCandidate, PageReferencePickerRequest } from "./types";

const request = (query: string): PageReferencePickerRequest => ({
  accessContext: { kind: "library" },
  hostPageId: null,
  ancestorPageIds: [],
  intent: "mention",
  query,
  limit: 20,
});

describe("Page reference search controller", () => {
  it("fails closed when an older response settles after a newer request", async () => {
    const resolvers = new Map<string, (items: PageReferenceCandidate[]) => void>();
    const controller = createPageReferenceSearchController((input) =>
      new Promise((resolve) => resolvers.set(input.query, resolve))
    );
    const oldSearch = controller.search(request("old"));
    const currentSearch = controller.search(request("current"));
    resolvers.get("current")?.([]);
    expect(await currentSearch).toEqual({ status: "current", items: [] });
    resolvers.get("old")?.([]);
    expect(await oldSearch).toEqual({ status: "stale", items: [] });
  });
});
