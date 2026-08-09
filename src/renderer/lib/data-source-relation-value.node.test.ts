import { describe, expect, test } from "vitest";
import { readRelationValuePreview } from "./data-source-relation-value";

const relationValue = {
  kind: "relation",
  value: {
    value_revision: 4,
    total_count: 2,
    targets: [{
      kind: "visible",
      edge_id: "a".repeat(64),
      page_id: "page-visible",
      title: "Visible task",
      lifecycle: "active",
      membership_state: "active_in_target_source",
    }],
    restricted_count: 1,
    has_more: true,
  },
};

describe("Relation value preview", () => {
  test("projects complete visible targets without inventing restricted identities", () => {
    expect(readRelationValuePreview(relationValue)).toEqual({
      valueRevision: 4,
      totalCount: 2,
      targets: [{
        kind: "visible",
        edgeId: "a".repeat(64),
        pageId: "page-visible",
        title: "Visible task",
        lifecycle: "active",
        membershipState: "active_in_target_source",
      }],
      restrictedCount: 1,
      hasMore: true,
    });
    expect(readRelationValuePreview({
      kind: "relation",
      value: { ...relationValue.value, targets: [{ kind: "restricted", page_id: "leak" }] },
    })).toBeNull();
  });

  test("rejects the entire preview when any authority field or target is malformed", () => {
    expect(readRelationValuePreview({
      kind: "relation",
      value: { ...relationValue.value, targets: [{}] },
    })).toBeNull();
    expect(readRelationValuePreview({
      kind: "relation",
      value: { ...relationValue.value, value_revision: -1 },
    })).toBeNull();
    expect(readRelationValuePreview({
      kind: "relation",
      value: { ...relationValue.value, restricted_count: 3 },
    })).toBeNull();
    expect(readRelationValuePreview({
      kind: "relation",
      value: { ...relationValue.value, has_more: false },
    })).toBeNull();
  });
});
