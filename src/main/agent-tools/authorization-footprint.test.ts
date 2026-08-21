import { describe, expect, test } from "vitest";
import { authorizationFootprint, sameAuthorizationFootprint } from "./authorization-footprint";

const base = authorizationFootprint({
  tool: "edit_document",
  projectId: "project-1",
  effect: "destructive",
  resources: ["block:b", "document:d", "block:a", "block:a"],
  deletions: ["block:b"],
  transformations: ["nfm.replace"],
});

describe("Nodex Agent authorization footprint", () => {
  test("is order-independent but rejects expanded destructive scope", () => {
    expect(
      sameAuthorizationFootprint(base, {
        ...base,
        resources: ["block:a", "block:b", "document:d"],
      }),
    ).toBe(true);
    expect(
      sameAuthorizationFootprint(base, {
        ...base,
        deletions: ["block:b", "block:c"],
      }),
    ).toBe(false);
  });

  test("binds effect class and transformation choices", () => {
    expect(sameAuthorizationFootprint(base, { ...base, effect: "write" })).toBe(false);
    expect(
      sameAuthorizationFootprint(base, {
        ...base,
        transformations: ["nfm.patch"],
      }),
    ).toBe(false);
  });
});
